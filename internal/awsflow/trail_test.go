package awsflow

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	cttypes "github.com/aws/aws-sdk-go-v2/service/cloudtrail/types"
)

func TestSelectorsCoverage(t *testing.T) {
	for _, tc := range []struct {
		name                             string
		basic                            []cttypes.EventSelector
		advanced                         []cttypes.AdvancedEventSelector
		read, write, fullRead, fullWrite bool
	}{
		{name: "basic defaults", basic: []cttypes.EventSelector{{}}, read: true, write: true, fullRead: true, fullWrite: true},
		{name: "data only", basic: []cttypes.EventSelector{{IncludeManagementEvents: aws.Bool(false)}}},
		{name: "write only", basic: []cttypes.EventSelector{{ReadWriteType: cttypes.ReadWriteTypeWriteOnly}}, write: true, fullWrite: true},
		{name: "excluded kms", basic: []cttypes.EventSelector{{ExcludeManagementEventSources: []string{"kms.amazonaws.com"}}}, read: true, write: true},
		{name: "advanced management", advanced: []cttypes.AdvancedEventSelector{{FieldSelectors: []cttypes.AdvancedFieldSelector{{Field: aws.String("eventCategory"), Equals: []string{"Management"}}}}}, read: true, write: true, fullRead: true, fullWrite: true},
		{name: "advanced restricted reads", advanced: []cttypes.AdvancedEventSelector{{FieldSelectors: []cttypes.AdvancedFieldSelector{{Field: aws.String("eventCategory"), Equals: []string{"Management"}}, {Field: aws.String("readOnly"), Equals: []string{"true"}}, {Field: aws.String("eventSource"), NotEquals: []string{"kms.amazonaws.com"}}}}}, read: true},
		{name: "advanced data", advanced: []cttypes.AdvancedEventSelector{{FieldSelectors: []cttypes.AdvancedFieldSelector{{Field: aws.String("eventCategory"), Equals: []string{"Data"}}}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := selectorsCoverage(tc.basic, tc.advanced)
			if c.read != tc.read || c.write != tc.write || c.fullRead != tc.fullRead || c.fullWrite != tc.fullWrite {
				t.Fatalf("coverage=%+v", c)
			}
		})
	}
}

type trailHTTP func(*http.Request) (*http.Response, error)

func (f trailHTTP) Do(r *http.Request) (*http.Response, error) { return f(r) }
func TestCheckTrailUsesHomeRegionAndReportsUnknownSelectors(t *testing.T) {
	for _, denied := range []bool{false, true} {
		cfg := aws.Config{Region: "us-east-1", Credentials: aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
			return aws.Credentials{AccessKeyID: "test", SecretAccessKey: "test"}, nil
		})}
		calls := 0
		cfg.HTTPClient = trailHTTP(func(req *http.Request) (*http.Response, error) {
			calls++
			target := req.Header.Get("X-Amz-Target")
			status, body := 200, ""
			switch {
			case strings.HasSuffix(target, "DescribeTrails"):
				body = `{"trailList":[{"Name":"org","TrailARN":"arn:aws:cloudtrail:us-west-2:111122223333:trail/org","HomeRegion":"us-west-2","IncludeGlobalServiceEvents":false}]}`
			case strings.HasSuffix(target, "GetTrailStatus"):
				if req.URL.Host != "cloudtrail.us-west-2.amazonaws.com" {
					t.Errorf("status used %s", req.URL.Host)
				}
				body = `{"IsLogging":true}`
			case strings.HasSuffix(target, "GetEventSelectors"):
				if req.URL.Host != "cloudtrail.us-west-2.amazonaws.com" {
					t.Errorf("selectors used %s", req.URL.Host)
				}
				body = `{"EventSelectors":[{"IncludeManagementEvents":true,"ReadWriteType":"All"}]}`
				if denied {
					status = 400
					body = `{"__type":"AccessDeniedException","message":"not permitted"}`
				}
			default:
				t.Fatalf("unexpected CloudTrail operation %s", target)
			}
			return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/x-amz-json-1.1"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		})
		got, err := CheckTrail(context.Background(), cfg, "us-east-1")
		if err != nil {
			t.Fatal(err)
		}
		if calls != 3 || !got.HasLoggingTrail || got.CoverageKnown == denied || got.CoverageComplete == denied || got.GlobalCovered {
			t.Fatalf("denied=%t status=%+v calls=%d", denied, got, calls)
		}
	}
}

func TestTeardownSurfacesPartialTargetFailure(t *testing.T) {
	cfg := aws.Config{Region: "us-east-1", Credentials: aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
		return aws.Credentials{AccessKeyID: "test", SecretAccessKey: "test"}, nil
	})}
	cfg.HTTPClient = trailHTTP(func(req *http.Request) (*http.Response, error) {
		body := "{}"
		if strings.HasSuffix(req.Header.Get("X-Amz-Target"), "RemoveTargets") {
			body = `{"FailedEntryCount":1,"FailedEntries":[{"TargetId":"cloudmon-queue","ErrorCode":"ConcurrentModificationException","ErrorMessage":"retry"}]}`
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/x-amz-json-1.1"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	err := Teardown(context.Background(), cfg, Infra{Owned: true, RuleName: "owned-rule"})
	if err == nil || !strings.Contains(err.Error(), "events:RemoveTargets") {
		t.Fatalf("partial failure was swallowed: %v", err)
	}
}
