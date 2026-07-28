package awsflow

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudtrail"
)

// TrailStatus reports whether a CloudTrail trail is actually feeding this region - the
// precondition for Flow A to receive anything. Without a logging trail the rule + queue
// get created but stay empty (the silent failure this guards against).
type TrailStatus struct {
	HasLoggingTrail bool   `json:"hasLoggingTrail"`
	TrailCount      int    `json:"trailCount"`
	GlobalCovered   bool   `json:"globalCovered"` // a logging trail includes global-service events (console sign-ins / IAM)
	Summary         string `json:"summary"`       // human line for the UI
}

// CheckTrail describes the trails visible in the region (including multi-region shadow
// trails) and reports whether any is actively logging, so the UI can warn before the
// user provisions a pipeline that would receive nothing.
func CheckTrail(ctx context.Context, cfg aws.Config, region string) (TrailStatus, error) {
	ct := cloudtrail.NewFromConfig(cfg)
	out, err := ct.DescribeTrails(ctx, &cloudtrail.DescribeTrailsInput{IncludeShadowTrails: aws.Bool(true)})
	if err != nil {
		return TrailStatus{}, err
	}
	st := TrailStatus{TrailCount: len(out.TrailList)}
	logging := 0
	best := ""
	for _, t := range out.TrailList {
		s, serr := ct.GetTrailStatus(ctx, &cloudtrail.GetTrailStatusInput{Name: t.TrailARN})
		if serr != nil || s.IsLogging == nil || !*s.IsLogging {
			continue
		}
		logging++
		if best == "" {
			best = aws.ToString(t.Name)
		}
		// Multi-region trails, and single-region trails with global-service events on,
		// capture console sign-ins (aws.signin) and IAM.
		if aws.ToBool(t.IsMultiRegionTrail) || aws.ToBool(t.IncludeGlobalServiceEvents) {
			st.GlobalCovered = true
		}
	}
	st.HasLoggingTrail = logging > 0
	switch {
	case logging > 0 && st.GlobalCovered:
		st.Summary = fmt.Sprintf("%d trail(s) logging management events (e.g. %s) - good.", logging, best)
	case logging > 0:
		st.Summary = fmt.Sprintf("%d trail(s) logging (e.g. %s), but none include global-service events - console sign-ins and IAM may not be captured.", logging, best)
	case len(out.TrailList) > 0:
		st.Summary = "A trail exists but none are actively logging - enable one, or capture will be empty."
	default:
		st.Summary = "No CloudTrail trail feeds this region. Create one (management events, multi-region) first - otherwise the rule + queue receive nothing."
	}
	return st, nil
}
