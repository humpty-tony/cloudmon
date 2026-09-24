// Package awsflow implements CloudMon's live "Flow A" ingestion against AWS: it
// enumerates local ~/.aws profiles, confirms identity via STS, provisions a
// parallel EventBridge rule + SQS queue (never touching the customer's trail), and
// polls the queue for CloudTrail events. Pure Go (no CGO) so the app builds and
// cross-compiles for Windows, macOS, and Linux.
package awsflow

import (
	"encoding/json"
	"fmt"
	"strings"

	ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
)

// Event patterns constrain the Management category to prevent collector data-event
// feedback. CloudTrail
// API-call events reach EventBridge with source "aws.<service>" (aws.ec2, aws.iam,
// aws.kms, …), not "aws.cloudtrail", so constraining source would drop nearly every
// event. detail-type "AWS API Call via CloudTrail" catches all management API calls;
// adding "AWS Console Sign In via CloudTrail" catches console logins (incl. failed
// MFA). The default keeps read-only calls (AssumeRole, kms:Decrypt, GetSecretValue)
// that a plain rule drops; the write-only variant is the opt-out.
const (
	// AWS's CloudTrail and EventBridge guides spell the sign-in type differently;
	// accept both documented forms, plus management console actions/service events.
	patternAllManagement = `{"detail-type":["AWS API Call via CloudTrail","AWS Console Sign In via CloudTrail","AWS Console Signin via CloudTrail","AWS Console Action via CloudTrail","AWS Service Event via CloudTrail"],"detail":{"eventCategory":["Management"]}}`
	patternWriteOnly     = `{"detail-type":["AWS API Call via CloudTrail"],"detail":{"eventCategory":["Management"],"readOnly":[false]}}`
)

// BuildEventPattern returns the EventBridge event pattern for the chosen scope.
func BuildEventPattern(allManagement bool) string {
	if allManagement {
		return patternAllManagement
	}
	return patternWriteOnly
}

// RuleState returns the EventBridge rule state. All-management capture REQUIRES the
// ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS state - a plain ENABLED rule silently
// drops read-only management events (the crown-jewel forensic trail).
func RuleState(allManagement bool) ebtypes.RuleState {
	if allManagement {
		return ebtypes.RuleStateEnabledWithAllCloudtrailManagementEvents
	}
	return ebtypes.RuleStateEnabled
}

// ConstrainManagementPattern applies the same capture restrictions to custom rules.
func ConstrainManagementPattern(pattern string, allManagement bool) (string, error) {
	if strings.TrimSpace(pattern) == "" {
		return BuildEventPattern(allManagement), nil
	}
	var p map[string]any
	if err := json.Unmarshal([]byte(pattern), &p); err != nil || p == nil {
		return "", fmt.Errorf("capture pattern must be a JSON object")
	}
	// EventBridge joins nested paths with dots. Reject dotted field keys, including
	// inside $or, so they cannot collide with the restrictions inserted below.
	if err := validateNestedPatternKeys(p); err != nil {
		return "", err
	}
	detail := map[string]any{}
	if v, ok := p["detail"]; ok {
		var valid bool
		detail, valid = v.(map[string]any)
		if !valid {
			return "", fmt.Errorf("capture pattern detail must be an object")
		}
	}
	if v, ok := detail["eventCategory"]; ok {
		b, _ := json.Marshal(v)
		if string(b) != `["Management"]` {
			return "", fmt.Errorf("capture rules support eventCategory Management; import data events or use a dedicated existing queue")
		}
	}
	detail["eventCategory"] = []string{"Management"}
	if !allManagement {
		if v, ok := detail["readOnly"]; ok {
			b, _ := json.Marshal(v)
			if string(b) != `[false]` {
				return "", fmt.Errorf("write-only capture requires readOnly [false]")
			}
		}
		detail["readOnly"] = []bool{false}
	}
	p["detail"] = detail
	b, err := json.Marshal(p)
	return string(b), err
}

func validateNestedPatternKeys(value any) error {
	switch value := value.(type) {
	case map[string]any:
		for key, child := range value {
			if strings.Contains(key, ".") {
				return fmt.Errorf("capture pattern field %q uses dotted syntax; use nested JSON fields so capture restrictions remain unambiguous", key)
			}
			if err := validateNestedPatternKeys(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range value {
			if err := validateNestedPatternKeys(child); err != nil {
				return err
			}
		}
	}
	return nil
}
