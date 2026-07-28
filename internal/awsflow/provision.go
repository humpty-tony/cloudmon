package awsflow

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"
)

const targetID = "cloudmon-queue"

// Names are the resources CloudMon creates. Both are prefixed cloudmon- so they are
// obviously ours and easy to find/remove.
type Names struct {
	Queue string
	Rule  string
}

// DefaultNames returns the standard resource names for a region.
func DefaultNames(region string) Names {
	return Names{Queue: "cloudmon-capture-" + region, Rule: "cloudmon-cloudtrail"}
}

// RegionFromQueueURL pulls the AWS region out of an SQS queue URL, or "" if it can't.
// The SQS client must sign for the queue's own region, which may differ from the
// profile default. Handles https://sqs.<region>.amazonaws.com/... and the legacy
// https://<region>.queue.amazonaws.com/... forms.
func RegionFromQueueURL(u string) string {
	if i := strings.Index(u, "sqs."); i >= 0 {
		rest := u[i+len("sqs."):]
		if j := strings.IndexByte(rest, '.'); j > 0 {
			return rest[:j]
		}
	}
	if i := strings.Index(u, ".queue."); i >= 0 {
		if s := strings.Index(u, "://"); s >= 0 && s+3 < i {
			return u[s+3 : i]
		}
	}
	return ""
}

// Infra is the handle to a provisioned Flow A pipeline, returned to the UI and used
// for teardown.
type Infra struct {
	QueueURL string `json:"queueUrl"`
	QueueArn string `json:"queueArn"`
	RuleName string `json:"ruleName"`
	RuleArn  string `json:"ruleArn"`
	Region   string `json:"region"`
	Account  string `json:"account"`
	AllMgmt  bool   `json:"allManagement"`
	Owned    bool   `json:"owned"` // true = CloudMon created it (safe to tear down); false = the user's existing queue
}

// ProvisionError names the AWS action that failed so the UI can tell the user
// exactly which permission to add.
type ProvisionError struct {
	Action string
	Err    error
}

func (e *ProvisionError) Error() string { return e.Action + ": " + e.Err.Error() }
func (e *ProvisionError) Unwrap() error { return e.Err }

// CheckQueue confirms an existing queue is reachable and readable with the current
// credentials (read-only GetQueueAttributes), so the connect screen can block before the
// user loads from a queue that's wrong, in another region, or off-limits.
func CheckQueue(ctx context.Context, cfg aws.Config, queueURL string) error {
	if _, err := sqs.NewFromConfig(cfg).GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
		QueueUrl:       aws.String(queueURL),
		AttributeNames: []sqstypes.QueueAttributeName{sqstypes.QueueAttributeNameQueueArn},
	}); err != nil {
		return fmt.Errorf("can't read that SQS queue - check the URL, its region, and your permissions: %w", err)
	}
	return nil
}

// Provision creates the SQS queue, its delivery policy, the EventBridge rule (in the
// all-management-events state by default), and the rule→queue target. On any failure
// it returns the partially-built Infra so the caller can roll back.
// randSuffix returns 8 hex chars so each capture provisions uniquely-named resources -
// a re-deploy (or a still-existing queue from a prior run) can't collide and fail.
func randSuffix() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "0"
	}
	return hex.EncodeToString(b)
}

func Provision(ctx context.Context, cfg aws.Config, account, region, pattern string, allMgmt bool) (Infra, error) {
	sfx := randSuffix()
	names := Names{Queue: "cloudmon-capture-" + region + "-" + sfx, Rule: "cloudmon-cloudtrail-" + sfx}
	if pattern == "" {
		pattern = BuildEventPattern(allMgmt)
	}
	sqsc := sqs.NewFromConfig(cfg)
	ebc := eventbridge.NewFromConfig(cfg)
	infra := Infra{RuleName: names.Rule, Region: region, Account: account, AllMgmt: allMgmt, Owned: true}

	// 1. Queue.
	cq, err := sqsc.CreateQueue(ctx, &sqs.CreateQueueInput{QueueName: aws.String(names.Queue)})
	if err != nil {
		if strings.Contains(err.Error(), "QueueDeletedRecently") {
			return infra, &ProvisionError{"sqs:CreateQueue", fmt.Errorf("a queue named %s was deleted in the last ~60s - wait a minute and retry: %w", names.Queue, err)}
		}
		return infra, &ProvisionError{"sqs:CreateQueue", err}
	}
	infra.QueueURL = aws.ToString(cq.QueueUrl)

	// 2. Real, partition-correct queue ARN (never synthesized).
	ga, err := sqsc.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
		QueueUrl:       cq.QueueUrl,
		AttributeNames: []sqstypes.QueueAttributeName{sqstypes.QueueAttributeNameQueueArn},
	})
	if err != nil {
		return infra, &ProvisionError{"sqs:GetQueueAttributes", err}
	}
	infra.QueueArn = ga.Attributes[string(sqstypes.QueueAttributeNameQueueArn)]

	// 3. Rule - before the queue policy, so we can use the ARN PutRule returns. That
	// ARN carries the correct partition (aws / aws-us-gov / aws-cn); synthesizing it
	// as arn:aws:... would make the policy's SourceArn condition never match outside
	// the standard partition, silently denying every delivery.
	pr, err := ebc.PutRule(ctx, &eventbridge.PutRuleInput{
		Name:         aws.String(names.Rule),
		EventPattern: aws.String(pattern),
		State:        RuleState(allMgmt),
		Description:  aws.String("CloudMon live CloudTrail capture (safe to delete)"),
	})
	if err != nil {
		return infra, &ProvisionError{"events:PutRule", err}
	}
	infra.RuleArn = aws.ToString(pr.RuleArn)

	// 4. Queue policy - allow EventBridge to deliver, but only from THIS rule.
	if _, err := sqsc.SetQueueAttributes(ctx, &sqs.SetQueueAttributesInput{
		QueueUrl:   cq.QueueUrl,
		Attributes: map[string]string{string(sqstypes.QueueAttributeNamePolicy): queuePolicy(infra.QueueArn, infra.RuleArn)},
	}); err != nil {
		return infra, &ProvisionError{"sqs:SetQueueAttributes", err}
	}

	// 5. Target. PutTargets returns HTTP 200 with FailedEntryCount>0 when the target
	// is rejected - check it, or a rule with no working target looks like success.
	pt, err := ebc.PutTargets(ctx, &eventbridge.PutTargetsInput{
		Rule:    aws.String(names.Rule),
		Targets: []ebtypes.Target{{Id: aws.String(targetID), Arn: aws.String(infra.QueueArn)}},
	})
	if err != nil {
		return infra, &ProvisionError{"events:PutTargets", err}
	}
	if pt.FailedEntryCount > 0 {
		msg := "target rejected by EventBridge"
		if len(pt.FailedEntries) > 0 {
			msg = aws.ToString(pt.FailedEntries[0].ErrorCode) + ": " + aws.ToString(pt.FailedEntries[0].ErrorMessage)
		}
		return infra, &ProvisionError{"events:PutTargets", errors.New(msg)}
	}

	return infra, nil
}

// Teardown removes exactly what Provision created, in reverse order. It is
// best-effort: every step is attempted and errors are joined, so one stuck delete
// doesn't strand the rest.
func Teardown(ctx context.Context, cfg aws.Config, infra Infra) error {
	if !infra.Owned {
		return nil // never delete infrastructure CloudMon didn't create (existing-queue mode)
	}
	ebc := eventbridge.NewFromConfig(cfg)
	sqsc := sqs.NewFromConfig(cfg)
	var errs []error
	if infra.RuleName != "" {
		if _, err := ebc.RemoveTargets(ctx, &eventbridge.RemoveTargetsInput{
			Rule: aws.String(infra.RuleName),
			Ids:  []string{targetID},
		}); err != nil {
			errs = append(errs, &ProvisionError{"events:RemoveTargets", err})
		}
		if _, err := ebc.DeleteRule(ctx, &eventbridge.DeleteRuleInput{Name: aws.String(infra.RuleName)}); err != nil {
			errs = append(errs, &ProvisionError{"events:DeleteRule", err})
		}
	}
	if infra.QueueURL != "" {
		if _, err := sqsc.DeleteQueue(ctx, &sqs.DeleteQueueInput{QueueUrl: aws.String(infra.QueueURL)}); err != nil {
			errs = append(errs, &ProvisionError{"sqs:DeleteQueue", err})
		}
	}
	return errors.Join(errs...)
}

// queuePolicy allows EventBridge to deliver to the queue, but only from THIS rule
// (SourceArn condition) - nothing else can send to it. Built via encoding/json so
// every ARN value is escaped correctly regardless of content.
func queuePolicy(queueArn, ruleArn string) string {
	b, _ := json.Marshal(map[string]any{
		"Version": "2012-10-17",
		"Statement": []map[string]any{{
			"Sid":       "CloudMonEventBridgeDelivery",
			"Effect":    "Allow",
			"Principal": map[string]string{"Service": "events.amazonaws.com"},
			"Action":    "sqs:SendMessage",
			"Resource":  queueArn,
			"Condition": map[string]any{"ArnEquals": map[string]string{"aws:SourceArn": ruleArn}},
		}},
	})
	return string(b)
}
