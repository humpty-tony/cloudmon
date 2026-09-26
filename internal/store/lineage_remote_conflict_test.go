package store

import (
	"context"
	"encoding/json"
	"testing"
)

func TestHistoricalLineageIncludesLocalConflictsForRemoteParents(t *testing.T) {
	for _, variant := range []bool{false, true} {
		t.Run(map[bool]string{false: "distinct-issuance", true: "source-variant"}[variant], func(t *testing.T) {
			child := issuing()
			identity := using()["userIdentity"].(evidenceObject)
			identity["accessKeyId"] = "ASIAPARENT"
			child["userIdentity"] = identity
			parent := issuing()
			parent["eventID"] = "remote-parent"
			parent["eventTime"] = "2026-08-31T23:59:00Z"
			parent["responseElements"].(evidenceObject)["credentials"].(evidenceObject)["accessKeyId"] = "ASIAPARENT"
			conflict := issuing()
			conflict["eventID"] = "local-conflict"
			if variant {
				conflict["eventID"] = "remote-parent"
			}
			conflict["eventTime"] = parent["eventTime"]
			conflict["responseElements"].(evidenceObject)["credentials"].(evidenceObject)["accessKeyId"] = "ASIAPARENT"
			conflict["userIdentity"] = evidenceObject{"type": "IAMUser", "accessKeyId": "AKIABOB", "arn": "arn:aws:iam::111:user/bob", "userName": "bob", "accountId": "111", "principalId": "AIDABOB"}
			s := evidenceStore(t, using(), conflict)
			seq := evidenceSeq(t, s, "use")
			snapshot, err := s.SnapshotContext(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			childRaw, _ := json.Marshal(child)
			parentRaw, _ := json.Marshal(parent)
			got, err := s.HistoricalLineage(seq, snapshot, []string{string(childRaw), string(parentRaw)})
			if err != nil {
				t.Fatal(err)
			}
			if len(got.Graph.Edges) != 1 || got.Graph.RootID != "ASIAPARENT" {
				t.Fatalf("remote ancestry bypassed conflicting loaded evidence: %+v", got.Graph)
			}
			if got.Graph.Edges[0].Parent != "ASIAPARENT" || got.Graph.Edges[0].Child != "ASIACHILD" {
				t.Fatalf("valid observed child link was lost: %+v", got.Graph.Edges)
			}
		})
	}
}
