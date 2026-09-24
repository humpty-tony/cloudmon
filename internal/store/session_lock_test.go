package store

import (
	"path/filepath"
	"testing"
)

func TestEvidenceSessionLockExcludesSecondOwnerAndRecovers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.lock")
	first, err := LockSession(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if second, err := LockSession(path); err == nil {
		second.Close()
		t.Fatal("two sessions acquired the same database")
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := LockSession(path)
	if err != nil {
		t.Fatalf("stale file blocked recovery: %v", err)
	}
	reopened.Close()
}
