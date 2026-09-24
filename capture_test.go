package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cloudmon/internal/awsflow"
	"cloudmon/internal/capture"
	"cloudmon/internal/config"
	"cloudmon/internal/store"
)

func recoveryApp(t *testing.T, path string) *App {
	t.Helper()
	bin := os.Getenv("DUCKDB_BIN")
	if bin == "" {
		t.Skip("DUCKDB_BIN required")
	}
	db := store.New(bin, path)
	if err := db.Open(); err != nil {
		t.Fatal(err)
	}
	a := NewApp()
	a.ctx = context.Background()
	a.dbOnce.Do(func() { a.db = db })
	return a
}

func TestRestartRetainsEvidenceAndCaptureWithoutStartingIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "saved.duckdb")
	a := recoveryApp(t, path)
	if _, err := a.IngestText(`{"eventName":"RunInstances"}`); err != nil {
		t.Fatal(err)
	}
	session := &capture.Session{Version: 1, Phase: capture.Ready, Config: config.ConnectionConfig{Mode: "create-infra", Profile: "original-profile"}, Infra: awsflow.Infra{Owned: true, Account: "111122223333", Region: "us-east-1", QueueName: "cloudmon-capture-test", RuleName: "cloudmon-cloudtrail-test", QueueURL: "https://sqs.us-east-1.amazonaws.com/111122223333/cloudmon-capture-test"}}
	if err := a.saveCapture(session); err != nil {
		t.Fatal(err)
	}
	// Shutdown must join the running poller and leave the durable resource handles.
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	a.capCancel = cancel
	a.capDone = done
	a.capActive = true
	go func() { <-ctx.Done(); close(done) }()
	a.onShutdown(context.Background())
	a = recoveryApp(t, path)
	state, err := a.GetRecoveryState()
	if err != nil || state.Evidence.Events != 1 || state.Active || state.Capture == nil || state.Capture.Config.Profile != "original-profile" {
		t.Fatalf("bad recovery: %+v %v", state, err)
	}
	if _, err := a.StartCapture(); err == nil {
		t.Fatal("new capture overwrote saved one")
	}
	if _, err := a.IngestText(`[{"eventName":"Pending"},broken]`); err == nil {
		t.Fatal("malformed import succeeded")
	}
	if count, err := a.db.Count(); err != nil || count != 1 {
		t.Fatalf("import lost saved evidence: %d %v", count, err)
	}
	if saved, err := a.db.GetState("capture"); err != nil || !strings.Contains(saved, "original-profile") {
		t.Fatalf("journal lost: %q %v", saved, err)
	}
}

func TestDamagedJournalIsReportedAndNotOverwritten(t *testing.T) {
	a := recoveryApp(t, filepath.Join(t.TempDir(), "saved.duckdb"))
	if err := a.db.SetState("capture", `{"version":999}`); err != nil {
		t.Fatal(err)
	}
	state, err := a.GetRecoveryState()
	if err != nil || !strings.Contains(state.CaptureError, "version") {
		t.Fatalf("damaged journal hidden: %+v %v", state, err)
	}
	if _, err := a.StartCapture(); err == nil {
		t.Fatal("damaged journal overwritten")
	}
	if got, err := a.db.GetState("capture"); err != nil || got != `{"version":999}` {
		t.Fatalf("journal changed: %q %v", got, err)
	}
}
