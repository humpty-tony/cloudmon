package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestRoleRollupAndResource covers the session-vs-role activity rollup and the
// per-event "affected resource" extraction. Scenario: alice → RoleA(ASIAA) which
// performs several events and mints RoleB(ASIAB); RoleB then performs its own events.
func TestRoleRollupAndResource(t *testing.T) {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-04-01T00:00:01Z",
	   "userIdentity":{"type":"IAMUser","userName":"alice","arn":"arn:aws:iam::111:user/alice","accessKeyId":"AKIAALICE"},
	   "responseElements":{"credentials":{"accessKeyId":"ASIAA"},"assumedRoleUser":{"arn":"arn:aws:sts::111:assumed-role/RoleA/sessA"}}},
	  {"eventID":"2","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-04-01T00:01:00Z",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAA","arn":"arn:aws:sts::111:assumed-role/RoleA/sessA","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleA"}}},
	   "responseElements":{"credentials":{"accessKeyId":"ASIAB"},"assumedRoleUser":{"arn":"arn:aws:sts::111:assumed-role/RoleB/sessB"}}},
	  {"eventID":"3","eventName":"Decrypt","eventSource":"kms.amazonaws.com","eventTime":"2025-04-01T00:02:00Z",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAA","arn":"arn:aws:sts::111:assumed-role/RoleA/sessA","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleA"}}},
	   "resources":[{"ARN":"arn:aws:kms:us-east-1:111:key/abcd-1234","type":"AWS::KMS::Key"}]},
	  {"eventID":"4","eventName":"GetObject","eventSource":"s3.amazonaws.com","eventTime":"2025-04-01T00:03:00Z",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAA","arn":"arn:aws:sts::111:assumed-role/RoleA/sessA","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleA"}}},
	   "requestParameters":{"bucketName":"secret-bucket","key":"path/to/object.txt"}},
	  {"eventID":"5","eventName":"PutObject","eventSource":"s3.amazonaws.com","eventTime":"2025-04-01T00:04:00Z",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAB","arn":"arn:aws:sts::111:assumed-role/RoleB/sessB","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleB"}}}}
	]}`
	f := filepath.Join(dir, "r.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	g, err := s.LineageGraph(3) // Decrypt, session ASIAA
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]GraphNode{}
	for _, n := range g.Nodes {
		byID[n.ID] = n
	}
	// ASIAA: 3 own events (this session), role RoleA = 3 events across 1 session
	if a := byID["ASIAA"]; a.Events != 3 || a.RoleEvents != 3 || a.RoleSessions != 1 {
		t.Errorf("ASIAA events=%d roleEvents=%d roleSessions=%d, want 3/3/1", a.Events, a.RoleEvents, a.RoleSessions)
	}
	// ASIAB: session performed 1 event; role RoleB = 1 event across 1 session
	if b := byID["ASIAB"]; b.Events != 1 || b.RoleEvents != 1 {
		t.Errorf("ASIAB events=%d roleEvents=%d, want 1/1", b.Events, b.RoleEvents)
	}
	// affected-resource extraction on the session's events
	ev, err := s.LineageEvents("ASIAA")
	if err != nil {
		t.Fatal(err)
	}
	res := map[string]string{}
	for _, n := range ev.Nodes {
		res[n.EventName] = n.Resource
	}
	if res["Decrypt"] != "arn:aws:kms:us-east-1:111:key/abcd-1234" {
		t.Errorf("Decrypt resource = %q, want the KMS key ARN", res["Decrypt"])
	}
	if res["GetObject"] != "secret-bucket" {
		t.Errorf("GetObject resource = %q, want secret-bucket", res["GetObject"])
	}
}

// TestServiceOriginChildCount covers a role assumed by an AWS service (no access
// key): the service origin must not read "child sessions: 0" when it visibly minted
// a child - childCount is floored at the node's out-degree.
func TestServiceOriginChildCount(t *testing.T) {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-04-01T00:00:01Z",
	   "userIdentity":{"type":"AWSService","invokedBy":"lambda.amazonaws.com"},
	   "responseElements":{"credentials":{"accessKeyId":"ASIAA"},"assumedRoleUser":{"arn":"arn:aws:sts::111:assumed-role/RoleA/sessA"}}},
	  {"eventID":"2","eventName":"Decrypt","eventSource":"kms.amazonaws.com","eventTime":"2025-04-01T00:01:00Z",
	   "userIdentity":{"type":"AssumedRole","accessKeyId":"ASIAA","arn":"arn:aws:sts::111:assumed-role/RoleA/sessA","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleA"}}}}
	]}`
	f := filepath.Join(dir, "svc.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	g, err := s.LineageGraph(2) // the Decrypt under RoleA
	if err != nil {
		t.Fatal(err)
	}
	var origin *GraphNode
	for i := range g.Nodes {
		if g.Nodes[i].Kind == "origin" {
			origin = &g.Nodes[i]
		}
	}
	if origin == nil {
		t.Fatalf("no origin node in %+v", g.Nodes)
	}
	if origin.IdentityType != "AWSService" || origin.InvokedBy != "lambda.amazonaws.com" {
		t.Errorf("origin = %+v, want AWSService lambda.amazonaws.com", *origin)
	}
	if origin.ChildCount < 1 {
		t.Errorf("service origin ChildCount = %d, want >= 1 (it minted RoleA)", origin.ChildCount)
	}
}

// TestSSOSession covers IAM Identity Center (SSO) detection: a reserved SSO role
// with no in-trail AssumeRole must name the permission set (not "aws-reserved")
// and note the federated SSO origin.
func TestSSOSession(t *testing.T) {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"1","eventName":"Decrypt","eventSource":"kms.amazonaws.com","eventTime":"2025-04-01T00:00:01Z","recipientAccountId":"111",
	   "userIdentity":{"type":"AssumedRole","accountId":"111","accessKeyId":"ASIASSO",
	     "arn":"arn:aws:sts::111:assumed-role/AWSReservedSSO_AdministratorAccess_abc123def/alice",
	     "sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/aws-reserved/sso.amazonaws.com/us-east-1/AWSReservedSSO_AdministratorAccess_abc123def"}}}}
	]}`
	f := filepath.Join(dir, "sso.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	g, err := s.LineageGraph(1)
	if err != nil {
		t.Fatal(err)
	}
	var cur *GraphNode
	for i := range g.Nodes {
		if g.Nodes[i].ID == "ASIASSO" {
			cur = &g.Nodes[i]
		}
	}
	if cur == nil {
		t.Fatalf("no current node in %+v", g.Nodes)
	}
	if cur.RoleName != "AdministratorAccess" {
		t.Errorf("SSO roleName = %q, want AdministratorAccess (not aws-reserved)", cur.RoleName)
	}
	var noted bool
	for _, n := range g.Notes {
		if strings.Contains(n, "Identity Center") && strings.Contains(n, "AdministratorAccess") {
			noted = true
		}
	}
	if !noted {
		t.Errorf("expected an SSO note naming the permission set, got %v", g.Notes)
	}
}

// TestServiceLinkedRole covers naming + origin badge for an AWS service-linked role
// (aws-service-role/…) - it must show the role name, not "aws-service-role", and be
// tagged originKind=service-linked.
func TestServiceLinkedRole(t *testing.T) {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"1","eventName":"DescribeInstances","eventSource":"ec2.amazonaws.com","eventTime":"2025-04-01T00:00:01Z","recipientAccountId":"111",
	   "userIdentity":{"type":"AssumedRole","accountId":"111","accessKeyId":"ASIASL",
	     "arn":"arn:aws:sts::111:assumed-role/AWSServiceRoleForAutoScaling/session",
	     "sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/aws-service-role/autoscaling.amazonaws.com/AWSServiceRoleForAutoScaling"}}}}
	]}`
	f := filepath.Join(dir, "sl.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	g, err := s.LineageGraph(1)
	if err != nil {
		t.Fatal(err)
	}
	var cur *GraphNode
	for i := range g.Nodes {
		if g.Nodes[i].ID == "ASIASL" {
			cur = &g.Nodes[i]
		}
	}
	if cur == nil {
		t.Fatalf("no current node in %+v", g.Nodes)
	}
	if cur.RoleName != "AWSServiceRoleForAutoScaling" {
		t.Errorf("service-linked roleName = %q, want AWSServiceRoleForAutoScaling (not aws-service-role)", cur.RoleName)
	}
	if cur.OriginKind != "service-linked" {
		t.Errorf("originKind = %q, want service-linked", cur.OriginKind)
	}
}

// TestLineageSelfLoopGuard: an event whose accessKeyId == issuedKeyId (a session
// that appears to issue its own key, seen with some SSO sessions) must NOT create
// bogus self-referential ancestors/children or inflate childCount.
func TestLineageSelfLoopGuard(t *testing.T) {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-04-01T00:00:01Z",
	   "userIdentity":{"type":"AssumedRole","accountId":"111","accessKeyId":"ASIASELF","arn":"arn:aws:sts::111:assumed-role/RoleX/sess","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleX"}}},
	   "responseElements":{"credentials":{"accessKeyId":"ASIASELF"}}},
	  {"eventID":"2","eventName":"GetObject","eventSource":"s3.amazonaws.com","eventTime":"2025-04-01T00:01:00Z",
	   "userIdentity":{"type":"AssumedRole","accountId":"111","accessKeyId":"ASIASELF","arn":"arn:aws:sts::111:assumed-role/RoleX/sess","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleX"}}}}
	]}`
	f := filepath.Join(dir, "self.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	g, err := s.LineageGraph(2)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Nodes) != 1 {
		t.Fatalf("want 1 node (no bogus ancestors), got %d: %+v", len(g.Nodes), g.Nodes)
	}
	if len(g.Edges) != 0 {
		t.Errorf("want 0 edges (no self-loops), got %+v", g.Edges)
	}
	if g.Nodes[0].ChildCount != 0 {
		t.Errorf("childCount = %d, want 0 (a self-issue isn't a real child)", g.Nodes[0].ChildCount)
	}
	if ch, _ := s.LineageChildren("ASIASELF"); len(ch.Nodes) != 0 {
		t.Errorf("LineageChildren = %d nodes, want 0", len(ch.Nodes))
	}
}

// TestCrossAccountEdge covers detection of a cross-account role assumption: a
// principal in account 222 assumes a role owned by account 111. The edge must be
// flagged and a note surfaced.
func TestCrossAccountEdge(t *testing.T) {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-04-01T00:00:01Z",
	   "userIdentity":{"type":"IAMUser","userName":"ext","arn":"arn:aws:iam::222:user/ext","accountId":"222","accessKeyId":"AKIAEXT"},
	   "recipientAccountId":"111",
	   "responseElements":{"credentials":{"accessKeyId":"ASIAA"},"assumedRoleUser":{"arn":"arn:aws:sts::111:assumed-role/RoleA/sessA"}}},
	  {"eventID":"2","eventName":"Decrypt","eventSource":"kms.amazonaws.com","eventTime":"2025-04-01T00:01:00Z","recipientAccountId":"111",
	   "userIdentity":{"type":"AssumedRole","accountId":"111","accessKeyId":"ASIAA","arn":"arn:aws:sts::111:assumed-role/RoleA/sessA","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111:role/RoleA"}}}}
	]}`
	f := filepath.Join(dir, "xa.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	g, err := s.LineageGraph(2) // Decrypt under RoleA (account 111), assumed by account 222
	if err != nil {
		t.Fatal(err)
	}
	var xEdge bool
	for _, e := range g.Edges {
		if e.Parent == "AKIAEXT" && e.Child == "ASIAA" && e.CrossAccount {
			xEdge = true
		}
	}
	if !xEdge {
		t.Errorf("expected cross-account edge AKIAEXT(222)→ASIAA(111), edges=%+v", g.Edges)
	}
	var noted bool
	for _, n := range g.Notes {
		if strings.Contains(n, "Cross-account") {
			noted = true
		}
	}
	if !noted {
		t.Errorf("expected a cross-account note, got %v", g.Notes)
	}
}
