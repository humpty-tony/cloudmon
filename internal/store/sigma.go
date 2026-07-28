package store

// Sigma rule testbench: translate a Sigma rule to a DuckDB WHERE clause and run it
// over the events table. sigma-go is the PARSER/VALIDATOR (it owns the YAML + the
// condition grammar); this file owns the AST→SQL translation with correct Sigma
// semantics. The design is FAIL-LOUD: a rule either compiles to SQL we can run, or
// it is flagged unsupported with a reason - it is NEVER translated to a query that
// silently under- or over-matches.

import (
	"encoding/base64"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	sigma "github.com/bradleyjkemp/sigma-go"
)

// SigmaDiag is one validation / translation message surfaced in the editor.
type SigmaDiag struct {
	Severity string `json:"severity"` // "error" | "warning"
	Message  string `json:"message"`
	Line     int    `json:"line,omitempty"` // 1-based; 0 = no position
}

// SigmaResult is the outcome of testing a rule. Parsed=false → YAML/grammar error.
// Parsed=true, Supported=false → valid Sigma we can't translate yet (diagnostics say
// why); the rule is NOT run. Supported=true → SQL ran; Matches/Rows are populated.
type SigmaResult struct {
	Parsed      bool        `json:"parsed"`
	Supported   bool        `json:"supported"`
	Title       string      `json:"title"`
	Diagnostics []SigmaDiag `json:"diagnostics"`
	SQL         string      `json:"sql"`
	Matches     int         `json:"matches"`
	Scanned     int         `json:"scanned"`
	Rows        []Row       `json:"rows"`
}

// sigmaFastFields maps common CloudTrail Sigma fields to indexed/extracted columns.
// Everything else falls back to json_extract_string on the raw event. Note:
// userIdentity.userName is deliberately ABSENT - the userName column coalesces
// sessionIssuer.userName (over-matches AssumedRole), so it must resolve via raw.
var sigmaFastFields = map[string]string{
	"eventName": "eventName", "eventSource": "eventSource", "awsRegion": "awsRegion",
	"sourceIPAddress": "sourceIPAddress", "userAgent": "userAgent",
	"errorCode": "errorCode", "errorMessage": "errorMessage", "eventID": "eventID",
	"eventTime": "eventTime", "recipientAccountId": "recipientAccountId",
	"readOnly": "CAST(readOnly AS VARCHAR)", "managementEvent": "CAST(managementEvent AS VARCHAR)",
	"userIdentity.type": "identityType", "userIdentity.arn": "identityArn",
	"userIdentity.principalId": "principalId", "userIdentity.accountId": "accountId",
	"userIdentity.accessKeyId": "accessKeyId", "userIdentity.invokedBy": "invokedBy",
	"userIdentity.sessionContext.sessionIssuer.arn": "roleArn",
}

// sigmaFieldExpr resolves a Sigma field name to a VARCHAR SQL expression.
func sigmaFieldExpr(field string) string {
	if c, ok := sigmaFastFields[field]; ok {
		return c
	}
	// slow path: json_extract_string(raw, '$."seg1"."seg2"...'). Build the JSON path
	// with its own quoting (embedded " escaped), then emit it as a SQL string literal
	// via sqlStr so a field name containing a single quote can't break out of the
	// literal and inject SQL. Sigma rules are routinely imported from third parties,
	// so the field NAME is as untrusted as any value.
	segs := strings.Split(field, ".")
	for i, s := range segs {
		segs[i] = `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
	}
	return "json_extract_string(raw, " + sqlStr("$."+strings.Join(segs, ".")) + ")"
}

// sigmaGlobToLike converts a Sigma value (with * ? wildcards and \* \? \\ escapes)
// into a DuckDB LIKE pattern for use with ESCAPE '\'. Returns (pattern, hasWildcard).
func sigmaGlobToLike(v string) (string, bool) {
	var b strings.Builder
	wild := false
	for i := 0; i < len(v); i++ {
		c := v[i]
		if c == '\\' && i+1 < len(v) {
			switch v[i+1] {
			case '*':
				b.WriteByte('*')
				i++
				continue
			case '?':
				b.WriteByte('?')
				i++
				continue
			case '\\':
				b.WriteString(`\\`)
				i++
				continue
			}
		}
		switch c {
		case '*':
			b.WriteByte('%')
			wild = true
		case '?':
			b.WriteByte('_')
			wild = true
		case '%':
			b.WriteString(`\%`)
		case '_':
			b.WriteString(`\_`)
		case '\\':
			b.WriteString(`\\`)
		default:
			b.WriteByte(c)
		}
	}
	return b.String(), wild
}

// sigmaMod is the parsed modifier set for one field matcher. `cased` is a
// case-sensitivity flag (not a match op); transforms are value expansions applied
// before matching (Rung 2). `op` is the match kind.
type sigmaMod struct {
	transforms []string // ordered: base64 | base64offset | windash | wide | utf16(le|be)
	op         string   // "" (eq) | contains | startswith | endswith | re | gt | gte | lt | lte | exists
	all        bool     // |all: values are AND-ed instead of OR-ed
	cased      bool     // case-sensitive match
	cidr       bool     // value is a CIDR
	fieldref   bool     // value names another field
}

func parseSigmaMods(mods []string) (sigmaMod, error) {
	m := sigmaMod{}
	for _, x := range mods {
		switch x {
		case "all":
			m.all = true
		case "cased":
			m.cased = true
		case "cidr":
			m.cidr = true
		case "fieldref":
			m.fieldref = true
		case "contains", "startswith", "endswith", "re", "gt", "gte", "lt", "lte", "exists":
			if m.op != "" {
				return m, fmt.Errorf("modifier chain |%s|%s not supported", m.op, x)
			}
			m.op = x
		case "base64", "base64offset", "windash", "wide", "utf16", "utf16le", "utf16be":
			m.transforms = append(m.transforms, x)
			if x != "windash" {
				m.cased = true // byte-exact encodings match case-sensitively
			}
		default:
			return m, fmt.Errorf("modifier |%s not supported yet", x)
		}
	}
	return m, nil
}

// ---- Rung 2: value transforms (expand a literal to its encoded variants) ----

func toUTF16Bytes(s string, big bool) string {
	u := utf16.Encode([]rune(s))
	b := make([]byte, 0, len(u)*2)
	for _, r := range u {
		if big {
			b = append(b, byte(r>>8), byte(r))
		} else {
			b = append(b, byte(r), byte(r>>8))
		}
	}
	return string(b)
}

var windashChars = []string{"-", "/", "–", "-", "―"}

func windashVariants(s string) []string {
	if !strings.Contains(s, "-") {
		return []string{s}
	}
	out := make([]string, 0, len(windashChars))
	for _, d := range windashChars {
		out = append(out, strings.ReplaceAll(s, "-", d))
	}
	return out
}

// base64OffsetVariants mirrors pySigma: the value can appear at any of 3 byte
// offsets inside a larger base64 blob.
func base64OffsetVariants(s string) []string {
	starts := []int{0, 2, 3}
	endTrim := []int{0, 3, 2}
	out := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		enc := base64.StdEncoding.EncodeToString([]byte(strings.Repeat(" ", i) + s))
		end := len(enc) - endTrim[i]
		if starts[i] <= end {
			out = append(out, enc[starts[i]:end])
		}
	}
	return out
}

func applyTransforms(value string, transforms []string) []string {
	vars := []string{value}
	for _, tr := range transforms {
		next := make([]string, 0, len(vars))
		for _, v := range vars {
			switch tr {
			case "wide", "utf16", "utf16le":
				next = append(next, toUTF16Bytes(v, false))
			case "utf16be":
				next = append(next, toUTF16Bytes(v, true))
			case "windash":
				next = append(next, windashVariants(v)...)
			case "base64":
				next = append(next, base64.StdEncoding.EncodeToString([]byte(v)))
			case "base64offset":
				next = append(next, base64OffsetVariants(v)...)
			}
		}
		vars = next
	}
	return vars
}

func sigmaStr(v interface{}) string {
	switch x := v.(type) {
	case nil:
		return ""
	case bool:
		if x {
			return "true"
		}
		return "false"
	case string:
		return x
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		return fmt.Sprintf("%v", x)
	}
}

// matchOne compiles a single-variant string match against `target` (a column or a
// list_filter lambda variable). Case-sensitivity is explicit.
func matchOne(target, op, literal string, cased bool) string {
	like := func(pat string) string {
		if cased {
			return "(" + target + " LIKE " + sqlStr(pat) + " ESCAPE '\\')"
		}
		return "(" + target + " ILIKE " + sqlStr(pat) + " ESCAPE '\\')"
	}
	esc := escapeLike(literal)
	switch op {
	case "":
		if pat, wild := sigmaGlobToLike(literal); wild {
			return like(pat)
		}
		if cased {
			return "(" + target + " = " + sqlStr(literal) + ")"
		}
		return "lower(" + target + ") = " + sqlStr(strings.ToLower(literal))
	case "contains":
		return like("%" + esc + "%")
	case "startswith":
		return like(esc + "%")
	case "endswith":
		return like("%" + esc)
	case "re": // Sigma |re is case-SENSITIVE by default (no 'i' flag)
		return "regexp_matches(" + target + ", " + sqlStr(literal) + ")"
	}
	return "FALSE"
}

// buildValuePred compiles one value against `target` (column or lambda var).
func buildValuePred(target string, m sigmaMod, v interface{}) (string, error) {
	if v == nil {
		return "(" + target + " IS NULL)", nil
	}
	switch m.op {
	case "gt", "gte", "lt", "lte":
		s := sigmaStr(v)
		if _, err := strconv.ParseFloat(s, 64); err != nil {
			return "", fmt.Errorf("|%s needs a number, got %q", m.op, s)
		}
		op := map[string]string{"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[m.op]
		return "(TRY_CAST(" + target + " AS DOUBLE) " + op + " " + s + ")", nil
	case "exists":
		if b, _ := v.(bool); b {
			return "(" + target + " IS NOT NULL)", nil
		}
		return "(" + target + " IS NULL)", nil
	}
	variants := applyTransforms(sigmaStr(v), m.transforms)
	if m.op == "re" {
		// Parse-gate: DuckDB's regexp_matches is RE2, same family as Go's regexp. If
		// Go can't compile it (PCRE lookaround/backref/etc.), DuckDB can't either - so
		// flag it cleanly instead of erroring at query time. (regexp2 is a later rung.)
		for _, vv := range variants {
			if _, err := regexp.Compile(vv); err != nil {
				return "", fmt.Errorf("|re uses features RE2 can't run (PCRE lookaround/backref?) - not supported yet")
			}
		}
	}
	subs := make([]string, 0, len(variants))
	for _, vv := range variants {
		subs = append(subs, matchOne(target, m.op, vv, m.cased))
	}
	if len(subs) == 1 {
		return subs[0], nil
	}
	return "(" + strings.Join(subs, " OR ") + ")", nil
}

// cidrPredicate handles |cidr for ANY IPv4 mask (/0–/32) in pure SQL: convert the
// dotted-quad to a 32-bit int and compare under the network mask. IPv6 fails loud.
func cidrPredicate(target, cidr string) (string, error) {
	ip, mask, ok := strings.Cut(cidr, "/")
	if !ok {
		mask = "32" // a bare IP is a valid Sigma |cidr host (implicit /32)
	}
	if strings.Contains(ip, ":") {
		return "", fmt.Errorf("|cidr IPv6 (%q) not supported yet", cidr)
	}
	bits, err := strconv.Atoi(mask)
	if err != nil || bits < 0 || bits > 32 {
		return "", fmt.Errorf("|cidr bad mask in %q", cidr)
	}
	octets := strings.Split(ip, ".")
	if len(octets) != 4 {
		return "", fmt.Errorf("|cidr bad IPv4 in %q", cidr)
	}
	var netint uint32
	for _, o := range octets {
		n, err := strconv.Atoi(o)
		if err != nil || n < 0 || n > 255 {
			return "", fmt.Errorf("|cidr bad IPv4 in %q", cidr)
		}
		netint = netint<<8 | uint32(n)
	}
	var maskint uint32
	if bits > 0 {
		maskint = ^uint32(0) << (32 - bits)
	}
	ipExpr := "(TRY_CAST(split_part(" + target + ",'.',1) AS BIGINT)*16777216" +
		"+TRY_CAST(split_part(" + target + ",'.',2) AS BIGINT)*65536" +
		"+TRY_CAST(split_part(" + target + ",'.',3) AS BIGINT)*256" +
		"+TRY_CAST(split_part(" + target + ",'.',4) AS BIGINT))"
	return "((" + ipExpr + " & " + strconv.FormatUint(uint64(maskint), 10) + ") = " + strconv.FormatUint(uint64(netint&maskint), 10) + ")", nil
}

// fieldrefPredicate compiles a field-to-field comparison (|fieldref).
func fieldrefPredicate(target, op, otherField string) (string, error) {
	other := sigmaFieldExpr(otherField)
	switch op {
	case "":
		return "(lower(" + target + ") = lower(" + other + "))", nil
	case "contains":
		return "(position(lower(" + other + ") IN lower(" + target + ")) > 0)", nil
	case "startswith":
		return "(starts_with(lower(" + target + "), lower(" + other + ")))", nil
	case "endswith":
		return "(ends_with(lower(" + target + "), lower(" + other + ")))", nil
	}
	return "", fmt.Errorf("|fieldref with |%s not supported", op)
}

func compileFieldMatcher(fm sigma.FieldMatcher) (string, error) {
	m, err := parseSigmaMods(fm.Modifiers)
	if err != nil {
		return "", fmt.Errorf("field %s: %w", fm.Field, err)
	}
	// CloudTrail `resources` is an array of objects → match ANY element (Rung 3, in SQL
	// via a list_filter lambda) instead of a scalar compare that would never match.
	target := sigmaFieldExpr(fm.Field)
	wrap := func(p string) string { return p }
	if strings.HasPrefix(fm.Field, "resources.") {
		leaf := strings.ReplaceAll(strings.TrimPrefix(fm.Field, "resources."), `"`, `\"`)
		arr := "CAST(json_extract(raw, " + sqlStr(`$.resources[*]."`+leaf+`"`) + ") AS VARCHAR[])"
		target = "x"
		// `x -> …` is the lambda form the pinned DuckDB (v1.5.5) accepts with a
		// parenthesized predicate; the deprecation warning goes to stderr, so stdout
		// stays valid JSON. (The newer `lambda x:` form rejects `(…)` here.)
		wrap = func(p string) string { return "(len(list_filter(" + arr + ", x -> " + p + ")) > 0)" }
	}

	vals := fm.Values
	if len(vals) == 0 {
		vals = []interface{}{nil}
	}
	parts := make([]string, 0, len(vals))
	for _, v := range vals {
		var p string
		switch {
		case m.fieldref:
			p, err = fieldrefPredicate(target, m.op, sigmaStr(v))
		case m.cidr:
			p, err = cidrPredicate(target, sigmaStr(v))
		default:
			p, err = buildValuePred(target, m, v)
		}
		if err != nil {
			return "", fmt.Errorf("field %s: %w", fm.Field, err)
		}
		parts = append(parts, wrap(p))
	}
	join := " OR "
	if m.all {
		join = " AND "
	}
	return "(" + strings.Join(parts, join) + ")", nil
}

func compileSearch(name string, s sigma.Search) (string, error) {
	var parts []string
	// keywords: unstructured full-text over the whole raw event
	for _, kw := range s.Keywords {
		parts = append(parts, "(raw ILIKE "+sqlStr("%"+escapeLike(kw)+"%")+" ESCAPE '\\')")
	}
	kwJoined := ""
	if len(parts) > 0 {
		kwJoined = "(" + strings.Join(parts, " OR ") + ")"
	}
	// event matchers: a list of field-maps → OR of maps, AND of fields within a map
	var ors []string
	for _, em := range s.EventMatchers {
		var ands []string
		for _, fm := range em {
			p, err := compileFieldMatcher(fm)
			if err != nil {
				return "", err
			}
			ands = append(ands, p)
		}
		if len(ands) > 0 {
			ors = append(ors, "("+strings.Join(ands, " AND ")+")")
		}
	}
	emJoined := ""
	if len(ors) > 0 {
		emJoined = "(" + strings.Join(ors, " OR ") + ")"
	}
	switch {
	case kwJoined != "" && emJoined != "":
		return "(" + emJoined + " AND " + kwJoined + ")", nil
	case emJoined != "":
		return emJoined, nil
	case kwJoined != "":
		return kwJoined, nil
	}
	return "", fmt.Errorf("search %q is empty", name)
}

// matchName reports whether a search identifier matches a "1 of X" / "all of X"
// pattern (which may contain a trailing/leading '*').
func matchName(pattern, name string) bool {
	if pattern == "them" || pattern == "" {
		return true
	}
	if strings.HasSuffix(pattern, "*") {
		return strings.HasPrefix(name, strings.TrimSuffix(pattern, "*"))
	}
	return pattern == name
}

func namesMatching(pattern string, searches map[string]string) []string {
	var out []string
	for n := range searches {
		if matchName(pattern, n) {
			out = append(out, n)
		}
	}
	return out
}

// compileCondition lowers the sigma-go condition AST to SQL, given each search's
// precompiled SQL. Undefined identifiers are a hard error (a real Sigma mistake).
func compileCondition(e sigma.SearchExpr, searches map[string]string) (string, error) {
	switch n := e.(type) {
	case sigma.And:
		parts := make([]string, 0, len(n))
		for _, sub := range n {
			s, err := compileCondition(sub, searches)
			if err != nil {
				return "", err
			}
			parts = append(parts, s)
		}
		return "(" + strings.Join(parts, " AND ") + ")", nil
	case sigma.Or:
		parts := make([]string, 0, len(n))
		for _, sub := range n {
			s, err := compileCondition(sub, searches)
			if err != nil {
				return "", err
			}
			parts = append(parts, s)
		}
		return "(" + strings.Join(parts, " OR ") + ")", nil
	case sigma.Not:
		s, err := compileCondition(n.Expr, searches)
		if err != nil {
			return "", err
		}
		// NULL-guard: an absent field must read as "did not match", not NULL - so a
		// `not filter` over an absent field keeps the row instead of dropping it.
		return "(NOT COALESCE(" + s + ", FALSE))", nil
	case sigma.SearchIdentifier:
		sql, ok := searches[n.Name]
		if !ok {
			return "", fmt.Errorf("condition references undefined identifier %q", n.Name)
		}
		return sql, nil
	case sigma.OneOfThem:
		return anyAllOf("them", searches, " OR ")
	case sigma.AllOfThem:
		return anyAllOf("them", searches, " AND ")
	case sigma.OneOfPattern:
		return anyAllOf(n.Pattern, searches, " OR ")
	case sigma.AllOfPattern:
		return anyAllOf(n.Pattern, searches, " AND ")
	case sigma.OneOfIdentifier:
		return anyAllOf(n.Ident.Name, searches, " OR ")
	case sigma.AllOfIdentifier:
		return anyAllOf(n.Ident.Name, searches, " AND ")
	}
	return "", fmt.Errorf("unsupported condition construct %T", e)
}

func anyAllOf(pattern string, searches map[string]string, join string) (string, error) {
	names := namesMatching(pattern, searches)
	if len(names) == 0 {
		return "", fmt.Errorf("condition %q matches no search identifier", pattern)
	}
	parts := make([]string, 0, len(names))
	for _, n := range names {
		parts = append(parts, searches[n])
	}
	return "(" + strings.Join(parts, join) + ")", nil
}

// compileAggregation lowers a `count()/sum()/… <op> N` tail to a WHERE that keeps
// the events belonging to groups passing the threshold (via GROUP BY … HAVING in a
// sub-select). Time-windowed aggregation (a timeframe) and correlation fail loud.
func compileAggregation(searchWhere string, agg sigma.AggregationExpr, timeframe time.Duration) (string, error) {
	if timeframe != 0 {
		return "", fmt.Errorf("time-windowed aggregation (timeframe) isn't supported yet")
	}
	cmp, ok := agg.(sigma.Comparison)
	if !ok {
		return "", fmt.Errorf("this aggregation kind isn't supported yet (e.g. |near correlation)")
	}
	op, ok := map[sigma.ComparisonOp]string{"=": "=", "!=": "<>", "<": "<", "<=": "<=", ">": ">", ">=": ">="}[cmp.Op]
	if !ok {
		return "", fmt.Errorf("aggregation comparison %q not supported", cmp.Op)
	}
	var aggExpr, groupBy string
	switch f := cmp.Func.(type) {
	case sigma.Count:
		if f.Field == "" {
			aggExpr = "count(*)"
		} else {
			aggExpr = "count(DISTINCT " + sigmaFieldExpr(f.Field) + ")"
		}
		groupBy = f.GroupedBy
	case sigma.Sum:
		aggExpr, groupBy = "sum(TRY_CAST("+sigmaFieldExpr(f.Field)+" AS DOUBLE))", f.GroupedBy
	case sigma.Min:
		aggExpr, groupBy = "min(TRY_CAST("+sigmaFieldExpr(f.Field)+" AS DOUBLE))", f.GroupedBy
	case sigma.Max:
		aggExpr, groupBy = "max(TRY_CAST("+sigmaFieldExpr(f.Field)+" AS DOUBLE))", f.GroupedBy
	case sigma.Average:
		aggExpr, groupBy = "avg(TRY_CAST("+sigmaFieldExpr(f.Field)+" AS DOUBLE))", f.GroupedBy
	default:
		return "", fmt.Errorf("this aggregation function isn't supported yet")
	}
	thr := strconv.FormatFloat(cmp.Threshold, 'f', -1, 64)
	if groupBy == "" { // global: keep selection rows iff the whole-selection aggregate passes
		return "(" + searchWhere + " AND (SELECT " + aggExpr + " FROM events WHERE " + searchWhere + ") " + op + " " + thr + ")", nil
	}
	gf := sigmaFieldExpr(groupBy)
	sub := "SELECT " + gf + " FROM events WHERE " + searchWhere + " GROUP BY " + gf + " HAVING " + aggExpr + " " + op + " " + thr
	return "(" + searchWhere + " AND " + gf + " IN (" + sub + "))", nil
}

// compileRule translates a parsed rule to a WHERE clause, or returns diagnostics
// explaining why it can't (fail-loud). ok=false means: do not run this rule.
func compileRule(rule sigma.Rule) (where string, diags []SigmaDiag, ok bool) {
	// logsource sanity (non-blocking): flag non-CloudTrail rules - fields may not map.
	ls := rule.Logsource
	if ls.Product != "" && !strings.EqualFold(ls.Product, "aws") {
		diags = append(diags, SigmaDiag{Severity: "warning", Message: fmt.Sprintf("logsource product is %q, not aws/cloudtrail - fields may not map to this dataset", ls.Product)})
	}

	searches := map[string]string{}
	for name, s := range rule.Detection.Searches {
		sql, err := compileSearch(name, s)
		if err != nil {
			diags = append(diags, SigmaDiag{Severity: "error", Message: err.Error()})
			continue
		}
		searches[name] = sql
	}

	conds := rule.Detection.Conditions
	if len(conds) == 0 {
		diags = append(diags, SigmaDiag{Severity: "error", Message: "rule has no condition"})
		return "", diags, false
	}
	var condSQLs []string
	for _, c := range conds {
		s, err := compileCondition(c.Search, searches)
		if err != nil {
			line, _ := c.Position()
			diags = append(diags, SigmaDiag{Severity: "error", Line: line + 1, Message: err.Error()})
			return "", diags, false
		}
		if c.Aggregation != nil {
			aggWhere, err := compileAggregation(s, c.Aggregation, rule.Detection.Timeframe)
			if err != nil {
				line, _ := c.Position()
				diags = append(diags, SigmaDiag{Severity: "error", Line: line + 1, Message: err.Error()})
				return "", diags, false
			}
			condSQLs = append(condSQLs, aggWhere)
			continue
		}
		condSQLs = append(condSQLs, s)
	}
	// If any search failed to compile, we already recorded an error → don't run.
	for _, d := range diags {
		if d.Severity == "error" {
			return "", diags, false
		}
	}
	where = "(" + strings.Join(condSQLs, " OR ") + ")"
	return where, diags, true
}

// SigmaRun validates a Sigma rule and, if fully supported, runs it against the
// events table, returning matches (capped at limit) + the generated SQL.
func (s *Store) SigmaRun(ruleYAML string, limit int) (SigmaResult, error) {
	if limit <= 0 {
		limit = 500
	}
	res := SigmaResult{Diagnostics: []SigmaDiag{}, Rows: []Row{}}

	rule, err := sigma.ParseRule([]byte(ruleYAML))
	if err != nil {
		res.Diagnostics = append(res.Diagnostics, SigmaDiag{Severity: "error", Message: err.Error()})
		return res, nil // a parse error is a result, not a transport error
	}
	res.Parsed = true
	res.Title = rule.Title

	where, diags, ok := compileRule(rule)
	res.Diagnostics = append(res.Diagnostics, diags...)
	if !ok {
		return res, nil
	}
	res.Supported = true
	res.SQL = "SELECT " + pageCols + " FROM events WHERE " + where + " ORDER BY seq DESC LIMIT " + strconv.Itoa(limit)

	// dataset size (scanned) - best-effort
	var tot []struct {
		N int `json:"n"`
	}
	if err := s.queryJSON("SELECT count(*) AS n FROM events;", &tot); err == nil && len(tot) > 0 {
		res.Scanned = tot[0].N
	}
	// match count over the full dataset
	var mc []struct {
		N int `json:"n"`
	}
	if err := s.queryJSON("SELECT count(*) AS n FROM events WHERE "+where+";", &mc); err != nil {
		return res, fmt.Errorf("sigma count: %w", err)
	} else if len(mc) > 0 {
		res.Matches = mc[0].N
	}
	// the capped page of matching rows
	var rows []Row
	if err := s.queryJSON(res.SQL+";", &rows); err != nil {
		return res, fmt.Errorf("sigma query: %w", err)
	}
	if rows != nil {
		res.Rows = rows
	}
	return res, nil
}
