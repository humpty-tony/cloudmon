package awsflow

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"cloudmon/internal/model"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"
)

const queueRecord = `{"eventID":"e1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2026-09-24T00:00:00Z","eventCategory":"Management"}`

type testQueue struct {
	t         *testing.T
	committed bool
	deleted   []string
	renewed   chan struct{}
}

func (q *testQueue) ReceiveMessage(ctx context.Context, _ *sqs.ReceiveMessageInput, _ ...func(*sqs.Options)) (*sqs.ReceiveMessageOutput, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}
func (q *testQueue) DeleteMessage(_ context.Context, in *sqs.DeleteMessageInput, _ ...func(*sqs.Options)) (*sqs.DeleteMessageOutput, error) {
	if !q.committed {
		q.t.Error("acknowledged a message before the sink committed")
	}
	q.deleted = append(q.deleted, aws.ToString(in.ReceiptHandle))
	return &sqs.DeleteMessageOutput{}, nil
}
func (q *testQueue) ChangeMessageVisibility(_ context.Context, in *sqs.ChangeMessageVisibilityInput, _ ...func(*sqs.Options)) (*sqs.ChangeMessageVisibilityOutput, error) {
	if aws.ToString(in.ReceiptHandle) != "valid" || in.VisibilityTimeout != 120 {
		q.t.Error("unexpected visibility renewal")
	}
	if q.renewed != nil {
		select {
		case q.renewed <- struct{}{}:
		default:
		}
	}
	return &sqs.ChangeMessageVisibilityOutput{}, nil
}
func validMessage() sqstypes.Message {
	return sqstypes.Message{Body: aws.String(queueRecord), ReceiptHandle: aws.String("valid")}
}

func TestPollerRetriesBeforeAcknowledgingOnlyCommittedRecords(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	q := &testQueue{t: t}
	attempts := 0
	p := &Poller{client: q, queueURL: "queue", onBatch: func(_ context.Context, events []model.CloudTrailEvent) error {
		attempts++
		if len(events) != 1 || events[0].EventID != "e1" {
			t.Fatalf("retry changed the batch: %+v", events)
		}
		if len(q.deleted) != 0 {
			t.Fatal("receipt deleted before successful retry")
		}
		if attempts == 1 {
			return errors.New("disk unavailable")
		}
		q.committed = true
		return nil
	}}
	p.process(ctx, []sqstypes.Message{validMessage(), {Body: aws.String(`{"Records":[{"s3":{"bucket":{"name":"logs"}}}]}`), ReceiptHandle: aws.String("unsupported")}})
	if attempts != 2 || len(q.deleted) != 1 || q.deleted[0] != "valid" {
		t.Fatalf("attempts=%d deleted=%v", attempts, q.deleted)
	}
}

func TestPollerFailureAndCancellationLeaveReceiptOnQueue(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	q := &testQueue{t: t}
	p := &Poller{client: q, onBatch: func(context.Context, []model.CloudTrailEvent) error { cancel(); return errors.New("commit failed") }}
	p.process(ctx, []sqstypes.Message{validMessage()})
	if len(q.deleted) != 0 {
		t.Fatal("failed batch was acknowledged")
	}
}

func TestPollerRenewsVisibilityDuringCommit(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	q := &testQueue{t: t, renewed: make(chan struct{}, 1)}
	p := &Poller{client: q, leaseInterval: time.Millisecond, onBatch: func(ctx context.Context, _ []model.CloudTrailEvent) error {
		select {
		case <-q.renewed:
			q.committed = true
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}}
	p.process(ctx, []sqstypes.Message{validMessage()})
	if !q.committed || len(q.deleted) != 1 {
		t.Fatal("visibility was not renewed while waiting for commit")
	}
}

func TestPollerUnsupportedAndMissingReceiptsAreNotAcknowledged(t *testing.T) {
	q := &testQueue{t: t}
	p := &Poller{client: q, onBatch: func(context.Context, []model.CloudTrailEvent) error {
		t.Fatal("unsupported message reached sink")
		return nil
	}}
	p.process(context.Background(), []sqstypes.Message{{Body: aws.String(queueRecord)}, {ReceiptHandle: aws.String("empty")}, {Body: aws.String(`{"eventName":"not-a-record"}`), ReceiptHandle: aws.String("invalid")}})
	if len(q.deleted) != 0 {
		t.Fatal("unsupported messages deleted")
	}
}

func TestParseSNSWrappedEventBridgeAndRejectS3Notification(t *testing.T) {
	envelope := `{"detail":` + queueRecord + `}`
	sns, _ := json.Marshal(map[string]string{"Type": "Notification", "Message": envelope})
	if e, ok := ParseEnvelope(sns); !ok || e.EventID != "e1" {
		t.Fatal("SNS-wrapped event did not parse")
	}
	sns, _ = json.Marshal(map[string]string{"Type": "Notification", "Message": `{"Records":[{"s3":{"bucket":{"name":"logs"}}}]}`})
	if _, ok := ParseEnvelope(sns); ok {
		t.Fatal("S3 notification mistaken for event data")
	}
}
