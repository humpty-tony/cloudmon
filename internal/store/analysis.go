package store

import (
	"context"
	"database/sql"
	"fmt"
)

const analysisLimit = 50

// Explicit identifiers remain case-sensitive. A display name is never an identity.
var analysisDimensions = map[string]string{
	"identityArn": "identityArn", "roleArn": "roleArn", "accountId": "accountId",
	"recipientAccountId": "recipientAccountId", "eventSource": "eventSource",
	"eventName": "eventName", "sourceIPAddress": "sourceIPAddress", "awsRegion": "awsRegion",
}

type AnalysisEntity struct {
	Dimension string `json:"dimension"`
	Value     string `json:"value"`
}
type AnalysisOptions struct {
	Filter      Filter          `json:"filter"`
	Dimension   string          `json:"dimension"`
	Compare     bool            `json:"compare"`
	WindowHours int             `json:"windowHours"`
	Entity      *AnalysisEntity `json:"entity"`
	Snapshot    *Snapshot       `json:"snapshot"`
}
type ActivityStats struct {
	Events          int    `json:"events"`
	Errors          int    `json:"errors"`
	Writes          int    `json:"writes"`
	UnknownReadOnly int    `json:"unknownReadOnly"`
	CredentialIDs   int    `json:"credentialIDs"`
	InvalidTimes    int    `json:"invalidTimes"`
	FirstMs         *int64 `json:"firstMs"`
	LastMs          *int64 `json:"lastMs"`
}
type ActivityGroup struct {
	Value       string `json:"value"`
	Current     int    `json:"current"`
	Previous    int    `json:"previous"`
	Errors      int    `json:"errors"`
	Writes      int    `json:"writes"`
	TotalGroups int    `json:"totalGroups"`
}
type ActivityAnalysis struct {
	Snapshot       Snapshot                   `json:"snapshot"`
	Scope          ActivityStats              `json:"scope"`
	Current        ActivityStats              `json:"current"`
	Previous       ActivityStats              `json:"previous"`
	Groups         []ActivityGroup            `json:"groups"`
	TotalGroups    int                        `json:"totalGroups"`
	Limit          int                        `json:"limit"`
	FromMs         int64                      `json:"fromMs"`
	ToMs           int64                      `json:"toMs"`
	PreviousFromMs int64                      `json:"previousFromMs"`
	HasWindow      bool                       `json:"hasWindow"`
	Breakdowns     map[string][]ActivityGroup `json:"breakdowns"`
	Events         []Row                      `json:"events"`
	Notes          []string                   `json:"notes"`
}

const activityStatsSQL = `count(*) AS events,
 count(*) FILTER (WHERE hasError) AS errors,
 count(*) FILTER (WHERE recordedReadOnly IS FALSE) AS writes,
 count(*) FILTER (WHERE recordedReadOnly IS NULL) AS unknownReadOnly,
 count(DISTINCT nullif(accessKeyId,'')) AS credentialIDs,
 count(*) FILTER (WHERE eventMs IS NULL) AS invalidTimes,
 min(eventMs) AS firstMs,max(eventMs) AS lastMs`

func (s *Store) Analyze(parent context.Context, options AnalysisOptions) (ActivityAnalysis, error) {
	r := ActivityAnalysis{Groups: []ActivityGroup{}, Events: []Row{}, Breakdowns: map[string][]ActivityGroup{}, Limit: analysisLimit, Notes: []string{}}
	column, ok := analysisDimensions[options.Dimension]
	if !ok {
		return r, fmt.Errorf("unknown analysis dimension")
	}
	if options.WindowHours != 1 && options.WindowHours != 24 && options.WindowHours != 168 {
		return r, fmt.Errorf("choose a 1-hour, 24-hour or 7-day comparison window")
	}
	entityPredicate := "TRUE"
	if options.Entity != nil {
		entityColumn, valid := analysisDimensions[options.Entity.Dimension]
		if !valid || len(options.Entity.Value) > 8192 {
			return r, fmt.Errorf("invalid analysis entity")
		}
		entityPredicate = "coalesce(" + entityColumn + ",'')=" + sqlStr(options.Entity.Value)
	}
	err := s.readSnapshot(parent, func(ctx context.Context, tx *sql.Tx) error {
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
		base := `WITH scoped AS (SELECT *,epoch_ms(try_cast(eventTime AS TIMESTAMPTZ)) AS eventMs,
 (coalesce(errorCode,'')<>'' OR coalesce(errorMessage,'')<>'') AS hasError,
 CASE WHEN json_type(raw,'$.readOnly')='BOOLEAN' THEN try_cast(json_extract_string(raw,'$.readOnly') AS BOOLEAN) END AS recordedReadOnly
 FROM events` + where + `) `
		query := func(q string, dst any) error { return queryJSONOn(ctx, tx, q, dst) }
		stats := func(q string, dst *ActivityStats) error {
			var rows []ActivityStats
			if err := query(q, &rows); err != nil {
				return err
			}
			*dst = rows[0]
			return nil
		}
		if err = stats(base+"SELECT "+activityStatsSQL+" FROM scoped", &r.Scope); err != nil {
			return err
		}
		current, previous := "TRUE", "FALSE"
		if options.Compare {
			current = "FALSE"
			if r.Scope.LastMs != nil {
				r.HasWindow = true
				r.ToMs = *r.Scope.LastMs + 1
				r.FromMs = r.ToMs - int64(options.WindowHours)*3_600_000
				r.PreviousFromMs = r.FromMs - int64(options.WindowHours)*3_600_000
				current = fmt.Sprintf("eventMs >= %d AND eventMs < %d", r.FromMs, r.ToMs)
				previous = fmt.Sprintf("eventMs >= %d AND eventMs < %d", r.PreviousFromMs, r.FromMs)
			}
		}
		base += ", selected AS (SELECT *,coalesce((" + current + "),FALSE) AS inCurrent,coalesce((" + previous + "),FALSE) AS inPrevious FROM scoped WHERE " + entityPredicate + ") "
		if err = stats(base+"SELECT "+activityStatsSQL+" FROM selected WHERE inCurrent", &r.Current); err != nil {
			return err
		}
		if err = stats(base+"SELECT "+activityStatsSQL+" FROM selected WHERE inPrevious", &r.Previous); err != nil {
			return err
		}
		groups := func(col string, compare bool, limit int) ([]ActivityGroup, error) {
			order := "current DESC,value"
			if compare {
				order = "abs(current-previous) DESC,current DESC,value"
			}
			q := base + fmt.Sprintf(`SELECT coalesce(%s,'') AS value,count(*) FILTER (WHERE inCurrent) AS current,
 count(*) FILTER (WHERE inPrevious) AS previous,count(*) FILTER (WHERE inCurrent AND hasError) AS errors,
 count(*) FILTER (WHERE inCurrent AND recordedReadOnly IS FALSE) AS writes,count(*) OVER () AS totalGroups
 FROM selected WHERE inCurrent OR inPrevious GROUP BY 1 ORDER BY %s LIMIT %d`, col, order, limit)
			rows := []ActivityGroup{}
			err := query(q, &rows)
			return rows, err
		}
		r.Groups, err = groups(column, options.Compare, analysisLimit)
		if err != nil {
			return err
		}
		if len(r.Groups) > 0 {
			r.TotalGroups = r.Groups[0].TotalGroups
		}
		if options.Entity != nil {
			for _, dimension := range []string{"eventSource", "eventName", "sourceIPAddress"} {
				r.Breakdowns[dimension], err = groups(analysisDimensions[dimension], false, 10)
				if err != nil {
					return err
				}
			}
			if err = query(base+"SELECT "+pageCols+" FROM selected WHERE inCurrent ORDER BY eventMs DESC NULLS LAST,seq DESC LIMIT 25", &r.Events); err != nil {
				return err
			}
		}
		r.Notes = append(r.Notes, "Counts describe stored events, not unique AWS actions. Cross-account records can describe the same action. Source versions use the displayed record.", "Errors count top-level errorCode/errorMessage only. Writes require a recorded boolean readOnly=false; missing or malformed values remain unknown.", "A principal ARN or source address is context, not proof of one human operator. Source addresses may also contain service names.")
		if options.Compare {
			r.Notes = append(r.Notes, "Equal adjacent windows end at the latest usable event time in the selected scope. Both retain every scope filter, including console time filters. Gaps or uncollected event categories can explain differences; this is not a statistical anomaly detector.")
		}
		return nil
	})
	return r, err
}
