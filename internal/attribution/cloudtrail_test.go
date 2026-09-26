package attribution

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudtrail"
	ctTypes "github.com/aws/aws-sdk-go-v2/service/cloudtrail/types"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

var testNow = time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)

const testSeed = `{"eventID":"activity","eventTime":"2026-09-25T11:00:00Z","eventSource":"s3.amazonaws.com","awsRegion":"eu-west-1","userIdentity":{"accessKeyId":"ASIAchild","type":"AssumedRole","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::123456789012:role/Example"}}}}`

func issuance(id, child, parent string) string {
	return fmt.Sprintf(`{"eventID":%q,"eventTime":"2026-09-25T10:00:00Z","eventSource":"sts.amazonaws.com","eventName":"AssumeRole","awsRegion":"eu-west-1","sourceIPAddress":"192.0.2.8","userAgent":"fixture-agent","userIdentity":{"accessKeyId":%q,"principalId":"issuer","sessionContext":{"attributes":{"mfaAuthenticated":"true"}}},"responseElements":{"credentials":{"accessKeyId":%q}}}`, id, parent, child)
}

type fakeCT struct {
	calls int
	fn    func(*cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error)
}

func (f *fakeCT) LookupEvents(_ context.Context, in *cloudtrail.LookupEventsInput, _ ...func(*cloudtrail.Options)) (*cloudtrail.LookupEventsOutput, error) {
	f.calls++
	return f.fn(in)
}

type fakeSTS struct{ calls int }

func (f *fakeSTS) GetCallerIdentity(context.Context, *sts.GetCallerIdentityInput, ...func(*sts.Options)) (*sts.GetCallerIdentityOutput, error) {
	f.calls++
	return &sts.GetCallerIdentityOutput{Account: aws.String("123456789012")}, nil
}
func ctPage(raws ...string) *cloudtrail.LookupEventsOutput {
	out := &cloudtrail.LookupEventsOutput{}
	for _, raw := range raws {
		out.Events = append(out.Events, ctTypes.Event{CloudTrailEvent: aws.String(raw)})
	}
	return out
}
func testDeps(ct *fakeCT) dependencies {
	return dependencies{now: func() time.Time { return testNow }, aws: func(context.Context, string, string) (awsClients, error) {
		return awsClients{cloudtrail: ct, sts: &fakeSTS{}}, nil
	}, wait: func(context.Context, string) error { return nil }}
}
func TestCloudTrailExactIssuedKeyRecursiveCandidates(t *testing.T) {
	a, b, c := issuance("a", "ASIAchild", "ASIAparent"), issuance("b", "ASIAparent", "AKIAroot"), issuance("ambiguous", "ASIAchild", "AKIAother")
	ct := &fakeCT{fn: func(in *cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) {
		if len(in.LookupAttributes) != 1 || in.LookupAttributes[0].AttributeKey != ctTypes.LookupAttributeKeyEventName {
			t.Fatalf("wrong lookup: %+v", in)
		}
		if !in.StartTime.Equal(testNow.Add(-90*24*time.Hour)) || in.EndTime.Format(time.RFC3339) != "2026-09-25T11:00:00Z" {
			t.Fatal("unbounded window")
		}
		if aws.ToString(in.LookupAttributes[0].AttributeValue) != "AssumeRole" {
			return ctPage(), nil
		}
		if in.NextToken == nil {
			p := ctPage(b, issuance("unrelated", "ASIAunrelated", "ASIAchild"))
			p.NextToken = aws.String("next")
			return p, nil
		}
		return ctPage(a, c), nil
	}}
	r, err := resolveWith(context.Background(), testSeed, nil, Config{AWSRegions: []string{"eu-west-1"}}, testDeps(ct))
	if err != nil || len(r.Records) != 3 || ct.calls != 7 {
		t.Fatalf("records=%+v calls=%d err=%v", r.Records, ct.calls, err)
	}
	for _, rec := range r.Records {
		if rec.Raw != a && rec.Raw != b && rec.Raw != c {
			t.Fatal("changed raw or unrelated record")
		}
	}
	if r.Sources[0].AccountID != "123456789012" || r.Sources[0].Status != "candidate" || r.Sources[0].Pages != 7 {
		t.Fatalf("scope/status: %+v", r.Sources)
	}
	if len(r.Evidence) != 3 || r.Evidence[0].Initiator.IP != "192.0.2.8" || r.Evidence[0].Initiator.MFA != "true" {
		t.Fatalf("missing initiator: %+v", r.Evidence)
	}
}
func TestOldSeedNoAWSCall(t *testing.T) {
	calls := 0
	d := testDeps(nil)
	d.aws = func(context.Context, string, string) (awsClients, error) {
		calls++
		return awsClients{}, fmt.Errorf("must not call")
	}
	r, err := resolveWith(context.Background(), strings.Replace(testSeed, "2026-09-25", "2025-01-01", 1), nil, Config{}, d)
	if err != nil || calls != 0 || r.Sources[0].Status != "unavailable" {
		t.Fatalf("old seed: %+v %v calls %d", r, err, calls)
	}
}
