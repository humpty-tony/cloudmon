package main

import (
	"cloudmon/internal/attribution"
	"cloudmon/internal/store"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestAttributionOfflineCacheAndDatasetIsolation(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	a := recoveryApp(t, filepath.Join(t.TempDir(), "events.duckdb"))
	seed := `{"eventID":"use","eventTime":"2026-09-25T12:00:00Z","eventSource":"s3.amazonaws.com","eventName":"ListBuckets","userIdentity":{"type":"AssumedRole","accessKeyId":"ASIA_CHILD","arn":"arn:aws:sts::111122223333:assumed-role/ReadOnly/alice","sessionContext":{"sessionIssuer":{"arn":"arn:aws:iam::111122223333:role/ReadOnly","userName":"ReadOnly"}}}}`
	issue := `{"eventID":"issue","eventTime":"2026-09-25T11:59:00Z","eventSource":"sts.amazonaws.com","eventName":"AssumeRole","sourceIPAddress":"198.51.100.24","userAgent":"aws-cli/2.17","userIdentity":{"type":"IAMUser","accessKeyId":"AKIA_ALICE","arn":"arn:aws:iam::111122223333:user/alice","userName":"alice"},"responseElements":{"credentials":{"accessKeyId":"ASIA_CHILD","expiration":"2026-09-25T13:00:00Z"}}}`
	if _, err := a.IngestText("[" + seed + "]"); err != nil {
		t.Fatal(err)
	}
	snapshot, err := a.db.SnapshotContext(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	a.resolveAttribution = func(ctx context.Context, got string, local []string, cfg attribution.Config) (attribution.Result, error) {
		calls++
		if got != seed {
			t.Fatal("seed changed")
		}
		return attribution.Result{FetchedAt: "2026-09-25T12:01:00Z", Records: []attribution.Record{{ID: "issue", Raw: issue, Source: "cloudtrail"}}, Sources: []attribution.SourceStatus{}, Evidence: []attribution.Evidence{}}, nil
	}
	if value, err := a.GetLineageAttribution(1, snapshot); err != nil || value != nil {
		t.Fatalf("unexpected cache: %v %v", value, err)
	}
	report, err := a.ResolveLineageAttribution("explicit-attribution", 1, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Graph.Edges) != 1 || report.Graph.Edges[0].ViaIP != "198.51.100.24" {
		t.Fatalf("missing historical issuance %+v", report.Graph)
	}
	cached, err := a.GetLineageAttribution(1, snapshot)
	if err != nil || cached == nil || !cached.Cached || calls != 1 {
		t.Fatalf("cache %v %v calls=%d", cached, err, calls)
	}
	after, err := a.db.SnapshotContext(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if after.Generation != snapshot.Generation || after.MaxSeq != snapshot.MaxSeq {
		t.Fatal("dataset modified")
	}
	cfg, err := a.GetAttributionSettings()
	if err != nil {
		t.Fatal(err)
	}
	cfg.AWSProfile = "different-account"
	if err = a.SaveAttributionSettings(cfg); err != nil {
		t.Fatal(err)
	}
	if value, err := a.GetLineageAttribution(1, snapshot); err != nil || value != nil {
		t.Fatal("old account configuration reused")
	}
	dir, _ := attributionDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		info, _ := entry.Info()
		if !entry.IsDir() && info.Mode().Perm() != 0600 {
			t.Fatalf("unsafe mode %s", info.Mode())
		}
	}
	// A replaced dataset must not accept the old snapshot or cached result.
	if _, err = a.IngestText("[" + seed + "]"); err != nil {
		t.Fatal(err)
	}
	if _, err = a.GetLineageAttribution(1, snapshot); err == nil {
		t.Fatal("stale snapshot accepted")
	}
}

func TestAttributionCancellationAndSettingsValidation(t *testing.T) {
	a := NewApp()
	a.ctx = context.Background()
	a.CancelQuery("cancelled-attribution")
	if _, err := a.ResolveLineageAttribution("cancelled-attribution", 1, store.Snapshot{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled request reached data/network: %v", err)
	}
	for _, cfg := range []attribution.Config{{VaultAddress: "http://vault.example.com"}, {VaultAddress: "https://secret@vault.example.com"}, {VaultAddress: "https://vault.example.com?token=secret"}, {EntraTokenEnv: "Bearer secret-value"}, {EntraMappings: []attribution.FederationMapping{{RoleARN: "arn:aws:iam::111122223333:role/ReadOnly"}}}} {
		if err := a.SaveAttributionSettings(cfg); err == nil {
			t.Fatalf("unsafe/incomplete settings accepted: %+v", cfg)
		}
	}
}
