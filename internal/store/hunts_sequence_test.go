package store

import (
	"cloudmon/internal/model"
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func huntStep(name string) *Expr {
	return &Expr{T: "cmp", Field: "eventName", Op: "eq", Value: name}
}

func orderedOptions(names ...string) HuntOptions {
	o := HuntOptions{Mode: "sequence", Group: "credential", Minutes: 5}
	for _, name := range names {
		o.Steps = append(o.Steps, huntStep(name))
	}
	return o
}

func huntEvent(id, name string, ms int64) evidenceObject {
	e := contextEvent(id, 0)
	e["eventName"] = name
	e["eventTime"] = time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(ms) * time.Millisecond).Format(time.RFC3339Nano)
	return e
}

func sequenceIDs(match SequenceMatch) []string {
	ids := make([]string, len(match.Events))
	for i, event := range match.Events {
		ids[i] = event.EventID
	}
	return ids
}

func highestHuntSequenceID(t *testing.T, s *Store, ids ...string) string {
	t.Helper()
	var highest int64
	var chosen string
	for _, id := range ids {
		if seq := evidenceSeq(t, s, id); seq > highest {
			highest, chosen = seq, id
		}
	}
	return chosen
}

func TestHuntFiveStepsTiesTerminalRecordsAndLegacy(t *testing.T) {
	s := evidenceStore(t,
		huntEvent("terminal-first", "E", 300_000), // Delivery order does not establish step order.
		huntEvent("old-a", "A", 0), huntEvent("a1", "A", 60_000), huntEvent("a2", "A", 60_000),
		huntEvent("b1", "B", 120_000), huntEvent("b2", "B", 120_000),
		huntEvent("c", "C", 180_000), huntEvent("d", "D", 240_000),
		huntEvent("terminal-last", "E", 300_000), huntEvent("too-late", "E", 300_001))
	o := orderedOptions("A", "B", "C", "D", "E")
	o.Minutes = 4 // Exactly four minutes from the chosen A to either eligible E.
	r, err := s.Hunt(context.Background(), o)
	if err != nil || r.Total != 2 || len(r.Sequences) != 2 || len(r.Pairs) != 0 {
		t.Fatalf("five-step results: %+v %v", r, err)
	}
	terminals := []string{"terminal-last", "terminal-first"}
	if highestHuntSequenceID(t, s, terminals...) != terminals[0] {
		terminals[0], terminals[1] = terminals[1], terminals[0]
	}
	for i, terminal := range terminals {
		match := r.Sequences[i]
		if !reflect.DeepEqual(sequenceIDs(match), []string{highestHuntSequenceID(t, s, "a1", "a2"), highestHuntSequenceID(t, s, "b1", "b2"), "c", "d", terminal}) || match.DeltaMs != 240_000 || !reflect.DeepEqual(match.TiedCandidates, []int{2, 2, 1, 1, 1}) {
			t.Fatalf("wrong representative, tie count or total span: %+v", match)
		}
		for _, event := range match.Events {
			if event.RawJSON != "" {
				t.Fatal("sequence response included unrequested raw evidence")
			}
		}
	}
	o.Steps = o.Steps[:2]
	modern, err := s.Hunt(context.Background(), o)
	if err != nil || modern.Total != 2 || len(modern.Pairs) != 2 {
		t.Fatalf("two-step compatibility output: %+v %v", modern, err)
	}
	o.First, o.Second, o.Steps = o.Steps[0], o.Steps[1], nil
	legacy, err := s.Hunt(context.Background(), o)
	if err != nil || !reflect.DeepEqual(legacy.Pairs, modern.Pairs) || !reflect.DeepEqual(legacy.Sequences, modern.Sequences) {
		t.Fatalf("legacy matching changed: %+v %v", legacy, err)
	}
}

func TestHuntSequenceTotalWindowAndOverlappingSteps(t *testing.T) {
	s := evidenceStore(t, huntEvent("a", "A", 0), huntEvent("b", "B", 240_000), huntEvent("c", "C", 480_000))
	o := orderedOptions("A", "B", "C")
	r, err := s.Hunt(context.Background(), o)
	if err != nil || r.Total != 0 {
		t.Fatalf("per-gap windows admitted an eight-minute sequence into five minutes: %+v %v", r, err)
	}
	o.Minutes = 8
	r, err = s.Hunt(context.Background(), o)
	if err != nil || r.Total != 1 || r.Sequences[0].DeltaMs != 480_000 {
		t.Fatalf("inclusive total boundary rejected: %+v %v", r, err)
	}
	// The same predicate can fill several steps, but a record (or equal-time
	// candidate) cannot be reused to manufacture an order at millisecond precision.
	fractional := huntEvent("fractional", "Repeated", 0)
	fractional["eventTime"] = "2026-09-01T00:00:00.0005Z"
	s = evidenceStore(t, huntEvent("a1", "Repeated", 0), huntEvent("a2", "Repeated", 0), fractional,
		huntEvent("b", "Repeated", 1), huntEvent("c1", "Repeated", 2), huntEvent("c2", "Repeated", 2))
	o = orderedOptions("Repeated", "Repeated", "Repeated")
	r, err = s.Hunt(context.Background(), o)
	if err != nil || r.Total != 2 || !reflect.DeepEqual(sequenceIDs(r.Sequences[0]), []string{highestHuntSequenceID(t, s, "a1", "a2", "fractional"), "b", highestHuntSequenceID(t, s, "c1", "c2")}) || !reflect.DeepEqual(r.Sequences[0].TiedCandidates, []int{3, 1, 1}) || r.Sequences[0].DeltaMs != 2 {
		t.Fatalf("overlapping expressions or equal timestamps fabricated ordering: %+v %v", r, err)
	}
}

func TestHuntSequenceIdentityScopeAndIncompletePrefixes(t *testing.T) {
	records := []evidenceObject{huntEvent("a", "A", 0), huntEvent("b", "B", 60_000), huntEvent("c", "C", 120_000)}
	for _, item := range []struct{ id, arn, key string }{
		{"missing-principal", "", "ASIAONE"},
		{"missing-key", "arn:aws:sts::111:assumed-role/Reader/one", ""},
		{"missing-both", "", ""},
		{"wrong-key", "arn:aws:sts::111:assumed-role/Reader/one", "ASIAOTHER"},
		{"wrong-case", "arn:aws:sts::111:assumed-role/reader/one", "ASIAONE"},
		{"wrong-partition", "arn:aws-cn:sts::111:assumed-role/Reader/one", "ASIAONE"},
	} {
		e := huntEvent(item.id, "B", 90_000)
		e["userIdentity"].(evidenceObject)["arn"] = item.arn
		e["userIdentity"].(evidenceObject)["accessKeyId"] = item.key
		records = append(records, e)
	}
	invalid := huntEvent("invalid-time", "B", 90_000)
	invalid["eventTime"] = "not a timestamp"
	records = append(records, invalid)
	// This group has later B/C records but never completed its A prefix.
	for _, name := range []string{"B", "C"} {
		e := huntEvent("incomplete-"+name, name, 180_000)
		e["userIdentity"].(evidenceObject)["arn"] = "arn:aws:sts::111:assumed-role/Other/session"
		records = append(records, e)
	}
	s := evidenceStore(t, records...)
	o := orderedOptions("A", "B", "C")
	r, err := s.Hunt(context.Background(), o)
	if err != nil || r.Total != 1 || !reflect.DeepEqual(sequenceIDs(r.Sequences[0]), []string{"a", "b", "c"}) || r.InvalidTimes != 1 || r.MissingPrincipal != 2 || r.MissingCredential != 2 {
		t.Fatalf("incorrect grouping or exclusion counts: %+v %v", r, err)
	}
	o.Group = "principal"
	r, err = s.Hunt(context.Background(), o)
	if err != nil || r.Total != 1 || r.Sequences[0].Events[1].EventID != highestHuntSequenceID(t, s, "missing-key", "wrong-key") || r.Sequences[0].TiedCandidates[1] != 2 {
		t.Fatalf("principal grouping unexpectedly required a key or merged case/partition: %+v %v", r, err)
	}
	o.Group = "credential"
	for _, scope := range []Filter{
		{Excludes: map[string][]string{"eventID": {"b"}}},
		{FromMs: time.Date(2026, 9, 1, 0, 0, 1, 0, time.UTC).UnixMilli()},
		{MatchNone: true},
	} {
		o.Filter = scope
		r, err = s.Hunt(context.Background(), o)
		if err != nil || r.Total != 0 {
			t.Fatalf("a step escaped the shared scope: %+v %v", r, err)
		}
	}
}

func TestHuntSequenceCapStableSnapshotCancellationAndValidation(t *testing.T) {
	records := []evidenceObject{huntEvent("a", "A", 0), huntEvent("b", "B", 60_000)}
	for i := 0; i < 505; i++ {
		records = append(records, huntEvent(fmt.Sprintf("terminal-%03d", i), "C", 120_000))
	}
	s := evidenceStore(t, records...)
	o := orderedOptions("A", "B", "C")
	r, err := s.Hunt(context.Background(), o)
	if err != nil || r.Total != 505 || len(r.Sequences) != 500 || r.Sequences[0].Events[2].EventID != "terminal-504" || r.Sequences[499].Events[2].EventID != "terminal-005" {
		t.Fatalf("wrong full total/cap/order: %d/%d %v", r.Total, len(r.Sequences), err)
	}
	data, err := json.Marshal(huntEvent("appended-terminal", "C", 180_000))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.AppendEvents([]model.CloudTrailEvent{liveEvent(t, string(data))}); err != nil {
		t.Fatal(err)
	}
	o.Snapshot = &r.Snapshot
	stable, err := s.Hunt(context.Background(), o)
	if err != nil || stable.Total != 505 || !reflect.DeepEqual(stable.Sequences, r.Sequences) {
		t.Fatalf("append changed the captured snapshot: %d %v", stable.Total, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = s.Hunt(ctx, o); err == nil {
		t.Fatal("cancelled sequence query executed")
	}
	for _, mutate := range []func(*HuntOptions){
		func(o *HuntOptions) { o.Steps = []*Expr{} },
		func(o *HuntOptions) { o.Steps = o.Steps[:1] },
		func(o *HuntOptions) { o.Steps = append(o.Steps, huntStep("D"), huntStep("E"), huntStep("F")) },
		func(o *HuntOptions) { o.Steps[1] = nil },
		func(o *HuntOptions) { o.Steps[1] = &Expr{T: "cmp", Field: "unknown", Op: "eq", Value: "x"} },
		func(o *HuntOptions) { o.First = huntStep("A") },
		func(o *HuntOptions) { o.Minutes = 0 },
		func(o *HuntOptions) { o.Minutes = 1441 },
		func(o *HuntOptions) { o.Group = "account" },
	} {
		bad := orderedOptions("A", "B", "C")
		mutate(&bad)
		if _, err = s.Hunt(context.Background(), bad); err == nil {
			t.Fatalf("invalid sequence became a query: %+v", bad)
		}
	}
	if _, err = s.IngestReader(strings.NewReader(`{"eventID":"replacement","eventName":"New"}`), "replacement"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Hunt(context.Background(), o); err == nil {
		t.Fatal("sequence reused IDs after dataset replacement")
	}
}

// Five broad overlapping predicates would explode if implemented as ordinary
// many-to-many inequality joins. This benchmark is informational, not a CI timing gate.
func BenchmarkHuntFiveStepSequence(b *testing.B) {
	const count = 20_000
	records := make([]evidenceObject, count)
	for i := range records {
		e := huntEvent(fmt.Sprintf("benchmark-%d", i), "Operation", int64(i/100)*1000)
		e["userIdentity"].(evidenceObject)["arn"] = fmt.Sprintf("arn:aws:sts::111:assumed-role/Reader/session-%d", i%100)
		records[i] = e
	}
	data, err := json.Marshal(evidenceObject{"Records": records})
	if err != nil {
		b.Fatal(err)
	}
	s := New(filepath.Join(b.TempDir(), "sequence-benchmark.duckdb"))
	if err := s.Open(); err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		if err := s.Close(); err != nil {
			b.Error(err)
		}
	})
	if _, err := s.IngestReader(strings.NewReader(string(data)), "sequence-benchmark"); err != nil {
		b.Fatal(err)
	}
	o := orderedOptions("Operation", "Operation", "Operation", "Operation", "Operation")
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r, err := s.Hunt(context.Background(), o)
		if err != nil || r.Total != count-400 || len(r.Sequences) != 500 {
			b.Fatalf("unexpected sequence benchmark output: %d/%d %v", r.Total, len(r.Sequences), err)
		}
	}
}
