package awsflow

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudtrail"
	cttypes "github.com/aws/aws-sdk-go-v2/service/cloudtrail/types"
)

// TrailStatus describes verified selector coverage, not a delivery guarantee.
type TrailStatus struct {
	HasLoggingTrail  bool   `json:"hasLoggingTrail"`
	TrailCount       int    `json:"trailCount"`
	GlobalCovered    bool   `json:"globalCovered"` // trail setting, not cross-region EventBridge delivery
	ReadManagement   bool   `json:"readManagement"`
	WriteManagement  bool   `json:"writeManagement"`
	CoverageKnown    bool   `json:"coverageKnown"`
	CoverageComplete bool   `json:"coverageComplete"`
	Summary          string `json:"summary"`
}

type managementCoverage struct {
	read, write, fullRead, fullWrite bool
	notes                            []string
}

func selectorsCoverage(basic []cttypes.EventSelector, advanced []cttypes.AdvancedEventSelector) managementCoverage {
	var c managementCoverage
	for _, e := range basic {
		if e.IncludeManagementEvents != nil && !*e.IncludeManagementEvents {
			continue
		}
		read := e.ReadWriteType != cttypes.ReadWriteTypeWriteOnly
		write := e.ReadWriteType != cttypes.ReadWriteTypeReadOnly
		c.read = c.read || read
		c.write = c.write || write
		c.fullRead = c.fullRead || read && len(e.ExcludeManagementEventSources) == 0
		c.fullWrite = c.fullWrite || write && len(e.ExcludeManagementEventSources) == 0
		for _, src := range e.ExcludeManagementEventSources {
			c.notes = append(c.notes, "excludes "+src)
		}
	}
	for _, e := range advanced {
		management, read, write, restricted := false, true, true, false
		for _, f := range e.FieldSelectors {
			switch aws.ToString(f.Field) {
			case "eventCategory":
				management = len(f.Equals) == 1 && f.Equals[0] == "Management"
			case "readOnly":
				read, write = false, false
				for _, v := range f.Equals {
					read = read || v == "true"
					write = write || v == "false"
				}
			default:
				restricted = true
			}
		}
		if !management {
			continue
		}
		c.read = c.read || read
		c.write = c.write || write
		c.fullRead = c.fullRead || read && !restricted
		c.fullWrite = c.fullWrite || write && !restricted
		if restricted {
			c.notes = append(c.notes, "advanced selectors restrict management coverage")
		}
	}
	return c
}

func CheckTrail(ctx context.Context, cfg aws.Config, region string) (TrailStatus, error) {
	ct := cloudtrail.NewFromConfig(cfg)
	out, err := ct.DescribeTrails(ctx, &cloudtrail.DescribeTrailsInput{IncludeShadowTrails: aws.Bool(true)})
	if err != nil {
		return TrailStatus{}, err
	}
	st := TrailStatus{TrailCount: len(out.TrailList), CoverageKnown: true}
	fullRead, fullWrite := false, false
	var notes []string
	for _, t := range out.TrailList {
		// Selector APIs use the home region, including when DescribeTrails returns a shadow.
		client := cloudtrail.NewFromConfig(cfg, func(o *cloudtrail.Options) {
			if home := aws.ToString(t.HomeRegion); home != "" {
				o.Region = home
			}
		})
		status, e := client.GetTrailStatus(ctx, &cloudtrail.GetTrailStatusInput{Name: t.TrailARN})
		if e != nil {
			st.CoverageKnown = false
			notes = append(notes, "trail status unavailable")
			continue
		}
		if !aws.ToBool(status.IsLogging) {
			continue
		}
		st.HasLoggingTrail = true
		selectors, e := client.GetEventSelectors(ctx, &cloudtrail.GetEventSelectorsInput{TrailName: t.TrailARN})
		if e != nil {
			st.CoverageKnown = false
			notes = append(notes, "event selectors unavailable; check cloudtrail:GetEventSelectors")
			continue
		}
		if len(selectors.EventSelectors) == 0 && len(selectors.AdvancedEventSelectors) == 0 {
			st.CoverageKnown = false
			notes = append(notes, "no selector information returned")
			continue
		}
		c := selectorsCoverage(selectors.EventSelectors, selectors.AdvancedEventSelectors)
		st.ReadManagement = st.ReadManagement || c.read
		st.WriteManagement = st.WriteManagement || c.write
		fullRead = fullRead || c.fullRead
		fullWrite = fullWrite || c.fullWrite
		st.GlobalCovered = st.GlobalCovered || ((c.read || c.write) && aws.ToBool(t.IncludeGlobalServiceEvents))
		notes = append(notes, c.notes...)
	}
	switch {
	case !st.CoverageKnown:
		st.Summary = "Coverage is partly unknown. " + strings.Join(notes, "; ")
	case !st.HasLoggingTrail:
		st.Summary = "No active logging trail was verified for " + region + ". Capture may receive no events."
	case !st.ReadManagement && !st.WriteManagement:
		st.Summary = "Logging trails do not select management events."
	default:
		st.Summary = fmt.Sprintf("Management selectors in %s: reads %t, writes %t; global-service logging enabled %t.", region, st.ReadManagement, st.WriteManagement, st.GlobalCovered)
		if !fullRead || !fullWrite {
			st.Summary += " Coverage is restricted. " + strings.Join(notes, "; ")
		}
		st.Summary += " EventBridge delivery is regional and best-effort."
	}
	st.CoverageComplete = st.CoverageKnown && fullRead && fullWrite
	return st, nil
}
