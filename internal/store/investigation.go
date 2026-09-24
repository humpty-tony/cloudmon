package store

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"time"
)

const investigationLimit = 500
const resourceDisplayLimit = 100

// Only complete observed ARNs are joined. Names such as "prod" are deliberately
// not converted to ARNs or matched across accounts, services, and partitions.
const arnPattern = `^arn:[^:]+:[^:]+:[^:]*:[^:]*:.+$`
const resourceReferencesSQL = `SELECT e.seq, json_extract_string(r.value,'$.ARN') AS arn,
 coalesce(json_extract_string(r.value,'$.type'),'') AS kind,
 'resources[' || r.key || '].ARN' AS source
 FROM window_events e, json_each(CASE WHEN json_type(e.raw,'$.resources')='ARRAY' THEN json_extract(e.raw,'$.resources') ELSE '[]'::JSON END) r
 WHERE json_type(r.value,'$.ARN')='VARCHAR' AND regexp_full_match(json_extract_string(r.value,'$.ARN'), '` + arnPattern + `')
 UNION ALL
 SELECT e.seq, json_extract_string(r.value,'$') AS arn, 'Request reference' AS kind,
 'requestParameters[' || to_json(r.key)::VARCHAR || ']' AS source
 FROM window_events e, json_each(CASE WHEN json_type(e.raw,'$.requestParameters')='OBJECT' THEN json_extract(e.raw,'$.requestParameters') ELSE '{}'::JSON END) r
 WHERE json_type(r.value)='VARCHAR' AND regexp_full_match(json_extract_string(r.value,'$'), '` + arnPattern + `')`

type ResourceReference struct {
	ARN    string `json:"arn"`
	Kind   string `json:"kind"`
	Source string `json:"source"`
}
type CorrelationReason struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Value string `json:"value,omitempty"`
}
type InvestigationEvent struct {
	Event   Row                 `json:"event"`
	Reasons []CorrelationReason `json:"reasons"`
	DeltaMs int64               `json:"deltaMs"`
}
type InvestigationOptions struct {
	Seq      int64     `json:"seq"`
	EventID  string    `json:"eventID"`
	Minutes  int       `json:"minutes"`
	Relation string    `json:"relation"`
	Snapshot *Snapshot `json:"snapshot"`
}
type Investigation struct {
	Snapshot           Snapshot             `json:"snapshot"`
	Anchor             Row                  `json:"anchor"`
	Resources          []ResourceReference  `json:"resources"`
	ResourcesTruncated bool                 `json:"resourcesTruncated"`
	Events             []InvestigationEvent `json:"events"`
	Total              int                  `json:"total"`
	Limit              int                  `json:"limit"`
	FromMs             int64                `json:"fromMs"`
	ToMs               int64                `json:"toMs"`
	Notes              []string             `json:"notes"`
}

func (s *Store) Investigate(parent context.Context, options InvestigationOptions) (Investigation, error) {
	result := Investigation{Resources: []ResourceReference{}, Events: []InvestigationEvent{}, Notes: []string{}, Limit: investigationLimit}
	err := s.readSnapshot(parent, func(ctx context.Context, tx *sql.Tx) error {
		var err error
		result, err = investigateOn(ctx, tx, options)
		return err
	})
	return result, err
}

// investigateOn also lets exports read the context and its evidence in one transaction.
func investigateOn(ctx context.Context, tx *sql.Tx, options InvestigationOptions) (Investigation, error) {
	return investigateUsing(ctx, tx, options, func(q string, dst any) error { return queryJSONOn(ctx, tx, q, dst) })
}

func investigateUsing(ctx context.Context, tx *sql.Tx, options InvestigationOptions, query func(string, any) error) (Investigation, error) {
	result := Investigation{Resources: []ResourceReference{}, Events: []InvestigationEvent{}, Notes: []string{}, Limit: investigationLimit}
	if options.Minutes == 0 {
		options.Minutes = 5
	}
	if options.Minutes < 1 || options.Minutes > 60 {
		return result, fmt.Errorf("choose a context window between 1 and 60 minutes")
	}
	modes := map[string]string{"": "TRUE", "all": "TRUE", "related": "sharedAction OR credential OR principal OR network OR request OR len(resourceArns)>0", "shared": "sharedAction", "credential": "credential", "principal": "principal", "ip": "network", "request": "request", "resources": "len(resourceArns)>0"}
	predicate, ok := modes[options.Relation]
	if !ok {
		return result, fmt.Errorf("unknown investigation relationship")
	}
	err := func() error {
		var err error
		if options.Snapshot == nil {
			result.Snapshot, err = snapshotOn(ctx, tx)
		} else {
			result.Snapshot = *options.Snapshot
			err = validateSnapshot(ctx, tx, result.Snapshot)
		}
		if err != nil {
			return err
		}
		var seeds []struct {
			Row
			AccessKeyID string `json:"accessKeyId"`
			SharedID    string `json:"sharedID"`
			RequestID   string `json:"requestID"`
			Variants    int    `json:"variants"`
		}
		q := fmt.Sprintf(`SELECT %s,accessKeyId,json_extract_string(raw,'$.sharedEventID') AS sharedID,json_extract_string(raw,'$.requestID') AS requestID,
   (SELECT count(DISTINCT o.raw) FROM observations o WHERE o.eventKey=events.eventKey) AS variants
   FROM events WHERE seq=%d AND seq<=%d`, pageCols, options.Seq, result.Snapshot.MaxSeq)
		if err = query(q, &seeds); err != nil {
			return err
		}
		if len(seeds) != 1 || seeds[0].EventID != options.EventID {
			return fmt.Errorf("the selected event is no longer in this dataset; reopen the investigation")
		}
		seed := seeds[0]
		switch options.Relation {
		case "credential":
			if seed.AccessKeyID == "" || seed.IdentityArn == "" {
				result.Notes = append(result.Notes, "Credential correlation requires both a recorded access key ID and principal ARN.")
			}
		case "ip":
			if net.ParseIP(seed.SourceIPAddress) == nil {
				result.Notes = append(result.Notes, "The selected event has no literal source IP. Service names and AWS Internal values are not grouped.")
			}
		case "principal":
			if seed.IdentityArn == "" {
				result.Notes = append(result.Notes, "The selected event has no principal ARN to match.")
			}
		case "shared":
			if seed.SharedID == "" {
				result.Notes = append(result.Notes, "The selected event has no sharedEventID to match.")
			}
		case "request":
			if seed.RequestID == "" || seed.RecipientAccountID == "" || seed.AWSRegion == "" {
				result.Notes = append(result.Notes, "Request correlation requires a recorded request ID, recipient account, region, service, and operation.")
			}
		}
		result.Anchor = seed.Row
		anchorTime, err := time.Parse(time.RFC3339Nano, seed.EventTime)
		if err != nil {
			return fmt.Errorf("this event has no valid timestamp for surrounding-event investigation")
		}
		delta := int64(options.Minutes) * 60_000
		result.FromMs = anchorTime.UnixMilli() - delta
		result.ToMs = anchorTime.UnixMilli() + delta
		if seed.Variants > 1 {
			result.Notes = append(result.Notes, "The anchor has different source versions. Correlations use its displayed record; compare Sources & hashes before interpreting the links.")
		}
		base := fmt.Sprintf(`WITH window_events AS (SELECT *,epoch_ms(try_cast(eventTime AS TIMESTAMPTZ)) AS eventMs FROM events WHERE seq<=%d AND epoch_ms(try_cast(eventTime AS TIMESTAMPTZ)) BETWEEN %d AND %d), resource_refs AS (%s) `, result.Snapshot.MaxSeq, result.FromMs, result.ToMs, resourceReferencesSQL)
		if err = query(base+fmt.Sprintf("SELECT DISTINCT arn,kind,source FROM resource_refs WHERE seq=%d ORDER BY arn,source LIMIT %d", options.Seq, resourceDisplayLimit+1), &result.Resources); err != nil {
			return err
		}
		if len(result.Resources) > resourceDisplayLimit {
			result.Resources = result.Resources[:resourceDisplayLimit]
			result.ResourcesTruncated = true
			result.Notes = append(result.Notes, "Only the first 100 resource references are displayed; correlation still considers every recorded resource ARN in this window.")
		}
		if len(result.Resources) == 0 {
			result.Notes = append(result.Notes, "No complete resource ARN was recorded in the resource list or top-level request values. Resource-name guesses are not used for correlation.")
		}
		eq := func(column, value string) string {
			if value == "" {
				return "FALSE"
			}
			return column + "=" + sqlStr(value)
		}
		shared := eq("json_extract_string(raw,'$.sharedEventID')", seed.SharedID) + " AND " + eq("eventSource", seed.EventSource) + " AND " + eq("eventName", seed.EventName)
		// A key ID alone is not globally unique; require the same recorded principal
		// ARN too. Account-only/missing identities are left as unlinked context.
		credential := eq("accessKeyId", seed.AccessKeyID) + " AND " + eq("identityArn", seed.IdentityArn)
		principal := eq("identityArn", seed.IdentityArn)
		network := "FALSE"
		if net.ParseIP(seed.SourceIPAddress) != nil {
			network = eq("sourceIPAddress", seed.SourceIPAddress)
		}
		request := eq("json_extract_string(raw,'$.requestID')", seed.RequestID) + " AND " + eq("eventSource", seed.EventSource) + " AND " + eq("eventName", seed.EventName) + " AND " + eq("recipientAccountId", seed.RecipientAccountID) + " AND " + eq("awsRegion", seed.AWSRegion)
		var rows []struct {
			Row
			SharedAction bool     `json:"sharedAction"`
			Credential   bool     `json:"credential"`
			Principal    bool     `json:"principal"`
			Network      bool     `json:"network"`
			Request      bool     `json:"request"`
			ResourceArns []string `json:"resourceArns"`
			EventMs      int64    `json:"eventMs"`
			Total        int      `json:"total"`
		}
		// Count and rows share one query and one snapshot. Prefer the anchor and the
		// closest events if the window is dense, then present the retained rows in time order.
		q = base + fmt.Sprintf(`, flags AS (SELECT %s,eventMs,
   coalesce((%s),false) AS sharedAction,coalesce((%s),false) AS credential,coalesce((%s),false) AS principal,coalesce((%s),false) AS network,coalesce((%s),false) AS request,
   ARRAY(SELECT DISTINCT r.arn FROM resource_refs r WHERE r.seq=e.seq AND r.arn IN (SELECT arn FROM resource_refs WHERE seq=%d) ORDER BY r.arn LIMIT 5) AS resourceArns
   FROM window_events e), retained AS (
   SELECT *,count(*) OVER () AS total FROM flags WHERE seq=%d OR (%s)
   ORDER BY (seq=%d) DESC,abs(eventMs-%d),eventMs,seq LIMIT %d)
   SELECT * FROM retained ORDER BY eventMs,seq`, pageCols, shared, credential, principal, network, request, options.Seq, options.Seq, predicate, options.Seq, anchorTime.UnixMilli(), investigationLimit)
		if err = query(q, &rows); err != nil {
			return err
		}
		for _, r := range rows {
			result.Total = r.Total
			e := InvestigationEvent{Event: r.Row, DeltaMs: r.EventMs - anchorTime.UnixMilli(), Reasons: []CorrelationReason{}}
			add := func(kind, label, value string) {
				e.Reasons = append(e.Reasons, CorrelationReason{Kind: kind, Label: label, Value: value})
			}
			if r.Seq == options.Seq {
				add("anchor", "Selected event", "")
			} else {
				if r.SharedAction {
					add("shared", "Shared AWS action", seed.SharedID)
				}
				if r.Request {
					add("request", "Same request ID, service, operation, account and region", seed.RequestID)
				}
				if r.Credential {
					add("credential", "Matching access key and principal ARN", seed.AccessKeyID)
				} else if r.Principal {
					add("principal", "Same principal ARN (context)", seed.IdentityArn)
				}
				for _, arn := range r.ResourceArns {
					add("resource", "Shared recorded ARN", arn)
				}
				if r.Network {
					add("ip", "Same source IP (context)", seed.SourceIPAddress)
				}
				if len(e.Reasons) == 0 {
					add("time", "Nearby in time", "")
				}
			}
			result.Events = append(result.Events, e)
		}
		if result.Total > investigationLimit {
			result.Notes = append(result.Notes, fmt.Sprintf("Showing the %d closest events of %d matches. Narrow the window or relationship to inspect the rest.", investigationLimit, result.Total))
		}
		result.Notes = append(result.Notes, "Only ingested events with usable timestamps appear in this window. Capture gaps and omitted resource fields can hide relationships.")
		result.Notes = append(result.Notes, "Shared identifiers show relationships in the loaded evidence, not causation. A principal or IP can be used by multiple operators.")
		return nil
	}()
	return result, err
}
