// Package store keeps one embedded DuckDB instance open for local evidence.
// A reserved writer connection commits batches; a bounded pool lets UI reads
// use DuckDB snapshots without queuing behind that writer.
package store

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/duckdb/duckdb-go/v2"
)

const operationTimeout = 2 * time.Minute

// Store owns its database and connections until Close. Open validates the saved
// schema before callers can import, append, or query evidence.
type Store struct {
	dbPath    string
	life      sync.RWMutex // Close joins operations after cancelling their contexts
	once      sync.Once
	db        *sql.DB
	writer    *sql.DB // separate one-connection pool, reserved for the capture sink
	connector *duckdb.Connector
	initErr   error
	writeSlot chan struct{}
	ctx       context.Context
	cancel    context.CancelFunc
	closeOnce sync.Once
	closeErr  error
	counts    evidenceCounters // guarded by writeSlot; reconstructed from disk on open
}

type evidenceCounters struct {
	valid       bool
	events      int64
	seq         int64
	observation int64
}

func New(dbPath string) *Store {
	ctx, cancel := context.WithCancel(context.Background())
	return &Store{dbPath: dbPath, writeSlot: make(chan struct{}, 1), ctx: ctx, cancel: cancel}
}

// Expose only driver.Connector, deliberately excluding the native Close method.
type poolConnector struct{ driver.Connector }

// engine is called with life held. The driver bundles DuckDB 1.5.5, the same
// storage version as the former CLI, and links the native library at build time.
func (s *Store) engine() error {
	s.once.Do(func() {
		// The driver's DSN splits on '?'. Reject it rather than opening a
		// different file if the application's configuration directory contains it.
		if strings.Contains(s.dbPath, "?") {
			s.initErr = fmt.Errorf("database path cannot contain '?'")
			return
		}
		connector, err := duckdb.NewConnector(fmt.Sprintf("%s?threads=%d", s.dbPath, min(4, runtime.GOMAXPROCS(0))), nil)
		if err != nil {
			s.initErr = err
			return
		}
		s.connector = connector
		// Both pools share the same native database. Store owns the connector;
		// closing either pool must not close it while the other is still in use.
		shared := poolConnector{connector}
		s.db = sql.OpenDB(shared)
		s.db.SetMaxOpenConns(4)
		s.db.SetMaxIdleConns(4)
		s.writer = sql.OpenDB(shared)
		s.writer.SetMaxOpenConns(1)
		s.writer.SetMaxIdleConns(1)

	})
	return s.initErr
}

// Close cancels running/waiting work, joins it, then releases all native handles.
// A closed Store never reopens implicitly.
func (s *Store) Close() error {
	s.closeOnce.Do(func() {
		s.cancel()
		s.life.Lock()
		defer s.life.Unlock()
		if s.writer != nil {
			s.closeErr = s.writer.Close()
		}
		if s.db != nil {
			s.closeErr = errors.Join(s.closeErr, s.db.Close())
		}
		if s.connector != nil {
			s.closeErr = errors.Join(s.closeErr, s.connector.Close())
		}
	})
	return s.closeErr
}

func (s *Store) operation(parent context.Context, fn func(context.Context) error) error {
	s.life.RLock()
	defer s.life.RUnlock()
	if s.ctx.Err() != nil {
		return fmt.Errorf("evidence database is closed")
	}
	ctx, cancel := context.WithTimeout(parent, operationTimeout)
	stop := context.AfterFunc(s.ctx, cancel)
	defer stop()
	defer cancel()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.engine(); err != nil {
		return err
	}
	return fn(ctx)
}

// write is the only write path. Errors (including cancellation) roll back before
// another batch can use the connection. Counters are discarded on any failure.
func (s *Store) write(parent context.Context, fn func(context.Context, *sql.Tx) error) error {
	return s.operation(parent, func(ctx context.Context) error {
		select {
		case s.writeSlot <- struct{}{}:
		case <-ctx.Done():
			return ctx.Err()
		}
		defer func() { <-s.writeSlot }()
		tx, err := s.writer.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		err = fn(ctx, tx)
		if err == nil {
			err = tx.Commit()
		}
		if err != nil {
			s.counts.valid = false
		}
		return err
	})
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// Keep the existing typed JSON contract using DuckDB's own JSON serialization.
// Raw event/source fields are VARCHAR, so their exact bytes stay strings; no
// conversion through Go float64 or inferred field types can change the evidence.
func queryJSONOn(ctx context.Context, db queryer, query string, dst any) error {
	query = strings.TrimSuffix(strings.TrimSpace(query), ";")
	rows, err := db.QueryContext(ctx, "SELECT to_json(result)::VARCHAR FROM ("+query+") AS result")
	if err != nil {
		return err
	}
	defer rows.Close()
	var out bytes.Buffer
	out.WriteByte('[')
	for rows.Next() {
		var row string
		if err := rows.Scan(&row); err != nil {
			return err
		}
		if out.Len() > 1 {
			out.WriteByte(',')
		}
		out.WriteString(row)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	out.WriteByte(']')
	return json.Unmarshal(out.Bytes(), dst)
}

func (s *Store) queryJSON(query string, dst any) error {
	return s.operation(context.Background(), func(ctx context.Context) error {
		return queryJSONOn(ctx, s.db, query, dst)
	})
}

// Count returns the number of committed searchable events.
func (s *Store) Count() (int, error) {
	var rows []struct {
		N int `json:"n"`
	}
	if err := s.queryJSON("SELECT count(*) AS n FROM events", &rows); err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}
	return rows[0].N, nil
}

func sqlStr(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// eventCols projects searchable fields; raw retains the source JSON object bytes.
const eventCols = `
  json_extract_string(r,'$.eventID')                   AS eventID,
  json_extract_string(r,'$.eventTime')                 AS eventTime,
  try_cast(json_extract_string(r,'$.eventTime') AS TIMESTAMP) AS ts,
  json_extract_string(r,'$.eventName')                 AS eventName,
  json_extract_string(r,'$.eventSource')               AS eventSource,
  json_extract_string(r,'$.awsRegion')                 AS awsRegion,
  json_extract_string(r,'$.sourceIPAddress')           AS sourceIPAddress,
  json_extract_string(r,'$.userAgent')                 AS userAgent,
  json_extract_string(r,'$.userIdentity.type')         AS identityType,
  json_extract_string(r,'$.userIdentity.arn')          AS identityArn,
  coalesce(nullif(json_extract_string(r,'$.userIdentity.userName'),''), json_extract_string(r,'$.userIdentity.sessionContext.sessionIssuer.userName')) AS userName,
  json_extract_string(r,'$.userIdentity.accountId')    AS accountId,
  json_extract_string(r,'$.userIdentity.principalId')  AS principalId,
  json_extract_string(r,'$.userIdentity.sessionContext.sessionIssuer.arn') AS roleArn,
  split_part(json_extract_string(r,'$.userIdentity.principalId'), ':', 2)  AS sessionName,
  json_extract_string(r,'$.userIdentity.accessKeyId')                  AS accessKeyId,
  json_extract_string(r,'$.responseElements.credentials.accessKeyId')  AS issuedKeyId,
  json_extract_string(r,'$.responseElements.assumedRoleUser.arn')      AS issuedRoleArn,
  json_extract_string(r,'$.userIdentity.invokedBy')                    AS invokedBy,
  json_extract_string(r,'$.userIdentity.sessionContext.sourceIdentity') AS sourceIdentity,
  json_extract_string(r,'$.errorCode')                 AS errorCode,
  json_extract_string(r,'$.errorMessage')              AS errorMessage,
  json_extract_string(r,'$.recipientAccountId')        AS recipientAccountId,
  COALESCE(try_cast(json_extract(r,'$.readOnly') AS BOOLEAN), false)       AS readOnly,
  COALESCE(try_cast(json_extract(r,'$.managementEvent') AS BOOLEAN), true) AS managementEvent,
  r::VARCHAR AS raw`
