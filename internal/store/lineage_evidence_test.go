package store

import (
	"cloudmon/internal/model"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

type evidenceObject map[string]any

func issuing() evidenceObject {
	return evidenceObject{
		"eventID": "issue", "eventName": "AssumeRole", "eventSource": "sts.amazonaws.com", "eventTime": "2026-09-01T00:00:00Z",
		"userIdentity":      evidenceObject{"type": "IAMUser", "arn": "arn:aws:iam::111:user/alice", "userName": "alice", "accessKeyId": "AKIAALICE", "accountId": "111", "principalId": "AIDAALICE"},
		"requestParameters": evidenceObject{"roleArn": "arn:aws:iam::111:role/team/Reader"},
		"responseElements":  evidenceObject{"credentials": evidenceObject{"accessKeyId": "ASIACHILD", "expiration": "Sep 1, 2026, 1:00:00 AM"}, "assumedRoleUser": evidenceObject{"arn": "arn:aws:sts::111:assumed-role/Reader/session"}},
	}
}
func using() evidenceObject {
	return evidenceObject{
		"eventID": "use", "eventName": "GetObject", "eventSource": "s3.amazonaws.com", "eventTime": "2026-09-01T00:10:00Z",
		"userIdentity": evidenceObject{"type": "AssumedRole", "accessKeyId": "ASIACHILD", "arn": "arn:aws:sts::111:assumed-role/Reader/session", "accountId": "111", "sessionContext": evidenceObject{"sessionIssuer": evidenceObject{"arn": "arn:aws:iam::111:role/team/Reader"}}},
	}
}
func evidenceStore(t *testing.T, records ...evidenceObject) *Store {
	t.Helper()
	s := openTestStore(t, filepath.Join(t.TempDir(), "evidence.duckdb"))
	data, err := json.Marshal(evidenceObject{"Records": records})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.IngestReader(strings.NewReader(string(data)), "fixture"); err != nil {
		t.Fatal(err)
	}
	return s
}
func evidenceSeq(t *testing.T, s *Store, id string) int64 {
	t.Helper()
	var rows []struct{ Seq int64 }
	if err := s.queryJSON("SELECT seq FROM events WHERE eventID="+sqlStr(id), &rows); err != nil || len(rows) != 1 {
		t.Fatalf("event %s: %v", id, err)
	}
	return rows[0].Seq
}
func TestCredentialEvidenceRejectsFalseLinks(t *testing.T) {
	cases := []struct {
		name, status string
		mutate       func(evidenceObject, evidenceObject)
	}{
		{"wrong-service", "missing", func(a, b evidenceObject) { a["eventSource"] = "example.amazonaws.com" }},
		{"wrong-operation", "missing", func(a, b evidenceObject) { a["eventName"] = "GetCallerIdentity" }},
		{"failed", "missing", func(a, b evidenceObject) { a["errorCode"] = "AccessDenied" }},
		{"after-use", "conflict", func(a, b evidenceObject) { a["eventTime"] = "2026-09-01T00:20:00Z" }},
		{"expired", "conflict", func(a, b evidenceObject) { b["eventTime"] = "2026-09-01T01:00:00Z" }},
		{"invalid-expiration", "conflict", func(a, b evidenceObject) {
			a["responseElements"].(evidenceObject)["credentials"].(evidenceObject)["expiration"] = "not a date"
		}},
		{"wrong-role", "conflict", func(a, b evidenceObject) {
			a["requestParameters"].(evidenceObject)["roleArn"] = "arn:aws:iam::111:role/Other"
		}},
		{"missing-key", "missing-key", func(a, b evidenceObject) { delete(b["userIdentity"].(evidenceObject), "accessKeyId") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a, b := issuing(), using()
			tc.mutate(a, b)
			s := evidenceStore(t, a, b)
			lin, err := s.Lineage(evidenceSeq(t, s, "use"))
			if err != nil || lin.Complete || len(lin.Nodes) != 0 || lin.Status != tc.status {
				t.Fatalf("%+v %v", lin, err)
			}
		})
	}
}
func TestCredentialEvidenceAmbiguityAndSharedObservations(t *testing.T) {
	for _, mode := range []string{"distinct", "shared", "conflicting-shared", "source-variants"} {
		t.Run(mode, func(t *testing.T) {
			a, b, u := issuing(), issuing(), using()
			b["eventID"] = "issue-b"
			if mode == "shared" || mode == "conflicting-shared" {
				a["sharedEventID"] = "same-action"
				b["sharedEventID"] = "same-action"
				b["userIdentity"] = evidenceObject{"type": "AWSAccount", "accountId": "111", "principalId": "AIDAALICE"}
			}
			if mode == "conflicting-shared" {
				b["userIdentity"].(evidenceObject)["accountId"] = "222"
			}
			if mode == "source-variants" {
				b["eventID"] = "issue"
				b["userIdentity"].(evidenceObject)["userName"] = "changed"
			}
			s := evidenceStore(t, a, b, u)
			lin, err := s.Lineage(evidenceSeq(t, s, "use"))
			if err != nil {
				t.Fatal(err)
			}
			if mode != "shared" {
				if lin.Status != "ambiguous" || len(lin.Nodes) != 0 {
					t.Fatalf("false chain: %+v", lin)
				}
				return
			}
			if !lin.Complete || len(lin.Nodes) != 1 || lin.Nodes[0].UserName != "alice" || len(lin.Nodes[0].EvidenceSeqs) != 2 {
				t.Fatalf("shared observation not collapsed: %+v", lin)
			}
			graph, err := s.LineageGraph(evidenceSeq(t, s, "use"))
			if err != nil || len(graph.Edges) != 1 {
				t.Fatalf("duplicate graph edge: %+v %v", graph, err)
			}
		})
	}
}
func TestCredentialEvidenceTemporaryUserRootAndFederation(t *testing.T) {
	for _, api := range []string{"GetSessionToken", "GetFederationToken", "AssumeRoot", "AssumeRoleWithSAML", "AssumeRoleWithWebIdentity"} {
		t.Run(api, func(t *testing.T) {
			a, u := issuing(), using()
			a["eventName"] = api
			delete(a, "requestParameters")
			response := a["responseElements"].(evidenceObject)
			delete(response, "assumedRoleUser")
			ui := u["userIdentity"].(evidenceObject)
			delete(ui, "sessionContext")
			switch api {
			case "GetSessionToken":
				ui["type"] = "IAMUser"
				ui["arn"] = "arn:aws:iam::111:user/alice"
			case "GetFederationToken":
				ui["type"] = "FederatedUser"
				ui["arn"] = "arn:aws:sts::111:federated-user/alice"
				response["federatedUser"] = evidenceObject{"arn": ui["arn"]}
			case "AssumeRoot":
				ui["type"] = "Root"
				ui["arn"] = "arn:aws:iam::222:root"
				ui["accountId"] = "222"
				a["requestParameters"] = evidenceObject{"targetPrincipal": "222"}
			case "AssumeRoleWithSAML":
				a["userIdentity"] = evidenceObject{"type": "SAMLUser", "principalId": "provider:alice", "userName": "alice"}
			case "AssumeRoleWithWebIdentity":
				a["userIdentity"] = evidenceObject{"type": "WebIdentityUser", "principalId": "provider:alice", "userName": "alice"}
			}
			s := evidenceStore(t, a, u)
			lin, err := s.Lineage(evidenceSeq(t, s, "use"))
			if err != nil || !lin.Applicable || !lin.Complete || len(lin.Nodes) != 1 || lin.Nodes[0].ViaEvent != api {
				t.Fatalf("%+v %v", lin, err)
			}
		})
	}
}
func TestCredentialEvidenceCyclesAndLateArrival(t *testing.T) {
	a, u := issuing(), using()
	a["userIdentity"].(evidenceObject)["accessKeyId"] = "ASIACHILD"
	s := evidenceStore(t, a, u)
	lin, err := s.Lineage(evidenceSeq(t, s, "use"))
	if err != nil || lin.Status != "cycle" || len(lin.Nodes) != 0 {
		t.Fatalf("cycle: %+v %v", lin, err)
	}
	s = evidenceStore(t, using())
	data, _ := json.Marshal(issuing())
	if _, err = s.AppendEvents([]model.CloudTrailEvent{liveEvent(t, string(data))}); err != nil {
		t.Fatal(err)
	}
	lin, err = s.Lineage(evidenceSeq(t, s, "use"))
	if err != nil || !lin.Complete {
		t.Fatalf("sequence order used as time: %+v %v", lin, err)
	}
}
func TestCredentialGraphPreservesARNsAndSnapshot(t *testing.T) {
	a, u := issuing(), using()
	a["requestParameters"].(evidenceObject)["roleArn"] = "arn:aws-us-gov:iam::111:role/team/Reader"
	a["responseElements"].(evidenceObject)["assumedRoleUser"].(evidenceObject)["arn"] = "arn:aws-us-gov:sts::111:assumed-role/Reader/session"
	// No activity under the issued key: all identity details must come from the response.
	s := evidenceStore(t, a)
	kids, err := s.LineageChildren("AKIAALICE")
	if err != nil || len(kids.Nodes) != 1 || kids.Nodes[0].RoleArn != "arn:aws-us-gov:iam::111:role/team/Reader" {
		t.Fatalf("ARN changed: %+v %v", kids, err)
	}
	delete(a, "requestParameters")
	s = evidenceStore(t, a)
	kids, err = s.LineageChildren("AKIAALICE")
	if err != nil || kids.Nodes[0].RoleArn != "" {
		t.Fatalf("ARN fabricated: %+v %v", kids, err)
	}
	s = evidenceStore(t, issuing(), u)
	g, err := s.LineageGraph(evidenceSeq(t, s, "use"))
	if err != nil {
		t.Fatal(err)
	}
	late := using()
	late["eventID"] = "late"
	data, _ := json.Marshal(late)
	if _, err = s.AppendEvents([]model.CloudTrailEvent{liveEvent(t, string(data))}); err != nil {
		t.Fatal(err)
	}
	events, err := s.LineageEvents("ASIACHILD", *g.Snapshot)
	if err != nil || len(events.Nodes) != 1 {
		t.Fatalf("expansion escaped snapshot: %+v %v", events, err)
	}
	if _, err = s.IngestReader(strings.NewReader(`{"eventID":"new","eventName":"Replacement"}`), "replacement"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.LineageChildren("ASIACHILD", *g.Snapshot); err == nil {
		t.Fatal("stale graph expanded")
	}
	if _, err = s.LineageRaw(1, *g.Snapshot); err == nil {
		t.Fatal("stale graph opened unrelated raw")
	}
}
func TestCredentialDepthLimitIsExplicit(t *testing.T) {
	records := []evidenceObject{}
	for i := 0; i < 14; i++ {
		a := issuing()
		a["eventID"] = fmt.Sprint(i)
		a["eventTime"] = fmt.Sprintf("2026-09-01T00:%02d:00Z", i)
		a["userIdentity"] = evidenceObject{"type": "AssumedRole", "accessKeyId": fmt.Sprintf("ASIA%d", i)}
		a["responseElements"] = evidenceObject{"credentials": evidenceObject{"accessKeyId": fmt.Sprintf("ASIA%d", i+1)}}
		delete(a, "requestParameters")
		records = append(records, a)
	}
	u := using()
	u["eventTime"] = "2026-09-01T00:30:00Z"
	u["userIdentity"].(evidenceObject)["accessKeyId"] = "ASIA14"
	records = append(records, u)
	s := evidenceStore(t, records...)
	lin, err := s.Lineage(evidenceSeq(t, s, "use"))
	if err != nil || lin.Status != "depth-limit" || len(lin.Nodes) != 12 {
		t.Fatalf("%+v %v", lin, err)
	}
}
