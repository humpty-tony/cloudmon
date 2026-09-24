package store

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// Snapshot identifies both a dataset and its append-only event cutoff. Importing
// another dataset changes Generation even when event sequence numbers repeat.
type Snapshot struct {
	Generation string `json:"generation"`
	MaxSeq     int64  `json:"maxSeq"`
	CapturedAt string `json:"capturedAt"`
}
type SearchResult struct {
	Aggregates Aggregates `json:"aggregates"`
	Events     []Row      `json:"events"`
}

// SnapshotContext captures the current dataset and event cutoff without building
// search aggregates. Detail views can share this scope even for events that
// arrived after the last full search.
func (s *Store) SnapshotContext(ctx context.Context) (Snapshot, error) {
	var snapshot Snapshot
	err := s.readSnapshot(ctx, func(ctx context.Context, tx *sql.Tx) error {
		var err error
		snapshot, err = snapshotOn(ctx, tx)
		return err
	})
	return snapshot, err
}

func (s *Store) readSnapshot(parent context.Context, fn func(context.Context, *sql.Tx) error) error {
	return s.operation(parent, func(ctx context.Context) error {
		// Acquire with the cancellable context before beginning a transaction whose
		// rollback must be synchronous. Cancellation also interrupts pool waiters.
		conn, err := s.db.Conn(ctx)
		if err != nil {
			return err
		}
		defer conn.Close()
		tx, err := conn.BeginTx(context.WithoutCancel(ctx), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		return fn(ctx, tx)
	})
}
func snapshotOn(ctx context.Context, tx *sql.Tx) (Snapshot, error) {
	var snapshot Snapshot
	err := tx.QueryRowContext(ctx, `SELECT coalesce((SELECT value FROM app_state WHERE key='datasetImportedAt'),''),coalesce(max(seq),0) FROM events`).Scan(&snapshot.Generation, &snapshot.MaxSeq)
	snapshot.CapturedAt = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	return snapshot, err
}
func validateSnapshot(ctx context.Context, tx *sql.Tx, snapshot Snapshot) error {
	current, err := snapshotOn(ctx, tx)
	if err != nil {
		return err
	}
	if current.Generation != snapshot.Generation {
		return fmt.Errorf("the dataset changed; run the search again")
	}
	if snapshot.MaxSeq < 0 || snapshot.MaxSeq > current.MaxSeq {
		return fmt.Errorf("invalid search snapshot; run the search again")
	}
	return nil
}
func snapshotWhere(f Filter, snapshot Snapshot, before int64) (string, error) {
	where, err := f.where()
	if err != nil {
		return "", err
	}
	if where == "" {
		where = " WHERE TRUE"
	}
	where += fmt.Sprintf(" AND seq <= %d", snapshot.MaxSeq)
	if before > 0 {
		where += fmt.Sprintf(" AND seq < %d", before)
	}
	return where, nil
}
func pageOn(ctx context.Context, tx *sql.Tx, f Filter, snapshot Snapshot, before int64, limit int) ([]Row, error) {
	where, err := snapshotWhere(f, snapshot, before)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 2000
	}
	limit = min(limit, 2000)
	var rows []Row
	err = queryJSONOn(ctx, tx, fmt.Sprintf("SELECT %s FROM events%s ORDER BY seq DESC LIMIT %d", pageCols, where, limit), &rows)
	return rows, err
}

// Search returns the first page and all summaries from one committed read.
func (s *Store) Search(ctx context.Context, f Filter, limit int) (SearchResult, error) {
	var result SearchResult
	err := s.readSnapshot(ctx, func(ctx context.Context, tx *sql.Tx) error {
		snapshot, err := snapshotOn(ctx, tx)
		if err != nil {
			return err
		}
		result.Aggregates, err = aggregates(f, func(q string, dst any) error { return queryJSONOn(ctx, tx, q, dst) })
		if err != nil {
			return err
		}
		result.Aggregates.Snapshot = &snapshot
		result.Events, err = pageOn(ctx, tx, f, snapshot, 0, limit)
		return err
	})
	return result, err
}

// PageSnapshot uses a sequence cursor; new arrivals cannot shift its offsets.
func (s *Store) PageSnapshot(ctx context.Context, f Filter, snapshot Snapshot, before int64, limit int) ([]Row, error) {
	var rows []Row
	err := s.readSnapshot(ctx, func(ctx context.Context, tx *sql.Tx) error {
		if err := validateSnapshot(ctx, tx, snapshot); err != nil {
			return err
		}
		var err error
		rows, err = pageOn(ctx, tx, f, snapshot, before, limit)
		return err
	})
	return rows, err
}

// ExportSnapshot streams original source records without the UI's page/row cap.
func (s *Store) ExportSnapshot(ctx context.Context, f Filter, snapshot Snapshot, dst io.Writer) (int, error) {
	count := 0
	err := s.readSnapshot(ctx, func(ctx context.Context, tx *sql.Tx) error {
		if err := validateSnapshot(ctx, tx, snapshot); err != nil {
			return err
		}
		where, err := snapshotWhere(f, snapshot, 0)
		if err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, "SELECT raw FROM events"+where+" ORDER BY seq DESC")
		if err != nil {
			return err
		}
		defer rows.Close()
		writer := bufio.NewWriter(dst)
		if _, err := io.WriteString(writer, "{\"Records\":[\n"); err != nil {
			return err
		}
		for rows.Next() {
			var raw string
			if err := rows.Scan(&raw); err != nil {
				return err
			}
			if !json.Valid([]byte(raw)) {
				return fmt.Errorf("source record is invalid; export cancelled")
			}
			if count > 0 {
				if _, err := io.WriteString(writer, ",\n"); err != nil {
					return err
				}
			}
			if _, err := io.WriteString(writer, raw); err != nil {
				return err
			}
			count++
		}
		if err := rows.Err(); err != nil {
			return err
		}
		if _, err := io.WriteString(writer, "\n]}\n"); err != nil {
			return err
		}
		if err := writer.Flush(); err != nil {
			return err
		}
		return ctx.Err()
	})
	return count, err
}

// ExportFile publishes only a complete export. Errors before publication preserve an existing file.
func (s *Store) ExportFile(ctx context.Context, f Filter, snapshot Snapshot, path string) (int, error) {
	count := 0
	err := writeCompletedExport(ctx, path, func(dst io.Writer) error {
		var err error
		count, err = s.ExportSnapshot(ctx, f, snapshot, dst)
		return err
	})
	if err != nil {
		return 0, err
	}
	return count, nil
}

// writeCompletedExport never opens the destination for writing. The caller must
// obtain the user's save/replace choice first. Rename has OS-specific atomicity
// guarantees; this is not a promise of crash durability on every filesystem.
func writeCompletedExport(ctx context.Context, path string, write func(io.Writer) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".cloudmon-export-*")
	if err != nil {
		return err
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	defer file.Close()
	if err := write(file); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}
