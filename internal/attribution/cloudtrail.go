package attribution

import (
	"context"
	"errors"
	"sync"
	"time"

	"cloudmon/internal/awsflow"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudtrail"
	ctTypes "github.com/aws/aws-sdk-go-v2/service/cloudtrail/types"
	"github.com/aws/aws-sdk-go-v2/service/identitystore"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

func productionDependencies() dependencies {
	return dependencies{now: time.Now, aws: func(ctx context.Context, profile, region string) (awsClients, error) {
		cfg, err := awsflow.LoadConfig(ctx, profile, region)
		if err != nil {
			return awsClients{}, errors.New("AWS configuration unavailable")
		}
		cfg.RetryMaxAttempts = 1 // retries would bypass LookupEvents' account/region limiter
		cfg.HTTPClient = secureClient()
		return awsClients{cloudtrail: cloudtrail.NewFromConfig(cfg), sts: sts.NewFromConfig(cfg), identity: identitystore.NewFromConfig(cfg)}, nil
	}, wait: waitCloudTrail}
}

var cloudTrailRate = struct {
	sync.Mutex
	next map[string]time.Time
}{next: map[string]time.Time{}}

// Shared across concurrent Resolve calls. Reserve a slot for each SDK request;
// disabled SDK retries prevent hidden calls from bypassing this rate bound.
func waitCloudTrail(ctx context.Context, scope string) error {
	cloudTrailRate.Lock()
	now := time.Now()
	for key, at := range cloudTrailRate.next {
		if at.Before(now.Add(-time.Minute)) {
			delete(cloudTrailRate.next, key)
		}
	}
	at := cloudTrailRate.next[scope]
	if at.Before(now) {
		at = now
	}
	cloudTrailRate.next[scope] = at.Add(500 * time.Millisecond)
	cloudTrailRate.Unlock()
	timer := time.NewTimer(time.Until(at))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func fetchCloudTrail(ctx context.Context, seed trailEvent, regions []string, cfg Config, d dependencies, r *Result) []trailEvent {
	from := d.now().Add(-90 * 24 * time.Hour)
	to, _ := time.Parse(time.RFC3339Nano, seed.Time)
	if to.After(d.now()) {
		to = d.now()
	}
	out := []trailEvent{}
	size := 0
	for _, region := range regions {
		status := SourceStatus{Source: "cloudtrail", Status: "complete", Region: region, From: from.UTC().Format(time.RFC3339Nano), To: to.UTC().Format(time.RFC3339Nano), Detail: "Selected AWS credential chain/account and Region only; no organization-wide coverage. No matching record does not prove no issuer exists."}
		if to.Before(from) {
			status.Status = "unavailable"
			status.Detail = "Seed predates the 90-day CloudTrail event-history window; retained historical logs are required."
			r.Sources = append(r.Sources, status)
			continue
		}
		if seed.Identity.Key == "" {
			status.Status = "unavailable"
			status.Detail = "Seed has no recorded access-key ID for reverse issuance lookup."
			r.Sources = append(r.Sources, status)
			continue
		}
		clients, err := d.aws(ctx, cfg.AWSProfile, region)
		if err != nil || clients.sts == nil || clients.cloudtrail == nil {
			status.Status = "unavailable"
			status.Detail = "AWS configuration or credentials unavailable for the selected profile/default chain."
			r.Sources = append(r.Sources, status)
			continue
		}
		caller, err := clients.sts.GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
		if err != nil || caller == nil || aws.ToString(caller.Account) == "" {
			status.Status = "unavailable"
			status.Detail = "GetCallerIdentity could not establish the selected account scope; history was not queried."
			r.Sources = append(r.Sources, status)
			continue
		}
		status.AccountID = aws.ToString(caller.Account)
		var token *string
		seenTokens := map[string]bool{}
		for page := 0; page < maxPages; page++ {
			if err := d.wait(ctx, status.AccountID+"/"+region); err != nil {
				status.Status = "partial"
				status.Detail = "CloudTrail lookup cancelled or deadline exceeded; history is incomplete."
				break
			}
			response, err := clients.cloudtrail.LookupEvents(ctx, &cloudtrail.LookupEventsInput{StartTime: &from, EndTime: &to, MaxResults: aws.Int32(50), NextToken: token, LookupAttributes: []ctTypes.LookupAttribute{{AttributeKey: ctTypes.LookupAttributeKeyEventSource, AttributeValue: aws.String("sts.amazonaws.com")}}})
			status.Pages++
			if err != nil || response == nil {
				status.Status = "error"
				if page > 0 {
					status.Status = "partial"
				}
				status.Detail = "CloudTrail lookup failed (permission, throttling, credentials or transport); history is incomplete."
				break
			}
			stop := false
			for _, record := range response.Events {
				status.Events++
				raw := aws.ToString(record.CloudTrailEvent)
				size += len(raw)
				if size > maxWindowBytes || len(out) >= maxWindowEvents {
					status.Status = "partial"
					status.Detail = "CloudTrail memory/candidate limit reached; history is incomplete."
					stop = true
					break
				}
				event, err := parseEvent(raw)
				if err != nil {
					status.Status = "partial"
					status.Detail = "Some CloudTrail records were invalid or oversized and omitted."
					continue
				}
				if event.issuedKey() == "" {
					continue
				}
				// Preserve authorized original audit evidence, including any fields AWS
				// logged. Connector authentication is separate and never enters records.
				// The parent retains these originals in its private local evidence cache.
				event.remote = true
				event.account = status.AccountID
				event.region = region
				out = append(out, event)
			}
			if stop {
				break
			}
			token = response.NextToken
			if token == nil || *token == "" {
				break
			}
			if seenTokens[*token] {
				status.Status = "partial"
				status.Detail = "CloudTrail repeated a pagination token; history is incomplete."
				break
			}
			seenTokens[*token] = true
			if page == maxPages-1 {
				status.Status = "partial"
				status.Detail = "CloudTrail page limit reached; history is incomplete."
			}
		}
		r.Sources = append(r.Sources, status)
	}
	return out
}
