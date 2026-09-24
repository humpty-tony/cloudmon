package store

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Row is one event projected into the columns the UI can display. RawJSON is populated
// only by Raw / RawBySeqs (the detail pane and export); Page / Newer window rows use
// pageCols, which omits `raw` to keep the loaded window tiny, so their RawJSON is empty.
type Row struct {
	Seq                int64  `json:"seq"`
	EventID            string `json:"eventID"`
	EventTime          string `json:"eventTime"`
	EventName          string `json:"eventName"`
	EventSource        string `json:"eventSource"`
	AWSRegion          string `json:"awsRegion"`
	SourceIPAddress    string `json:"sourceIPAddress"`
	UserAgent          string `json:"userAgent"`
	IdentityType       string `json:"identityType"`
	IdentityArn        string `json:"identityArn"`
	UserName           string `json:"userName"`
	AccountID          string `json:"accountId"`
	PrincipalID        string `json:"principalId"`
	RoleArn            string `json:"roleArn"`
	SessionName        string `json:"sessionName"`
	ErrorCode          string `json:"errorCode"`
	ErrorMessage       string `json:"errorMessage"`
	RecipientAccountID string `json:"recipientAccountId"`
	ReadOnly           bool   `json:"readOnly"`
	ManagementEvent    bool   `json:"managementEvent"`
	RawJSON            string `json:"rawJSON"`
}

// pageCols intentionally omits `raw` - the detail pane fetches it lazily via Raw(seq).
// Keeping the full record out of the page keeps rows tiny (~200B), so a big loaded
// window stays cheap in the browser and can't blow up memory.
const pageCols = `seq,eventID,eventTime,eventName,eventSource,awsRegion,sourceIPAddress,userAgent,identityType,identityArn,userName,accountId,principalId,roleArn,sessionName,errorCode,errorMessage,recipientAccountId,readOnly,managementEvent`

// Filter is the structured, injection-safe filter the UI builds from facets,
// pivots, and toolbar toggles. Expr carries the free-text query language
// (eventSource="ec2" and eventName="List*"), parsed client-side into a tree that
// this package turns into SQL - see Expr / exprSQL below.
type Filter struct {
	Includes     map[string][]string `json:"includes"`
	Excludes     map[string][]string `json:"excludes"`
	ErrorsOnly   bool                `json:"errorsOnly"`
	HideReadOnly bool                `json:"hideReadOnly"`
	FromMs       int64               `json:"fromMs"`
	ToMs         int64               `json:"toMs"`
	Text         string              `json:"text"`
	Expr         *Expr               `json:"expr"`
}

// Expr is one node of the parsed query-language expression. The parser runs
// client-side (instant validation); Go turns the tree into SQL here so column
// whitelisting and value escaping live in exactly one place - the frontend can
// never inject SQL, only a constrained tree of these nodes.
type Expr struct {
	T     string `json:"t"`               // and | or | not | cmp | text
	Nodes []Expr `json:"nodes,omitempty"` // and / or children
	Node  *Expr  `json:"node,omitempty"`  // not child
	Field string `json:"field,omitempty"` // cmp: query-language field name
	Op    string `json:"op,omitempty"`    // cmp: eq | ne | regex | nregex | contains
	Value string `json:"value,omitempty"` // cmp / text operand
	Regex bool   `json:"regex,omitempty"` // text: match Value as a regex, not a substring
}

// queryFieldExpr maps a query-language field (lower-cased) to the SQL column or
// expression it filters on. This whitelist is the injection guard for field
// names; derived fields (result, readOnly) resolve to expressions over stored
// columns so the language can query them like any other field.
var queryFieldExpr = map[string]string{
	"eventname":          "eventName",
	"eventsource":        "eventSource",
	"awsregion":          "awsRegion",
	"sourceipaddress":    "sourceIPAddress",
	"useragent":          "userAgent",
	"identitytype":       "identityType",
	"identityarn":        "identityArn",
	"user":               "userName",
	"username":           "userName",
	"rolearn":            "roleArn",
	"sessionname":        "sessionName",
	"accountid":          "accountId",
	"principalid":        "principalId",
	"errorcode":          "errorCode",
	"errormessage":       "errorMessage",
	"recipientaccountid": "recipientAccountId",
	"eventid":            "eventID",
	"eventtime":          "eventTime",
	"result":             "coalesce(nullif(errorCode,''),'Success')",
	"readonly":           "CAST(readOnly AS VARCHAR)",
	"managementevent":    "CAST(managementEvent AS VARCHAR)",
}

// filterable columns whitelist - guards against SQL injection via column name.
var filterCols = map[string]bool{
	"eventName": true, "eventSource": true, "awsRegion": true, "sourceIPAddress": true,
	"identityType": true, "identityArn": true, "userName": true, "accountId": true,
	"principalId": true, "errorCode": true, "recipientAccountId": true,
	"roleArn": true, "sessionName": true, "userAgent": true,
}

var facetFields = []string{"eventSource", "eventName", "userName", "roleArn", "identityType", "sourceIPAddress", "awsRegion"}
var textCols = []string{"eventName", "eventSource", "userName", "roleArn", "sessionName", "identityArn", "principalId", "sourceIPAddress", "errorCode"}

func inList(col string, vals []string) string {
	q := make([]string, 0, len(vals))
	for _, v := range vals {
		q = append(q, sqlStr(v))
	}
	return col + " IN (" + strings.Join(q, ",") + ")"
}

// escapeLike escapes the LIKE/ILIKE metacharacters so a user value matches
// literally under `ESCAPE '\'`.
func escapeLike(s string) string {
	return strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(s)
}

// globToLike turns a glob (with * and ?) into a LIKE pattern, escaping any LIKE
// metacharacters already present so only the glob wildcards stay special.
func globToLike(g string) string {
	g = escapeLike(g)
	g = strings.ReplaceAll(g, "*", "%")
	g = strings.ReplaceAll(g, "?", "_")
	return g
}

// textMatchSQL matches a bareword (regex=false) or regex (regex=true) free-text
// term across the searchable columns - the SQL form of the old searchableText().
func textMatchSQL(word string, regex bool) string {
	w := strings.TrimSpace(word)
	if w == "" {
		return ""
	}
	ors := make([]string, 0, len(textCols))
	if regex {
		pat := sqlStr(w)
		for _, col := range textCols {
			ors = append(ors, "regexp_matches("+col+", "+pat+", 'i')")
		}
	} else {
		like := sqlStr("%" + escapeLike(w) + "%")
		for _, col := range textCols {
			ors = append(ors, col+" ILIKE "+like+" ESCAPE '\\'")
		}
	}
	return "(" + strings.Join(ors, " OR ") + ")"
}

// cmpSQL compiles one field comparison. The value is always escaped via sqlStr;
// the field is resolved through queryFieldExpr (the injection guard).
func cmpSQL(field, op, value string) (string, error) {
	col, ok := queryFieldExpr[strings.ToLower(field)]
	if !ok {
		return "", fmt.Errorf("unknown query field %q", field)
	}
	switch op {
	case "exists": // bare  field=  → has a value
		return "(" + col + " IS NOT NULL AND " + col + " <> '')", nil
	case "nexists": // bare  field!=  → missing / empty
		return "(" + col + " IS NULL OR " + col + " = '')", nil
	case "eq", "ne":
		neg := op == "ne"
		switch {
		case value == "": // explicit empty string:  field=""  is-empty ;  field!=""  has-a-value
			if neg {
				return "(" + col + " IS NOT NULL AND " + col + " <> '')", nil
			}
			return "(" + col + " IS NULL OR " + col + " = '')", nil
		case strings.ContainsAny(value, "*?"): // glob
			pat := sqlStr(globToLike(value))
			if neg {
				return "(" + col + " IS NULL OR " + col + " NOT ILIKE " + pat + " ESCAPE '\\')", nil
			}
			return "(" + col + " ILIKE " + pat + " ESCAPE '\\')", nil
		default: // exact, case-insensitive
			lv := sqlStr(strings.ToLower(value))
			if neg {
				return "(" + col + " IS NULL OR lower(" + col + ") <> " + lv + ")", nil
			}
			return "lower(" + col + ") = " + lv, nil
		}
	case "contains":
		like := sqlStr("%" + escapeLike(value) + "%")
		return "(" + col + " ILIKE " + like + " ESCAPE '\\')", nil
	case "regex", "nregex":
		m := "regexp_matches(" + col + ", " + sqlStr(value) + ", 'i')"
		if op == "nregex" {
			return "(" + col + " IS NULL OR NOT " + m + ")", nil
		}
		return m, nil
	}
	return "", fmt.Errorf("unknown query op %q", op)
}

// exprSQL compiles a parsed query-language tree into a SQL boolean expression.
// Empty nodes (e.g. a bareword that trims to nothing) collapse away.
func exprSQL(e *Expr) (string, error) {
	if e == nil {
		return "", nil
	}
	switch e.T {
	case "and", "or":
		joiner := " AND "
		if e.T == "or" {
			joiner = " OR "
		}
		parts := make([]string, 0, len(e.Nodes))
		for i := range e.Nodes {
			s, err := exprSQL(&e.Nodes[i])
			if err != nil {
				return "", err
			}
			if s != "" {
				parts = append(parts, s)
			}
		}
		if len(parts) == 0 {
			return "", nil
		}
		return "(" + strings.Join(parts, joiner) + ")", nil
	case "not":
		s, err := exprSQL(e.Node)
		if err != nil {
			return "", err
		}
		if s == "" {
			return "", nil
		}
		return "(NOT " + s + ")", nil
	case "text":
		return textMatchSQL(e.Value, e.Regex), nil
	case "cmp":
		return cmpSQL(e.Field, e.Op, e.Value)
	}
	return "", fmt.Errorf("unknown expr node %q", e.T)
}

func (f Filter) where() (string, error) {
	var c []string
	for col, vals := range f.Includes {
		if filterCols[col] && len(vals) > 0 {
			c = append(c, inList(col, vals))
		}
	}
	for col, vals := range f.Excludes {
		if filterCols[col] && len(vals) > 0 {
			c = append(c, "("+col+" IS NULL OR NOT "+inList(col, vals)+")")
		}
	}
	if f.ErrorsOnly {
		c = append(c, "errorCode IS NOT NULL AND errorCode <> ''")
	}
	if f.HideReadOnly {
		c = append(c, "readOnly = false")
	}
	if f.FromMs > 0 {
		c = append(c, fmt.Sprintf("ts >= epoch_ms(%d)", f.FromMs))
	}
	if f.ToMs > 0 {
		c = append(c, fmt.Sprintf("ts <= epoch_ms(%d)", f.ToMs))
	}
	if s := textMatchSQL(f.Text, false); s != "" {
		c = append(c, s)
	}
	if f.Expr != nil {
		s, err := exprSQL(f.Expr)
		if err != nil {
			return "", err
		}
		if s != "" {
			c = append(c, s)
		}
	}
	if len(c) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(c, " AND "), nil
}

// Page returns a window of events (newest-first), matching the filter.
func (s *Store) Page(f Filter, offset, limit int) ([]Row, error) {
	if limit <= 0 {
		limit = 200
	}
	where, err := f.where()
	if err != nil {
		return nil, err
	}
	sql := fmt.Sprintf("SELECT %s FROM events%s ORDER BY seq DESC LIMIT %d OFFSET %d;", pageCols, where, limit, offset)
	var rows []Row
	if err := s.queryJSON(sql, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// Newer returns rows matching the filter with seq greater than sinceSeq, newest-first.
// The live tail uses this to APPEND just-arrived events instead of replacing the whole
// window (which resets scroll/virtualization). seq is indexed, so the slice is cheap.
func (s *Store) Newer(f Filter, sinceSeq int64, limit int) ([]Row, error) {
	if limit <= 0 {
		limit = 500
	}
	where, err := f.where()
	if err != nil {
		return nil, err
	}
	cond := fmt.Sprintf("seq > %d", sinceSeq)
	if where == "" {
		where = " WHERE " + cond
	} else {
		where += " AND " + cond
	}
	// Return the OLDEST unseen band (seq just above sinceSeq), newest-first for display.
	// If a burst produced more than `limit` new rows, this leaves the newer-still rows
	// for the next tick so the append cursor advances contiguously - no permanent gap
	// (a plain "ORDER BY seq DESC LIMIT n" would skip the middle band).
	sql := fmt.Sprintf("SELECT * FROM (SELECT %s FROM events%s ORDER BY seq ASC LIMIT %d) ORDER BY seq DESC;", pageCols, where, limit)
	var rows []Row
	if err := s.queryJSON(sql, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// FacetValue / Bucket / Aggregates feed the sidebar, histogram, and stats strip.
type FacetValue struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}
type Bucket struct {
	T int64 `json:"t"` // bucket start, unix ms
	N int   `json:"n"` // total events
	E int   `json:"e"` // error events
}

// Stats are the headline metrics for the insight strip, computed over the full
// filtered set in one query.
type Stats struct {
	Errors     int   `json:"errors"`
	Principals int   `json:"principals"`
	Sources    int   `json:"sources"`
	Regions    int   `json:"regions"`
	MinMs      int64 `json:"minMs"`
	MaxMs      int64 `json:"maxMs"`
}
type Aggregates struct {
	Total     int                     `json:"total"`
	Stats     Stats                   `json:"stats"`
	Facets    map[string][]FacetValue `json:"facets"`
	Histogram []Bucket                `json:"histogram"` // sparse: only non-empty buckets
	HistStep  int64                   `json:"histStep"`  // bucket width, ms
	HistFrom  int64                   `json:"histFrom"`  // first bucket start, ms
	HistTo    int64                   `json:"histTo"`    // last bucket end, ms
}

// Aggregates computes total count, per-field facet counts, and the time histogram
// for the current filter - all in DuckDB, so the bridge carries only summaries.
func (s *Store) Aggregates(f Filter) (Aggregates, error) {
	agg := Aggregates{Facets: map[string][]FacetValue{}}
	where, err := f.where()
	if err != nil {
		return agg, err
	}

	// total + headline stats in one query
	var st []struct {
		Total      int   `json:"total"`
		Errors     int   `json:"errors"`
		Principals int   `json:"principals"`
		Sources    int   `json:"sources"`
		Regions    int   `json:"regions"`
		MinMs      int64 `json:"minMs"`
		MaxMs      int64 `json:"maxMs"`
	}
	statSQL := "SELECT count(*) AS total, " +
		"count(*) FILTER (WHERE errorCode IS NOT NULL AND errorCode <> '') AS errors, " +
		"count(DISTINCT coalesce(nullif(identityArn,''), nullif(userName,''), nullif(principalId,''))) AS principals, " +
		"count(DISTINCT nullif(eventSource,'')) AS sources, " +
		"count(DISTINCT nullif(awsRegion,'')) AS regions, " +
		"coalesce(epoch_ms(min(ts))::BIGINT, 0) AS minMs, coalesce(epoch_ms(max(ts))::BIGINT, 0) AS maxMs " +
		"FROM events" + where + ";"
	if err := s.queryJSON(statSQL, &st); err != nil {
		return agg, err
	}
	if len(st) > 0 {
		agg.Total = st[0].Total
		agg.Stats = Stats{Errors: st[0].Errors, Principals: st[0].Principals, Sources: st[0].Sources, Regions: st[0].Regions, MinMs: st[0].MinMs, MaxMs: st[0].MaxMs}
	}

	// all facets in ONE union query (was one subprocess per field)
	for _, col := range facetFields {
		agg.Facets[col] = []FacetValue{}
	}
	parts := make([]string, 0, len(facetFields))
	for _, col := range facetFields {
		cond := col + " IS NOT NULL AND " + col + " <> ''"
		w := where
		if w == "" {
			w = " WHERE " + cond
		} else {
			w += " AND " + cond
		}
		parts = append(parts, fmt.Sprintf("SELECT * FROM (SELECT '%s' AS f, %s AS value, count(*) AS count FROM events%s GROUP BY value ORDER BY count DESC LIMIT 25)", col, col, w))
	}
	var frows []struct {
		F     string `json:"f"`
		Value string `json:"value"`
		Count int    `json:"count"`
	}
	if err := s.queryJSON(strings.Join(parts, " UNION ALL ")+";", &frows); err != nil {
		return agg, err
	}
	for _, r := range frows {
		agg.Facets[r.F] = append(agg.Facets[r.F], FacetValue{Value: r.Value, Count: r.Count})
	}
	for col := range agg.Facets {
		vs := agg.Facets[col]
		sort.Slice(vs, func(i, j int) bool { return vs[i].Count > vs[j].Count })
	}

	// histogram: derive a bucket size targeting ~120 buckets across the filtered span
	tsWhere := where
	if tsWhere == "" {
		tsWhere = " WHERE ts IS NOT NULL"
	} else {
		tsWhere += " AND ts IS NOT NULL"
	}
	var span []struct {
		Lo int64 `json:"lo"`
		Hi int64 `json:"hi"`
	}
	if err := s.queryJSON("SELECT epoch_ms(min(ts))::BIGINT AS lo, epoch_ms(max(ts))::BIGINT AS hi FROM events"+tsWhere+";", &span); err != nil {
		return agg, err
	}
	sec := int64(60)
	if len(span) > 0 && span[0].Hi > span[0].Lo {
		if s := (span[0].Hi - span[0].Lo) / 1000 / 120; s > sec {
			sec = s
		}
	}
	hsql := fmt.Sprintf(
		"SELECT epoch_ms(time_bucket(INTERVAL '%d seconds', ts))::BIGINT AS t, count(*) AS n, count(*) FILTER (WHERE errorCode IS NOT NULL AND errorCode <> '') AS e FROM events%s GROUP BY t ORDER BY t;",
		sec, tsWhere)
	if err := s.queryJSON(hsql, &agg.Histogram); err != nil {
		return agg, err
	}
	agg.HistStep = sec * 1000
	if n := len(agg.Histogram); n > 0 {
		agg.HistFrom = agg.Histogram[0].T
		agg.HistTo = agg.Histogram[n-1].T + agg.HistStep
	}
	return agg, nil
}

// Raw returns the full original JSON record for one event (detail pane), fetched
// lazily so the bulk data never crosses the bridge.
func (s *Store) Raw(seq int64) (string, error) {
	var res []struct {
		Raw string `json:"raw"`
	}
	if err := s.queryJSON(fmt.Sprintf("SELECT raw FROM events WHERE seq=%d;", seq), &res); err != nil {
		return "", err
	}
	if len(res) == 0 {
		return "", nil
	}
	return res[0].Raw, nil
}

// RawBySeqs returns the raw CloudTrail JSON for each requested seq, in the SAME order
// as the input (an error if any seq is missing). Page rows deliberately omit `raw`
// (see pageCols), so a faithful, re-importable export must pull it from the DB rather
// than reuse the light window rows. seqs are engine-assigned integers, formatted with
// strconv, so the IN list is not an injection vector.
func (s *Store) RawBySeqs(seqs []int64) ([]string, error) {
	out := make([]string, len(seqs))
	if len(seqs) == 0 {
		return out, nil
	}
	ids := make([]string, len(seqs))
	for i, q := range seqs {
		ids[i] = strconv.FormatInt(q, 10)
	}
	var res []struct {
		Seq int64  `json:"seq"`
		Raw string `json:"raw"`
	}
	sql := "SELECT seq, raw FROM events WHERE seq IN (" + strings.Join(ids, ",") + ");"
	if err := s.queryJSON(sql, &res); err != nil {
		return nil, err
	}
	bySeq := make(map[int64]string, len(res))
	for _, r := range res {
		bySeq[r.Seq] = r.Raw
	}
	for i, q := range seqs {
		raw, ok := bySeq[q]
		if !ok {
			return nil, fmt.Errorf("event %d is no longer available; refresh before exporting", q)
		}
		out[i] = raw
	}
	return out, nil
}
