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
type SequenceMatch struct {
	Events         []Row `json:"events"`
	DeltaMs        int64 `json:"deltaMs"`
	TiedCandidates []int `json:"tiedCandidates"`
}
type HuntOptions struct {
	Mode       string      `json:"mode"`
	Filter     Filter      `json:"filter"`
	Indicators []Indicator `json:"indicators"`
	First      *Expr       `json:"first"`
	Second     *Expr       `json:"second"`
	Steps      []*Expr     `json:"steps"`
	Group      string      `json:"group"`
	Minutes    int         `json:"minutes"`
	Snapshot   *Snapshot   `json:"snapshot"`
}
type HuntResult struct {
	Snapshot          Snapshot         `json:"snapshot"`
	Scanned           int              `json:"scanned"`
	Total             int              `json:"total"`
	Limit             int              `json:"limit"`
	InvalidTimes      int              `json:"invalidTimes"`
	MissingPrincipal  int              `json:"missingPrincipal"`
	MissingCredential int              `json:"missingCredential"`
	Indicators        []IndicatorCount `json:"indicators"`
	Matches           []HuntMatch      `json:"matches"`
	Pairs             []SequencePair   `json:"pairs"`
	Sequences         []SequenceMatch  `json:"sequences"`
	Notes             []string         `json:"notes"`
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

func sequencePredicates(options HuntOptions) ([]string, error) {
	steps := options.Steps
	if steps == nil {
		steps = []*Expr{options.First, options.Second}
	} else if options.First != nil || options.Second != nil {
		return nil, fmt.Errorf("use either sequence steps or legacy first/second, not both")
	}
	if len(steps) < 2 || len(steps) > 5 {
		return nil, fmt.Errorf("an ordered sequence needs 2 to 5 steps")
	}
	if options.Minutes < 1 || options.Minutes > 1440 {
		return nil, fmt.Errorf("sequence interval must be 1 to 1440 minutes")
	}
	if options.Group != "principal" && options.Group != "credential" {
		return nil, fmt.Errorf("choose principal or credential grouping")
	}
	predicates := make([]string, len(steps))
	for i, step := range steps {
		if step == nil {
			return nil, fmt.Errorf("step %c needs a search expression", 'A'+i)
		}
		predicate, err := exprSQL(step)
		if err != nil {
			return nil, fmt.Errorf("step %c: %w", 'A'+i, err)
		}
		if strings.TrimSpace(predicate) == "" {
			return nil, fmt.Errorf("step %c needs a search expression", 'A'+i)
		}
		predicates[i] = predicate
	}
	return predicates, nil
}

// Each nonterminal stage has one completed prefix per group/timestamp. The nearest
// completed predecessor is chosen, never an arbitrary raw intermediate event.
// Its start time is nondecreasing as the end time advances within one group:
// if the closest prefix is already too old, an earlier prefix cannot fit either.
// This lets one ASOF lookup per stage enforce the total window without expanding
// every possible combination or retaining multiple histories per event.
func sequenceSQL(base string, predicates []string, options HuntOptions) string {
	identity := "coalesce(identityArn,'')<>''"
	partition := "identityArn,eventMs"
	join := "c.identityArn=p.identityArn"
	if options.Group == "credential" {
		identity += " AND coalesce(accessKeyId,'')<>''"
		partition = "identityArn,accessKeyId,eventMs"
		join += " AND c.accessKeyId=p.accessKeyId"
	}
	base += ", eligible AS (SELECT * FROM window_events WHERE eventMs IS NOT NULL AND " + identity + ") "
	last := len(predicates) - 1
	for i, predicate := range predicates {
		name := fmt.Sprintf("step_%d", i)
		if i == last {
			// Terminal records remain distinct even when they have the same timestamp.
			base += ", " + name + " AS (SELECT seq,identityArn,accessKeyId,eventMs,1 AS tied FROM eligible WHERE " + predicate + ") "
		} else {
			base += ", " + name + "_candidates AS (SELECT seq,identityArn,accessKeyId,eventMs,count(*) OVER (PARTITION BY " + partition + ") AS tied,row_number() OVER (PARTITION BY " + partition + " ORDER BY seq DESC) AS tieRank FROM eligible WHERE " + predicate + "), " + name + " AS (SELECT seq,identityArn,accessKeyId,eventMs,tied FROM " + name + "_candidates WHERE tieRank=1) "
		}
		if i == 0 {
			base += ", prefix_0 AS (SELECT identityArn,accessKeyId,eventMs AS firstMs,eventMs AS endMs,seq AS seq0,tied AS tied0 FROM step_0) "
			continue
		}
		previous := make([]string, 0, i*2)
		for j := 0; j < i; j++ {
			previous = append(previous, fmt.Sprintf("p.seq%d,p.tied%d", j, j))
		}
		base += fmt.Sprintf(", prefix_%d AS (SELECT c.identityArn,c.accessKeyId,p.firstMs,c.eventMs AS endMs,%s,c.seq AS seq%d,c.tied AS tied%d FROM %s c ASOF JOIN prefix_%d p ON %s AND c.eventMs>p.endMs WHERE c.eventMs-p.firstMs<=%d) ", i, strings.Join(previous, ","), i, i, name, i-1, join, int64(options.Minutes)*60_000)
	}
	// Count/limit the compact prefixes before fetching their full display rows.
	base += fmt.Sprintf(", selected_sequences AS MATERIALIZED (SELECT *,count(*) OVER () AS total FROM prefix_%d ORDER BY endMs DESC,seq%d DESC LIMIT 500) ", last, last)
	rows, ties, joins := []string{}, []string{}, []string{}
	for i := range predicates {
		alias := fmt.Sprintf("e%d", i)
		rows = append(rows, rowStruct(alias))
		ties = append(ties, fmt.Sprintf("m.tied%d", i))
		joins = append(joins, fmt.Sprintf("JOIN window_events %s ON %s.seq=m.seq%d", alias, alias, i))
	}
	return base + "SELECT [" + strings.Join(rows, ",") + "] AS events,m.endMs-m.firstMs AS deltaMs,[" + strings.Join(ties, ",") + "] AS tiedCandidates,m.total FROM selected_sequences m " + strings.Join(joins, " ") + fmt.Sprintf(" ORDER BY m.endMs DESC,m.seq%d DESC", last)
}

func (s *Store) Hunt(parent context.Context, options HuntOptions) (HuntResult, error) {
	r := HuntResult{Limit: 500, Indicators: []IndicatorCount{}, Matches: []HuntMatch{}, Pairs: []SequencePair{}, Sequences: []SequenceMatch{}, Notes: []string{}}
	var indicators []Indicator
	var predicates []string
	var err error
	switch options.Mode {
	case "indicators":
		indicators, err = validateIndicators(options.Indicators)
		if err != nil {
			return r, err
		}
	case "sequence":
		predicates, err = sequencePredicates(options)
		if err != nil {
			return r, err
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
		columns := "*"
		if options.Mode == "sequence" {
			// All searchable/display fields are flat columns. Explicit projection
			// keeps raw payloads out of reused sequence CTEs even if they materialize.
			columns = pageCols + ",accessKeyId"
		}
		base := `WITH window_events AS (SELECT ` + columns + `,epoch_ms(try_cast(eventTime AS TIMESTAMPTZ)) AS eventMs FROM events` + where + `) `
		query := func(q string, dst any) error { return queryJSONOn(ctx, tx, q, dst) }
		var counts []struct {
			Scanned           int `json:"scanned"`
			InvalidTimes      int `json:"invalidTimes"`
			MissingPrincipal  int `json:"missingPrincipal"`
			MissingCredential int `json:"missingCredential"`
		}
		if err = query(base+"SELECT count(*) AS scanned,count(*) FILTER (WHERE eventMs IS NULL) AS invalidTimes,count(*) FILTER (WHERE coalesce(identityArn,'')='') AS missingPrincipal,count(*) FILTER (WHERE coalesce(accessKeyId,'')='') AS missingCredential FROM window_events", &counts); err != nil {
			return err
		}
		r.Scanned = counts[0].Scanned
		r.InvalidTimes = counts[0].InvalidTimes
		r.MissingPrincipal = counts[0].MissingPrincipal
		r.MissingCredential = counts[0].MissingCredential
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
			var matches []struct {
				SequenceMatch
				Total int `json:"total"`
			}
			if err = query(sequenceSQL(base, predicates, options), &matches); err != nil {
				return err
			}
			for _, match := range matches {
				r.Total = match.Total
				r.Sequences = append(r.Sequences, match.SequenceMatch)
				if len(match.Events) == 2 {
					r.Pairs = append(r.Pairs, SequencePair{First: match.Events[0], Second: match.Events[1], DeltaMs: match.DeltaMs, TiedFirst: match.TiedCandidates[0]})
				}
			}
			r.Notes = append(r.Notes, "Each final-step event returns at most one sequence, using its closest strictly earlier completed prefix at every step. The interval bounds the entire first-to-last span, not each adjacent gap. This does not enumerate every possible combination.", "Ordering uses recorded timestamps at millisecond resolution. Equal timestamps never establish step order. Intermediate timestamp ties report candidate counts and show the highest-source-sequence representative; each final-step record stays distinct. Missing timestamps or required grouping identifiers are excluded, and their scope counts can overlap.", "Sequences show temporal proximity for the same recorded identifiers, not causation, a verified session or one human operator. CloudTrail eventTime is request-completion time; arrival order does not establish event order. This search is not a Sigma correlation-rule interpreter.")
		}
		r.Notes = append(r.Notes, "Scope is the selected filter over the loaded evidence snapshot. Missing event categories, delivery delays, source variants or capture gaps can hide matches. No match is not proof of absence.")
		return nil
	})
	return r, err
}
