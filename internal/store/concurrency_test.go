package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"cloudmon/internal/model"
)

func TestReaderSeesCommittedStateWhileWriterIsBusy(t *testing.T) {
	s := newStore(t)
	if err := s.SetState("test", "before"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel() // also releases the writer if a read fails
	staged := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- s.write(ctx, func(ctx context.Context, tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, "UPDATE app_state SET value='after' WHERE key='test'"); err != nil {
				close(staged)
				return err
			}
			close(staged)
			select {
			case <-release:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
	}()
	<-staged
	read := make(chan error, 1)
	go func() {
		got, err := s.GetState("test")
		if err == nil && got != "before" {
			err = fmt.Errorf("reader saw uncommitted value %q", got)
		}
		read <- err
	}()
	select {
	case err := <-read:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("reader waited behind the writer")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got, err := s.GetState("test"); err != nil || got != "after" {
		t.Fatalf("commit not visible: %q %v", got, err)
	}
}

func TestReadersCannotExhaustWriterConnections(t *testing.T) {
	s := newStore(t)
	for i := 0; i < 4; i++ {
		conn, err := s.db.Conn(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	batch := []model.CloudTrailEvent{liveEvent(t, `{"eventName":"WhileReadersBusy"}`)}
	if n, err := s.AppendFromContext(ctx, batch, "concurrency-test"); err != nil || n != 4 {
		t.Fatalf("reserved writer blocked: %d %v", n, err)
	}
}

func TestCancelledTransactionRollsBackAndNextWriteWorks(t *testing.T) {
	s := newStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	err := s.write(ctx, func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "INSERT INTO app_state VALUES ('cancelled','uncommitted')"); err != nil {
			return err
		}
		cancel()
		return ctx.Err()
	})
	if err == nil {
		t.Fatal("cancelled transaction reported success")
	}
	if got, err := s.GetState("cancelled"); err != nil || got != "" {
		t.Fatalf("cancelled write persisted: %q %v", got, err)
	}
	if n, err := s.AppendEvents([]model.CloudTrailEvent{liveEvent(t, `{"eventName":"AfterCancellation"}`)}); err != nil || n != 4 {
		t.Fatalf("writer did not recover: %d %v", n, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Count(); err == nil {
		t.Fatal("closed store reopened implicitly")
	}
}

func TestCloseCancelsActiveQueriesAndJoinsThem(t *testing.T) {
	s := newStore(t)
	started := make(chan struct{})
	queryDone := make(chan error, 1)
	go func() {
		queryDone <- s.operation(context.Background(), func(ctx context.Context) error {
			conn, err := s.db.Conn(ctx)
			if err != nil {
				close(started)
				return err
			}
			defer conn.Close()
			close(started)
			var sum string
			return conn.QueryRowContext(ctx, "SELECT sum(i)::VARCHAR FROM range(1000000000000) AS t(i)").Scan(&sum)
		})
	}()
	<-started
	closed := make(chan error, 1)
	go func() { closed <- s.Close() }()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("close did not interrupt active query")
	}
	if err := <-queryDone; err == nil {
		t.Fatal("cancelled query reported success")
	}
}

// A successful sink call must survive exit before normal shutdown/checkpoint.
// The subprocess deliberately skips Close; reopening replays committed WAL.
func TestCommittedEvidenceSurvivesProcessExit(t *testing.T) {
	const record = `{"eventID":"durable","recipientAccountId":"123456789012","eventName":"Committed","number":9007199254740993}`
	if path := os.Getenv("CLOUDMON_WAL_TEST_PATH"); path != "" {
		s := New(path)
		if err := s.Open(); err != nil {
			t.Fatal(err)
		}
		if n, err := s.AppendFrom([]model.CloudTrailEvent{liveEvent(t, record)}, "before-exit"); err != nil || n != 1 {
			t.Fatalf("commit: %d %v", n, err)
		}
		if err := s.SetState("capture", "saved-resource-journal"); err != nil {
			t.Fatal(err)
		}
		os.Exit(0)
	}
	path := filepath.Join(t.TempDir(), "abrupt-exit.duckdb")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCommittedEvidenceSurvivesProcessExit$")
	cmd.Env = append(os.Environ(), "CLOUDMON_WAL_TEST_PATH="+path)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("subprocess: %v %s", err, out)
	}
	s := openTestStore(t, path)
	if got, err := s.Raw(1); err != nil || got != record {
		t.Fatalf("committed evidence lost: %q %v", got, err)
	}
	if got, err := s.GetState("capture"); err != nil || got != "saved-resource-journal" {
		t.Fatalf("journal lost: %q %v", got, err)
	}
	if n, err := s.AppendFrom([]model.CloudTrailEvent{liveEvent(t, record)}, "redelivered"); err != nil || n != 1 {
		t.Fatalf("restart counters/deduplication: %d %v", n, err)
	}
	evidence, err := s.Evidence(1, 0)
	if err != nil || evidence.Total != 2 || evidence.Observations[1].ID != 2 {
		t.Fatalf("observation IDs after restart: %+v %v", evidence, err)
	}
}
