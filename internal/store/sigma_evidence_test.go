package store

import (
	"cloudmon/internal/model"
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
)

func sigmaSelection(field string) string {
	return "title: Evidence test\nlogsource: {product: aws, service: cloudtrail}\ndetection:\n  selection:\n    " + field + "\n  condition: selection"
}

func TestSigmaEvidenceExactNumbersAndPresence(t *testing.T) {
	a, b, c := contextEvent("a", 0), contextEvent("b", 1), contextEvent("c", 2)
	a["requestParameters"] = evidenceObject{"large": json.Number("9007199254740993"), "decimal": json.Number("0.123456789012345678901234567891"), "nil": nil, "empty": ""}
	b["requestParameters"] = evidenceObject{"large": json.Number("9007199254740992"), "decimal": json.Number("0.123456789012345678901234567890")}
	a["resources"] = []any{evidenceObject{"ARN": "other"}, evidenceObject{"ARN": "arn:aws:s3:::exact"}}
	b["resources"] = []any{evidenceObject{"ARN": nil}}
	c["resources"] = []any{}
	a["readOnly"] = false
	delete(b, "readOnly")
	delete(c, "readOnly")
	a["managementEvent"] = nil
	delete(b, "managementEvent")
	delete(c, "managementEvent")
	s := evidenceStore(t, a, b, c)
	for _, tc := range []struct {
		field   string
		matches int
		first   string
	}{
		{"requestParameters.large|gt: 9007199254740992", 1, "a"},
		{"requestParameters.large: 9007199254740993", 1, "a"},
		{"requestParameters.large|lt: 9.007199254740993e15", 1, "b"},
		{"requestParameters.decimal|gt: 0.123456789012345678901234567890", 1, "a"},
		{"requestParameters.decimal: 0.123456789012345678901234567890", 1, "b"},
		{"requestParameters.nil|exists: true", 1, "a"},
		{"requestParameters.nil|exists: false", 2, "c"},
		{"requestParameters.empty: ''", 1, "a"},
		{"readOnly: false", 1, "a"},
		{"readOnly|exists: false", 2, "c"},
		{"managementEvent|exists: true", 1, "a"},
		{"resources.ARN: 'arn:aws:s3:::exact'", 1, "a"},
		{"resources.ARN|exists: true", 2, "b"},
		{"resources.ARN|exists: false", 1, "c"},
	} {
		t.Run(tc.field, func(t *testing.T) {
			r := mustRun(t, s, sigmaSelection(tc.field))
			if r.Matches != tc.matches || r.Rows[0].EventID != tc.first {
				t.Fatalf("wrong evidence matches: %+v", r)
			}
		})
	}
}

func TestSigmaValidatedNetworkAndEscapes(t *testing.T) {
	a, b, c, d := contextEvent("a", 0), contextEvent("b", 1), contextEvent("c", 2), contextEvent("d", 3)
	a["sourceIPAddress"] = "999.0.2.1"
	b["sourceIPAddress"] = "192.0.2.1.5"
	c["sourceIPAddress"] = "2001:0db8::1"
	d["sourceIPAddress"] = "192.0.2.1"
	a["userAgent"] = "*"
	b["userAgent"] = "prefixABCvalue"
	c["userAgent"] = "prefixZZvalue"
	d["userAgent"] = "PREFIX*VALUE"
	a["requestParameters"] = evidenceObject{"a": "Abc", "b": "abc"}
	s := evidenceStore(t, a, b, c, d)
	for _, tc := range []struct {
		field string
		count int
	}{
		{"sourceIPAddress|cidr: 0.0.0.0/0", 1}, {"sourceIPAddress|cidr: 2001:db8::/32", 1},
		{`userAgent: '\*'`, 1}, {`userAgent|contains: 'prefix*value'`, 3},
		{"requestParameters.a|fieldref|cased: requestParameters.b", 0}, {"requestParameters.a|fieldref: requestParameters.b", 1},
	} {
		r := mustRun(t, s, sigmaSelection(tc.field))
		if r.Matches != tc.count {
			t.Fatalf("%s: %d != %d", tc.field, r.Matches, tc.count)
		}
	}
}

func TestSigmaRejectsAmbiguousOrUnsupportedRules(t *testing.T) {
	base := sigmaSelection("eventName: GetObject")
	for _, source := range []string{
		sigmaSelection("readOnly|exists: 'false'"), sigmaSelection("eventName|contains|base64: GetObject"),
		sigmaSelection("sourceIPAddress|cidr|contains: 192.0.2.0/24"), sigmaSelection("eventName|wide: value"),
		sigmaSelection("eventName|windash: '-a -b'"), sigmaSelection("eventName: {nested: wrong}"), sigmaSelection("eventName: []"),
		sigmaSelection("requestParameters.n|gt: .nan"), sigmaSelection("requestParameters.n|gt: 1e99999"),
		strings.Replace(base, "product: aws", "product: windows", 1), strings.Replace(base, "service: cloudtrail", "service: guardduty", 1),
		base + "\ncorrelation: {type: event_count}", base + "\ntaxonomy: unsupported", base + "\n---\n" + base,
		strings.Replace(base, "eventName: GetObject", "eventName: GetObject\n    eventName: PutObject", 1),
		strings.Replace(base, "selection:\n", "selection: &sel\n", 1) + "\nextra: *sel",
		strings.Replace(base, "condition: selection", "condition: selection | sum(requestParameters.n) > 1", 1),
		strings.Replace(base, "condition: selection", "condition: selection | count() > 1.000000000000000001", 1),
		strings.Replace(base, "condition: selection", "condition: selection | count() > 9007199254740993", 1),
	} {
		r := prepareSigma(source)
		if r.result.Supported || len(r.result.Diagnostics) == 0 {
			t.Fatalf("ambiguous rule accepted: %s", source)
		}
	}
}

func TestSigmaSnapshotSuiteAndExplanations(t *testing.T) {
	s := sigmaStore(t)
	source := `title: Secrets
logsource: {product: aws, service: cloudtrail}
detection:
  selection:
    eventName: GetSecretValue
  filter_service:
    userIdentity.invokedBy|exists: true
  condition: selection and not filter_service`
	suite, err := s.SigmaSuite(context.Background(), []SigmaRuleInput{{"secrets", source}, {"all logins", sigmaSelection("eventName: ConsoleLogin")}, {"unsupported", sigmaSelection("eventName|expand: value")}})
	if err != nil {
		t.Fatal(err)
	}
	if len(suite.Results) != 3 || suite.Results[0].Result.Matches != 1 || suite.Results[1].Result.Matches != 2 || suite.Results[2].Result.Supported {
		t.Fatalf("suite: %+v", suite)
	}
	for _, entry := range suite.Results {
		if *entry.Result.Snapshot != suite.Snapshot {
			t.Fatal("suite snapshots differ")
		}
	}
	r := suite.Results[0].Result
	explanation := r.Explanations[r.Rows[0].Seq]
	if len(explanation) != 2 || explanation[0].Name != "filter_service" || explanation[0].Matched || !explanation[1].Matched {
		t.Fatalf("wrong selection reasons: %+v", explanation)
	}
	snapshot := suite.Snapshot
	if _, err = s.AppendEvents([]model.CloudTrailEvent{liveEvent(t, `{"eventID":"late","eventName":"ConsoleLogin","eventTime":"2026-01-01T00:00:00Z"}`)}); err != nil {
		t.Fatal(err)
	}
	countRule := prepareSigma(strings.Replace(sigmaSelection("eventName: ConsoleLogin"), "condition: selection", "condition: selection | count() > 2", 1))
	err = s.readSnapshot(context.Background(), func(ctx context.Context, tx *sql.Tx) error {
		result, err := runSigmaOn(ctx, tx, countRule, snapshot, 500)
		if err == nil && (result.Scanned != 5 || result.Matches != 0) {
			t.Fatalf("count subquery escaped snapshot: %+v", result)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = s.SigmaSuite(cancelled, []SigmaRuleInput{{"secrets", source}}); err == nil {
		t.Fatal("cancelled suite ran")
	}
	if _, err = s.SigmaRunContext(cancelled, source, 500); err == nil {
		t.Fatal("cancelled single rule ran")
	}
	page, err := s.EvidenceSnapshot(r.Rows[0].Seq, 0, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ObservationSnapshot(page.Observations[0].ID, snapshot); err != nil {
		t.Fatal(err)
	}
	if _, err = s.IngestReader(strings.NewReader(`{"eventID":"replacement","eventName":"Other"}`), "replacement"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.LineageRaw(r.Rows[0].Seq, snapshot); err == nil {
		t.Fatal("raw opened replacement dataset")
	}
	if _, err = s.Lineage(r.Rows[0].Seq, snapshot); err == nil {
		t.Fatal("lineage opened replacement dataset")
	}
	if _, err = s.LineageGraph(r.Rows[0].Seq, snapshot); err == nil {
		t.Fatal("graph opened replacement dataset")
	}
	if _, err = s.EvidenceSnapshot(r.Rows[0].Seq, 0, snapshot); err == nil {
		t.Fatal("sources opened replacement dataset")
	}
	if _, err = s.ObservationSnapshot(page.Observations[0].ID, snapshot); err == nil {
		t.Fatal("observation ID opened replacement dataset")
	}
}

func TestSigmaNumericLimitsFailTheRun(t *testing.T) {
	event := contextEvent("oversized", 0)
	event["requestParameters"] = evidenceObject{"value": strings.Repeat("9", 4097)}
	s := evidenceStore(t, event)
	r, err := s.SigmaRun(sigmaSelection("requestParameters.value|gt: 1"), 500)
	if err == nil || !strings.Contains(err.Error(), "4096") || r.Supported {
		t.Fatalf("oversized numeric evidence silently evaluated: %+v %v", r, err)
	}
}
