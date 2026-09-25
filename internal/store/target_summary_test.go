package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestReviewTargetProjection(t *testing.T) {
	s := openTestStore(t, filepath.Join(t.TempDir(), "targets.duckdb"))
	path := filepath.Join(t.TempDir(), "targets.json")
	raw := `{"Records":[
 {"eventID":"secret","eventName":"GetSecretValue","eventTime":"2026-09-24T09:00:01Z","requestParameters":{"secretId":"prod/payments","password":"never-project-this"}},
 {"eventID":"object","eventName":"GetObject","eventTime":"2026-09-24T09:00:02Z","requestParameters":{"bucketName":"audit","key":"2026/log.json"}},
 {"eventID":"malformed","eventName":"GetSecretValue","eventTime":"2026-09-24T09:00:03Z","requestParameters":{"secretId":{"nested":"not-a-target"}}}
 ]}`
	if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Ingest(path); err != nil {
		t.Fatal(err)
	}
	result, err := s.Search(context.Background(), Filter{}, 10)
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]string{"secret": "prod/payments", "object": "audit/2026/log.json", "malformed": ""}
	for _, row := range result.Events {
		if row.Target != expected[row.EventID] {
			t.Fatalf("%s target: %q", row.EventID, row.Target)
		}
		if row.RawJSON != "" {
			t.Fatal("row transport must not contain full raw evidence")
		}
	}
	if len(result.Events) != len(expected) {
		t.Fatal("missing events")
	}
	investigation, err := s.Investigate(context.Background(), InvestigationOptions{Seq: result.Events[1].Seq, EventID: "object", Minutes: 2, Snapshot: result.Aggregates.Snapshot})
	if err != nil {
		t.Fatal(err)
	}
	if investigation.Anchor.Target != "audit/2026/log.json" {
		t.Fatal("context target missing")
	}
}
