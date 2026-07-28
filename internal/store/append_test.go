package store

import (
	"path/filepath"
	"testing"

	"cloudmon/internal/model"
)

func liveEvent(t *testing.T, raw string) model.CloudTrailEvent {
	t.Helper()
	ev, err := model.FromRawJSON([]byte(raw))
	if err != nil {
		t.Fatalf("FromRawJSON: %v", err)
	}
	return ev
}

// AppendEvents into a table that already has an imported dataset: seq continues past
// the existing max and Count reflects the total.
func TestAppendEventsAfterIngest(t *testing.T) {
	s := newStore(t) // ingests the 3-event sample (seq 1..3)
	ev := liveEvent(t, `{"eventID":"live1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-01-01T00:10:00Z","readOnly":true,"userIdentity":{"type":"AssumedRole","userName":"live"}}`)
	total, err := s.AppendEvents([]model.CloudTrailEvent{ev})
	if err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}
	if total != 4 { // returns the post-insert total (3 imported + 1 appended)
		t.Fatalf("post-append total = %d, want 4", total)
	}
	c, err := s.Count()
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if c != 4 {
		t.Fatalf("count = %d, want 4", c)
	}
	// The appended event must land with seq greater than the imported max (3).
	var rows []struct {
		Seq       int64  `json:"seq"`
		EventName string `json:"eventName"`
	}
	if err := s.queryJSON("SELECT seq, eventName FROM events WHERE eventID='live1';", &rows); err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(rows) != 1 || rows[0].Seq <= 3 || rows[0].EventName != "AssumeRole" {
		t.Fatalf("appended row = %+v, want seq>3 AssumeRole", rows)
	}
}

// Newer returns events with seq greater than sinceSeq, newest-first, and - crucially -
// returns the OLDEST unseen band under a limit so the append cursor never skips a gap.
func TestNewer(t *testing.T) {
	s := newStore(t) // 3 sample events → seq 1..3
	e4 := liveEvent(t, `{"eventID":"n4","eventName":"A","eventSource":"s.amazonaws.com","eventTime":"2025-01-01T00:20:00Z"}`)
	e5 := liveEvent(t, `{"eventID":"n5","eventName":"B","eventSource":"s.amazonaws.com","eventTime":"2025-01-01T00:21:00Z"}`)
	if _, err := s.AppendEvents([]model.CloudTrailEvent{e4, e5}); err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}
	rows, err := s.Newer(Filter{}, 3, 100)
	if err != nil {
		t.Fatalf("Newer: %v", err)
	}
	if len(rows) != 2 || rows[0].Seq != 5 || rows[1].Seq != 4 {
		t.Fatalf("Newer(since=3) = %+v, want seq [5,4]", rows)
	}
	// Limit 1 must return the OLDEST unseen (seq 4), not the newest (seq 5).
	one, err := s.Newer(Filter{}, 3, 1)
	if err != nil {
		t.Fatalf("Newer limit: %v", err)
	}
	if len(one) != 1 || one[0].Seq != 4 {
		t.Fatalf("Newer(since=3, limit=1) = %+v, want [seq 4] (oldest unseen)", one)
	}
}

// AppendEvents with no prior table must create it (streaming that starts with no
// import).
func TestAppendEventsCreatesTable(t *testing.T) {
	dir := t.TempDir()
	s := New(bin(t), filepath.Join(dir, "live.duckdb"))
	ev := liveEvent(t, `{"eventID":"a","eventName":"ConsoleLogin","eventSource":"signin.amazonaws.com","eventTime":"2025-02-02T00:00:00Z"}`)
	total, err := s.AppendEvents([]model.CloudTrailEvent{ev})
	if err != nil {
		t.Fatalf("AppendEvents (fresh): %v", err)
	}
	if total != 1 {
		t.Fatalf("post-append total = %d, want 1", total)
	}
	c, err := s.Count()
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if c != 1 {
		t.Fatalf("count = %d, want 1", c)
	}
}

// AppendEvents must drop events whose eventID is already in the table, so an SQS
// redelivery on resume (a batch buffered but not acked before pause) can't create
// duplicate rows.
func TestAppendEventsDedupesByEventID(t *testing.T) {
	dir := t.TempDir()
	s := New(bin(t), filepath.Join(dir, "dedup.duckdb"))
	e1 := liveEvent(t, `{"eventID":"dup1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-03-01T00:00:00Z"}`)
	if _, err := s.AppendEvents([]model.CloudTrailEvent{e1}); err != nil {
		t.Fatalf("AppendEvents first: %v", err)
	}
	// Re-deliver the same event (dup1) alongside a genuinely new one (new2).
	e1again := liveEvent(t, `{"eventID":"dup1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-03-01T00:00:00Z"}`)
	e2 := liveEvent(t, `{"eventID":"new2","eventName":"GetCallerIdentity","eventSource":"sts.amazonaws.com","eventTime":"2025-03-01T00:01:00Z"}`)
	total, err := s.AppendEvents([]model.CloudTrailEvent{e1again, e2})
	if err != nil {
		t.Fatalf("AppendEvents redelivery: %v", err)
	}
	if total != 2 { // dup1 dropped, new2 kept -> 2 total, not 3
		t.Fatalf("post-dedup total = %d, want 2 (duplicate dropped)", total)
	}
	var rows []struct {
		N int `json:"n"`
	}
	if err := s.queryJSON("SELECT count(*) AS n FROM events WHERE eventID='dup1';", &rows); err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(rows) != 1 || rows[0].N != 1 {
		t.Fatalf("rows for dup1 = %+v, want exactly 1", rows)
	}
}
