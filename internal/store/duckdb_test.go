package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// These tests drive the real duckdb CLI. Point DUCKDB_BIN at it, e.g.:
//
//	DUCKDB_BIN=/path/to/duckdb go test ./internal/store/
func bin(t *testing.T) string {
	b := os.Getenv("DUCKDB_BIN")
	if b == "" {
		t.Skip("set DUCKDB_BIN to the duckdb CLI to run store tests")
	}
	return b
}

const sample = `{"Records":[
  {"eventID":"1","eventName":"ListBuckets","eventSource":"s3.amazonaws.com","eventTime":"2025-01-01T00:00:01Z","awsRegion":"us-east-1","readOnly":true,"userIdentity":{"type":"IAMUser","userName":"alice"}},
  {"eventID":"2","eventName":"GetObject","eventSource":"s3.amazonaws.com","eventTime":"2025-01-01T00:00:02Z","awsRegion":"us-east-1","readOnly":true},
  {"eventID":"3","eventName":"RunInstances","eventSource":"ec2.amazonaws.com","eventTime":"2025-01-01T00:00:03Z","awsRegion":"us-east-1","errorCode":"Client.UnauthorizedOperation","userIdentity":{"type":"AssumedRole","userName":"deploy"}}
]}`

func newStore(t *testing.T) *Store {
	dir := t.TempDir()
	f := filepath.Join(dir, "sample.json")
	if err := os.WriteFile(f, []byte(sample), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(bin(t), filepath.Join(dir, "app.duckdb"))
	n, err := s.Ingest(f)
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	if n != 3 {
		t.Fatalf("want 3 events, got %d", n)
	}
	return s
}

func TestIngestAndPage(t *testing.T) {
	s := newStore(t)
	rows, err := s.Page(Filter{}, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("want 3 rows, got %d", len(rows))
	}
	// newest-first: seq 3 (00:00:03, RunInstances) on top
	if rows[0].Seq != 3 || rows[0].EventName != "RunInstances" {
		t.Fatalf("wrong ordering: %+v", rows[0])
	}
	if rows[0].ErrorCode != "Client.UnauthorizedOperation" {
		t.Fatalf("errorCode lost: %q", rows[0].ErrorCode)
	}
}

func TestAggregates(t *testing.T) {
	s := newStore(t)
	agg, err := s.Aggregates(Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if agg.Total != 3 {
		t.Fatalf("want total 3, got %d", agg.Total)
	}
	src := agg.Facets["eventSource"]
	if len(src) == 0 || src[0].Value != "s3.amazonaws.com" || src[0].Count != 2 {
		t.Fatalf("eventSource facet wrong: %+v", src)
	}
	if agg.Stats.Errors != 1 || agg.Stats.Sources != 2 || agg.Stats.Regions != 1 {
		t.Fatalf("stats wrong: %+v", agg.Stats)
	}
	if len(agg.Histogram) == 0 {
		t.Fatal("empty histogram")
	}
	total := 0
	for _, b := range agg.Histogram {
		total += b.N
	}
	if total != 3 {
		t.Fatalf("histogram counts sum to %d, want 3", total)
	}
}

func TestFilters(t *testing.T) {
	s := newStore(t)
	// errors only
	if agg, err := s.Aggregates(Filter{ErrorsOnly: true}); err != nil || agg.Total != 1 {
		t.Fatalf("errorsOnly total = %d (err %v), want 1", agg.Total, err)
	}
	// include eventSource=s3
	f := Filter{Includes: map[string][]string{"eventSource": {"s3.amazonaws.com"}}}
	rows, err := s.Page(f, 0, 10)
	if err != nil || len(rows) != 2 {
		t.Fatalf("include filter rows = %d (err %v), want 2", len(rows), err)
	}
	// hide read-only leaves just the ec2 error event
	if agg, err := s.Aggregates(Filter{HideReadOnly: true}); err != nil || agg.Total != 1 {
		t.Fatalf("hideReadOnly total = %d (err %v), want 1", agg.Total, err)
	}
}

func TestRaw(t *testing.T) {
	s := newStore(t)
	raw, err := s.Raw(3)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(raw, "RunInstances") {
		t.Fatalf("raw missing record content: %q", raw)
	}
}

func TestTextSearch(t *testing.T) {
	s := newStore(t)
	rows, err := s.Page(Filter{Text: "runinstances"}, 0, 10)
	if err != nil || len(rows) != 1 || rows[0].EventName != "RunInstances" {
		t.Fatalf("text search rows = %d (err %v)", len(rows), err)
	}
}

// TestIdentityFields verifies the extracted assumed-role identity columns
// (roleArn from sessionContext, sessionName from the principalId suffix).
func TestIdentityFields(t *testing.T) {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"a","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-02-01T00:00:01Z",
	   "userIdentity":{"type":"AssumedRole","principalId":"AROAEXAMPLE123:jdoe-session","arn":"arn:aws:sts::111122223333:assumed-role/AdminRole/jdoe-session",
	   "sessionContext":{"sessionIssuer":{"type":"Role","userName":"AdminRole","arn":"arn:aws:iam::111122223333:role/AdminRole"}}}}
	]}`
	f := filepath.Join(dir, "role.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(bin(t), filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	rows, err := s.Page(Filter{}, 0, 10)
	if err != nil || len(rows) != 1 {
		t.Fatalf("page rows=%d err=%v", len(rows), err)
	}
	if rows[0].RoleArn != "arn:aws:iam::111122223333:role/AdminRole" {
		t.Fatalf("roleArn = %q", rows[0].RoleArn)
	}
	if rows[0].SessionName != "jdoe-session" {
		t.Fatalf("sessionName = %q", rows[0].SessionName)
	}
	// no top-level userName on an assumed role → coalesce to the session-issuer's role name
	if rows[0].UserName != "AdminRole" {
		t.Fatalf("userName = %q, want AdminRole (coalesced from sessionIssuer)", rows[0].UserName)
	}
	// roleArn is queryable + pivotable and round-trips
	rows, err = s.Page(Filter{Includes: map[string][]string{"roleArn": {"arn:aws:iam::111122223333:role/AdminRole"}}}, 0, 10)
	if err != nil || len(rows) != 1 {
		t.Fatalf("roleArn filter rows=%d err=%v", len(rows), err)
	}
	// query-language: sessionName="jdoe-session"
	rows, err = s.Page(Filter{Expr: &Expr{T: "cmp", Field: "sessionName", Op: "eq", Value: "jdoe-session"}}, 0, 10)
	if err != nil || len(rows) != 1 {
		t.Fatalf("sessionName expr rows=%d err=%v", len(rows), err)
	}
}

// TestEmptyAndExists pins the empty-string vs exists semantics. In the sample,
// only event 2 has no userName (alice, deploy have one).
func TestEmptyAndExists(t *testing.T) {
	s := newStore(t)
	cases := []struct {
		name string
		op   string
		want int
	}{
		{`userName!="" excludes empties`, "ne", 2},  // has a value
		{`userName="" keeps only empties`, "eq", 1}, // is empty
		{`bare userName= (exists)`, "exists", 2},
		{`bare userName!= (not exists)`, "nexists", 1},
	}
	for _, c := range cases {
		f := Filter{Expr: &Expr{T: "cmp", Field: "userName", Op: c.op, Value: ""}}
		rows, err := s.Page(f, 0, 10)
		if err != nil || len(rows) != c.want {
			t.Fatalf("%s: rows=%d (err %v), want %d", c.name, len(rows), err, c.want)
		}
	}
}

// TestLineage walks a two-hop assumed-role chain: alice (IAMUser) assumes RoleA,
// and that session assumes RoleB, which then does something. The lineage of the
// RoleB event should resolve RoleA's session then alice as the origin.
func TestLineage(t *testing.T) {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-03-01T00:00:01Z","sourceIPAddress":"1.2.3.4",
	   "userIdentity":{"type":"IAMUser","userName":"alice","arn":"arn:aws:iam::111:user/alice","accessKeyId":"AKIAALICE"},
	   "responseElements":{"credentials":{"accessKeyId":"ASIAROLEA"}}},
	  {"eventID":"2","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-03-01T00:05:00Z","sourceIPAddress":"10.0.0.5",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAROLEA","arn":"arn:aws:sts::111:assumed-role/RoleA/sessA",
	     "sessionContext":{"sessionIssuer":{"userName":"RoleA","arn":"arn:aws:iam::111:role/RoleA"}}},
	   "responseElements":{"credentials":{"accessKeyId":"ASIAROLEB"}}},
	  {"eventID":"3","eventName":"GetObject","eventSource":"s3.amazonaws.com","eventTime":"2025-03-01T00:10:00Z",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAROLEB","arn":"arn:aws:sts::111:assumed-role/RoleB/sessB",
	     "sessionContext":{"sessionIssuer":{"userName":"RoleB","arn":"arn:aws:iam::111:role/RoleB"}}}}
	]}`
	f := filepath.Join(dir, "chain.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(bin(t), filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	// event 3 is the GetObject under RoleB (seq is chronological: 1,2,3)
	lin, err := s.Lineage(3)
	if err != nil {
		t.Fatal(err)
	}
	if !lin.Applicable || !lin.Complete {
		t.Fatalf("expected applicable+complete lineage, got %+v", lin)
	}
	if len(lin.Nodes) != 2 {
		t.Fatalf("want 2 ancestors, got %d: %+v", len(lin.Nodes), lin.Nodes)
	}
	// origin-first: alice, then RoleA's session
	if lin.Nodes[0].IdentityType != "IAMUser" || lin.Nodes[0].UserName != "alice" {
		t.Fatalf("origin wrong: %+v", lin.Nodes[0])
	}
	if lin.Nodes[0].ViaSourceIP != "1.2.3.4" || lin.Nodes[0].ViaEvent != "AssumeRole" {
		t.Fatalf("origin edge wrong: %+v", lin.Nodes[0])
	}
	if lin.Nodes[1].IdentityType != "AssumedRole" || lin.Nodes[1].RoleArn != "arn:aws:iam::111:role/RoleA" {
		t.Fatalf("parent wrong: %+v", lin.Nodes[1])
	}
	// a non-assumed-role event has no lineage
	if lin1, _ := s.Lineage(1); lin1.Applicable {
		t.Fatalf("IAMUser event should not be applicable: %+v", lin1)
	}
}

// TestLineageGraph builds the tree around a RoleB session:
//
//	alice ─assume─▶ RoleA/sessA ─┬─assume─▶ RoleB/sessB (current)  ─assume─▶ RoleC/sessC
//	                             └─assume─▶ RoleB2/sessB2 (sibling)
func TestLineageGraph(t *testing.T) {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-04-01T00:00:01Z","sourceIPAddress":"1.1.1.1",
	   "userIdentity":{"type":"IAMUser","userName":"alice","arn":"arn:aws:iam::111:user/alice","accessKeyId":"AKIAALICE"},
	   "responseElements":{"credentials":{"accessKeyId":"ASIAA"},"assumedRoleUser":{"arn":"arn:aws:sts::111:assumed-role/RoleA/sessA"}}},
	  {"eventID":"2","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-04-01T00:01:00Z","sourceIPAddress":"2.2.2.2",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAA","arn":"arn:aws:sts::111:assumed-role/RoleA/sessA","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleA"}}},
	   "responseElements":{"credentials":{"accessKeyId":"ASIAB"},"assumedRoleUser":{"arn":"arn:aws:sts::111:assumed-role/RoleB/sessB"}}},
	  {"eventID":"3","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-04-01T00:02:00Z","sourceIPAddress":"2.2.2.2",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAA","arn":"arn:aws:sts::111:assumed-role/RoleA/sessA","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleA"}}},
	   "responseElements":{"credentials":{"accessKeyId":"ASIAB2"},"assumedRoleUser":{"arn":"arn:aws:sts::111:assumed-role/RoleB2/sessB2"}}},
	  {"eventID":"4","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-04-01T00:03:00Z","sourceIPAddress":"3.3.3.3",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAB","arn":"arn:aws:sts::111:assumed-role/RoleB/sessB","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleB"}}},
	   "responseElements":{"credentials":{"accessKeyId":"ASIAC"},"assumedRoleUser":{"arn":"arn:aws:sts::111:assumed-role/RoleC/sessC"}}},
	  {"eventID":"5","eventName":"GetObject","eventSource":"s3.amazonaws.com","eventTime":"2025-04-01T00:04:00Z",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAB","arn":"arn:aws:sts::111:assumed-role/RoleB/sessB","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleB"}}}}
	]}`
	f := filepath.Join(dir, "tree.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(bin(t), filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	g, err := s.LineageGraph(5) // the GetObject under RoleB
	if err != nil {
		t.Fatal(err)
	}
	if !g.Applicable || g.CurrentID != "ASIAB" || g.RootID != "AKIAALICE" {
		t.Fatalf("graph header wrong: applicable=%v current=%q root=%q", g.Applicable, g.CurrentID, g.RootID)
	}
	byID := map[string]GraphNode{}
	for _, n := range g.Nodes {
		byID[n.ID] = n
	}
	want := map[string]string{"AKIAALICE": "origin", "ASIAA": "parent", "ASIAB": "current", "ASIAB2": "sibling", "ASIAC": "descendant"}
	for id, kind := range want {
		if byID[id].Kind != kind {
			t.Fatalf("node %s kind = %q, want %q", id, byID[id].Kind, kind)
		}
	}
	// sibling resolved from the edge arn (it has no own events)
	if byID["ASIAB2"].RoleName != "RoleB2" || byID["ASIAB2"].SessionName != "sessB2" {
		t.Fatalf("sibling not resolved: %+v", byID["ASIAB2"])
	}
	// edges present: alice→A, A→B, A→B2, B→C
	edge := func(p, c string) bool {
		for _, e := range g.Edges {
			if e.Parent == p && e.Child == c {
				return true
			}
		}
		return false
	}
	if !edge("AKIAALICE", "ASIAA") || !edge("ASIAA", "ASIAB") || !edge("ASIAA", "ASIAB2") || !edge("ASIAB", "ASIAC") {
		t.Fatalf("edges wrong: %+v", g.Edges)
	}
	// current session made one AssumeRole → childCount 1; alice's key issued 1 session
	if byID["ASIAB"].ChildCount != 1 {
		t.Fatalf("current childCount = %d, want 1", byID["ASIAB"].ChildCount)
	}
	// lazy expansion of a node's children
	ch, err := s.LineageChildren("ASIAB")
	if err != nil || len(ch.Nodes) != 1 || ch.Nodes[0].ID != "ASIAC" {
		t.Fatalf("LineageChildren(ASIAB) = %+v (err %v)", ch.Nodes, err)
	}
}

// TestQueryExpr exercises the query-language → SQL compiler across every operator
// class: glob, exact-negation, per-field regex, contains, exists, OR, free-text,
// a derived field, and the unknown-field error path.
func TestQueryExpr(t *testing.T) {
	s := newStore(t)

	// eventSource="s3.amazonaws.com" and eventName="List*"  → just ListBuckets
	f := Filter{Expr: &Expr{T: "and", Nodes: []Expr{
		{T: "cmp", Field: "eventSource", Op: "eq", Value: "s3.amazonaws.com"},
		{T: "cmp", Field: "eventName", Op: "eq", Value: "List*"},
	}}}
	if rows, err := s.Page(f, 0, 10); err != nil || len(rows) != 1 || rows[0].EventName != "ListBuckets" {
		t.Fatalf("glob+eq expr rows=%d err=%v", len(rows), err)
	}

	// not readOnly="true"  → only the ec2 error event
	f = Filter{Expr: &Expr{T: "not", Node: &Expr{T: "cmp", Field: "readOnly", Op: "eq", Value: "true"}}}
	if rows, err := s.Page(f, 0, 10); err != nil || len(rows) != 1 || rows[0].EventID != "3" {
		t.Fatalf("not-eq expr rows=%d err=%v", len(rows), err)
	}

	// eventName ~ "^Get"  → GetObject
	f = Filter{Expr: &Expr{T: "cmp", Field: "eventName", Op: "regex", Value: "^Get"}}
	if rows, err := s.Page(f, 0, 10); err != nil || len(rows) != 1 || rows[0].EventName != "GetObject" {
		t.Fatalf("regex expr rows=%d err=%v", len(rows), err)
	}

	// user:"ali" or errorCode=*  → alice's ListBuckets + the ec2 error = 2
	f = Filter{Expr: &Expr{T: "or", Nodes: []Expr{
		{T: "cmp", Field: "user", Op: "contains", Value: "ali"},
		{T: "cmp", Field: "errorCode", Op: "eq", Value: ""},
	}}}
	if agg, err := s.Aggregates(f); err != nil || agg.Total != 2 {
		t.Fatalf("or expr total=%d err=%v", agg.Total, err)
	}

	// result="Success"  → the two non-error events (derived field)
	f = Filter{Expr: &Expr{T: "cmp", Field: "result", Op: "eq", Value: "Success"}}
	if agg, err := s.Aggregates(f); err != nil || agg.Total != 2 {
		t.Fatalf("result=Success total=%d err=%v", agg.Total, err)
	}

	// bare free-text node behaves like Text
	f = Filter{Expr: &Expr{T: "text", Value: "runinstances"}}
	if rows, err := s.Page(f, 0, 10); err != nil || len(rows) != 1 || rows[0].EventName != "RunInstances" {
		t.Fatalf("text expr rows=%d err=%v", len(rows), err)
	}

	// unknown field must fail loudly, never silently widen results
	f = Filter{Expr: &Expr{T: "cmp", Field: "nope", Op: "eq", Value: "x"}}
	if _, err := s.Page(f, 0, 10); err == nil {
		t.Fatal("expected error for unknown query field")
	}
}
