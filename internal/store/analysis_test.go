package store

import (
	"cloudmon/internal/model"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestAnalysisWindowsUnknownFieldsAndExactEntities(t *testing.T) {
	a := contextEvent("latest", 59)
	a["eventTime"] = "2026-09-01T02:00:00Z"
	a["readOnly"] = false
	b := contextEvent("boundary", 0)
	b["eventTime"] = "2026-09-01T01:00:00.001Z"
	b["errorMessage"] = "denied"
	b["readOnly"] = true
	c := contextEvent("previous", 0)
	c["eventTime"] = "2026-09-01T01:00:00Z"
	d := contextEvent("offset", 0)
	d["eventTime"] = "2026-09-01T02:00:00+01:00"
	d["userIdentity"].(evidenceObject)["arn"] = "ARN:aws:sts::111:assumed-role/Reader/one"
	e := contextEvent("invalid-time", 0)
	e["eventTime"] = ""
	e["userIdentity"] = evidenceObject{}
	s := evidenceStore(t, a, b, c, d, e)
	o := AnalysisOptions{Dimension: "identityArn", Compare: true, WindowHours: 1}
	r, err := s.Analyze(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	if r.Current.Events != 2 || r.Previous.Events != 2 || r.Current.Writes != 1 || r.Current.Errors != 1 || r.Scope.UnknownReadOnly != 3 || r.Scope.InvalidTimes != 1 {
		t.Fatalf("window/optional fields: %+v", r)
	}
	if r.ToMs-r.FromMs != 3_600_000 || r.FromMs-r.PreviousFromMs != 3_600_000 || r.TotalGroups != 2 {
		t.Fatalf("windows/groups: %+v", r)
	}
	o.Entity = &AnalysisEntity{Dimension: "identityArn", Value: "arn:aws:sts::111:assumed-role/Reader/one"}
	o.Snapshot = &r.Snapshot
	entity, err := s.Analyze(context.Background(), o)
	if err != nil || entity.Previous.Events != 1 || len(entity.Events) != 2 || len(entity.Breakdowns) != 3 {
		t.Fatalf("entity conflated/case insensitive: %+v %v", entity, err)
	}
	o.Compare = false
	o.Entity = &AnalysisEntity{Dimension: "identityArn", Value: ""}
	empty, err := s.Analyze(context.Background(), o)
	if err != nil || empty.Current.Events != 1 || empty.Current.Writes != 0 || empty.Current.InvalidTimes != 1 {
		t.Fatalf("empty identity bucket: %+v %v", empty, err)
	}
}

func TestAnalysisSnapshotCapsScopeAndCancellation(t *testing.T) {
	records := []evidenceObject{}
	for i := 0; i < 70; i++ {
		e := contextEvent(fmt.Sprintf("id-%d", i), 10)
		e["eventName"] = fmt.Sprintf("Operation%d", i)
		records = append(records, e)
	}
	s := evidenceStore(t, records...)
	o := AnalysisOptions{Dimension: "eventName", WindowHours: 24}
	r, err := s.Analyze(context.Background(), o)
	if err != nil || r.TotalGroups != 70 || len(r.Groups) != 50 || r.Current.Events != 70 {
		t.Fatalf("counts/cap: %+v %v", r, err)
	}
	data, _ := json.Marshal(contextEvent("late", 20))
	if _, err = s.AppendEvents([]model.CloudTrailEvent{liveEvent(t, string(data))}); err != nil {
		t.Fatal(err)
	}
	o.Snapshot = &r.Snapshot
	stable, err := s.Analyze(context.Background(), o)
	if err != nil || stable.Current.Events != 70 {
		t.Fatalf("snapshot: %+v %v", stable, err)
	}
	o.Filter = Filter{Includes: map[string][]string{"eventName": {"Operation1"}}}
	scoped, err := s.Analyze(context.Background(), o)
	if err != nil || scoped.Current.Events != 1 {
		t.Fatalf("scope not applied: %+v %v", scoped, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = s.Analyze(ctx, o); err == nil {
		t.Fatal("cancelled query ran")
	}
	o.Dimension = "raw; DROP TABLE events"
	if _, err = s.Analyze(context.Background(), o); err == nil {
		t.Fatal("invalid dimension accepted")
	}
	o.Dimension = "eventName"
	if _, err = s.IngestReader(strings.NewReader(`{"eventID":"replacement","eventName":"New"}`), "replacement"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Analyze(context.Background(), o); err == nil {
		t.Fatal("dataset replacement accepted")
	}
	o.Snapshot = nil
	o.Filter = Filter{}
	o.Compare = true
	noTime, err := s.Analyze(context.Background(), o)
	if err != nil || noTime.HasWindow || noTime.Current.Events != 0 || noTime.Scope.InvalidTimes != 1 {
		t.Fatalf("no timestamps: %+v %v", noTime, err)
	}
}
