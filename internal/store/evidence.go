package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
		emptyObservations + `CREATE UNIQUE INDEX IF NOT EXISTS idx_event_key ON events(eventKey);`
}

// Open initializes an empty store without deleting an existing dataset. Refuse
// unknown schemas rather than modifying evidence created by a newer application.
func (s *Store) Open() error {
	if _, err := s.run(false, false, `CREATE TABLE IF NOT EXISTS app_state (key VARCHAR PRIMARY KEY, value VARCHAR);`); err != nil {
		return err
	}
	version, err := s.GetState("evidenceVersion")
	if err != nil {
		return err
	}
	if version != "" && version != evidenceVersion {
		return fmt.Errorf("unsupported evidence schema %s", version)
	}
	if version == "" {
		var rows []struct {
			N int `json:"n"`
		}
		if err := s.queryJSON(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name IN ('events','observations');`, &rows); err != nil {
			return err
		}
		if len(rows) > 0 && rows[0].N > 0 {
			return fmt.Errorf("unversioned evidence database; open a new database and re-import the source files")
		}
		// Schema and version become durable together, including on first launch.
		if _, err := s.run(false, false, "BEGIN TRANSACTION;"+evidenceSchema()+"INSERT INTO app_state VALUES ('evidenceVersion',"+sqlStr(evidenceVersion)+"); COMMIT;"); err != nil {
			return err
		}
	} else {
		var rows []struct {
			N int `json:"n"`
		}
		if err := s.queryJSON(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name IN ('events','observations');`, &rows); err != nil {
			return err
		}
		if len(rows) != 1 || rows[0].N != 2 {
			return fmt.Errorf("saved evidence schema is incomplete; the database has been retained")
		}
	}
	return os.Chmod(s.dbPath, 0o600)
}

func (s *Store) GetState(key string) (string, error) {
	var rows []struct {
		Value string `json:"value"`
	}
	if err := s.queryJSON("SELECT value FROM app_state WHERE key="+sqlStr(key)+";", &rows); err != nil {
		return "", err
	}
	if len(rows) == 0 {
		return "", nil
	}
	return rows[0].Value, nil
}
func (s *Store) SetState(key, value string) error {
	_, err := s.run(false, false, "INSERT INTO app_state VALUES ("+sqlStr(key)+","+sqlStr(value)+") ON CONFLICT (key) DO UPDATE SET value=excluded.value;")
	return err
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
	// A successful import replaces event/observation tables together. Capture state
	// stays in app_state so a failed or successful import cannot orphan resources.
	sql := "BEGIN TRANSACTION;"
	if replace {
		sql += "DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS observations;"
	}
	sql += evidenceSchema() + `CREATE TEMP TABLE incoming AS SELECT * FROM read_json(` + sqlStr(path) + `, format='newline_delimited', columns={position:'BIGINT',eventKey:'VARCHAR',sha256:'VARCHAR',raw:'VARCHAR',original:'VARCHAR',source:'VARCHAR',ordinal:'BIGINT',format:'VARCHAR',lossy:'BOOLEAN',observedAt:'VARCHAR'});`
	sql += `INSERT INTO observations SELECT (SELECT coalesce(max(id),0) FROM observations)+row_number() OVER (ORDER BY position), eventKey,sha256,raw,original,source,ordinal,format,lossy,observedAt FROM incoming;`
	sql += `INSERT INTO events SELECT (SELECT coalesce(max(seq),0) FROM events)+row_number() OVER (ORDER BY json_extract_string(r,'$.eventTime'), eventKey) AS seq,` + eventCols + `,eventKey,sha256 AS evidenceHash FROM (SELECT raw AS r,eventKey,sha256 FROM incoming QUALIFY row_number() OVER (PARTITION BY eventKey ORDER BY position)=1) AS candidates WHERE NOT EXISTS (SELECT 1 FROM events WHERE events.eventKey=candidates.eventKey);`
	sql += `CREATE INDEX IF NOT EXISTS idx_seq ON events(seq);CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);CREATE INDEX IF NOT EXISTS idx_akid ON events(accessKeyId);CREATE INDEX IF NOT EXISTS idx_ikid ON events(issuedKeyId);CREATE INDEX IF NOT EXISTS idx_observation_key ON observations(eventKey);`
	if replace {
		sql += `INSERT INTO app_state VALUES ('datasetImportedAt',` + sqlStr(time.Now().UTC().Format(time.RFC3339Nano)) + `) ON CONFLICT (key) DO UPDATE SET value=excluded.value;`
	}
	sql += `INSERT INTO app_state VALUES ('evidenceVersion',` + sqlStr(evidenceVersion) + `) ON CONFLICT (key) DO NOTHING; COMMIT; SELECT count(*) AS n FROM events;`
	out, err := s.run(true, false, sql)
	if err != nil {
		return 0, err
	}
	var rows []struct {
		N int `json:"n"`
	}
	if err = json.Unmarshal(out, &rows); err != nil {
		return 0, err
	}
	if len(rows) != 1 {
		return 0, fmt.Errorf("commit returned no event count")
	}
	return rows[0].N, nil
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
	if len(events) == 0 {
		return s.Count()
	}
	stage, _, err := stageEvidence(func(emit func(ingest.Record) error) error {
		for i, event := range events {
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
	return s.commitStage(stage, false)
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
