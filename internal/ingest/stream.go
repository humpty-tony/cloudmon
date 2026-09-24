package ingest

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"cloudmon/internal/model"
)

// Record separates the queryable JSON from its source evidence. For CSV, Raw is a
// lossy projection and Original contains the source header and row, without JSON
// number coercion. JSON records keep their original object bytes in both fields.
type Record struct {
	Raw      string `json:"raw"`
	Original string `json:"original"`
	Source   string `json:"source"`
	Ordinal  int64  `json:"ordinal"`
	Format   string `json:"format"`
	Lossy    bool   `json:"lossy"`
}

// Stream validates every record and emits it as soon as it is decoded. Callers
// stage emissions until EOF: an error must never publish a partial import.
func Stream(input io.Reader, source string, emit func(Record) error) error {
	reader := bufio.NewReader(input)
	if magic, _ := reader.Peek(2); bytes.Equal(magic, []byte{0x1f, 0x8b}) {
		gz, err := gzip.NewReader(reader)
		if err != nil {
			return fmt.Errorf("%s: gzip: %w", source, err)
		}
		defer gz.Close()
		reader = bufio.NewReader(gz)
	}
	if bom, _ := reader.Peek(3); bytes.Equal(bom, []byte{0xef, 0xbb, 0xbf}) {
		reader.Discard(3)
	}
	var ordinal int64
	output := func(raw, original, format string, lossy bool) error {
		event, err := model.FromRawJSON([]byte(raw))
		if err != nil || event.EventName == "" {
			return fmt.Errorf("%s: record %d is not a valid CloudTrail event", source, ordinal+1)
		}
		ordinal++
		return emit(Record{Raw: raw, Original: original, Source: source, Ordinal: ordinal, Format: format, Lossy: lossy})
	}
	first, err := peekValue(reader)
	if err != nil {
		return fmt.Errorf("%s: empty or unreadable input: %w", source, err)
	}
	if first != '{' && first != '[' {
		return streamCSV(reader, output)
	}
	replay := &replayReader{source: reader}
	reader = bufio.NewReader(replay)
	for {
		first, err = peekValue(reader)
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("%s: %w", source, err)
		}
		capture := &captureBuffer{enabled: true}
		decoder := json.NewDecoder(io.TeeReader(reader, capture))
		emitArray := func(format string) error {
			token, e := decoder.Token()
			if e != nil {
				return e
			}
			if token != json.Delim('[') {
				return fmt.Errorf("%s must be an array", format)
			}
			for decoder.More() {
				var raw json.RawMessage
				if e := decoder.Decode(&raw); e != nil {
					return e
				}
				if format == "event-history-json" {
					var wrapper struct {
						CloudTrailEvent string `json:"CloudTrailEvent"`
					}
					if e := json.Unmarshal(raw, &wrapper); e != nil {
						return e
					}
					if wrapper.CloudTrailEvent == "" {
						return fmt.Errorf("lookup event is missing CloudTrailEvent")
					}
					raw = json.RawMessage(wrapper.CloudTrailEvent)
				}
				if e := output(string(raw), string(raw), format, false); e != nil {
					return e
				}
			}
			_, e = decoder.Token()
			return e
		}
		switch first {
		case '[':
			capture.enabled = false
			err = emitArray("cloudtrail-json")
		case '{':
			_, err = decoder.Token()
			wrapped := false
			for err == nil && decoder.More() {
				var key any
				key, err = decoder.Token()
				if err != nil {
					break
				}
				if key == "Records" || key == "Events" {
					if wrapped {
						err = fmt.Errorf("multiple record containers in one object")
						break
					}
					wrapped = true
					capture.enabled = false
					capture.Reset()
					format := "cloudtrail-json"
					if key == "Events" {
						format = "event-history-json"
					}
					err = emitArray(format)
				} else {
					var value json.RawMessage
					err = decoder.Decode(&value)
				}
			}
			if err == nil {
				_, err = decoder.Token()
			}
			if err == nil && !wrapped {
				raw := string(capture.Bytes()[:decoder.InputOffset()])
				err = output(raw, raw, "cloudtrail-json", false)
			}
		default:
			err = fmt.Errorf("unexpected content after JSON records")
		}
		if err != nil {
			return fmt.Errorf("%s: after %d record(s): %w", source, ordinal, err)
		}
		// The decoder may read ahead; keep those bytes for the next NDJSON value.
		pending, _ := io.ReadAll(decoder.Buffered())
		buffered, _ := reader.Peek(reader.Buffered())
		pending = append(pending, buffered...)
		replay.pending = append(pending, replay.pending...)
		reader.Reset(replay)
	}
	if ordinal == 0 {
		return fmt.Errorf("%s: no CloudTrail events found", source)
	}
	return nil
}

// Reuse one underlying reader so long NDJSON files do not grow a recursive chain
// of decoder buffers. Pending data is bounded by read-ahead, not the file size.
type replayReader struct {
	source  io.Reader
	pending []byte
}

func (r *replayReader) Read(p []byte) (int, error) {
	if len(r.pending) > 0 {
		n := copy(p, r.pending)
		r.pending = r.pending[n:]
		return n, nil
	}
	return r.source.Read(p)
}

type captureBuffer struct {
	bytes.Buffer
	enabled bool
}

func (c *captureBuffer) Write(p []byte) (int, error) {
	if c.enabled {
		return c.Buffer.Write(p)
	}
	return len(p), nil
}
func peekValue(r *bufio.Reader) (byte, error) {
	for {
		b, e := r.Peek(1)
		if e != nil {
			return 0, e
		}
		if !strings.ContainsRune(" \r\n\t", rune(b[0])) {
			return b[0], nil
		}
		r.ReadByte()
	}
}

type recordOutput func(raw, original, format string, lossy bool) error

func streamCSV(input io.Reader, output recordOutput) error {
	capture := &captureBuffer{enabled: true}
	reader := csv.NewReader(io.TeeReader(input, capture))
	header, err := reader.Read()
	if err != nil {
		return fmt.Errorf("CSV header: %w", err)
	}
	var consumed int64
	take := func() string {
		n := reader.InputOffset() - consumed
		data := string(capture.Next(int(n)))
		consumed = reader.InputOffset()
		return data
	}
	originalHeader := take()
	index := map[string]int{}
	for i, name := range header {
		index[strings.ToLower(strings.TrimSpace(name))] = i
	}
	if _, ok := index["event name"]; !ok {
		if _, ok := index["eventname"]; !ok {
			return fmt.Errorf("CSV is missing the Event name column")
		}
	}
	count := 0
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("CSV record %d: %w", count+1, err)
		}
		original := originalHeader + take()
		get := func(names ...string) string {
			for _, name := range names {
				if i, ok := index[name]; ok && i < len(row) {
					return strings.TrimSpace(row[i])
				}
			}
			return ""
		}
		record := map[string]any{}
		for field, names := range map[string][]string{
			"eventID": {"event id", "eventid"}, "eventTime": {"event time", "eventtime"}, "eventName": {"event name", "eventname"},
			"eventSource": {"event source", "eventsource"}, "awsRegion": {"aws region", "awsregion", "region"},
			"sourceIPAddress": {"source ip address", "sourceipaddress", "source ip"}, "errorCode": {"error code", "errorcode"},
			"recipientAccountId": {"recipient account id", "recipientaccountid"},
		} {
			if value := get(names...); value != "" {
				record[field] = value
			}
		}
		identity := map[string]string{}
		if value := get("user name", "username"); value != "" {
			identity["userName"] = value
		}
		if value := get("arn", "user arn"); value != "" {
			identity["arn"] = value
		}
		if len(identity) > 0 {
			record["userIdentity"] = identity
		}
		raw, _ := json.Marshal(record)
		if err := output(string(raw), original, "event-history-csv", true); err != nil {
			return err
		}
		count++
	}
	if count == 0 {
		return fmt.Errorf("CSV has no data rows")
	}
	return nil
}
