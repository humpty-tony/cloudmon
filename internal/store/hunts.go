package store

import (
	"context"
	"database/sql"
	"fmt"
	"net/netip"
	"regexp"
	"strings"
)

type Indicator struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}
type IndicatorCount struct {
	Indicator
	Matches int `json:"matches"`
}
type HuntMatch struct {
	Event      Row   `json:"event"`
	Indicators []int `json:"indicators"`
}
type SequencePair struct {
	First     Row   `json:"first"`
	Second    Row   `json:"second"`
	DeltaMs   int64 `json:"deltaMs"`
	TiedFirst int   `json:"tiedFirst"`
}
type HuntOptions struct {
	Mode       string      `json:"mode"`
	Filter     Filter      `json:"filter"`
	Indicators []Indicator `json:"indicators"`
	First      *Expr       `json:"first"`
	Second     *Expr       `json:"second"`
	Group      string      `json:"group"`
	Minutes    int         `json:"minutes"`
	Snapshot   *Snapshot   `json:"snapshot"`
}
type HuntResult struct {
	Snapshot         Snapshot         `json:"snapshot"`
	Scanned          int              `json:"scanned"`
	Total            int              `json:"total"`
	Limit            int              `json:"limit"`
	InvalidTimes     int              `json:"invalidTimes"`
	MissingPrincipal int              `json:"missingPrincipal"`
	Indicators       []IndicatorCount `json:"indicators"`
	Matches          []HuntMatch      `json:"matches"`
	Pairs            []SequencePair   `json:"pairs"`
	Notes            []string         `json:"notes"`
}

var completeARN = regexp.MustCompile(arnPattern)
var keyIdentifier = regexp.MustCompile(`^[A-Za-z0-9_]{1,128}$`)

func validateIndicators(input []Indicator) ([]Indicator, error) {
	if len(input) == 0 || len(input) > 100 {
		return nil, fmt.Errorf("enter 1 to 100 typed indicators")
	}
	output := []Indicator{}
	seen := map[Indicator]bool{}
	for i, indicator := range input {
		if len(indicator.Value) == 0 || len(indicator.Value) > 2048 {
			return nil, fmt.Errorf("indicator %d requires a value of 1 to 2048 bytes", i+1)
		}
		valid := false
		switch indicator.Kind {
		case "ip":
			ip, err := netip.ParseAddr(indicator.Value)
			valid = err == nil && ip.Zone() == ""
			if valid {
				indicator.Value = ip.String()
			}
		case "cidr":
			network, err := netip.ParsePrefix(indicator.Value)
			valid = err == nil
			if valid {
				indicator.Value = network.Masked().String()
			}
		case "key":
			valid = keyIdentifier.MatchString(indicator.Value)
		case "event":
			valid = len(indicator.Value) <= 256 && !strings.ContainsAny(indicator.Value, "\r\n\t")
		case "arn":
			valid = completeARN.MatchString(indicator.Value)
		}
		if !valid {
			return nil, fmt.Errorf("indicator %d has an invalid type or value (%s)", i+1, indicator.Kind)
		}
		if !seen[indicator] {
			seen[indicator] = true
			output = append(output, indicator)
		}
	}
	return output, nil
}

func rowStruct(alias string) string {
	fields := strings.Split(pageCols, ",")
	for i, field := range fields {
		fields[i] = field + " := " + alias + "." + field
	}
	return "struct_pack(" + strings.Join(fields, ",") + ")"
}

func (s *Store) Hunt(parent context.Context, options HuntOptions) (HuntResult, error) {
	r := HuntResult{Limit: 500, Indicators: []IndicatorCount{}, Matches: []HuntMatch{}, Pairs: []SequencePair{}, Notes: []string{}}
	var indicators []Indicator
	var first, second string
	var err error
	switch options.Mode {
	case "indicators":
		indicators, err = validateIndicators(options.Indicators)
		if err != nil {
			return r, err
		}
	case "sequence":
		if options.First == nil || options.Second == nil {
			return r, fmt.Errorf("both sequence steps need a search expression")
		}
		if options.Minutes < 1 || options.Minutes > 1440 {
			return r, fmt.Errorf("sequence interval must be 1 to 1440 minutes")
		}
		if options.Group != "principal" && options.Group != "credential" {
			return r, fmt.Errorf("choose principal or credential grouping")
		}
		first, err = exprSQL(options.First)
		if err != nil {
			return r, fmt.Errorf("step A: %w", err)
		}
		second, err = exprSQL(options.Second)
		if err != nil {
			return r, fmt.Errorf("step B: %w", err)
		}
	default:
		return r, fmt.Errorf("unknown hunt mode")
	}
	err = s.readSnapshot(parent, func(ctx context.Context, tx *sql.Tx) error {
		var err error
		if options.Snapshot == nil {
			r.Snapshot, err = snapshotOn(ctx, tx)
		} else {
			r.Snapshot = *options.Snapshot
			err = validateSnapshot(ctx, tx, r.Snapshot)
		}
		if err != nil {
			return err
		}
		where, err := snapshotWhere(options.Filter, r.Snapshot, 0)
		if err != nil {
			return err
		}
		base := `WITH window_events AS (SELECT *,epoch_ms(try_cast(eventTime AS TIMESTAMPTZ)) AS eventMs FROM events` + where + `) `
		query := func(q string, dst any) error { return queryJSONOn(ctx, tx, q, dst) }
		var counts []struct {
			Scanned          int `json:"scanned"`
			InvalidTimes     int `json:"invalidTimes"`
			MissingPrincipal int `json:"missingPrincipal"`
		}
		if err = query(base+"SELECT count(*) AS scanned,count(*) FILTER (WHERE eventMs IS NULL) AS invalidTimes,count(*) FILTER (WHERE coalesce(identityArn,'')='') AS missingPrincipal FROM window_events", &counts); err != nil {
			return err
		}
		r.Scanned = counts[0].Scanned
		r.InvalidTimes = counts[0].InvalidTimes
		r.MissingPrincipal = counts[0].MissingPrincipal
		if options.Mode == "indicators" {
			parts := []string{}
			needsResources := false
			for i, indicator := range indicators {
				literal := sqlStr(indicator.Value)
				predicate := ""
				switch indicator.Kind {
				case "ip", "cidr":
					predicate = "cloudmon_ip_match(sourceIPAddress," + literal + ")"
				case "key":
					predicate = "accessKeyId=" + literal
				case "event":
					predicate = "eventID=" + literal
				case "arn":
					predicate = "identityArn=" + literal + " OR roleArn=" + literal + " OR EXISTS (SELECT 1 FROM resource_refs r WHERE r.seq=e.seq AND r.arn=" + literal + ")"
					needsResources = true
				}
				parts = append(parts, fmt.Sprintf("SELECT seq,%d AS indicator FROM window_events e WHERE %s", i, predicate))
				r.Indicators = append(r.Indicators, IndicatorCount{Indicator: indicator})
			}
			if needsResources {
				base += ", resource_refs AS (" + resourceReferencesSQL + ") "
			}
			base += ", hits AS (" + strings.Join(parts, " UNION ALL ") + ") "
			var totals []struct {
				Indicator int `json:"indicator"`
				Matches   int `json:"matches"`
			}
			if err = query(base+"SELECT indicator,count(*) AS matches FROM hits GROUP BY indicator", &totals); err != nil {
				return err
			}
			for _, total := range totals {
				r.Indicators[total.Indicator].Matches = total.Matches
			}
			var matches []struct {
				HuntMatch
				Total int `json:"total"`
			}
			if err = query(base+", matched AS (SELECT seq,list(indicator ORDER BY indicator) AS indicators FROM hits GROUP BY seq) SELECT "+rowStruct("e")+" AS event,h.indicators,count(*) OVER () AS total FROM window_events e JOIN matched h USING(seq) ORDER BY eventMs DESC NULLS LAST,e.seq DESC LIMIT 500", &matches); err != nil {
				return err
			}
			for _, match := range matches {
				r.Total = match.Total
				r.Matches = append(r.Matches, match.HuntMatch)
			}
			r.Notes = append(r.Notes, "Indicator counts can overlap; the event total counts each matched event once. IDs and ARNs match exactly, including case and partition.", "ARN matching includes principal/session issuer ARNs, all resources[].ARN entries and complete ARN strings directly in request parameters. Nested request values, response-only ARNs and guessed resource names are outside this extractor.", "IP/CIDR matching parses IPv4 and IPv6 addresses. Service names, zone identifiers and malformed addresses never match. IPv4 and IPv4-mapped IPv6 remain different address families.")
		} else {
			identity := "coalesce(identityArn,'')<>''"
			partition := "identityArn,eventMs"
			join := "b.identityArn=a.identityArn"
			if options.Group == "credential" {
				identity += " AND coalesce(accessKeyId,'')<>''"
			}
			if options.Group == "credential" {
				partition = "identityArn,accessKeyId,eventMs"
				join += " AND b.accessKeyId=a.accessKeyId"
			}
			base += ", eligible AS (SELECT * FROM window_events WHERE eventMs IS NOT NULL AND " + identity + "), first_candidates AS (SELECT *,count(*) OVER (PARTITION BY " + partition + ") AS tiedFirst,row_number() OVER (PARTITION BY " + partition + " ORDER BY seq DESC) AS tieRank FROM eligible WHERE " + first + "), first_events AS (SELECT * FROM first_candidates WHERE tieRank=1), second_events AS (SELECT * FROM eligible WHERE " + second + ") "
			var pairs []struct {
				SequencePair
				Total int `json:"total"`
			}
			q := base + "SELECT " + rowStruct("a") + " AS first," + rowStruct("b") + " AS second,b.eventMs-a.eventMs AS deltaMs,a.tiedFirst,count(*) OVER () AS total FROM second_events b ASOF JOIN first_events a ON " + join + fmt.Sprintf(" AND b.eventMs>a.eventMs WHERE b.eventMs-a.eventMs<=%d ORDER BY b.eventMs DESC,b.seq DESC LIMIT 500", int64(options.Minutes)*60_000)
			if err = query(q, &pairs); err != nil {
				return err
			}
			for _, pair := range pairs {
				r.Total = pair.Total
				r.Pairs = append(r.Pairs, pair.SequencePair)
			}
			r.Notes = append(r.Notes, "Each B is paired with the closest strictly earlier matching A within the interval, using recorded timestamps at millisecond resolution. This returns at most one pair per B, not every possible combination.", "Equal-time A candidates are counted; the displayed representative uses the highest source sequence. Equal A/B timestamps never establish order. Missing timestamps or required grouping identifiers are excluded.", "Pairs show temporal proximity for the same recorded identifiers, not causation, a verified session or one human operator. This two-step search is not a Sigma correlation-rule interpreter.")
		}
		r.Notes = append(r.Notes, "Scope is the selected filter over the loaded evidence snapshot. Missing event categories, delivery delays, source variants or capture gaps can hide matches. No match is not proof of absence.")
		return nil
	})
	return r, err
}
