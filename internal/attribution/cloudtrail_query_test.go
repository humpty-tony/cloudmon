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
)

var issuanceMethodsForTest = []string{"AssumeRole", "AssumeRoleWithSAML", "AssumeRoleWithWebIdentity", "AssumeRoot", "GetSessionToken", "GetFederationToken"}

func TestCloudTrailPrioritizesRecordedCreationForEveryIssuanceType(t *testing.T) {
	for _, method := range issuanceMethodsForTest {
		t.Run(method, func(t *testing.T) {
			seed := strings.Replace(testSeed, `"sessionContext":{`, `"sessionContext":{"attributes":{"creationDate":"2026-09-25T10:00:00Z"},`, 1)
			raw := strings.Replace(issuance("target", "ASIAchild", "AKIAroot"), "AssumeRole", method, 1)
			narrowCalls := 0
			ct := &fakeCT{}
			ct.fn = func(in *cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) {
				if in.StartTime.Equal(testNow.Add(-2*time.Hour-5*time.Minute)) && in.EndTime.Equal(testNow.Add(-2*time.Hour+5*time.Minute)) {
					narrowCalls++
					if ct.calls != 1 {
						t.Fatal("creation-time query must precede background history")
					}
					return ctPage(raw), nil
				}
				p := ctPage(issuance(fmt.Sprint(ct.calls), "ASIAunrelated", "AKIAother"))
				p.NextToken = aws.String(fmt.Sprint(ct.calls))
				return p, nil
			}
			r, err := resolveWith(context.Background(), seed, nil, Config{AWSRegions: []string{"eu-west-1"}}, testDeps(ct))
			if err != nil || narrowCalls != 1 || len(r.Records) != 1 || r.Records[0].Raw != raw || ct.calls > maxPages {
				t.Fatalf("narrow=%d records=%d calls=%d err=%v", narrowCalls, len(r.Records), ct.calls, err)
			}
			if r.Sources[0].Status != "partial" {
				t.Fatal("bounded fallback must not claim exhaustive history")
			}
		})
	}
}

func TestCloudTrailSeedHintSurvivesLocalHintLimit(t *testing.T) {
	for _, count := range []int{maxDepth - 1, maxDepth, maxDepth + 1} {
		t.Run(fmt.Sprintf("%d_local_windows", count), func(t *testing.T) {
			seed := strings.Replace(testSeed, `"sessionContext":{`, `"sessionContext":{"attributes":{"creationDate":"2026-09-25T10:00:00Z"},`, 1)
			raw := issuance("target", "ASIAchild", "AKIAroot")
			var local []string
			for i := 0; i < count; i++ {
				created := testNow.Add(-time.Duration(i+3) * time.Hour).Format(time.RFC3339)
				event := strings.Replace(seed, "2026-09-25T10:00:00Z", created, 1)
				event = strings.Replace(event, "ASIAchild", fmt.Sprintf("ASIAlocal%d", i), 1)
				event = strings.Replace(event, `"activity"`, fmt.Sprintf(`"local%d"`, i), 1)
				local = append(local, event, event) // Duplicate windows must not consume hint slots.
			}
			start, end := testNow.Add(-2*time.Hour-5*time.Minute), testNow.Add(-2*time.Hour+5*time.Minute)
			hints := map[string]int{}
			ct := &fakeCT{}
			ct.fn = func(in *cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) {
				seedWindow := in.StartTime.Equal(start) && in.EndTime.Equal(end)
				if ct.calls == 1 && !seedWindow {
					t.Errorf("first lookup window = %s/%s, want seed %s/%s", in.StartTime, in.EndTime, start, end)
				}
				if in.LookupAttributes[0].AttributeKey == ctTypes.LookupAttributeKeyEventSource {
					hints[in.StartTime.Format(time.RFC3339Nano)]++
					if seedWindow {
						return ctPage(raw), nil
					}
					return ctPage(), nil
				}
				p := ctPage()
				p.NextToken = aws.String(fmt.Sprint(ct.calls))
				return p, nil
			}
			r, err := resolveWith(context.Background(), seed, local, Config{AWSRegions: []string{"eu-west-1"}}, testDeps(ct))
			if err != nil {
				t.Fatal(err)
			}
			if len(r.Records) != 1 || r.Records[0].Raw != raw {
				t.Errorf("seed issuance not recovered: records=%v", r.Records)
			}
			if len(hints) != maxDepth || hints[start.Format(time.RFC3339Nano)] != 1 {
				t.Errorf("want seed plus %d local hints, got %v", maxDepth-1, hints)
			}
			for window, calls := range hints {
				if calls != 1 {
					t.Errorf("duplicate hint %s: calls=%d", window, calls)
				}
			}
			if ct.calls != maxPages || r.Sources[0].Pages != maxPages || r.Sources[0].Status != "partial" {
				t.Errorf("shared page budget: calls=%d source=%+v", ct.calls, r.Sources[0])
			}
		})
	}
}

func TestCloudTrailFairEventTypeQueriesWithoutCreationHint(t *testing.T) {
	for _, method := range issuanceMethodsForTest {
		t.Run(method, func(t *testing.T) {
			counts := map[string]int{}
			raw := strings.Replace(issuance("target", "ASIAchild", "AKIAroot"), "AssumeRole", method, 1)
			ct := &fakeCT{fn: func(in *cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) {
				if len(in.LookupAttributes) != 1 || in.LookupAttributes[0].AttributeKey != ctTypes.LookupAttributeKeyEventName {
					t.Fatal("use one supported EventName filter, not an all-STS scan")
				}
				name := aws.ToString(in.LookupAttributes[0].AttributeValue)
				counts[name]++
				if counts[name] > 1 && len(counts) != len(issuanceMethodsForTest) {
					t.Fatal("a busy API starved the other credential APIs")
				}
				p := ctPage()
				if name == method && counts[name] == 2 {
					p = ctPage(raw)
				}
				p.NextToken = aws.String(fmt.Sprint(counts[name]))
				return p, nil
			}}
			r, err := resolveWith(context.Background(), testSeed, nil, Config{AWSRegions: []string{"eu-west-1"}}, testDeps(ct))
			if err != nil || len(r.Records) != 1 || len(counts) != 6 || ct.calls > maxPages {
				t.Fatalf("methods=%d records=%d calls=%d err=%v", len(counts), len(r.Records), ct.calls, err)
			}
		})
	}
}

func TestCloudTrailPrioritizesDiscoveredParentCreation(t *testing.T) {
	seed := strings.Replace(testSeed, `"sessionContext":{`, `"sessionContext":{"attributes":{"creationDate":"2026-09-25T10:00:00Z"},`, 1)
	child := strings.Replace(issuance("child", "ASIAchild", "ASIAparent"), `"mfaAuthenticated":"true"`, `"mfaAuthenticated":"true","creationDate":"2026-09-25T09:00:00Z"`, 1)
	parent := strings.Replace(issuance("parent", "ASIAparent", "AKIAroot"), "10:00:00Z", "09:00:00Z", 1)
	ct := &fakeCT{fn: func(in *cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) {
		if in.StartTime.Format("15:04") == "09:55" {
			return ctPage(child), nil
		}
		if in.StartTime.Format("15:04") == "08:55" {
			return ctPage(parent), nil
		}
		return ctPage(), nil
	}}
	r, err := resolveWith(context.Background(), seed, nil, Config{AWSRegions: []string{"eu-west-1"}}, testDeps(ct))
	if err != nil || len(r.Records) != 2 {
		t.Fatalf("parent target omitted: records=%d err=%v", len(r.Records), err)
	}
}
