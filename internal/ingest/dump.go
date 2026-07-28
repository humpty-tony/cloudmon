// Package ingest loads CloudTrail events from exported files and (later) live
// sources, normalizing everything to model.CloudTrailEvent. The parser accepts
// every common export shape so a user can point CloudMon at whatever they have.
package ingest

import (
	"bytes"
	"compress/gzip"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"cloudmon/internal/model"
)

// ParseDump parses a CloudTrail export from raw bytes. Supported shapes:
//   - gzip of any of the below (S3 log files are gzipped)
//   - {"Records": [ <event>, ... ]}           console "Download as JSON" + S3 logs
//   - {"Events": [ {"CloudTrailEvent": "<json string>"}, ... ]}   `aws cloudtrail lookup-events`
//   - [ <event>, ... ]                         bare array
//   - one <event> JSON object per line         NDJSON
//   - CSV                                       console "Download as CSV" (lossy)
//
// Events are returned sorted oldest-first with a monotonic Seq assigned in that
// order, matching the live stream's ordering contract.
func ParseDump(data []byte) ([]model.CloudTrailEvent, error) {
	var err error
	if data, err = maybeGunzip(data); err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("file is empty")
	}

	var events []model.CloudTrailEvent
	switch trimmed[0] {
	case '{':
		events, err = parseJSONObject(trimmed)
		if err != nil {
			// Not a single JSON object - likely NDJSON (one event per line).
			if nd, ndErr := parseNDJSON(trimmed); ndErr == nil && len(nd) > 0 {
				events, err = nd, nil
			}
		}
	case '[':
		events, err = parseRecords(trimmed)
	default:
		if looksLikeCSV(trimmed) {
			events, err = parseCSV(trimmed)
		} else {
			events, err = parseNDJSON(trimmed)
		}
	}
	if err != nil {
		return nil, err
	}
	if len(events) == 0 {
		return nil, fmt.Errorf("no CloudTrail events found in file")
	}
	// Guard against arbitrary JSON: a real CloudTrail record always has an eventName.
	named := 0
	for i := range events {
		if events[i].EventName != "" {
			named++
		}
	}
	if named == 0 {
		return nil, fmt.Errorf("this doesn't look like a CloudTrail export - no events with an eventName")
	}
	assignSeq(events)
	return events, nil
}

func maybeGunzip(data []byte) ([]byte, error) {
	if len(data) < 2 || data[0] != 0x1f || data[1] != 0x8b {
		return data, nil // not gzip
	}
	r, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("gunzip: %w", err)
	}
	defer r.Close()
	out, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("gunzip read: %w", err)
	}
	return out, nil
}

// top-level object: either {Records:[...]} or {Events:[{CloudTrailEvent:"..."}]}
// or (fallback) a single event object.
func parseJSONObject(data []byte) ([]model.CloudTrailEvent, error) {
	var envelope struct {
		Records json.RawMessage `json:"Records"`
		Events  []struct {
			CloudTrailEvent string `json:"CloudTrailEvent"`
		} `json:"Events"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	if len(envelope.Records) > 0 {
		return parseRecords(envelope.Records)
	}
	if len(envelope.Events) > 0 {
		out := make([]model.CloudTrailEvent, 0, len(envelope.Events))
		for _, ev := range envelope.Events {
			if ev.CloudTrailEvent == "" {
				continue
			}
			e, err := model.FromRawJSON([]byte(ev.CloudTrailEvent))
			if err != nil {
				continue // skip malformed records rather than failing the whole import
			}
			out = append(out, e)
		}
		return out, nil
	}
	// fallback: a single bare event object
	e, err := model.FromRawJSON(data)
	if err != nil {
		return nil, fmt.Errorf("unrecognized JSON object (no Records/Events): %w", err)
	}
	return []model.CloudTrailEvent{e}, nil
}

func parseRecords(data []byte) ([]model.CloudTrailEvent, error) {
	var raws []json.RawMessage
	if err := json.Unmarshal(data, &raws); err != nil {
		return nil, fmt.Errorf("invalid records array: %w", err)
	}
	out := make([]model.CloudTrailEvent, 0, len(raws))
	for _, raw := range raws {
		e, err := model.FromRawJSON(raw)
		if err != nil {
			continue
		}
		out = append(out, e)
	}
	return out, nil
}

func parseNDJSON(data []byte) ([]model.CloudTrailEvent, error) {
	var out []model.CloudTrailEvent
	for _, line := range bytes.Split(data, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		e, err := model.FromRawJSON(line)
		if err != nil {
			continue
		}
		out = append(out, e)
	}
	return out, nil
}

func looksLikeCSV(data []byte) bool {
	// first line has commas and a header-ish token
	nl := bytes.IndexByte(data, '\n')
	first := data
	if nl >= 0 {
		first = data[:nl]
	}
	low := strings.ToLower(string(first))
	return bytes.ContainsRune(first, ',') && (strings.Contains(low, "event") || strings.Contains(low, "time"))
}

// parseCSV handles the console "Event history → Download as CSV" export, which is
// flattened and lossy (no requestParameters/responseElements). Columns are mapped
// case-insensitively by header name so minor header variations still work.
func parseCSV(data []byte) ([]model.CloudTrailEvent, error) {
	r := csv.NewReader(bytes.NewReader(data))
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("invalid CSV: %w", err)
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("CSV has no data rows")
	}
	idx := map[string]int{}
	for i, h := range rows[0] {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	col := func(row []string, names ...string) string {
		for _, n := range names {
			if i, ok := idx[n]; ok && i < len(row) {
				return strings.TrimSpace(row[i])
			}
		}
		return ""
	}
	out := make([]model.CloudTrailEvent, 0, len(rows)-1)
	for _, row := range rows[1:] {
		if len(row) == 0 {
			continue
		}
		e := model.CloudTrailEvent{
			EventID:         col(row, "event id", "eventid"),
			EventTime:       col(row, "event time", "eventtime"),
			EventName:       col(row, "event name", "eventname"),
			EventSource:     col(row, "event source", "eventsource"),
			AWSRegion:       col(row, "aws region", "awsregion", "region"),
			SourceIPAddress: col(row, "source ip address", "sourceipaddress", "source ip"),
			ErrorCode:       col(row, "error code", "errorcode"),
			ManagementEvent: true,
		}
		userName := col(row, "user name", "username")
		e.UserIdentity = model.UserIdentity{UserName: userName, ARN: col(row, "arn", "user arn")}
		if pretty, mErr := json.MarshalIndent(e, "", "  "); mErr == nil {
			e.RawJSON = string(pretty)
		}
		out = append(out, e)
	}
	return out, nil
}

func assignSeq(events []model.CloudTrailEvent) {
	sort.SliceStable(events, func(i, j int) bool {
		ti, ei := time.Parse(time.RFC3339, events[i].EventTime)
		tj, ej := time.Parse(time.RFC3339, events[j].EventTime)
		if ei != nil || ej != nil {
			// Unparseable timestamps sort after parseable ones; two unparseable (or
			// equal) entries keep their original order (SliceStable). Returning a
			// consistent result here keeps this a valid strict weak ordering.
			return ei == nil && ej != nil
		}
		return ti.Before(tj)
	})
	for i := range events {
		events[i].Seq = int64(i + 1)
	}
}
