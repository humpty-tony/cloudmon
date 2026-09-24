// Package store is CloudMon's scalable query engine. It drives the DuckDB CLI as
// a subprocess (NOT via CGO) so the Go app stays pure-Go and cross-compilable for
// Windows, macOS, and Linux. Imports stream into a private staging file and commit
// searchable events plus source observations atomically. The UI
// then asks for windows + aggregates via SQL instead of holding the dataset in JS.
package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Store is a handle to an on-disk DuckDB database backing one loaded dataset.
type Store struct {
	mu     sync.Mutex // one CLI process owns this database at a time
	bin    string     // path to the duckdb CLI binary
	dbPath string     // on-disk database file
}

func New(bin, dbPath string) *Store { return &Store{bin: bin, dbPath: dbPath} }

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

// run serializes CLI processes so readers and writers cannot contend for this
// Store's database lock. Brief retries still tolerate locks from other processes.
// Each subprocess has a deadline; hideWindow avoids console popups on Windows.
func (s *Store) run(jsonOut, readonly bool, sql string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	args := []string{"-bail"}
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
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, s.bin, args...)
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
