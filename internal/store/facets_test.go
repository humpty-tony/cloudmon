package store

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func facetFixtureStore(t *testing.T) *Store {
	t.Helper()
	data, err := os.ReadFile("../../testdata/facets.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Records json.RawMessage }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "facets.json")
	if err := os.WriteFile(path, fixture.Records, 0600); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(dir, "events.duckdb"))
	if _, err := s.Ingest(path); err != nil {
		t.Fatal(err)
	}
	return s
}

// Assert the wire contract, not merely Go fields; old native fixtures may lack it.
func facetMetadataWire(t *testing.T, agg Aggregates, field string) map[string]any {
	t.Helper()
	data, err := json.Marshal(agg)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(data, &wire); err != nil {
		t.Fatal(err)
	}
	metadata, ok := wire["facetMetadata"].(map[string]any)
	if !ok {
		t.Fatal("aggregate is missing facetMetadata: presence must not be inferred from top values")
	}
	meta, ok := metadata[field].(map[string]any)
	if !ok {
		t.Fatalf("missing metadata for %s", field)
	}
	return meta
}

func TestFacetAdditionalFieldsDistinguishDerivedResultAndMissingError(t *testing.T) {
	s := facetFixtureStore(t)
	agg, err := s.Aggregates(Filter{})
	if err != nil {
		t.Fatal(err)
	}
	for field, want := range map[string]FacetMetadata{
		"accountId": {TotalEvents: 40, PresentEvents: 25, MissingEvents: 15, DistinctValues: 1, ReturnedValues: 1, Limit: 25},
		"errorCode": {TotalEvents: 40, PresentEvents: 8, MissingEvents: 32, DistinctValues: 2, ReturnedValues: 2, Limit: 25},
		"result":    {TotalEvents: 40, PresentEvents: 40, MissingEvents: 0, DistinctValues: 3, ReturnedValues: 3, Limit: 25},
	} {
		if got, ok := agg.FacetMetadata[field]; !ok || got != want {
			t.Errorf("%s metadata = %+v, want %+v", field, got, want)
		}
	}
	if len(agg.Facets["result"]) != 3 || agg.Facets["result"][0] != (FacetValue{Value: "Success", Count: 32}) {
		t.Fatalf("wrong derived result: %+v", agg.Facets["result"])
	}
}

func TestFacetSharedFilterConformance(t *testing.T) {
	s := facetFixtureStore(t)
	data, err := os.ReadFile("../../testdata/facets.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name   string
			Filter Filter
			IDs    []string
		}
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	output := map[string]Aggregates{}
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
			if agg.Total != len(tc.IDs) {
				t.Fatalf("aggregate scope = %d, want %d", agg.Total, len(tc.IDs))
			}
			for field, meta := range agg.FacetMetadata {
				if meta.TotalEvents != agg.Total || meta.PresentEvents+meta.MissingEvents != agg.Total || meta.ReturnedValues != len(agg.Facets[field]) || meta.Truncated != (meta.DistinctValues > meta.ReturnedValues) {
					t.Fatalf("invalid metadata for %s: %+v", field, meta)
				}
			}
			output[tc.Name] = agg
		})
	}
	// Optional real native wire output for cross-runtime parity, never a fixture
	// fabricated by a mock. Normal go test needs no exported artifact.
	if path := os.Getenv("CLOUDMON_FACETS_OUTPUT"); path != "" {
		data, err := json.Marshal(output)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFacetNormalizedUserOrIssuerName(t *testing.T) {
	data, err := os.ReadFile("../../testdata/facets-identity.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Records   json.RawMessage
		UserNames map[string]string
		Cases     []struct {
			Name   string
			Filter Filter
			IDs    []string
		}
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	s := openTestStore(t, filepath.Join(t.TempDir(), "identity.duckdb"))
	if _, err := s.IngestReader(strings.NewReader(string(fixture.Records)), "facets-identity"); err != nil {
		t.Fatal(err)
	}
	output := map[string]Aggregates{}
	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			rows, err := s.Page(tc.Filter, 0, 100)
			if err != nil {
				t.Fatal(err)
			}
			ids := make([]string, 0, len(rows))
			for _, row := range rows {
				ids = append(ids, row.EventID)
				if want, ok := fixture.UserNames[row.EventID]; !ok || row.UserName != want {
					t.Errorf("%s normalized name = %q, want %q", row.EventID, row.UserName, want)
				}
			}
			sort.Strings(ids)
			if !reflect.DeepEqual(ids, tc.IDs) {
				t.Fatalf("IDs %v, want %v", ids, tc.IDs)
			}
			agg, err := s.Aggregates(tc.Filter)
			if err != nil {
				t.Fatal(err)
			}
			output[tc.Name] = agg
		})
	}
	agg := output["normalized names"]
	want := []FacetValue{{Value: "AdminRole", Count: 3}, {Value: "DirectName", Count: 1}}
	if !reflect.DeepEqual(agg.Facets["userName"], want) {
		t.Fatalf("same-name users and issuers must keep grouping together: %+v", agg.Facets["userName"])
	}
	if agg.FacetMetadata["userName"] != (FacetMetadata{TotalEvents: 5, PresentEvents: 4, MissingEvents: 1, DistinctValues: 2, ReturnedValues: 2, Limit: 25}) {
		t.Fatalf("presence must count normalized names, not raw userIdentity.userName: %+v", agg.FacetMetadata["userName"])
	}
	if path := os.Getenv("CLOUDMON_FACETS_IDENTITY_OUTPUT"); path != "" {
		data, err := json.Marshal(output)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFacetReplacementAndEmptyStore(t *testing.T) {
	s := facetFixtureStore(t)
	old, err := s.Aggregates(Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.IngestReader(strings.NewReader(`{"eventID":"replacement","eventName":"Replacement"}`), "replacement"); err != nil {
		t.Fatal(err)
	}
	fresh, err := s.Aggregates(Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if old.Snapshot.Generation == fresh.Snapshot.Generation {
		t.Fatal("facet snapshot generation did not change")
	}
	if fresh.Total != 1 || len(fresh.Facets["userName"]) != 0 || fresh.FacetMetadata["userName"].MissingEvents != 1 {
		t.Fatalf("replacement kept old counts: %+v", fresh)
	}
	empty := openTestStore(t, filepath.Join(t.TempDir(), "empty.duckdb"))
	agg, err := empty.Aggregates(Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(agg.FacetMetadata) != 10 {
		t.Fatal("empty facets disappeared")
	}
	for field, meta := range agg.FacetMetadata {
		if meta != (FacetMetadata{Limit: 25}) || len(agg.Facets[field]) != 0 {
			t.Fatalf("empty facet %s: %+v", field, meta)
		}
	}
}

func TestFacetPresenceCoversCompleteFilteredSnapshot(t *testing.T) {
	s := facetFixtureStore(t)
	result, err := s.Search(context.Background(), Filter{}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Events) != 2 || result.Aggregates.Total != 40 {
		t.Fatalf("invalid page/scope: %+v", result)
	}
	meta := facetMetadataWire(t, result.Aggregates, "userName")
	for key, want := range map[string]float64{"totalEvents": 40, "presentEvents": 30, "missingEvents": 10, "distinctValues": 30, "returnedValues": 25, "limit": 25} {
		if meta[key] != want {
			t.Errorf("%s = %v, want %v", key, meta[key], want)
		}
	}
	if meta["truncated"] != true {
		t.Fatal("high-cardinality facet must be marked truncated")
	}
	if len(result.Aggregates.Facets["userName"]) != 25 {
		t.Fatal("bounded values must not claim to be all values")
	}
	if result.Aggregates.Snapshot == nil || result.Aggregates.Snapshot.MaxSeq != 40 {
		t.Fatal("facet snapshot is not the complete search snapshot")
	}
}
