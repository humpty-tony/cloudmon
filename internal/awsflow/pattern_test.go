package awsflow

import (
	"encoding/json"
	"strings"
	"testing"

	ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
)

func TestBuildEventPatternValidJSON(t *testing.T) {
	for _, all := range []bool{true, false} {
		var m map[string]any
		if err := json.Unmarshal([]byte(BuildEventPattern(all)), &m); err != nil {
			t.Fatalf("allMgmt=%v produced invalid JSON: %v", all, err)
		}
	}
}

func TestAllManagementKeepsReadsAndSignin(t *testing.T) {
	p := BuildEventPattern(true)
	if !strings.Contains(p, "AWS Console Sign In via CloudTrail") {
		t.Error("all-management pattern must include the console sign-in detail-type (logins)")
	}
	if strings.Contains(p, "readOnly") {
		t.Error("all-management pattern must NOT exclude readOnly events")
	}
	// CloudTrail API calls arrive with source aws.<service>, not aws.cloudtrail, so the
	// pattern must NOT constrain source or it would drop nearly every event.
	if strings.Contains(p, `"source"`) {
		t.Error("pattern must not constrain source")
	}
}

func TestWriteOnlyExcludesReads(t *testing.T) {
	p := BuildEventPattern(false)
	if !strings.Contains(p, `"readOnly":[false]`) {
		t.Errorf("write-only pattern must exclude reads, got %s", p)
	}
}

func TestRuleState(t *testing.T) {
	if got := RuleState(true); got != ebtypes.RuleStateEnabledWithAllCloudtrailManagementEvents {
		t.Errorf("allMgmt state = %q, want ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS", got)
	}
	if got := RuleState(false); got != ebtypes.RuleStateEnabled {
		t.Errorf("write-only state = %q, want ENABLED", got)
	}
}
