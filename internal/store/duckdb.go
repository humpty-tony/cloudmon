// Package store is CloudMon's scalable query engine. It drives the DuckDB CLI as
// a subprocess (NOT via CGO) so the Go app stays pure-Go and cross-compilable for
// Windows, macOS, and Linux. On ingest, DuckDB streams read_json over the file/dir/gz
// and builds an on-disk table (memory-bounded, so it handles multi-GB dumps). The UI
// then asks for windows + aggregates via SQL instead of holding the dataset in JS.
package store

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"cloudmon/internal/model"
)

// Store is a handle to an on-disk DuckDB database backing one loaded dataset.
type Store struct {
	bin    string // path to the duckdb CLI binary
	dbPath string // on-disk database file
}

func New(bin, dbPath string) *Store { return &Store{bin: bin, dbPath: dbPath} }

// selectCols projects one JSON record column `r` into the typed event columns the
// UI needs. `seq` is a chronological monotonic id; `ts` is used for the histogram;
// `raw` keeps the original record for the lazily-fetched detail pane.
const seqExpr = "row_number() OVER (ORDER BY json_extract_string(r,'$.eventTime'))"

// eventCols is every column after seq. A fresh Ingest prepends seqExpr; AppendEvents
// (live streaming) prepends its own MAX(seq)-offset expression so seq stays monotonic
// across batches.
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

// selectCols is the full projection (seq + eventCols) used by a fresh Ingest.
const selectCols = "\n  " + seqExpr + " AS seq," + eventCols

const maxObj = "1073741824" // 1 GiB max single JSON object (a whole Records file counts as one object)

// run executes SQL against the on-disk DB. readonly opens the DB read-only, which
// DuckDB allows many processes to do concurrently (write opens take an exclusive
// lock - so all queries MUST be read-only or they collide). hideWindow suppresses
// the console window each subprocess would otherwise pop up on Windows.
// run executes SQL, retrying briefly on a DuckDB file-lock conflict. Because each
// call is its own subprocess, the live-capture writer (a brief exclusive-lock write)
// and the read-only query subprocesses can momentarily collide; a bounded backoff
// lets whichever lost the race succeed on a retry instead of surfacing an error.
func (s *Store) run(jsonOut, readonly bool, sql string) ([]byte, error) {
	const maxTries = 12
	var lastErr error
	for try := 0; try < maxTries; try++ {
		out, err := s.runOnce(jsonOut, readonly, sql)
		if err == nil {
			if jsonOut {
				out = trimToJSON(out) // strip any ANSI/warning noise DuckDB prints before the JSON
			}
			return out, nil
		}
		lastErr = err
		if !isLockErr(err) {
			return nil, err
		}
		time.Sleep(time.Duration(20+try*15) * time.Millisecond)
	}
	return nil, lastErr
}

// isLockErr reports whether err is DuckDB failing to acquire the database file lock
// (another process holds a conflicting read-only/read-write open).
func isLockErr(err error) bool {
	if err == nil {
		return false
	}
	m := strings.ToLower(err.Error())
	return strings.Contains(m, "conflicting lock") ||
		strings.Contains(m, "set lock") ||
		strings.Contains(m, "could not set lock") ||
		strings.Contains(m, "being used by another")
}

func (s *Store) runOnce(jsonOut, readonly bool, sql string) ([]byte, error) {
	args := []string{}
	if readonly {
		args = append(args, "-readonly")
	}
	args = append(args, s.dbPath)
	if jsonOut {
		args = append(args, "-json")
	}
	// Feed SQL on stdin, NOT via -c. A large filter - "Sensitive only" compiles to
	// eventName IN (~270 values), and the facets query repeats the WHERE clause once
	// per field - can exceed the Windows ~32 KB command-line limit, making
	// CreateProcess fail (the query silently returns nothing). stdin has no such cap.
	cmd := exec.Command(s.bin, args...)
	hideWindow(cmd)
	cmd.Stdin = strings.NewReader(sql)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("duckdb: %v: %s", err, strings.TrimSpace(errb.String()))
	}
	return out.Bytes(), nil
}

func (s *Store) queryJSON(sql string, dst any) error {
	b, err := s.run(true, true, sql) // reads are always read-only
	if err != nil {
		return err
	}
	b = bytes.TrimSpace(b)
	if len(b) == 0 {
		return nil // empty result set → leave dst as-is
	}
	return json.Unmarshal(b, dst)
}

// Ingest detects the export shape of path (a file, gzip, directory or glob) and
// builds the on-disk `events` table. Returns the number of events loaded.
func (s *Store) Ingest(path string) (int, error) {
	src, err := recordSource(path)
	if err != nil {
		return 0, err
	}
	sql := "DROP TABLE IF EXISTS events;\nCREATE TABLE events AS SELECT" + selectCols + "\nFROM " + src +
		"\nWHERE json_extract_string(r,'$.eventName') IS NOT NULL;"
	if _, err := s.run(false, false, sql); err != nil {
		return 0, err
	}
	// speed up ordering/filtering on big tables
	_, _ = s.run(false, false, "CREATE INDEX IF NOT EXISTS idx_seq ON events(seq); CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);")
	// join keys for assumed-role lineage walking (accessKeyId ↔ issuedKeyId)
	_, _ = s.run(false, false, "CREATE INDEX IF NOT EXISTS idx_akid ON events(accessKeyId); CREATE INDEX IF NOT EXISTS idx_ikid ON events(issuedKeyId);")
	var res []struct {
		N int `json:"n"`
	}
	if err := s.queryJSON("SELECT count(*) AS n FROM events;", &res); err != nil {
		return 0, err
	}
	if len(res) == 0 {
		return 0, nil
	}
	if res[0].N == 0 {
		return 0, fmt.Errorf("no CloudTrail events found (unrecognized export shape or empty file)")
	}
	return res[0].N, nil
}

// AppendEvents inserts a batch of already-parsed live events into the on-disk
// `events` table, creating it (with the same schema as Ingest) if this is the first
// batch. seq continues after the current MAX(seq) so ordering stays monotonic across
// batches. Used by the live SQS capture path. Returns the table's total row count
// after the insert (authoritative for the UI counter - no separate read needed).
func (s *Store) AppendEvents(evs []model.CloudTrailEvent) (int, error) {
	if len(evs) == 0 {
		return 0, nil
	}
	tmp, err := os.CreateTemp("", "cloudmon-live-*.ndjson")
	if err != nil {
		return 0, err
	}
	name := tmp.Name()
	defer os.Remove(name)
	var buf bytes.Buffer
	written := 0
	for _, e := range evs {
		buf.Reset()
		if json.Compact(&buf, []byte(e.RawJSON)) != nil {
			continue // skip records whose raw JSON won't compact to one line
		}
		buf.WriteByte('\n')
		if _, err := tmp.Write(buf.Bytes()); err != nil {
			tmp.Close()
			return 0, err
		}
		written++
	}
	if err := tmp.Close(); err != nil {
		return 0, err
	}
	if written == 0 {
		return 0, nil
	}

	// One JSON record per line → the same `r` projection Ingest uses.
	src := "(SELECT to_json(j) AS r FROM read_json(" + sqlStr(name) +
		", format='newline_delimited', records=true, ignore_errors=true, union_by_name=true) AS j)"
	// Single subprocess (one exclusive-lock window): create-if-missing, ensure the
	// indexes, then insert with a MAX(seq)-offset seq. The NOT EXISTS on eventID drops
	// events already in the table, so an SQS redelivery (e.g. a batch buffered but not
	// yet acked when capture paused, then re-received on resume) can't create duplicate
	// rows. Events without an eventID are kept as-is (nothing to dedupe on).
	sql := "CREATE TABLE IF NOT EXISTS events AS SELECT" + selectCols + "\nFROM " + src + "\nWHERE false;\n" +
		"CREATE INDEX IF NOT EXISTS idx_seq ON events(seq);\n" +
		"CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);\n" +
		"CREATE INDEX IF NOT EXISTS idx_akid ON events(accessKeyId);\n" +
		"CREATE INDEX IF NOT EXISTS idx_ikid ON events(issuedKeyId);\n" +
		"INSERT INTO events SELECT\n  (SELECT COALESCE(MAX(seq),0) FROM events) + " + seqExpr + " AS seq," + eventCols +
		"\nFROM " + src + "\nWHERE json_extract_string(r,'$.eventName') IS NOT NULL" +
		"\n  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.eventID <> '' AND e.eventID = json_extract_string(r,'$.eventID'));"
	if _, err := s.run(false, false, sql); err != nil {
		return 0, err
	}
	return s.Count()
}

// Count returns the number of events currently in the table (0 if none loaded yet).
func (s *Store) Count() (int, error) {
	var res []struct {
		N int `json:"n"`
	}
	if err := s.queryJSON("SELECT count(*) AS n FROM events;", &res); err != nil {
		return 0, err
	}
	if len(res) == 0 {
		return 0, nil
	}
	return res[0].N, nil
}

// recordSource returns a SQL subquery that yields a single JSON column `r`, one row
// per CloudTrail record, for whichever export shape `path` is.
func recordSource(path string) (string, error) {
	glob := path
	if fi, err := os.Stat(path); err == nil && fi.IsDir() {
		glob = filepath.Join(path, "**", "*") // recurse S3-style date partitions
	}
	g := sqlStr(glob)
	head := bytes.TrimSpace(peek(sampleFile(path), 65536))
	switch {
	case bytes.Contains(head, []byte(`"Records"`)):
		return "(SELECT unnest(Records) AS r FROM read_json(" + g + ", columns={Records: 'JSON[]'}, maximum_object_size=" + maxObj + ", ignore_errors=true))", nil
	case bytes.Contains(head, []byte(`"CloudTrailEvent"`)):
		return "(SELECT json(json_extract_string(e,'$.CloudTrailEvent')) AS r FROM (SELECT unnest(Events) AS e FROM read_json(" + g + ", columns={Events: 'JSON[]'}, maximum_object_size=" + maxObj + ", ignore_errors=true)))", nil
	case len(head) > 0 && head[0] == '[':
		return "(SELECT to_json(j) AS r FROM read_json(" + g + ", records=true, maximum_object_size=" + maxObj + ", ignore_errors=true, union_by_name=true) AS j)", nil
	case len(head) > 0 && head[0] == '{':
		return "(SELECT to_json(j) AS r FROM read_json(" + g + ", format='newline_delimited', records=true, ignore_errors=true, union_by_name=true) AS j)", nil
	}
	return "", fmt.Errorf("this doesn't look like a CloudTrail JSON export")
}

// sampleFile returns a concrete file to peek at for shape detection (the first file
// when path is a directory), or path itself.
func sampleFile(path string) string {
	fi, err := os.Stat(path)
	if err != nil || !fi.IsDir() {
		return path
	}
	var found string
	_ = filepath.Walk(path, func(p string, info os.FileInfo, err error) error {
		if err != nil || found != "" || info.IsDir() {
			return nil
		}
		if strings.Contains(p, ".json") || strings.HasSuffix(p, ".gz") {
			found = p
		}
		return nil
	})
	return found
}

// peek reads up to n bytes from path, transparently gunzipping if needed.
func peek(path string, n int) []byte {
	if path == "" {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	head := make([]byte, n)
	m, _ := io.ReadFull(f, head)
	head = head[:m]
	if len(head) >= 2 && head[0] == 0x1f && head[1] == 0x8b {
		if _, err := f.Seek(0, io.SeekStart); err == nil {
			if gz, err := gzip.NewReader(f); err == nil {
				defer gz.Close()
				out := make([]byte, n)
				k, _ := io.ReadFull(gz, out)
				return out[:k]
			}
		}
	}
	return head
}

func sqlStr(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// ansiCSI matches ANSI control sequences (colors, cursor moves).
var ansiCSI = regexp.MustCompile("\x1b\\[[0-9;?]*[ -/]*[@-~]")

// trimToJSON makes DuckDB's -json output parseable even when the CLI prepends noise
// to stdout - e.g. v1.5.5 prints a colored "Deprecated lambda arrow (->)" warning
// there, and a progress bar can leak escape codes. It strips ANSI sequences; if the
// result still isn't valid JSON it finds the earliest '[' / '{' from which the rest
// parses cleanly, so a bracket inside warning text (a type name like INTEGER[]) can't
// cause a bad slice.
func trimToJSON(b []byte) []byte {
	b = ansiCSI.ReplaceAll(b, nil)
	if json.Valid(bytes.TrimSpace(b)) {
		return b
	}
	for i := 0; i < len(b); i++ {
		if (b[i] == '[' || b[i] == '{') && json.Valid(bytes.TrimSpace(b[i:])) {
			return b[i:]
		}
	}
	return b
}
