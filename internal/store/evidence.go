package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"cloudmon/internal/ingest"
	"cloudmon/internal/model"
)

const evidenceVersion = "1"
const observationColumns = `eventKey VARCHAR, sha256 VARCHAR, raw VARCHAR, original VARCHAR, source VARCHAR, ordinal BIGINT, format VARCHAR, lossy BOOLEAN, observedAt VARCHAR`
const emptyObservations = `CREATE TABLE IF NOT EXISTS observations (id BIGINT, ` + observationColumns + `);`

func evidenceSchema() string {
	return `CREATE TABLE IF NOT EXISTS app_state (key VARCHAR PRIMARY KEY, value VARCHAR);` +
		`CREATE TABLE IF NOT EXISTS events AS SELECT 0::BIGINT AS seq,` + eventCols + `, ''::VARCHAR AS eventKey, ''::VARCHAR AS evidenceHash FROM (SELECT '{}'::JSON AS r) WHERE false;` +
		emptyObservations + evidenceIndexes
}

const evidenceIndexes = `CREATE UNIQUE INDEX IF NOT EXISTS idx_event_key ON events(eventKey);
CREATE INDEX IF NOT EXISTS idx_seq ON events(seq);
CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_akid ON events(accessKeyId);
CREATE INDEX IF NOT EXISTS idx_ikid ON events(issuedKeyId);
CREATE INDEX IF NOT EXISTS idx_observation_key ON observations(eventKey);`

// Open initializes an empty store without deleting an existing dataset. Schema
// validation, initial creation, and versioning share one transaction.
func (s *Store) Open() error {
	err := s.write(context.Background(), func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS app_state (key VARCHAR PRIMARY KEY, value VARCHAR)`); err != nil {
			return err
		}
		var version string
		err := tx.QueryRowContext(ctx, "SELECT value FROM app_state WHERE key='evidenceVersion'").Scan(&version)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if version != "" && version != evidenceVersion {
			return fmt.Errorf("unsupported evidence schema %s", version)
		}
		var tables int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_name IN ('events','observations')`).Scan(&tables); err != nil {
			return err
		}
		if version == "" {
			if tables > 0 {
				return fmt.Errorf("unversioned evidence database; open a new database and re-import the source files")
			}
			if _, err := tx.ExecContext(ctx, evidenceSchema()+"INSERT INTO app_state VALUES ('evidenceVersion',"+sqlStr(evidenceVersion)+")"); err != nil {
				return err
			}
		} else {
			if tables != 2 {
				return fmt.Errorf("saved evidence schema is incomplete; the database has been retained")
			}
			// Older empty databases did not get lookup indexes until first ingest.
			if _, err := tx.ExecContext(ctx, evidenceIndexes); err != nil {
				return err
			}
		}
		return s.loadCounters(ctx, tx)
	})
	if err != nil {
		return err
	}
	return os.Chmod(s.dbPath, 0o600)
}

// This scan runs once at open (or after a failed transaction), never per batch.
// Counters are an optimization only: the durable evidence tables are authoritative.
func (s *Store) loadCounters(ctx context.Context, tx *sql.Tx) error {
	var counts evidenceCounters
	if err := tx.QueryRowContext(ctx, "SELECT count(*), coalesce(max(seq),0) FROM events").Scan(&counts.events, &counts.seq); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx, "SELECT coalesce(max(id),0) FROM observations").Scan(&counts.observation); err != nil {
		return err
	}
	counts.valid = true
	s.counts = counts
	return nil
}

func (s *Store) GetState(key string) (string, error) {
	var rows []struct {
		Value string `json:"value"`
	}
	if err := s.queryJSON("SELECT value FROM app_state WHERE key="+sqlStr(key), &rows); err != nil {
		return "", err
	}
	if len(rows) == 0 {
		return "", nil
	}
	return rows[0].Value, nil
}
func (s *Store) SetState(key, value string) error {
	return s.write(context.Background(), func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, "INSERT INTO app_state VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value", key, value)
		return err
	})
}

type observation struct {
	Position int64  `json:"position"`
	EventKey string `json:"eventKey"`
	SHA256   string `json:"sha256"`
	ingest.Record
	ObservedAt string `json:"observedAt"`
}

func makeObservation(record ingest.Record) (observation, error) {
	if !utf8.ValidString(record.Raw) || !utf8.ValidString(record.Original) {
		return observation{}, fmt.Errorf("source record is not valid UTF-8")
	}
	event, err := model.FromRawJSON([]byte(record.Raw))
	if err != nil || event.EventName == "" {
		return observation{}, fmt.Errorf("invalid CloudTrail record from %s at %d", record.Source, record.Ordinal)
	}
	hash := sha256.Sum256([]byte(record.Original))
	digest := hex.EncodeToString(hash[:])
	key := "content:" + digest
	if event.EventID != "" && event.RecipientAccount != "" {
		scoped, _ := json.Marshal([]string{event.RecipientAccount, event.EventID})
		key = "event:" + string(scoped)
	}
	return observation{EventKey: key, SHA256: digest, Record: record, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}, nil
}

// stageEvidence serializes strings explicitly, avoiding DuckDB schema inference
// over source JSON. The stage is private and disposable until its final commit.
func stageEvidence(produce func(func(ingest.Record) error) error) (string, int, error) {
	file, err := os.CreateTemp("", "cloudmon-stage-*.ndjson")
	if err != nil {
		return "", 0, err
	}
	path := file.Name()
	ok := false
	defer func() {
		file.Close()
		if !ok {
			os.Remove(path)
		}
	}()
	encoder := json.NewEncoder(file)
	count := 0
	err = produce(func(record ingest.Record) error {
		observation, err := makeObservation(record)
		if err != nil {
			return err
		}
		observation.Position = int64(count + 1)
		if err = encoder.Encode(observation); err == nil {
			count++
		}
		return err
	})
	if err != nil {
		return "", 0, err
	}
	if count == 0 {
		return "", 0, fmt.Errorf("no CloudTrail events found")
	}
	if err = file.Close(); err != nil {
		return "", 0, err
	}
	ok = true
	return path, count, nil
}

func (s *Store) commitStage(path string, replace bool) (int, error) {
	return s.commitStageContext(context.Background(), path, replace)
}

func (s *Store) commitStageContext(parent context.Context, path string, replace bool) (int, error) {
	var total int
	err := s.write(parent, func(ctx context.Context, tx *sql.Tx) error {
		if replace {
			// Capture state stays in app_state; replacing evidence cannot orphan it.
			if _, err := tx.ExecContext(ctx, "DROP TABLE events; DROP TABLE observations;"+evidenceSchema()); err != nil {
				return err
			}
			s.counts = evidenceCounters{valid: true}
		} else if !s.counts.valid {
			if err := s.loadCounters(ctx, tx); err != nil {
				return err
			}
		}
		// The staging table is connection-local and explicitly dropped on success.
		// Rollback removes it on failure, allowing the next batch to retry safely.
		if _, err := tx.ExecContext(ctx, `CREATE TEMP TABLE incoming AS SELECT * FROM read_json(?, format='newline_delimited', columns={position:'BIGINT',eventKey:'VARCHAR',sha256:'VARCHAR',raw:'VARCHAR',original:'VARCHAR',source:'VARCHAR',ordinal:'BIGINT',format:'VARCHAR',lossy:'BOOLEAN',observedAt:'VARCHAR'})`, path); err != nil {
			return err
		}
		observed, err := tx.ExecContext(ctx, `INSERT INTO observations SELECT ?+row_number() OVER (ORDER BY position), eventKey,sha256,raw,original,source,ordinal,format,lossy,observedAt FROM incoming`, s.counts.observation)
		if err != nil {
			return err
		}
		observedCount, err := observed.RowsAffected()
		if err != nil {
			return err
		}
		inserted, err := tx.ExecContext(ctx, `INSERT INTO events SELECT ?+row_number() OVER (ORDER BY json_extract_string(r,'$.eventTime'), eventKey) AS seq,`+eventCols+`,eventKey,sha256 AS evidenceHash FROM (SELECT raw AS r,eventKey,sha256 FROM incoming QUALIFY row_number() OVER (PARTITION BY eventKey ORDER BY position)=1) AS candidates WHERE NOT EXISTS (SELECT 1 FROM events WHERE events.eventKey=candidates.eventKey)`, s.counts.seq)
		if err != nil {
			return err
		}
		insertedCount, err := inserted.RowsAffected()
		if err != nil {
			return err
		}
		if replace {
			if _, err := tx.ExecContext(ctx, `INSERT INTO app_state VALUES ('datasetImportedAt',?) ON CONFLICT (key) DO UPDATE SET value=excluded.value`, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, "DROP TABLE incoming"); err != nil {
			return err
		}
		// write invalidates these values if COMMIT fails. No reader uses them.
		s.counts.observation += observedCount
		s.counts.events += insertedCount
		s.counts.seq += insertedCount
		total = int(s.counts.events)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return total, nil
}

// Ingest validates every file before replacing the active dataset in one transaction.
func (s *Store) Ingest(path string) (int, error) {
	paths, err := inputFiles(path)
	if err != nil {
		return 0, err
	}
	stage, _, err := stageEvidence(func(emit func(ingest.Record) error) error {
		for _, path := range paths {
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			err = ingest.Stream(file, path, emit)
			closeErr := file.Close()
			if err != nil {
				return err
			}
			if closeErr != nil {
				return closeErr
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	defer os.Remove(stage)
	return s.commitStage(stage, true)
}
func (s *Store) IngestReader(reader io.Reader, source string) (int, error) {
	stage, _, err := stageEvidence(func(emit func(ingest.Record) error) error { return ingest.Stream(reader, source, emit) })
	if err != nil {
		return 0, err
	}
	defer os.Remove(stage)
	return s.commitStage(stage, true)
}
func (s *Store) AppendEvents(events []model.CloudTrailEvent) (int, error) {
	return s.AppendFrom(events, "live-capture")
}
func (s *Store) AppendFrom(events []model.CloudTrailEvent, source string) (int, error) {
	return s.AppendFromContext(context.Background(), events, source)
}

func (s *Store) AppendFromContext(ctx context.Context, events []model.CloudTrailEvent, source string) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if len(events) == 0 {
		return s.Count()
	}
	stage, _, err := stageEvidence(func(emit func(ingest.Record) error) error {
		for i, event := range events {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := emit(ingest.Record{Raw: event.RawJSON, Original: event.RawJSON, Source: source, Ordinal: int64(i + 1), Format: "cloudtrail-json"}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	defer os.Remove(stage)
	return s.commitStageContext(ctx, stage, false)
}

func inputFiles(path string) ([]string, error) {
	matches := []string{path}
	if _, err := os.Stat(path); err != nil {
		var globErr error
		matches, globErr = filepath.Glob(path)
		if globErr != nil {
			return nil, globErr
		}
	}
	if len(matches) == 0 {
		return nil, fmt.Errorf("no input files match %s", path)
	}
	var paths []string
	for _, match := range matches {
		stat, err := os.Stat(match)
		if err != nil {
			return nil, err
		}
		if !stat.IsDir() {
			paths = append(paths, match)
			continue
		}
		err = filepath.WalkDir(match, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			name := strings.ToLower(entry.Name())
			if strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".jsonl") || strings.HasSuffix(name, ".ndjson") || strings.HasSuffix(name, ".csv") || strings.HasSuffix(name, ".gz") {
				paths = append(paths, path)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	for i, path := range paths {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return nil, err
		}
		paths[i] = absolute
	}
	sort.Strings(paths)
	unique := paths[:0]
	for _, path := range paths {
		if len(unique) == 0 || path != unique[len(unique)-1] {
			unique = append(unique, path)
		}
	}
	if len(unique) == 0 {
		return nil, fmt.Errorf("no supported input files found")
	}
	return unique, nil
}
