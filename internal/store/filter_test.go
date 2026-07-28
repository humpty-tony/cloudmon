package store

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// TestLargeIncludesFilter mirrors the "Sensitive only" toggle: a big eventName
// IN (...) list, run through Aggregates (which repeats the WHERE once per facet)
// and Page. The old -c path made this exceed the Windows command-line limit and
// silently return nothing; stdin removes the cap.
func TestLargeIncludesFilter(t *testing.T) {
	dir := t.TempDir()
	rec := `{"Records":[
	  {"eventID":"1","eventName":"Decrypt","eventSource":"kms.amazonaws.com","eventTime":"2025-01-01T00:00:01Z","userIdentity":{"type":"AssumedRole","accountId":"111"}},
	  {"eventID":"2","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-01-01T00:00:02Z","userIdentity":{"type":"AssumedRole","accountId":"111"}},
	  {"eventID":"3","eventName":"GetObject","eventSource":"s3.amazonaws.com","eventTime":"2025-01-01T00:00:03Z","readOnly":true},
	  {"eventID":"4","eventName":"DescribeInstances","eventSource":"ec2.amazonaws.com","eventTime":"2025-01-01T00:00:04Z","readOnly":true}
	]}`
	f := filepath.Join(dir, "s.json")
	if err := os.WriteFile(f, []byte(rec), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(bin(t), filepath.Join(dir, "app.duckdb"))
	if _, err := s.Ingest(f); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	names := []string{"Decrypt", "AssumeRole"}
	for i := 0; i < 400; i++ {
		names = append(names, fmt.Sprintf("PaddingEvent%d", i))
	}
	flt := Filter{Includes: map[string][]string{"eventName": names}}

	agg, err := s.Aggregates(flt)
	if err != nil {
		t.Fatalf("Aggregates: %v", err)
	}
	if agg.Total != 2 {
		t.Errorf("Aggregates total = %d, want 2 (Decrypt + AssumeRole)", agg.Total)
	}
	page, err := s.Page(flt, 0, 100)
	if err != nil {
		t.Fatalf("Page: %v", err)
	}
	if len(page) != 2 {
		t.Errorf("Page rows = %d, want 2", len(page))
	}
}
