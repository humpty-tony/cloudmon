package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// The browser parser/evaluator and real DuckDB run the same evidence and expected
// event IDs. Counts alone can conceal two engines returning different events.
func TestSearchConformance(t *testing.T) {
	data, err := os.ReadFile("../../testdata/search.json")
	if err != nil {
		t.Fatal(err)
	}
	type queryCase struct {
		Name   string
		Filter Filter
		IDs    []string
	}
	var fixture struct {
		Records json.RawMessage
		Cases   []queryCase
		Invalid []queryCase
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	source := filepath.Join(dir, "records.json")
	if err := os.WriteFile(source, fixture.Records, 0600); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(dir, "events.duckdb"))
	if _, err := s.Ingest(source); err != nil {
		t.Fatal(err)
	}
	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			rows, err := s.Page(tc.Filter, 0, 100)
			if err != nil {
				t.Fatal(err)
			}
			ids := make([]string, 0, len(rows))
			for _, row := range rows {
				ids = append(ids, row.EventID)
			}
			sort.Strings(ids)
			if !reflect.DeepEqual(ids, tc.IDs) {
				t.Fatalf("IDs %v, want %v", ids, tc.IDs)
			}
			agg, err := s.Aggregates(tc.Filter)
			if err != nil {
				t.Fatal(err)
			}
			if agg.Total != len(ids) {
				t.Fatalf("aggregate %d, page %d", agg.Total, len(ids))
			}
		})
	}
	empty := openTestStore(t, filepath.Join(dir, "empty.duckdb"))
	for _, tc := range fixture.Invalid {
		t.Run(tc.Name, func(t *testing.T) {
			if _, err := empty.Page(tc.Filter, 0, 100); err == nil {
				t.Fatal("accepted malformed filter")
			}
		})
	}
}
