package awsflow

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
)

func recoveryConfig(handle func(*http.Request) (int, string)) aws.Config {
	return aws.Config{Region: "us-east-1", RetryMaxAttempts: 1, Credentials: aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
		return aws.Credentials{AccessKeyID: "test", SecretAccessKey: "test"}, nil
	}), HTTPClient: trailHTTP(func(req *http.Request) (*http.Response, error) {
		status, body := handle(req)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/x-amz-json-1.0"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
}

func TestProvisionCannotMutateBeforeCheckpoint(t *testing.T) {
	calls := 0
	cfg := recoveryConfig(func(*http.Request) (int, string) { calls++; return 200, "{}" })
	_, err := Provision(context.Background(), cfg, "111122223333", "us-east-1", "", true, func(infra Infra) error {
		if infra.QueueName == "" || infra.RuleName == "" || infra.QueueURL != "" {
			t.Fatalf("incomplete planned handles: %+v", infra)
		}
		return errors.New("disk full")
	})
	if err == nil || calls != 0 {
		t.Fatalf("AWS called without durable plan: calls=%d err=%v", calls, err)
	}
}

func TestInterruptedProvisionCanCleanUpFromPlannedNames(t *testing.T) {
	var saved Infra
	cfg := recoveryConfig(func(req *http.Request) (int, string) {
		if !strings.HasSuffix(req.Header.Get("X-Amz-Target"), "CreateQueue") {
			t.Fatalf("unexpected call %s", req.Header.Get("X-Amz-Target"))
		}
		if saved.QueueName == "" {
			t.Fatal("CreateQueue before checkpoint")
		}
		return 200, `{"QueueUrl":"https://sqs.us-east-1.amazonaws.com/111122223333/planned"}`
	})
	_, err := Provision(context.Background(), cfg, "111122223333", "us-east-1", "", true, func(infra Infra) error {
		if infra.QueueURL != "" {
			return errors.New("checkpoint failed after AWS creation")
		}
		saved = infra
		return nil
	})
	if err == nil {
		t.Fatal("ignored failed checkpoint")
	}
	deleted := false
	lookedUp := false
	cfg = recoveryConfig(func(req *http.Request) (int, string) {
		switch target := req.Header.Get("X-Amz-Target"); {
		case strings.HasSuffix(target, "RemoveTargets"), strings.HasSuffix(target, "DeleteRule"):
			return 400, `{"__type":"ResourceNotFoundException","message":"not created"}`
		case strings.HasSuffix(target, "GetQueueUrl"):
			var body map[string]string
			json.NewDecoder(req.Body).Decode(&body)
			if body["QueueName"] != saved.QueueName || body["QueueOwnerAWSAccountId"] != saved.Account {
				t.Fatalf("wrong queue recovery: %v", body)
			}
			lookedUp = true
			return 200, `{"QueueUrl":"https://sqs.us-east-1.amazonaws.com/111122223333/planned"}`
		case strings.HasSuffix(target, "DeleteQueue"):
			deleted = true
			return 200, `{}`
		default:
			t.Fatalf("unexpected cleanup: %s", target)
		}
		return 500, `{}`
	})
	if err := Teardown(context.Background(), cfg, saved); err != nil || !lookedUp || !deleted {
		t.Fatalf("cleanup incomplete: lookup=%t delete=%t err=%v", lookedUp, deleted, err)
	}
	cfg = recoveryConfig(func(*http.Request) (int, string) {
		return 400, `{"__type":"QueueDoesNotExist","message":"already removed"}`
	})
	if err := Teardown(context.Background(), cfg, Infra{Owned: true, QueueURL: "https://sqs.us-east-1.amazonaws.com/111122223333/planned"}); err != nil {
		t.Fatalf("repeat queue deletion: %v", err)
	}
}

func TestCaptureAccountGuardUsesCurrentSTSIdentity(t *testing.T) {
	calls := 0
	cfg := recoveryConfig(func(req *http.Request) (int, string) {
		calls++
		if !strings.HasPrefix(req.URL.Host, "sts.") {
			t.Fatalf("unexpected service %s", req.URL.Host)
		}
		return 200, `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Account>999999999999</Account><Arn>arn:aws:iam::999999999999:user/changed</Arn><UserId>changed</UserId></GetCallerIdentityResult></GetCallerIdentityResponse>`
	})
	err := VerifyCaptureAccount(context.Background(), cfg, Infra{Region: "us-east-1", Account: "111122223333"}, "investigator")
	if err == nil || !strings.Contains(err.Error(), "999999999999") || calls != 1 {
		t.Fatalf("account mismatch not blocked: calls=%d err=%v", calls, err)
	}
}
