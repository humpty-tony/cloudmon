package store

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cloudmon/internal/model"
)

func TestEvidenceIdentityAndRestart(t *testing.T) {
	s := openTestStore(t, filepath.Join(t.TempDir(), "evidence.duckdb"))
	if err := s.Open(); err != nil {
		t.Fatal(err)
	}
	raw := `{"eventID":"id","recipientAccountId":"111111111111","eventName": "RunInstances","opaque":9007199254740993,"present":null}`
	changed := strings.Replace(raw, "9007199254740993", "9007199254740995", 1)
	crossAccount := strings.Replace(raw, "111111111111", "222222222222", 1)
	batch := []model.CloudTrailEvent{liveEvent(t, raw), liveEvent(t, raw), liveEvent(t, changed), liveEvent(t, crossAccount)}
	if n, err := s.AppendFrom(batch, "sqs://capture-1"); err != nil || n != 2 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if err := s.SetState("capture", `{"queue":"retained"}`); err != nil {
		t.Fatal(err)
	}
	// A new Store must reopen exactly the same evidence and resource journal.
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, s.dbPath)
	if err := s.Open(); err != nil {
		t.Fatal(err)
	}
	if got, err := s.Raw(1); err != nil || got != raw {
		t.Fatalf("first source changed: %s err=%v", got, err)
	}
	evidence, err := s.Evidence(1, 0)
	if err != nil || evidence.Total != 3 || evidence.Variants != 2 || len(evidence.Observations) != 3 {
		t.Fatalf("evidence=%+v err=%v", evidence, err)
	}
	for i, want := range []string{raw, raw, changed} {
		ob := evidence.Observations[i]
		if got, err := s.Observation(ob.ID); err != nil || got != want {
			t.Fatalf("observation %d changed: %q err=%v", i, got, err)
		}
		if ob.SHA256 != fmt.Sprintf("%x", sha256.Sum256([]byte(want))) || ob.Source != "sqs://capture-1" || ob.Displayed != (i < 2) {
			t.Fatalf("bad provenance: %+v", ob)
		}
	}
	if n, err := s.AppendFrom(batch, "sqs://redelivery"); err != nil || n != 2 {
		t.Fatalf("redelivery created event rows: %d %v", n, err)
	}
	if got, err := s.RawBySeqs([]int64{2, 1}); err != nil || got[0] != crossAccount || got[1] != raw {
		t.Fatalf("export changed records: %v %v", got, err)
	}
	if _, err := s.RawBySeqs([]int64{1, 999}); err == nil {
		t.Fatal("missing evidence silently exported")
	}
	if got, err := s.GetState("capture"); err != nil || got != `{"queue":"retained"}` {
		t.Fatalf("journal=%q err=%v", got, err)
	}
}

func TestImportIsAtomicAcrossFilesAndFormats(t *testing.T) {
	s := newStore(t)
	if err := s.SetState("capture", "saved capture"); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	write := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("01.json", `{"eventName":"First","eventID":"x"}`)
	write("02.csv", "Event name,Event ID\nSecond,y\n")
	write("03.json", `{"Records":[{"eventName":"Pending"},{`)
	if _, err := s.Ingest(dir); err == nil {
		t.Fatal("partial input reported success")
	}
	if n, err := s.Count(); err != nil || n != 3 {
		t.Fatalf("failed import changed old dataset: %d %v", n, err)
	}
	// Also fail inside the SQL transaction, after its DROP/CREATE statements.
	badStage := filepath.Join(t.TempDir(), "invalid-stage.ndjson")
	if err := os.WriteFile(badStage, []byte(`{"position":"not-a-number","raw":"{}"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.commitStage(badStage, true); err == nil {
		t.Fatal("invalid stage committed")
	}
	if n, err := s.Count(); err != nil || n != 3 {
		t.Fatalf("SQL failure replaced evidence: %d %v", n, err)
	}
	if err := os.Remove(filepath.Join(dir, "03.json")); err != nil {
		t.Fatal(err)
	}
	if n, err := s.Ingest(dir); err != nil || n != 2 {
		t.Fatalf("mixed import: %d %v", n, err)
	}
	stats, err := s.EvidenceStats()
	if err != nil || stats.Events != 2 || stats.Observations != 2 || stats.Lossy != 1 {
		t.Fatalf("stats=%+v err=%v", stats, err)
	}
	if journal, err := s.GetState("capture"); err != nil || journal != "saved capture" {
		t.Fatalf("import lost journal: %q %v", journal, err)
	}
}

func TestMissingIdentityUsesContentAndVersionGuard(t *testing.T) {
	s := openTestStore(t, filepath.Join(t.TempDir(), "evidence.duckdb"))
	raw := `{"eventID":"same-id-no-recipient","eventName":"One"}`
	other := strings.Replace(raw, "One", "Two", 1)
	if n, err := s.AppendEvents([]model.CloudTrailEvent{liveEvent(t, raw), liveEvent(t, raw), liveEvent(t, other)}); err != nil || n != 2 {
		t.Fatalf("content identity=%d %v", n, err)
	}
	if err := s.SetState("evidenceVersion", "future"); err != nil {
		t.Fatal(err)
	}
	if err := s.Open(); err == nil {
		t.Fatal("opened unknown schema")
	}
	if n, err := s.Count(); err != nil || n != 2 {
		t.Fatalf("version rejection changed evidence: %d %v", n, err)
	}
}
