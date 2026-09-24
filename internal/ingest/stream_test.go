package ingest

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestStreamPreservesSourceAcrossJSONFormats(t *testing.T) {
	raw := "{\"eventName\": \"RunInstances\", \"unknown\":9007199254740993, \"requestParameters\":null}"
	escaped, _ := json.Marshal(raw)
	for name, input := range map[string]string{
		"object":  raw,
		"array":   "[\n" + raw + "\n]",
		"records": "{\"Records\":[" + raw + "]}",
		"lookup":  "{\"Events\":[{\"CloudTrailEvent\":" + string(escaped) + "}]}",
	} {
		t.Run(name, func(t *testing.T) {
			var records []Record
			if err := Stream(strings.NewReader(input), "source.json", func(r Record) error { records = append(records, r); return nil }); err != nil {
				t.Fatal(err)
			}
			if len(records) != 1 || records[0].Raw != raw || records[0].Original != raw || records[0].Lossy {
				t.Fatalf("source changed: %+v", records)
			}
		})
	}
}

func TestStreamNDJSONReadAhead(t *testing.T) {
	var input strings.Builder
	for i := 0; i < 1500; i++ {
		fmt.Fprintf(&input, "{\"eventName\":\"Call%d\",\"padding\":\"%s\"}\n", i, strings.Repeat("x", i%333))
	}
	count := 0
	err := Stream(strings.NewReader(input.String()), "records.ndjson", func(r Record) error {
		if !strings.Contains(r.Raw, fmt.Sprintf(`"Call%d"`, count)) || r.Ordinal != int64(count+1) {
			t.Fatalf("read-ahead lost ordering at %d: %s", count, r.Raw)
		}
		count++
		return nil
	})
	if err != nil || count != 1500 {
		t.Fatalf("count=%d err=%v", count, err)
	}
}

func TestStreamCSVRetainsHeaderAndOriginalRow(t *testing.T) {
	header := "Event name,Event ID,Extra\r\n"
	row := "RunInstances,id-1,\"quoted, text\r\nsecond line\"\r\n"
	err := Stream(strings.NewReader(header+row), "history.csv", func(r Record) error {
		if !r.Lossy || r.Format != "event-history-csv" || r.Original != header+row {
			t.Fatalf("CSV source changed: %+v", r)
		}
		if strings.Contains(r.Raw, "readOnly") || strings.Contains(r.Raw, "managementEvent") {
			t.Fatal("CSV invented missing flags")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestStreamFailsOnMalformedOrTruncatedInputs(t *testing.T) {
	for _, input := range []string{`{"Records":[{"eventName":"Valid"},{"eventID":"missing-name"}]}`, `[{"eventName":"Valid"}`, `{"Events":[{"EventName":"NoRawRecord"}]}`, `{"eventName":"Valid"}garbage`} {
		if err := Stream(strings.NewReader(input), "bad.json", func(Record) error { return nil }); err == nil {
			t.Fatalf("accepted %s", input)
		}
	}
	var compressed bytes.Buffer
	gz := gzip.NewWriter(&compressed)
	gz.Write([]byte(`{"eventName":"Valid"}`))
	gz.Close()
	truncated := compressed.Bytes()[:compressed.Len()-4]
	if err := Stream(bytes.NewReader(truncated), "truncated.gz", func(Record) error { return nil }); err == nil {
		t.Fatal("accepted truncated gzip")
	}
}
