package store

import (
	"cloudmon/internal/model"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func contextEvent(id string, minute int) evidenceObject {
	return evidenceObject{"eventID": id, "eventName": "GetObject", "eventSource": "s3.amazonaws.com", "eventTime": fmt.Sprintf("2026-09-01T00:%02d:00Z", minute), "awsRegion": "us-east-1", "recipientAccountId": "111", "userIdentity": evidenceObject{"type": "AssumedRole", "accessKeyId": "ASIAONE", "arn": "arn:aws:sts::111:assumed-role/Reader/one"}}
}
func correlationKinds(result Investigation, id string) map[string]bool {
	kinds := map[string]bool{}
	for _, event := range result.Events {
		if event.Event.EventID == id {
			for _, r := range event.Reasons {
				kinds[r.Kind] = true
			}
		}
	}
	return kinds
}
func TestInvestigationRelationsUseExplicitIdentifiers(t *testing.T) {
	anchor := contextEvent("anchor", 10)
	anchor["sourceIPAddress"] = "192.0.2.1"
	anchor["sharedEventID"] = "shared-action"
	anchor["requestID"] = "request-one"
	anchor["resources"] = []any{evidenceObject{"ARN": "arn:aws:s3:::first-bucket"}, evidenceObject{"ARN": "arn:aws:s3:::important-bucket/key", "type": "AWS::S3::Object"}}
	resource := contextEvent("resource", 11)
	resource["userIdentity"] = evidenceObject{}
	resource["resources"] = []any{evidenceObject{"ARN": "arn:aws:s3:::important-bucket/key"}}
	reference := contextEvent("reference", 9)
	reference["userIdentity"] = evidenceObject{}
	reference["requestParameters"] = evidenceObject{"resourceArn": "arn:aws:s3:::important-bucket/key"}
	shared := contextEvent("shared", 12)
	shared["sharedEventID"] = "shared-action"
	shared["recipientAccountId"] = "222"
	shared["userIdentity"] = evidenceObject{}
	request := contextEvent("request", 10)
	request["requestID"] = "request-one"
	request["userIdentity"] = evidenceObject{}
	otherScope := contextEvent("other-scope", 10)
	otherScope["requestID"] = "request-one"
	otherScope["recipientAccountId"] = "222"
	otherScope["userIdentity"] = evidenceObject{}
	ip := contextEvent("ip", 10)
	ip["sourceIPAddress"] = "192.0.2.1"
	ip["userIdentity"] = evidenceObject{}
	credential := contextEvent("credential", 10)
	otherIdentity := contextEvent("other-identity", 10)
	otherIdentity["userIdentity"].(evidenceObject)["arn"] = "arn:aws:sts::222:assumed-role/Reader/one"
	names := contextEvent("names", 10)
	names["userIdentity"] = evidenceObject{}
	names["requestParameters"] = evidenceObject{"name": "important-bucket/key"}
	s := evidenceStore(t, anchor, resource, reference, shared, request, otherScope, ip, credential, otherIdentity, names)
	out, err := s.Investigate(context.Background(), InvestigationOptions{Seq: evidenceSeq(t, s, "anchor"), EventID: "anchor", Minutes: 5, Relation: "related"})
	if err != nil {
		t.Fatal(err)
	}
	for id, kind := range map[string]string{"resource": "resource", "reference": "resource", "shared": "shared", "request": "request", "ip": "ip", "credential": "credential"} {
		if !correlationKinds(out, id)[kind] {
			t.Errorf("%s missing %s: %+v", id, kind, out.Events)
		}
	}
	for _, id := range []string{"other-scope", "other-identity", "names"} {
		if len(correlationKinds(out, id)) != 0 {
			t.Errorf("false link to %s", id)
		}
	}
	if len(out.Resources) != 2 {
		t.Fatalf("lost a resource: %+v", out.Resources)
	}
}
func TestInvestigationNoEmptyOrGenericLinksAndStableSnapshot(t *testing.T) {
	a, b := contextEvent("anchor", 10), contextEvent("other", 11)
	a["userIdentity"] = evidenceObject{}
	b["userIdentity"] = evidenceObject{}
	a["sourceIPAddress"] = "AWS Internal"
	b["sourceIPAddress"] = "AWS Internal"
	a["requestParameters"] = evidenceObject{"name": "prod"}
	b["requestParameters"] = evidenceObject{"name": "prod"}
	b["resources"] = evidenceObject{"unexpected": "shape"}
	s := evidenceStore(t, a, b)
	opts := InvestigationOptions{Seq: evidenceSeq(t, s, "anchor"), EventID: "anchor", Relation: "related"}
	out, err := s.Investigate(context.Background(), opts)
	if err != nil || out.Total != 1 || len(out.Resources) != 0 {
		t.Fatalf("false empty/name links: %+v %v", out, err)
	}
	late := contextEvent("late", 12)
	data, _ := json.Marshal(late)
	if _, err = s.AppendEvents([]model.CloudTrailEvent{liveEvent(t, string(data))}); err != nil {
		t.Fatal(err)
	}
	opts.Relation = "all"
	opts.Snapshot = &out.Snapshot
	stable, err := s.Investigate(context.Background(), opts)
	if err != nil || stable.Total != 2 {
		t.Fatalf("snapshot changed: %+v %v", stable, err)
	}
	opts.EventID = "wrong"
	if _, err = s.Investigate(context.Background(), opts); err == nil {
		t.Fatal("sequence reused for wrong event")
	}
	opts.EventID = "anchor"
	if _, err = s.IngestReader(strings.NewReader(`{"eventID":"new","eventName":"Replacement"}`), "replacement"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Investigate(context.Background(), opts); err == nil {
		t.Fatal("replaced dataset accepted")
	}
}
func TestInvestigationCapAndCancellation(t *testing.T) {
	records := []evidenceObject{contextEvent("anchor", 10)}
	for i := 0; i < 600; i++ {
		records = append(records, contextEvent(fmt.Sprintf("context-%03d", i), 11))
	}
	s := evidenceStore(t, records...)
	opts := InvestigationOptions{Seq: evidenceSeq(t, s, "anchor"), EventID: "anchor"}
	out, err := s.Investigate(context.Background(), opts)
	if err != nil || out.Total != 601 || len(out.Events) != 500 || !correlationKinds(out, "anchor")["anchor"] {
		t.Fatalf("cap/count/anchor: %d/%d %v", out.Total, len(out.Events), err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = s.Investigate(ctx, opts); err == nil {
		t.Fatal("cancelled investigation executed")
	}
	opts.Minutes = 61
	if _, err = s.Investigate(context.Background(), opts); err == nil {
		t.Fatal("unbounded window accepted")
	}
}
