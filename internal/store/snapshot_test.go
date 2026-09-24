package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"cloudmon/internal/model"
)

func TestCurrentSnapshotTracksArrivalsAndRejectsReplacement(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	first, err := s.SnapshotContext(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if first.Generation == "" || first.MaxSeq != 3 {
		t.Fatalf("unexpected initial snapshot: %+v", first)
	}
	if _, err := time.Parse(time.RFC3339Nano, first.CapturedAt); err != nil {
		t.Fatalf("invalid snapshot timestamp: %v", err)
	}
	const lateRaw = `{"eventID":"late-detail","eventName":"InspectArrival","number":9007199254740993}`
	if _, err := s.AppendEvents([]model.CloudTrailEvent{liveEvent(t, lateRaw)}); err != nil {
		t.Fatal(err)
	}
	current, err := s.SnapshotContext(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if current.Generation != first.Generation || current.MaxSeq != 4 {
		t.Fatalf("snapshot missed the appended event: %+v", current)
	}
	if raw, err := s.LineageRaw(current.MaxSeq, current); err != nil || raw != lateRaw {
		t.Fatalf("current snapshot did not retain the exact arrival: %q %v", raw, err)
	}
	if _, err := s.LineageRaw(current.MaxSeq, first); err == nil {
		t.Fatal("older snapshot accepted an event beyond its cutoff")
	}
	if _, err := s.IngestReader(strings.NewReader(`{"eventID":"replacement","eventName":"NewDataset"}`), "replacement"); err != nil {
		t.Fatal(err)
	}
	// Sequence 1 exists in both datasets; the generation must prevent reading
	// replacement evidence under the original selected event's snapshot.
	if _, err := s.LineageRaw(1, current); err == nil {
		t.Fatal("stale snapshot accepted a reused event sequence")
	}
	fresh, err := s.SnapshotContext(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Generation == current.Generation || fresh.MaxSeq != 1 {
		t.Fatalf("snapshot did not identify the replacement dataset: %+v", fresh)
	}
	rows, err := s.PageSnapshot(ctx, Filter{}, fresh, 0, 100)
	if err != nil || len(rows) != 1 || rows[0].EventID != "replacement" {
		t.Fatalf("fresh snapshot failed: %+v %v", rows, err)
	}
}

func TestSnapshotPagesRemainStableAcrossArrivals(t *testing.T) {
	s := newStore(t)
	first, err := s.Search(context.Background(), Filter{}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if first.Aggregates.Total != 3 || len(first.Events) != 2 || first.Aggregates.Snapshot.MaxSeq != 3 {
		t.Fatalf("unexpected initial search: %+v", first)
	}
	if _, err := s.AppendEvents([]model.CloudTrailEvent{liveEvent(t, `{"eventID":"late","eventName":"LateArrival"}`)}); err != nil {
		t.Fatal(err)
	}
	next, err := s.PageSnapshot(context.Background(), Filter{}, *first.Aggregates.Snapshot, first.Events[1].Seq, 2000)
	if err != nil || len(next) != 1 || next[0].EventID != "1" {
		t.Fatalf("page shifted after arrival: %+v %v", next, err)
	}
	var output bytes.Buffer
	count, err := s.ExportSnapshot(context.Background(), Filter{}, *first.Aggregates.Snapshot, &output)
	if err != nil || count != 3 || bytes.Contains(output.Bytes(), []byte("late")) {
		t.Fatalf("export escaped snapshot: %d %v", count, err)
	}
	// Re-import can reuse sequences; the generation prevents reading a new event
	// under a previously selected snapshot or exporting an unrelated dataset.
	if _, err := s.IngestReader(strings.NewReader(`{"eventID":"replacement","eventName":"NewDataset"}`), "replacement"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PageSnapshot(context.Background(), Filter{}, *first.Aggregates.Snapshot, 0, 100); err == nil {
		t.Fatal("stale dataset snapshot accepted")
	}
	output.Reset()
	if _, err := s.ExportSnapshot(context.Background(), Filter{}, *first.Aggregates.Snapshot, &output); err == nil || output.Len() != 0 {
		t.Fatal("stale dataset exported")
	}
	fresh, err := s.Search(context.Background(), Filter{}, 100)
	if err != nil || len(fresh.Events) != 1 || fresh.Events[0].EventID != "replacement" {
		t.Fatalf("fresh search failed: %v", err)
	}
}

func TestFullExportExceedsUIRowCapAndPreservesExistingFileOnFailure(t *testing.T) {
	s := openTestStore(t, filepath.Join(t.TempDir(), "events.duckdb"))
	var source strings.Builder
	source.WriteString(`{"Records":[`)
	for i := 0; i < 20001; i++ {
		if i > 0 {
			source.WriteByte(',')
		}
		fmt.Fprintf(&source, `{"eventID":"e%d","eventName":"ExactEvidence","number":9007199254740993}`, i)
	}
	source.WriteString("]}")
	if _, err := s.IngestReader(strings.NewReader(source.String()), "bulk.json"); err != nil {
		t.Fatal(err)
	}
	result, err := s.Search(context.Background(), Filter{}, 2000)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Events) != 2000 || result.Aggregates.Total != 20001 {
		t.Fatal("fixture did not exceed loaded rows")
	}
	target := filepath.Join(t.TempDir(), "export.json")
	if err := os.WriteFile(target, []byte("previous file"), 0600); err != nil {
		t.Fatal(err)
	}
	count, err := s.ExportFile(context.Background(), Filter{}, *result.Aggregates.Snapshot, target)
	if err != nil || count != 20001 {
		t.Fatalf("full export: %d %v", count, err)
	}
	saved, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct{ Records []json.RawMessage }
	if err := json.Unmarshal(saved, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Records) != 20001 || !bytes.Contains(decoded.Records[0], []byte("9007199254740993")) {
		t.Fatal("export lost events or numeric evidence")
	}
	bad := Filter{Includes: map[string][]string{"unknownField": {"x"}}}
	if _, err := s.ExportFile(context.Background(), bad, *result.Aggregates.Snapshot, target); err == nil {
		t.Fatal("bad filter exported")
	}
	after, _ := os.ReadFile(target)
	if !bytes.Equal(after, saved) {
		t.Fatal("failed export replaced the previous file")
	}
	files, _ := filepath.Glob(filepath.Join(filepath.Dir(target), ".cloudmon-export-*"))
	if len(files) != 0 {
		t.Fatal("failed export left a partial file")
	}
}

type rejectedWriter struct{}

func (rejectedWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
func TestSnapshotExportWriterFailureReleasesReader(t *testing.T) {
	s := newStore(t)
	result, err := s.Search(context.Background(), Filter{}, 100)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ExportSnapshot(context.Background(), Filter{}, *result.Aggregates.Snapshot, rejectedWriter{}); err == nil {
		t.Fatal("write failure ignored")
	}
	if _, err := s.Search(context.Background(), Filter{}, 100); err != nil {
		t.Fatal(err)
	}
}

func TestCancelledSearchLeavesConnectionQueue(t *testing.T) {
	s := newStore(t)
	for i := 0; i < 4; i++ {
		conn, err := s.db.Conn(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
	}
	waiting := s.db.Stats().WaitCount
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := s.Search(ctx, Filter{}, 100); done <- err }()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for s.db.Stats().WaitCount == waiting {
		select {
		case <-tick.C:
		case <-deadline.C:
			t.Fatal("search did not reach connection queue")
		}
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled search succeeded")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled search stayed queued")
	}
}
