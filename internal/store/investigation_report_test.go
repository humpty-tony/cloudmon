package store

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"cloudmon/internal/model"
)

func investigationReportOptions(t *testing.T, s *Store, id string) InvestigationOptions {
	t.Helper()
	options := InvestigationOptions{Seq: evidenceSeq(t, s, id), EventID: id, Minutes: 5, Relation: "all"}
	result, err := s.Investigate(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	options.Snapshot = &result.Snapshot
	return options
}

func readInvestigationReport(t *testing.T, data []byte) (investigationReport, map[string][]byte) {
	t.Helper()
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string][]byte{}
	for _, entry := range archive.File {
		if !filepath.IsLocal(entry.Name) || strings.Contains(entry.Name, "\\") || entries[entry.Name] != nil {
			t.Fatalf("unsafe or duplicate archive path %q", entry.Name)
		}
		reader, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		entries[entry.Name] = data
	}
	var report investigationReport
	if err := json.Unmarshal(entries["manifest.json"], &report); err != nil {
		t.Fatal(err)
	}
	return report, entries
}

func TestInvestigationReportPreservesEvidenceAndExportTimeSources(t *testing.T) {
	s := openTestStore(t, filepath.Join(t.TempDir(), "evidence.duckdb"))
	raw := `{ "eventID":"anchor", "recipientAccountId":"111111111111", "eventName":"GetObject", "eventSource":"s3.amazonaws.com", "eventTime":"2026-09-01T00:10:00Z", "opaque":9007199254740993, "decimal":1.23000000000000000001, "duplicate":1,"duplicate":2,"text":"日本語" }`
	other := strings.ReplaceAll(strings.Replace(raw, `"anchor"`, `"other"`, 1), "00:10:00Z", "00:11:00Z")
	if _, err := s.IngestReader(strings.NewReader("["+raw+","+other+"]"), "../../escape</a><script>window.reportInjected=true</script>"); err != nil {
		t.Fatal(err)
	}
	options := investigationReportOptions(t, s, "anchor")
	variant := strings.Replace(raw, "9007199254740993", "9007199254740995", 1)
	newEvent := strings.Replace(raw, `"anchor"`, `"new-arrival"`, 1)
	if _, err := s.AppendFrom([]model.CloudTrailEvent{liveEvent(t, variant), liveEvent(t, newEvent)}, "capture://later"); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	summary, err := s.ExportInvestigation(context.Background(), options, &output)
	if err != nil {
		t.Fatal(err)
	}
	if summary != (InvestigationExportSummary{EventCount: 2, TotalMatches: 2, ObservationCount: 3}) {
		t.Fatalf("wrong report scope: %+v", summary)
	}
	report, entries := readInvestigationReport(t, output.Bytes())
	want, err := s.Investigate(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(report.Investigation, want) || report.Summary != summary || report.Scope.Relation != "all" || report.ObservationSnapshot.MaxID != 4 {
		t.Fatalf("report no longer describes the captured context: %+v", report)
	}
	if report.Investigation.Snapshot != *options.Snapshot {
		t.Fatal("displayed event snapshot changed")
	}
	wantRaw := map[int64]string{evidenceSeq(t, s, "anchor"): raw, evidenceSeq(t, s, "other"): other}
	for _, event := range report.Evidence {
		if string(entries[event.Path]) != wantRaw[event.Seq] || event.SHA256 != fmt.Sprintf("%x", sha256.Sum256(entries[event.Path])) {
			t.Fatalf("queryable event bytes changed: %+v", event)
		}
		for _, source := range event.Sources {
			original, err := s.Observation(source.ID)
			if err != nil || string(entries[source.Path]) != original || source.SHA256 != fmt.Sprintf("%x", sha256.Sum256(entries[source.Path])) {
				t.Fatalf("original source/hash changed: %+v (%v)", source, err)
			}
		}
	}
	html := string(entries["report.html"])
	if strings.Contains(html, "<script>") || strings.Contains(html, "<a href=\"../../") || !strings.Contains(html, "&lt;script&gt;window.reportInjected=true&lt;/script&gt;") {
		t.Fatal("source text was not safely escaped")
	}
	if !strings.Contains(html, "Source observations were collected at export time") || !strings.Contains(html, "not alternate source variants") {
		t.Fatal("report omitted the event/source snapshot distinction")
	}
}

func TestInvestigationReportCSVSourceAndTruncation(t *testing.T) {
	t.Run("CSV original", func(t *testing.T) {
		s := openTestStore(t, filepath.Join(t.TempDir(), "evidence.duckdb"))
		csv := "Event name,Event ID,Event time,Username\r\nGetObject,csv-event,2026-09-01T00:10:00Z,alice\r\n"
		if _, err := s.IngestReader(strings.NewReader(csv), "original.csv"); err != nil {
			t.Fatal(err)
		}
		var output bytes.Buffer
		if _, err := s.ExportInvestigation(context.Background(), investigationReportOptions(t, s, "csv-event"), &output); err != nil {
			t.Fatal(err)
		}
		report, entries := readInvestigationReport(t, output.Bytes())
		source := report.Evidence[0].Sources[0]
		if !source.Lossy || source.Format != "event-history-csv" || string(entries[source.Path]) != csv || bytes.Equal(entries[report.Evidence[0].Path], entries[source.Path]) {
			t.Fatalf("CSV source/projection boundary lost: %+v", source)
		}
	})
	t.Run("retained events", func(t *testing.T) {
		records := make([]evidenceObject, 503)
		for i := range records {
			records[i] = contextEvent(fmt.Sprintf("event-%03d", i), 10)
		}
		s := evidenceStore(t, records...)
		var output bytes.Buffer
		summary, err := s.ExportInvestigation(context.Background(), investigationReportOptions(t, s, "event-000"), &output)
		if err != nil {
			t.Fatal(err)
		}
		report, entries := readInvestigationReport(t, output.Bytes())
		if !summary.Truncated || summary.EventCount != 500 || summary.TotalMatches != 503 || summary.ObservationCount != 500 || len(report.Evidence) != 500 || !bytes.Contains(entries["report.html"], []byte("500 of 503 matching events")) {
			t.Fatalf("report hid truncation: %+v", summary)
		}
	})
}

func TestInvestigationReportFailuresPreserveDestination(t *testing.T) {
	s := evidenceStore(t, contextEvent("anchor", 10))
	options := investigationReportOptions(t, s, "anchor")
	target := filepath.Join(t.TempDir(), "report.zip")
	previous := []byte("previous report")
	if err := os.WriteFile(target, previous, 0600); err != nil {
		t.Fatal(err)
	}
	checkFailure := func(ctx context.Context, options InvestigationOptions) {
		t.Helper()
		if got, err := s.ExportInvestigationFile(ctx, options, target); err == nil || got != (InvestigationExportSummary{}) {
			t.Fatalf("failed export reported success: %+v, %v", got, err)
		}
		after, err := os.ReadFile(target)
		if err != nil || !bytes.Equal(after, previous) {
			t.Fatal("failed export changed destination")
		}
		files, _ := filepath.Glob(filepath.Join(filepath.Dir(target), ".cloudmon-export-*"))
		if len(files) != 0 {
			t.Fatal("failed export left temporary content")
		}
	}
	missing := options
	missing.Snapshot = nil
	checkFailure(context.Background(), missing)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	checkFailure(ctx, options)
	if _, err := s.ExportInvestigation(context.Background(), options, rejectedWriter{}); err == nil {
		t.Fatal("writer failure ignored")
	}
	if err := s.write(context.Background(), func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, "UPDATE observations SET sha256='incorrect'")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	checkFailure(context.Background(), options)
	if _, err := s.IngestReader(strings.NewReader(`{"eventID":"anchor","eventName":"Replacement","eventTime":"2026-09-01T00:10:00Z"}`), "replacement"); err != nil {
		t.Fatal(err)
	}
	checkFailure(context.Background(), options)
	// The shared publication helper must also reject cancellation after a fully
	// successful writer, before replacing an existing destination.
	ctx, cancel = context.WithCancel(context.Background())
	err := writeCompletedExport(ctx, target, func(dst io.Writer) error {
		_, err := io.WriteString(dst, "complete but cancelled")
		cancel()
		return err
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatal("late cancellation ignored")
	}
	after, _ := os.ReadFile(target)
	if !bytes.Equal(after, previous) {
		t.Fatal("late cancellation published output")
	}
	// A nonempty directory cannot be replaced by the completed file.
	if _, err := s.ExportInvestigationFile(context.Background(), investigationReportOptions(t, s, "anchor"), filepath.Dir(target)); err == nil {
		t.Fatal("invalid destination accepted")
	}
}

func TestInvestigationReportBoundedOutput(t *testing.T) {
	s := evidenceStore(t, contextEvent("anchor", 10))
	options := investigationReportOptions(t, s, "anchor")
	if err := s.write(context.Background(), func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO observations SELECT id+n, eventKey,sha256,raw,original,source,ordinal,format,lossy,observedAt FROM observations,generate_series(1,10000) copies(n)`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if _, err := s.ExportInvestigation(context.Background(), options, &output); err == nil || !strings.Contains(err.Error(), "10000 source observations") || output.Len() != 0 {
		t.Fatalf("observation limit did not fail before output: %v", err)
	}
	// Exercise the archive-wide uncompressed budget across two entries without
	// manufacturing a 128 MiB fixture. Metadata uses this same writer.
	archive := &reportArchive{ctx: context.Background(), zip: zip.NewWriter(&output), remaining: 10}
	defer archive.zip.Close()
	if err := archive.text("one.txt", "123456"); err != nil {
		t.Fatal(err)
	}
	if err := archive.text("two.txt", "12345"); err == nil || !strings.Contains(err.Error(), "128 MiB") {
		t.Fatal("entry budget reset between files")
	}
}

// TestInvestigationReportFixture optionally produces real exported evidence for
// browser/layout checks. The environment value is an absolute report.html path;
// its directory receives the ZIP and every generated entry for working links.
func TestInvestigationReportFixture(t *testing.T) {
	target := os.Getenv("CLOUDMON_REPORT_FIXTURE")
	if target == "" {
		t.Skip("set CLOUDMON_REPORT_FIXTURE to generate a report screenshot fixture")
	}
	if !filepath.IsAbs(target) || filepath.Base(target) != "report.html" {
		t.Fatal("CLOUDMON_REPORT_FIXTURE must be an absolute path ending in report.html")
	}
	records := []evidenceObject{contextEvent("evt-01-identity", 9), contextEvent("evt-02-read", 10), contextEvent("evt-03-write", 11)}
	for i, record := range records {
		record["recipientAccountId"] = "111111111111"
		record["sourceIPAddress"] = "192.0.2.18"
		record["userIdentity"] = evidenceObject{"type": "AssumedRole", "accessKeyId": "ASIAEXAMPLESESSION", "arn": "arn:aws:sts::111111111111:assumed-role/AuditReader/investigator"}
		record["resources"] = []any{evidenceObject{"ARN": "arn:aws:s3:::audit-evidence/2026/09/cloudtrail.json", "type": "AWS::S3::Object"}}
		if i == 0 {
			record["eventName"] = "HeadObject"
		}
		if i == 2 {
			record["eventName"] = "PutObject"
			record["errorCode"] = "AccessDenied"
		}
	}
	s := evidenceStore(t, records...)
	options := investigationReportOptions(t, s, "evt-02-read")
	variant, err := json.Marshal(records[1])
	if err != nil {
		t.Fatal(err)
	}
	variant = bytes.Replace(variant, []byte("192.0.2.18"), []byte("192.0.2.19"), 1)
	if _, err := s.AppendFrom([]model.CloudTrailEvent{liveEvent(t, string(variant))}, `review </a><script>window.reportInjected=true</script>`); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		t.Fatal(err)
	}
	zipPath := filepath.Join(filepath.Dir(target), "investigation-report.zip")
	if _, err := s.ExportInvestigationFile(context.Background(), options, zipPath); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	report, entries := readInvestigationReport(t, data)
	if report.Summary.EventCount != 3 || report.Summary.ObservationCount != 4 {
		t.Fatalf("unexpected browser fixture: %+v", report.Summary)
	}
	for name, data := range entries {
		destination := filepath.Join(filepath.Dir(target), filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(destination, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
