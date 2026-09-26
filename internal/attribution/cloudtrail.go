package attribution

import (
	"context"
	"errors"
	"fmt"
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

// Shared across Resolve calls; SDK retries must not bypass this rate bound.
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

type trailLookup struct {
	from, to  time.Time
	attribute ctTypes.LookupAttributeKey
	value     string
	token     *string
	seen      map[string]bool
}

func newTrailLookup(from, to time.Time, attribute ctTypes.LookupAttributeKey, value string) *trailLookup {
	return &trailLookup{from: from, to: to, attribute: attribute, value: value, seen: map[string]bool{}}
}

func fetchCloudTrail(ctx context.Context, seed trailEvent, roots []trailEvent, regions []string, cfg Config, d dependencies, r *Result) []trailEvent {
	now := d.now()
	from := now.Add(-90 * 24 * time.Hour)
	to, _ := time.Parse(time.RFC3339Nano, seed.Time)
	if to.After(now) {
		to = now
	}
	out := []trailEvent{}
	size := 0
	seenRaw := map[string]bool{}
	for _, region := range regions {
		status := SourceStatus{Source: "cloudtrail", Status: "complete", Region: region, From: from.UTC().Format(time.RFC3339Nano), To: to.UTC().Format(time.RFC3339Nano), Detail: "Selected account/Region only. Recorded creation-time windows first; EventName-filtered history for all six supported STS credential-issuance APIs, paginated fairly. No matching record does not prove no issuer exists."}
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

		// LookupEvents permits ONE attribute. AccessKeyId indexes the signer, not
		// necessarily the returned child key; ResourceName is absent on some genuine
		// SAML records. Neither can safely be the sole reverse-issuance filter.
		queue := []*trailLookup{}
		queryCalls := map[string]int{}
		finished := map[string]bool{}
		wanted := map[string]bool{seed.Identity.Key: true}
		hinted := map[string]bool{}
		addHint := func(e trailEvent) {
			created, err := time.Parse(time.RFC3339Nano, e.Identity.Session.Attributes.Created)
			if err != nil || created.Before(from) || created.After(to) || len(hinted) >= maxDepth {
				return
			}
			start, end := created.Add(-5*time.Minute), created.Add(5*time.Minute)
			if start.Before(from) {
				start = from
			}
			if end.After(to) {
				end = to
			}
			id := start.Format(time.RFC3339Nano) + "/" + end.Format(time.RFC3339Nano)
			if hinted[id] {
				return
			}
			hinted[id] = true
			queue = append([]*trailLookup{newTrailLookup(start, end, ctTypes.LookupAttributeKeyEventSource, "sts.amazonaws.com")}, queue...)
		}
		// Reserve the seed's hint slot and first lookup before admitting local hints.
		addHint(seed)
		seedHints := queue
		queue = nil
		for i := len(roots) - 1; i >= 0; i-- {
			if roots[i].Identity.Key != "" {
				wanted[roots[i].Identity.Key] = true
				addHint(roots[i])
			}
		}
		queue = append(seedHints, queue...)
		// The list is shared with issuedKey(), so retrieval and accepted API types
		// cannot drift. Role labels do not suppress any credential-issuance method.
		for _, method := range supportedIssuanceAPIs {
			queue = append(queue, newTrailLookup(from, to, ctTypes.LookupAttributeKeyEventName, method))
		}
		for status.Pages < maxPages && len(queue) > 0 {
			query := queue[0]
			queue = queue[1:]
			if err := d.wait(ctx, status.AccountID+"/"+region); err != nil {
				status.Status = "partial"
				status.Detail = "CloudTrail lookup cancelled or deadline exceeded; history is incomplete."
				break
			}
			response, err := clients.cloudtrail.LookupEvents(ctx, &cloudtrail.LookupEventsInput{StartTime: &query.from, EndTime: &query.to, MaxResults: aws.Int32(50), NextToken: query.token, LookupAttributes: []ctTypes.LookupAttribute{{AttributeKey: query.attribute, AttributeValue: aws.String(query.value)}}})
			status.Pages++
			queryCalls[query.value]++
			if err != nil || response == nil {
				status.Status = "error"
				if status.Pages > 1 {
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
				id := rawID(raw)
				if seenRaw[id] {
					continue
				}
				seenRaw[id] = true
				// Preserve exact authorized audit originals, including any logged fields.
				event.remote = true
				event.account = status.AccountID
				event.region = region
				out = append(out, event)
			}
			if stop {
				break
			}
			// Exact-key candidates may reveal an older parent session. Prioritize its
			// recorded creation time, including parents encountered on an earlier page.
			// These are search hints only; the strict store still checks every edge.
			for depth := 0; depth < maxDepth; depth++ {
				changed := false
				for _, event := range out {
					if !wanted[event.issuedKey()] || event.Identity.Key == "" {
						continue
					}
					if !wanted[event.Identity.Key] {
						wanted[event.Identity.Key] = true
						changed = true
					}
					addHint(event)
				}
				if !changed {
					break
				}
			}
			token := aws.ToString(response.NextToken)
			if token == "" && query.attribute == ctTypes.LookupAttributeKeyEventName {
				finished[query.value] = true
			}
			if token != "" {
				if query.seen[token] {
					status.Status = "partial"
					status.Detail = "CloudTrail repeated a pagination token; history is incomplete."
				} else {
					query.seen[token] = true
					query.token = response.NextToken
					// Round-robin: a noisy AssumeRole page cannot starve SAML, OIDC, root,
					// temporary-user or federated-user issuance searches.
					queue = append(queue, query)
				}
			}
		}
		if status.Pages == maxPages && len(queue) > 0 {
			status.Status = "partial"
			status.Detail = fmt.Sprintf("CloudTrail %d-call budget reached; creation-time hints and all six EventName filters were prioritized, but history is incomplete (%d query windows still pending).", maxPages, len(queue))
		}
		status.Detail += fmt.Sprintf(" Creation-window calls: %d. EventName-filtered calls:", queryCalls["sts.amazonaws.com"])
		for _, method := range supportedIssuanceAPIs {
			coverage := "partial"
			if queryCalls[method] == 0 {
				coverage = "not queried"
			} else if finished[method] {
				coverage = "complete"
			}
			status.Detail += fmt.Sprintf(" %s=%d (%s);", method, queryCalls[method], coverage)
		}
		r.Sources = append(r.Sources, status)
	}
	return out
}
