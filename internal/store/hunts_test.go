package store

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestHuntIndicatorsNetworkAndExplicitARNs(t *testing.T) {
	a := contextEvent("a", 0)
	a["sourceIPAddress"] = "2001:0db8:0:0:0:0:0:1"
	a["resources"] = []any{evidenceObject{"ARN": "arn:aws:s3:::other"}, evidenceObject{"ARN": "arn:aws:s3:::evidence/key"}}
	b := contextEvent("b", 1)
	b["sourceIPAddress"] = "192.0.2.5"
	b["requestParameters"] = evidenceObject{"roleArn": "arn:aws:iam::111:role/Target"}
	c := contextEvent("c", 2)
	c["sourceIPAddress"] = "999.0.2.5"
	c["resources"] = evidenceObject{"ARN": "arn:aws:s3:::evidence/key"}
	d := contextEvent("d", 3)
	d["sourceIPAddress"] = "192.0.2.5.9"
	e := contextEvent("e", 4)
	e["sourceIPAddress"] = "AWS Internal"
	s := evidenceStore(t, a, b, c, d, e)
	o := HuntOptions{Mode: "indicators", Indicators: []Indicator{{"ip", "2001:db8::1"}, {"cidr", "0.0.0.0/0"}, {"arn", "arn:aws:s3:::evidence/key"}, {"arn", "arn:aws:iam::111:role/Target"}, {"event", "absent"}, {"ip", "2001:0db8::1"}}}
	r, err := s.Hunt(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	if r.Total != 2 || len(r.Indicators) != 5 {
		t.Fatalf("counts/dedup: %+v", r)
	}
	for i, expected := range []int{1, 1, 1, 1, 0} {
		if r.Indicators[i].Matches != expected {
			t.Fatalf("indicator %d: %+v", i, r.Indicators)
		}
	}
	o.Indicators = []Indicator{{"cidr", "2001:db8::/32"}, {"key", "ASIAONE"}}
	r, err = s.Hunt(context.Background(), o)
	if err != nil || r.Total != 5 || r.Indicators[0].Matches != 1 {
		t.Fatalf("IPv6/key: %+v %v", r, err)
	}
	for _, bad := range []Indicator{{"cidr", "bad/0"}, {"ip", "192.0.2.5.9"}, {"ip", "fe80::1%en0"}, {"arn", "evidence/key"}, {"key", ""}, {"raw", "*"}} {
		o.Indicators = []Indicator{{"event", "a"}, bad}
		if _, err = s.Hunt(context.Background(), o); err == nil {
			t.Fatalf("invalid input widened query: %+v", bad)
		}
	}
}
func TestHuntSequenceUsesTimeAndClosestEligibleIdentity(t *testing.T) {
	makeEvent := func(id, name string, minute int, arn, key string) evidenceObject {
		e := contextEvent(id, minute)
		e["eventName"] = name
		e["userIdentity"].(evidenceObject)["arn"] = arn
		e["userIdentity"].(evidenceObject)["accessKeyId"] = key
		return e
	}
	arn := "arn:aws:sts::111:assumed-role/Reader/one"
	s := evidenceStore(t,
		makeEvent("b", "Second", 10, arn, "ONE"), // arrives before A; time determines ordering
		makeEvent("old", "First", 1, arn, "ONE"),
		makeEvent("a1", "First", 9, arn, "ONE"), makeEvent("a2", "First", 9, arn, "ONE"),
		makeEvent("same-time", "First", 10, arn, "ONE"),
		makeEvent("wrong-key", "First", 9, arn, "TWO"),
		makeEvent("wrong-arn", "First", 9, "arn:aws:sts::222:assumed-role/Reader/one", "ONE"),
		makeEvent("missing-identity", "Second", 10, "", "ONE"),
		makeEvent("too-late", "Second", 30, arn, "ONE"))
	o := HuntOptions{Mode: "sequence", Group: "credential", Minutes: 5, First: &Expr{T: "cmp", Field: "eventName", Op: "eq", Value: "First"}, Second: &Expr{T: "cmp", Field: "eventName", Op: "eq", Value: "Second"}}
	r, err := s.Hunt(context.Background(), o)
	if err != nil || r.Total != 1 || r.Pairs[0].First.EventID != "a2" || r.Pairs[0].Second.EventID != "b" || r.Pairs[0].TiedFirst != 2 || r.Pairs[0].DeltaMs != 60_000 {
		t.Fatalf("incorrect pair: %+v %v", r, err)
	}
	o.Group = "principal"
	r, err = s.Hunt(context.Background(), o)
	if err != nil || r.Pairs[0].TiedFirst != 3 {
		t.Fatalf("principal group: %+v %v", r, err)
	}
	o.First = nil
	if _, err = s.Hunt(context.Background(), o); err == nil {
		t.Fatal("empty step accepted")
	}
}
func TestHuntCapsSnapshotAndCancellation(t *testing.T) {
	records := []evidenceObject{}
	for i := 0; i < 505; i++ {
		e := contextEvent(fmt.Sprintf("row-%d", i), 10)
		e["sourceIPAddress"] = "192.0.2.1"
		records = append(records, e)
	}
	s := evidenceStore(t, records...)
	o := HuntOptions{Mode: "indicators", Indicators: []Indicator{{"ip", "192.0.2.1"}}}
	r, err := s.Hunt(context.Background(), o)
	if err != nil || r.Total != 505 || len(r.Matches) != 500 || r.Indicators[0].Matches != 505 {
		t.Fatalf("cap/count: %+v %v", r, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = s.Hunt(ctx, o); err == nil {
		t.Fatal("cancelled hunt ran")
	}
	o.Snapshot = &r.Snapshot
	if _, err = s.IngestReader(strings.NewReader(`{"eventID":"replacement","eventName":"New"}`), "replacement"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Hunt(context.Background(), o); err == nil {
		t.Fatal("dataset replacement reused snapshot")
	}
}
