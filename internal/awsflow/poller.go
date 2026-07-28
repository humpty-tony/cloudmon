package awsflow

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	"cloudmon/internal/model"
)

// Poller long-polls the SQS queue, unwraps each message into a CloudTrailEvent, and
// hands batches to onBatch. It runs until the context is cancelled.
type Poller struct {
	client   *sqs.Client
	queueURL string
	onBatch  func([]model.CloudTrailEvent)
	onError  func(error)
}

// NewPoller builds a poller for the given queue. onError may be nil.
func NewPoller(cfg aws.Config, queueURL string, onBatch func([]model.CloudTrailEvent), onError func(error)) *Poller {
	return &Poller{client: sqs.NewFromConfig(cfg), queueURL: queueURL, onBatch: onBatch, onError: onError}
}

// Run polls until ctx is cancelled. On a transient receive error it backs off and
// retries (SQS buffers messages, so nothing is lost across a blip).
func (p *Poller) Run(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		out, err := p.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
			QueueUrl:            aws.String(p.queueURL),
			MaxNumberOfMessages: 10,
			WaitTimeSeconds:     20,  // long poll
			VisibilityTimeout:   120, // margin over worst-case append (DuckDB lock retries) before redelivery
		})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if p.onError != nil {
				p.onError(err)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
			continue
		}
		if len(out.Messages) == 0 {
			continue
		}
		batch := make([]model.CloudTrailEvent, 0, len(out.Messages))
		unparsed := 0
		for _, m := range out.Messages {
			if m.Body == nil {
				continue
			}
			if ev, ok := ParseEnvelope([]byte(*m.Body)); ok {
				batch = append(batch, ev)
			} else {
				unparsed++
			}
		}
		if unparsed > 0 && p.onError != nil {
			p.onError(fmt.Errorf("%d SQS message(s) were not recognizable CloudTrail events and were dropped", unparsed))
		}
		if len(batch) > 0 && p.onBatch != nil {
			p.onBatch(batch)
		}
		// Acknowledge everything we received - parsed or not - so an unparseable
		// message can't wedge the queue into an infinite redelivery loop. Surface (not
		// swallow) delete failures so a redelivery/duplicate loop is visible.
		for _, m := range out.Messages {
			if m.ReceiptHandle == nil {
				continue
			}
			if _, err := p.client.DeleteMessage(ctx, &sqs.DeleteMessageInput{
				QueueUrl:      aws.String(p.queueURL),
				ReceiptHandle: m.ReceiptHandle,
			}); err != nil && p.onError != nil && ctx.Err() == nil {
				p.onError(fmt.Errorf("delete message: %w", err))
			}
		}
	}
}

// ParseEnvelope extracts the CloudTrail record from an SQS message body. Flow A's
// messages are EventBridge envelopes whose "detail" field holds the record; if there
// is no envelope, the whole body is treated as a raw record. Returns ok=false for
// anything that doesn't parse into a CloudTrail event.
func ParseEnvelope(body []byte) (model.CloudTrailEvent, bool) {
	var env struct {
		Detail json.RawMessage `json:"detail"`
	}
	if err := json.Unmarshal(body, &env); err == nil && len(env.Detail) > 0 {
		if ev, err := model.FromRawJSON(env.Detail); err == nil && ev.EventName != "" {
			return ev, true
		}
	}
	if ev, err := model.FromRawJSON(body); err == nil && ev.EventName != "" {
		return ev, true
	}
	return model.CloudTrailEvent{}, false
}
