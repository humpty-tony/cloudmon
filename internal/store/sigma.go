package store

// Sigma rule testbench: translate a Sigma rule to a DuckDB WHERE clause and run it
// over the events table. sigma-go is the PARSER/VALIDATOR (it owns the YAML + the
// condition grammar); this file owns the AST→SQL translation with correct Sigma
// semantics. The design is FAIL-LOUD: a rule either compiles to SQL we can run, or
// it is flagged unsupported with a reason - it is NEVER translated to a query that
// silently under- or over-matches.

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
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
	Parsed       bool                       `json:"parsed"`
	Supported    bool                       `json:"supported"`
	Title        string                     `json:"title"`
	Diagnostics  []SigmaDiag                `json:"diagnostics"`
	SQL          string                     `json:"sql"`
	Matches      int                        `json:"matches"`
	Scanned      int                        `json:"scanned"`
	Rows         []Row                      `json:"rows"`
	Snapshot     *Snapshot                  `json:"snapshot"`
	Explanations map[int64][]SigmaSelection `json:"explanations"`
}

type SigmaSelection struct {
	Name    string `json:"name"`
	Matched bool   `json:"matched"`
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
	return "json_extract_string(raw, " + sqlStr(sigmaJSONPath(field)) + ")"
}

func sigmaJSONPath(field string) string {
	parts := strings.Split(field, ".")
	for i, part := range parts {
		quoted, _ := json.Marshal(part)
		parts[i] = string(quoted)
	}
	path := "$." + strings.Join(parts, ".")
	if strings.HasPrefix(field, "resources.") {
		path = `$."resources"[*].` + strings.Join(parts[1:], ".")
	}
	return path
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
	transforms []string // ordered: base64 | base64offset | wide | utf16(le|be)
	op         string   // "" (eq) | contains | startswith | endswith | re | gt | gte | lt | lte | exists
	all        bool     // |all: values are AND-ed instead of OR-ed
	cased      bool     // case-sensitive match
	cidr       bool     // value is a CIDR
	fieldref   bool     // value names another field
}

func parseSigmaMods(mods []string) (sigmaMod, error) {
	m := sigmaMod{}
	if len(mods) > 8 {
		return m, fmt.Errorf("at most 8 modifiers are supported")
	}
	seen := map[string]bool{}
	for _, x := range mods {
		if seen[x] {
			return m, fmt.Errorf("duplicate modifier |%s", x)
		}
		seen[x] = true
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
		case "base64", "base64offset", "wide", "utf16", "utf16le", "utf16be":
			if m.op != "" {
				return m, fmt.Errorf("encoding modifiers must precede matching modifiers")
			}
			m.transforms = append(m.transforms, x)
			m.cased = true // byte-exact encodings match case-sensitively
		default:
			return m, fmt.Errorf("modifier |%s not supported yet", x)
		}
	}
	if len(m.transforms) > 3 {
		return m, fmt.Errorf("at most 3 encoding transforms are supported")
	}
	if m.cidr && (m.fieldref || m.op != "" || m.cased || len(m.transforms) > 0) || m.fieldref && len(m.transforms) > 0 || (m.op == "exists" || m.op == "gt" || m.op == "gte" || m.op == "lt" || m.op == "lte") && (m.cased || m.fieldref || len(m.transforms) > 0) {
		return m, fmt.Errorf("conflicting or unsupported modifier chain")
	}
	for i, tr := range m.transforms {
		if tr == "wide" || strings.HasPrefix(tr, "utf16") {
			if i+1 == len(m.transforms) || (m.transforms[i+1] != "base64" && m.transforms[i+1] != "base64offset") {
				return m, fmt.Errorf("UTF-16 byte transforms require a following base64/base64offset encoding")
			}
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
			case "wide", "utf16le":
				next = append(next, toUTF16Bytes(v, false))
			case "utf16be":
				next = append(next, toUTF16Bytes(v, true))
			case "utf16":
				next = append(next, "\xff\xfe"+toUTF16Bytes(v, false))
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
	pattern, _ := sigmaGlobToLike(literal)
	switch op {
	case "":
		return like(pattern)
	case "contains":
		return like("%" + pattern + "%")
	case "startswith":
		return like(pattern + "%")
	case "endswith":
		return like("%" + pattern)

	case "re": // Sigma |re is case-SENSITIVE by default (no 'i' flag)
		return "regexp_matches(" + target + ", " + sqlStr(literal) + ")"
	}
	return "FALSE"
}

// buildValuePred compiles one value against `target` (column or lambda var).
func buildValuePred(target string, m sigmaMod, v interface{}) (string, error) {
	if v == nil {
		if m.op != "" || len(m.transforms) > 0 || m.cased {
			return "", fmt.Errorf("null values cannot have matching modifiers")
		}
		return "(" + target + " IS NULL)", nil
	}
	if _, wild := sigmaGlobToLike(sigmaStr(v)); len(m.transforms) > 0 && wild {
		return "", fmt.Errorf("wildcards inside encoded values are unsupported")
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

// CIDR matching shares the validated native IPv4/IPv6 parser used by hunts.
func cidrPredicate(target, cidr string) (string, error) {
	network, err := networkPrefix(cidr)
	if err != nil {
		return "", fmt.Errorf("|cidr invalid IP/network %q", cidr)
	}
	return "cloudmon_ip_match(" + target + "," + sqlStr(network.Masked().String()) + ")", nil
}

func fieldrefPredicate(target, op, otherField string, cased bool) (string, error) {
	if strings.HasPrefix(otherField, "resources.") {
		return "", fmt.Errorf("array-valued field references are unsupported")
	}
	other := sigmaFieldExpr(otherField)
	if !cased {
		target = "lower(" + target + ")"
		other = "lower(" + other + ")"
	}
	switch op {
	case "":
		return "(" + target + " = " + other + ")", nil
	case "contains":
		return "(position(" + other + " IN " + target + ") > 0)", nil
	case "startswith":
		return "starts_with(" + target + "," + other + ")", nil
	case "endswith":
		return "ends_with(" + target + "," + other + ")", nil
	}
	return "", fmt.Errorf("|fieldref with |%s not supported", op)
}

func compileFieldMatcher(fm sigma.FieldMatcher) (string, error) {
	if fm.Field == "" || len(fm.Field) > 512 || strings.ContainsRune(fm.Field, 0) {
		return "", fmt.Errorf("invalid or overlong field name")
	}
	m, err := parseSigmaMods(fm.Modifiers)
	if err != nil {
		return "", fmt.Errorf("field %s: %w", fm.Field, err)
	}
	if len(fm.Values) == 0 {
		return "", fmt.Errorf("field %s has an empty value list", fm.Field)
	}
	if m.all && len(fm.Values) < 2 {
		return "", fmt.Errorf("|all requires at least two values")
	}
	array := strings.HasPrefix(fm.Field, "resources.")
	target := sigmaFieldExpr(fm.Field)
	arr := target
	wrap := func(p string) string { return p }
	if array {
		target = "x"
		wrap = func(p string) string { return "COALESCE(len(list_filter(" + arr + ", x -> " + p + ")) > 0,FALSE)" }
	}
	parts := make([]string, 0, len(fm.Values))
	for _, v := range fm.Values {
		switch v.(type) {
		case nil, string, bool, json.Number:
		default:
			return "", fmt.Errorf("field %s needs scalar values", fm.Field)
		}
		_, number := v.(json.Number)
		numeric := m.op == "gt" || m.op == "gte" || m.op == "lt" || m.op == "lte" || number && m.op == "" && len(m.transforms) == 0 && !m.fieldref && !m.cidr
		var p string
		switch {
		case m.op == "exists":
			want, ok := v.(bool)
			if !ok {
				return "", fmt.Errorf("field %s: |exists requires a boolean", fm.Field)
			}
			p = "json_exists(raw," + sqlStr(sigmaJSONPath(fm.Field)) + ")"
			if array {
				p = "COALESCE(list_contains(" + p + ",TRUE),FALSE)"
			}
			if !want {
				p = "(NOT COALESCE(" + p + ",FALSE))"
			}
		case numeric:
			p, err = numericPredicate(fm.Field, m.op, sigmaStr(v))
		case v == nil && array:
			p = "(NOT " + wrap("x IS NOT NULL") + ")"
			if len(fm.Modifiers) > 0 {
				return "", fmt.Errorf("null values cannot have matching modifiers")
			}
		default:
			switch {
			case m.fieldref:
				value, ok := v.(string)
				if !ok {
					return "", fmt.Errorf("|fieldref requires a field name")
				}
				p, err = fieldrefPredicate(target, m.op, value, m.cased)
			case m.cidr:
				value, ok := v.(string)
				if !ok {
					return "", fmt.Errorf("|cidr requires an IP/network string")
				}
				p, err = cidrPredicate(target, value)
			default:
				p, err = buildValuePred(target, m, v)
			}
			p = wrap(p)
		}
		if err != nil {
			return "", fmt.Errorf("field %s: %w", fm.Field, err)
		}
		parts = append(parts, p)
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
		pattern, _ := sigmaGlobToLike(kw)
		parts = append(parts, "(raw ILIKE "+sqlStr("%"+pattern+"%")+" ESCAPE '\\')")
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
	if pattern == "them" {
		return true
	}
	expression := "^" + strings.ReplaceAll(regexp.QuoteMeta(pattern), `\*`, ".*") + "$"
	matched, _ := regexp.MatchString(expression, name)
	return matched
}

func namesMatching(pattern string, searches map[string]string) []string {
	var out []string
	for n := range searches {
		if matchName(pattern, n) {
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return out
}

// compileCondition lowers the sigma-go condition AST to SQL, given each search's
// precompiled SQL. Undefined identifiers are a hard error (a real Sigma mistake).
func compileCondition(e sigma.SearchExpr, searches map[string]string) (string, error) {
	result, err := compileConditionNode(e, searches)
	if len(result) > 1_000_000 {
		return "", fmt.Errorf("compiled condition exceeds 1 MB")
	}
	return result, err
}

func compileConditionNode(e sigma.SearchExpr, searches map[string]string) (string, error) {
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
			if strings.HasPrefix(f.Field, "resources.") {
				return "", fmt.Errorf("array distinct counts are unsupported")
			}
			aggExpr = "count(DISTINCT " + sigmaFieldExpr(f.Field) + ")"
		}
		groupBy = f.GroupedBy
	default:
		return "", fmt.Errorf("only count aggregation is supported; approximate numeric aggregates are not run")
	}
	if math.IsNaN(cmp.Threshold) || math.IsInf(cmp.Threshold, 0) || math.Trunc(cmp.Threshold) != cmp.Threshold || math.Abs(cmp.Threshold) > 9007199254740991 {
		return "", fmt.Errorf("count aggregation needs an exact safe integer threshold")
	}
	if strings.HasPrefix(groupBy, "resources.") {
		return "", fmt.Errorf("array aggregation groups are unsupported")
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
	ls := rule.Logsource
	if ls.Product != "" && !strings.EqualFold(ls.Product, "aws") || ls.Service != "" && !strings.EqualFold(ls.Service, "cloudtrail") || ls.Category != "" || len(ls.AdditionalFields) > 0 {
		return "", []SigmaDiag{{Severity: "error", Message: "only aws/cloudtrail log sources without category/custom constraints are supported"}}, false
	}
	if ls.Product == "" || ls.Service == "" {
		diags = append(diags, SigmaDiag{Severity: "warning", Message: "this rule is evaluated only against the loaded CloudTrail dataset"})
	}
	for _, key := range []string{"correlation", "action", "filter"} {
		if _, exists := rule.AdditionalFields[key]; exists {
			return "", []SigmaDiag{{Severity: "error", Message: key + " rules are unsupported"}}, false
		}
	}
	if taxonomy, exists := rule.AdditionalFields["taxonomy"]; exists && taxonomy != "sigma" {
		return "", []SigmaDiag{{Severity: "error", Message: "custom Sigma taxonomy is unsupported"}}, false
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
	if len(where) > 1_000_000 {
		return "", []SigmaDiag{{Severity: "error", Message: "compiled rule exceeds 1 MB"}}, false
	}
	return where, diags, true
}
