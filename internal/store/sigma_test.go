package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sigmaStore(t *testing.T) *Store {
	dir := t.TempDir()
	// A small CloudTrail set exercising fields fast-mapped + resolved from raw.
	rec := `{"Records":[
	  {"eventID":"1","eventName":"ConsoleLogin","eventSource":"signin.amazonaws.com","eventTime":"2025-01-01T00:00:01Z",
	   "userIdentity":{"type":"Root","arn":"arn:aws:iam::111:root"},
	   "additionalEventData":{"MFAUsed":"No"}},
	  {"eventID":"2","eventName":"ConsoleLogin","eventSource":"signin.amazonaws.com","eventTime":"2025-01-01T00:00:02Z",
	   "userIdentity":{"type":"IAMUser","userName":"alice"},
	   "additionalEventData":{"MFAUsed":"Yes"}},
	  {"eventID":"3","eventName":"GetSecretValue","eventSource":"secretsmanager.amazonaws.com","eventTime":"2025-01-01T00:00:03Z",
	   "userIdentity":{"type":"AssumedRole","accountId":"111","invokedBy":"ecs-tasks.amazonaws.com"}},
	  {"eventID":"4","eventName":"GetSecretValue","eventSource":"secretsmanager.amazonaws.com","eventTime":"2025-01-01T00:00:04Z",
	   "userIdentity":{"type":"AssumedRole","accountId":"111","arn":"arn:aws:sts::111:assumed-role/App/sess"}},
	  {"eventID":"5","eventName":"DeleteTrail","eventSource":"cloudtrail.amazonaws.com","eventTime":"2025-01-01T00:00:05Z",
	   "errorCode":"AccessDenied","userIdentity":{"type":"IAMUser","userName":"bob"}}
	]}`
	f := filepath.Join(dir, "ct.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	return s
}

func TestSigmaBasicMatch(t *testing.T) {
	s := sigmaStore(t)
	rule := `title: Root Console Login
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventSource: signin.amazonaws.com
    eventName: ConsoleLogin
    userIdentity.type: Root
  condition: selection
level: high`
	r, err := s.SigmaRun(rule, 100)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Parsed || !r.Supported {
		t.Fatalf("parsed=%v supported=%v diags=%+v", r.Parsed, r.Supported, r.Diagnostics)
	}
	if r.Matches != 1 || len(r.Rows) != 1 || r.Rows[0].EventID != "1" {
		t.Fatalf("want 1 match (event 1), got matches=%d rows=%d sql=%s", r.Matches, len(r.Rows), r.SQL)
	}
}

func TestSigmaConditionAndNot(t *testing.T) {
	s := sigmaStore(t)
	// GetSecretValue not invoked by an AWS service → only event 4 (event 3 is invokedBy).
	rule := `title: SecretsManager GetSecretValue non-service
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    eventSource: secretsmanager.amazonaws.com
    eventName: GetSecretValue
  filter_service:
    userIdentity.invokedBy|endswith: .amazonaws.com
  condition: selection and not filter_service`
	r, err := s.SigmaRun(rule, 100)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Supported {
		t.Fatalf("unsupported: %+v", r.Diagnostics)
	}
	// The NULL-guard on `not` is the point: event 4 has no invokedBy (absent field)
	// and must still be KEPT, not dropped.
	if r.Matches != 1 || len(r.Rows) != 1 || r.Rows[0].EventID != "4" {
		t.Fatalf("want event 4 only, got matches=%d rows=%v sql=%s", r.Matches, r.Rows, r.SQL)
	}
}

func TestSigmaRawFieldAndContains(t *testing.T) {
	s := sigmaStore(t)
	// nested field resolved from raw + |contains; MFAUsed:No → event 1 only.
	rule := `title: Console login without MFA
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    eventName: ConsoleLogin
    additionalEventData.MFAUsed: 'No'
  condition: selection`
	r, err := s.SigmaRun(rule, 100)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Supported {
		t.Fatalf("unsupported: %+v", r.Diagnostics)
	}
	if r.Matches != 1 || r.Rows[0].EventID != "1" {
		t.Fatalf("want event 1, got matches=%d sql=%s", r.Matches, r.SQL)
	}
}

func TestSigmaValidationError(t *testing.T) {
	s := sigmaStore(t)
	// condition references an undefined identifier → parsed but not supported, with a reason.
	rule := `title: Broken
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    eventName: ConsoleLogin
  condition: selection and filter`
	r, err := s.SigmaRun(rule, 100)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Parsed || r.Supported {
		t.Fatalf("want parsed+unsupported, got parsed=%v supported=%v", r.Parsed, r.Supported)
	}
	found := false
	for _, d := range r.Diagnostics {
		if d.Severity == "error" && strings.Contains(d.Message, "undefined identifier") {
			found = true
		}
	}
	if !found {
		t.Fatalf("want an undefined-identifier diagnostic, got %+v", r.Diagnostics)
	}
}

func TestSigmaFailLoudUnsupportedModifier(t *testing.T) {
	s := sigmaStore(t)
	// |expand needs a placeholder resolver we don't wire → must be FLAGGED, never run.
	rule := `title: Uses expand
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    userAgent|expand: '%tools%'
  condition: selection`
	r, err := s.SigmaRun(rule, 100)
	if err != nil {
		t.Fatal(err)
	}
	if r.Supported {
		t.Fatalf("|expand must be unsupported, but rule ran: sql=%s", r.SQL)
	}
	found := false
	for _, d := range r.Diagnostics {
		if strings.Contains(d.Message, "expand") {
			found = true
		}
	}
	if !found {
		t.Fatalf("want an |expand diagnostic, got %+v", r.Diagnostics)
	}
}

func advStore(t *testing.T) *Store {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"1","eventName":"DescribeImages","eventSource":"ecr.amazonaws.com","eventTime":"2025-01-01T00:00:01Z","sourceIPAddress":"35.165.83.150","recipientAccountId":"111",
	   "userIdentity":{"type":"AssumedRole","accountId":"111"},
	   "resources":[{"ARN":"arn:aws:ecr:us-east-1:111:repository/deployment/functional_tests"}]},
	  {"eventID":"2","eventName":"DescribeImages","eventSource":"ecr.amazonaws.com","eventTime":"2025-01-01T00:00:02Z","sourceIPAddress":"35.165.10.20","recipientAccountId":"111",
	   "userIdentity":{"type":"AssumedRole","accountId":"111"},
	   "resources":[{"ARN":"arn:aws:ecr:us-east-1:111:repository/other"}]},
	  {"eventID":"3","eventName":"GetObject","eventSource":"s3.amazonaws.com","eventTime":"2025-01-01T00:00:03Z","sourceIPAddress":"10.0.4.12","recipientAccountId":"111",
	   "userIdentity":{"type":"AssumedRole","accountId":"222"}},
	  {"eventID":"4","eventName":"DescribeImages","eventSource":"ecr.amazonaws.com","eventTime":"2025-01-01T00:00:04Z","sourceIPAddress":"8.8.8.8","userAgent":"aGVsbG8=","recipientAccountId":"111",
	   "userIdentity":{"type":"AssumedRole","accountId":"111"}},
	  {"eventID":"5","eventName":"DescribeImages","eventSource":"ecr.amazonaws.com","eventTime":"2025-01-01T00:00:05Z","sourceIPAddress":"35.165.83.150","recipientAccountId":"111",
	   "userIdentity":{"type":"AssumedRole","accountId":"111"}}
	]}`
	f := filepath.Join(dir, "adv.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	return s
}

func mustRun(t *testing.T, s *Store, rule string) SigmaResult {
	t.Helper()
	r, err := s.SigmaRun(rule, 100)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Supported {
		t.Fatalf("rule not supported: %+v\nsql=%s", r.Diagnostics, r.SQL)
	}
	return r
}

func TestSigmaCidr(t *testing.T) {
	s := advStore(t)
	// /16 → 35.165.x = events 1, 2, 5
	r := mustRun(t, s, `title: t
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    sourceIPAddress|cidr: 35.165.0.0/16
  condition: selection`)
	if r.Matches != 3 {
		t.Errorf("cidr /16 matches = %d, want 3; sql=%s", r.Matches, r.SQL)
	}
	// non-octet-aligned /20 now works in pure SQL: 35.165.80.0/20 covers .80–.95,
	// so 35.165.83.150 (events 1,5) but NOT 35.165.10.20 (event 2).
	r = mustRun(t, s, `title: t
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    sourceIPAddress|cidr: 35.165.80.0/20
  condition: selection`)
	if r.Matches != 2 {
		t.Errorf("cidr /20 matches = %d, want 2; sql=%s", r.Matches, r.SQL)
	}
	// a bare IP is a valid Sigma |cidr host (implicit /32) - must compile, not error.
	r = mustRun(t, s, `title: t
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    sourceIPAddress|cidr: 35.165.83.150
  condition: selection`)
	if r.Matches != 2 { // events 1 and 5 share that exact IP
		t.Errorf("bare-IP cidr matches = %d, want 2; sql=%s", r.Matches, r.SQL)
	}
}

func TestSigmaResourcesArray(t *testing.T) {
	s := advStore(t)
	// array any-element contains → only event 1's resources ARN has functional_tests
	r := mustRun(t, s, `title: t
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    resources.ARN|contains: functional_tests
  condition: selection`)
	if r.Matches != 1 || r.Rows[0].EventID != "1" {
		t.Errorf("resources array = %d (want event 1); sql=%s", r.Matches, r.SQL)
	}
}

func TestSigmaBase64(t *testing.T) {
	s := advStore(t)
	// base64("hello") = aGVsbG8= → event 4's userAgent
	r := mustRun(t, s, `title: t
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    userAgent|base64|contains: hello
  condition: selection`)
	if r.Matches != 1 || r.Rows[0].EventID != "4" {
		t.Errorf("base64 = %d (want event 4); sql=%s", r.Matches, r.SQL)
	}
}

func TestSigmaFieldref(t *testing.T) {
	s := advStore(t)
	// accountId == recipientAccountId → all except event 3 (222 != 111)
	r := mustRun(t, s, `title: t
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    userIdentity.accountId|fieldref: recipientAccountId
  condition: selection`)
	if r.Matches != 4 {
		t.Errorf("fieldref = %d, want 4; sql=%s", r.Matches, r.SQL)
	}
}

func TestSigmaAggregation(t *testing.T) {
	s := advStore(t)
	// count() by sourceIPAddress > 1 among DescribeImages → 35.165.83.150 (events 1,5)
	r := mustRun(t, s, `title: t
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    eventName: DescribeImages
  condition: selection | count() by sourceIPAddress > 1`)
	if r.Matches != 2 {
		t.Errorf("aggregation = %d, want 2 (events 1,5); sql=%s", r.Matches, r.SQL)
	}
}

func TestSigmaFailLoudTimeframe(t *testing.T) {
	s := advStore(t)
	// timeframe-windowed aggregation must fail loud, not silently run.
	r, err := s.SigmaRun(`title: t
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    eventName: DescribeImages
  timeframe: 5m
  condition: selection | count() by sourceIPAddress > 1`, 100)
	if err != nil {
		t.Fatal(err)
	}
	if r.Supported {
		t.Fatalf("timeframe aggregation must be unsupported; sql=%s", r.SQL)
	}
}

func TestSigmaPCREFailLoud(t *testing.T) {
	s := advStore(t)
	// PCRE lookahead - RE2 (DuckDB + Go) can't run it → must flag cleanly, not crash.
	r, err := s.SigmaRun(`title: t
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    userAgent|re: '(?=secret)foo'
  condition: selection`, 100)
	if err != nil {
		t.Fatal(err)
	}
	if r.Supported {
		t.Fatalf("PCRE regex must be unsupported, not run; sql=%s", r.SQL)
	}
}

func TestSigmaOneOfThem(t *testing.T) {
	s := sigmaStore(t)
	rule := `title: any of these
logsource: {product: aws, service: cloudtrail}
detection:
  sel_delete:
    eventName: DeleteTrail
  sel_secret:
    eventName: GetSecretValue
  condition: 1 of sel_*`
	r, err := s.SigmaRun(rule, 100)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Supported {
		t.Fatalf("unsupported: %+v", r.Diagnostics)
	}
	if r.Matches != 3 { // DeleteTrail(1) + GetSecretValue(2)
		t.Fatalf("want 3 matches, got %d sql=%s", r.Matches, r.SQL)
	}
}
