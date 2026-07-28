package awsflow

import (
	"context"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
)

func TestRegionFromQueueURL(t *testing.T) {
	cases := map[string]string{
		"https://sqs.us-east-1.amazonaws.com/123456789012/my-queue": "us-east-1",
		"https://sqs.eu-west-3.amazonaws.com/111122223333/cloudmon": "eu-west-3",
		"https://sqs.ap-southeast-2.amazonaws.com/1/q":              "ap-southeast-2",
		"https://us-east-2.queue.amazonaws.com/123456789012/legacy": "us-east-2",
		"https://sqs.us-gov-west-1.amazonaws.com/1/gov":             "us-gov-west-1",
		"":                            "",
		"not-a-url":                   "",
		"https://example.com/foo/bar": "",
	}
	for url, want := range cases {
		if got := RegionFromQueueURL(url); got != want {
			t.Errorf("RegionFromQueueURL(%q) = %q, want %q", url, got, want)
		}
	}
}

// Teardown must refuse to delete anything it doesn't own (existing-queue mode), so a
// user's queue is never removed even if a teardown path is reached.
func TestTeardownSkipsUnowned(t *testing.T) {
	// Owned=false: Teardown returns nil BEFORE building any AWS client or making a call,
	// so a zero aws.Config is never touched here.
	err := Teardown(context.Background(), aws.Config{}, Infra{
		QueueURL: "https://sqs.us-east-1.amazonaws.com/1/theirs",
		Owned:    false,
	})
	if err != nil {
		t.Fatalf("Teardown(!owned) = %v, want nil (must not touch a queue it didn't create)", err)
	}
}
