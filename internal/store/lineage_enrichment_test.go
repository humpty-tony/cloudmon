package store

import (
	"context"
	"encoding/json"
	"testing"
)

func TestLineageInitiatorMetadata(t *testing.T) {
	issue, use := issuing(), using()
	issue["sourceIPAddress"] = "198.51.100.24"
	issue["userAgent"] = "aws-cli/2.17.0 Python/3.11"
	issue["awsRegion"] = "eu-west-1"
	issue["userIdentity"].(evidenceObject)["sessionContext"] = evidenceObject{"attributes": evidenceObject{"mfaAuthenticated": "true"}}
	use["sourceIPAddress"] = "203.0.113.9"
	use["userAgent"] = "downstream-client"
	s := evidenceStore(t, issue, use)
	graph, err := s.LineageGraph(evidenceSeq(t, s, "use"))
	if err != nil || len(graph.Edges) != 1 {
		t.Fatalf("graph: %+v %v", graph, err)
	}
	raw, _ := json.Marshal(graph.Edges[0])
	var edge map[string]any
	json.Unmarshal(raw, &edge)
	for k, v := range map[string]string{"viaIP": "198.51.100.24", "viaUserAgent": "aws-cli/2.17.0 Python/3.11", "viaRegion": "eu-west-1", "viaEventId": "issue", "viaMfa": "true"} {
		if edge[k] != v {
			t.Errorf("initiator %s = %v; want %s", k, edge[k], v)
		}
	}
}

func TestHistoricalLineageOverlayPreservesDataset(t *testing.T) {
	s := evidenceStore(t, using())
	seq := evidenceSeq(t, s, "use")
	snapshot, err := s.SnapshotContext(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	input, err := s.LineageContext(seq, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	issue, _ := json.Marshal(issuing())
	overlay, err := s.HistoricalLineage(seq, snapshot, []string{string(issue)})
	if err != nil {
		t.Fatal(err)
	}
	if len(overlay.Graph.Edges) != 1 || overlay.Graph.RootID != "AKIAALICE" {
		t.Fatalf("missing recovered ancestry: %+v", overlay.Graph)
	}
	if overlay.Graph.Snapshot.Generation != snapshot.Generation {
		t.Fatal("overlay changed snapshot")
	}
	edge := overlay.Graph.Edges[0]
	if edge.ViaSeq >= 0 || overlay.Raw[edge.ViaSeq] != string(issue) {
		t.Fatal("recovered raw record not bound to overlay")
	}
	after, _ := s.SnapshotContext(context.Background())
	if after.MaxSeq != snapshot.MaxSeq || after.Generation != snapshot.Generation {
		t.Fatal("lookup mutated primary dataset")
	}
	if input.Seed == "" || len(input.Records) != 0 {
		t.Fatalf("wrong local input: %+v", input)
	}
	// Conflicting observations must not create a convenient, false ancestry.
	other := issuing()
	other["eventID"] = "second-issuance"
	second, _ := json.Marshal(other)
	conflicted, err := s.HistoricalLineage(seq, snapshot, []string{string(issue), string(second)})
	if err != nil || len(conflicted.Graph.Edges) != 0 {
		t.Fatalf("ambiguous history linked: %+v %v", conflicted, err)
	}
	if _, err = s.HistoricalLineage(seq, Snapshot{Generation: "wrong", MaxSeq: seq}, nil); err == nil {
		t.Fatal("accepted stale snapshot")
	}
}
