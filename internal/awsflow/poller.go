package awsflow

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"

	"cloudmon/internal/model"
)

type queueClient interface {
	ReceiveMessage(context.Context, *sqs.ReceiveMessageInput, ...func(*sqs.Options)) (*sqs.ReceiveMessageOutput, error)
	DeleteMessage(context.Context, *sqs.DeleteMessageInput, ...func(*sqs.Options)) (*sqs.DeleteMessageOutput, error)
	ChangeMessageVisibility(context.Context, *sqs.ChangeMessageVisibilityInput, ...func(*sqs.Options)) (*sqs.ChangeMessageVisibilityOutput, error)
}

// Poller holds at most one received batch. onBatch must return success only after
// committing locally: receipts are never acknowledged on a failed or absent sink.
type Poller struct {
	client        queueClient
	queueURL      string
	onBatch       func(context.Context, []model.CloudTrailEvent) error
	onError       func(error)
	leaseInterval time.Duration // zero uses the production 40-second renewal interval
}

func NewPoller(cfg aws.Config, queueURL string, onBatch func(context.Context, []model.CloudTrailEvent) error, onError func(error)) *Poller {
	return &Poller{client: sqs.NewFromConfig(cfg), queueURL: queueURL, onBatch: onBatch, onError: onError}
}

func (p *Poller) report(err error) {
	if p.onError != nil {
		p.onError(err)
	}
}

func waitRetry(ctx context.Context) bool {
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (p *Poller) Run(ctx context.Context) {
	for ctx.Err() == nil {
		out, err := p.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
			QueueUrl: aws.String(p.queueURL), MaxNumberOfMessages: 10, WaitTimeSeconds: 20, VisibilityTimeout: 120,
		})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			p.report(err)
			if !waitRetry(ctx) {
				return
			}
			continue
		}
		p.process(ctx, out.Messages)
	}
}

func (p *Poller) process(ctx context.Context, messages []sqstypes.Message) {
	batch := make([]model.CloudTrailEvent, 0, len(messages))
	receipts := make([]string, 0, len(messages))
	unsupported := 0
	for _, m := range messages {
		if m.Body == nil || aws.ToString(m.ReceiptHandle) == "" {
			unsupported++
			continue
		}
		ev, ok := ParseEnvelope([]byte(*m.Body))
		if !ok {
			unsupported++
			continue
		}
		batch = append(batch, ev)
		receipts = append(receipts, *m.ReceiptHandle)
	}
	if unsupported > 0 {
		p.report(fmt.Errorf("%d SQS message(s) were unsupported or missing a receipt handle; left unacknowledged", unsupported))
	}
	if len(batch) == 0 {
		return
	}
	if p.onBatch == nil {
		p.report(fmt.Errorf("capture sink unavailable; receipts left unacknowledged"))
		return
	}

	leaseCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { defer close(done); p.renewVisibility(leaseCtx, receipts) }()
	defer func() { cancel(); <-done }()
	for ctx.Err() == nil {
		if err := p.onBatch(ctx, batch); err != nil {
			if ctx.Err() != nil {
				return
			}
			p.report(fmt.Errorf("local commit failed; retaining batch for retry: %w", err))
			if !waitRetry(ctx) {
				return
			}
			continue
		}
		for _, receipt := range receipts {
			if ctx.Err() != nil {
				return
			}
			if _, err := p.client.DeleteMessage(ctx, &sqs.DeleteMessageInput{
				QueueUrl: aws.String(p.queueURL), ReceiptHandle: aws.String(receipt),
			}); err != nil && ctx.Err() == nil {
				p.report(fmt.Errorf("delete committed message: %w", err))
			}
		}
		return
	}
}

func (p *Poller) renewVisibility(ctx context.Context, receipts []string) {
	interval := p.leaseInterval
	if interval <= 0 {
		interval = 40 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, receipt := range receipts {
				// Bound a renewal independently so one failing request cannot occupy the
				// whole visibility window for the other messages in this batch.
				renewalCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
				_, err := p.client.ChangeMessageVisibility(renewalCtx, &sqs.ChangeMessageVisibilityInput{
					QueueUrl: aws.String(p.queueURL), ReceiptHandle: aws.String(receipt), VisibilityTimeout: 120,
				})
				cancel()
				if err != nil && ctx.Err() == nil {
					p.report(fmt.Errorf("renew message visibility: %w", err))
				}
			}
		}
	}
}

// ParseEnvelope supports a raw record, EventBridge detail, or an SNS Notification
// wrapping either. S3 object notifications contain no event record and stay on SQS.
func ParseEnvelope(body []byte) (model.CloudTrailEvent, bool) {
	for depth := 0; depth < 4; depth++ {
		var env struct {
			Detail  json.RawMessage `json:"detail"`
			Type    string          `json:"Type"`
			Message string          `json:"Message"`
		}
		if err := json.Unmarshal(body, &env); err != nil {
			break
		}
		if len(env.Detail) > 0 {
			body = env.Detail
			continue
		}
		if env.Type == "Notification" && env.Message != "" {
			body = []byte(env.Message)
			continue
		}
		if ev, err := model.FromRawJSON(body); err == nil && ev.EventName != "" && ev.EventID != "" {
			return ev, true
		}
		break
	}
	return model.CloudTrailEvent{}, false
}
