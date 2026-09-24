package store

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"strconv"
	"strings"
	"time"
)

const investigationReportObservationLimit = 10_000
const investigationReportByteLimit int64 = 128 << 20
const investigationReportMetadataLimit int64 = 8 << 20

//go:embed templates/investigation_report.html
var investigationReportHTML string

var investigationReportTemplate = template.Must(template.New("investigation").Parse(investigationReportHTML))

type InvestigationExportSummary struct {
	EventCount       int  `json:"eventCount"`
	TotalMatches     int  `json:"totalMatches"`
	ObservationCount int  `json:"observationCount"`
	Truncated        bool `json:"truncated"`
}

type reportSource struct {
	SourceEvidence
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
}

type reportEvent struct {
	Seq      int64          `json:"seq"`
	Path     string         `json:"path"`
	SHA256   string         `json:"sha256"`
	Bytes    int64          `json:"bytes"`
	Variants int            `json:"variants"`
	Sources  []reportSource `json:"sources"`
}

type reportObservationSnapshot struct {
	MaxID      int64  `json:"maxID"`
	CapturedAt string `json:"capturedAt"`
}

type reportScope struct {
	Seq      int64  `json:"seq"`
	EventID  string `json:"eventID"`
	Minutes  int    `json:"minutes"`
	Relation string `json:"relation"`
}

type investigationReport struct {
	Schema              string                     `json:"schema"`
	Version             int                        `json:"version"`
	GeneratedAt         string                     `json:"generatedAt"`
	Scope               reportScope                `json:"scope"`
	Summary             InvestigationExportSummary `json:"summary"`
	Investigation       Investigation              `json:"investigation"`
	ObservationSnapshot reportObservationSnapshot  `json:"observationSnapshot"`
	Evidence            []reportEvent              `json:"evidence"`
	Notes               []string                   `json:"notes"`
}

// ExportInvestigation reconstructs the displayed context and collects all source
// observations for the retained events in a single committed database read.
// The ZIP's 128 MiB limit applies to all uncompressed entries, including metadata.
func (s *Store) ExportInvestigation(parent context.Context, options InvestigationOptions, dst io.Writer) (InvestigationExportSummary, error) {
	var summary InvestigationExportSummary
	if options.Snapshot == nil {
		return summary, fmt.Errorf("an investigation snapshot is required; reopen the investigation")
	}
	if options.Minutes == 0 {
		options.Minutes = 5
	}
	if options.Relation == "" {
		options.Relation = "all"
	}
	err := s.readSnapshot(parent, func(ctx context.Context, tx *sql.Tx) error {
		investigation, err := investigateUsing(ctx, tx, options, boundedReportQuery(ctx, tx))
		if err != nil {
			return err
		}
		report := investigationReport{
			Schema: "cloudmon-investigation-report", Version: 1,
			GeneratedAt:   time.Now().UTC().Format(time.RFC3339Nano),
			Scope:         reportScope{Seq: options.Seq, EventID: options.EventID, Minutes: options.Minutes, Relation: options.Relation},
			Investigation: investigation, Evidence: []reportEvent{},
			Notes: []string{
				"Event membership uses the displayed snapshot. Source observations were collected at export time in the same read transaction as this report.",
				"Only the retained investigation events are included, up to 500 closest matches. This is not a complete dataset export.",
				"Up to 100 anchor resource references and five matching resource ARNs per event are listed. Correlation considers all recorded resource ARNs in the context window.",
				"Event summaries are derived projections; original JSON entries preserve exact numeric tokens and missing-field semantics. Correlations use each event's displayed record, not alternate source variants.",
				"SHA-256 identifies the retained bytes. It does not verify CloudTrail signatures or authenticate their source.",
				"JSON sources preserve the retained event object, not its surrounding delivery envelope. CSV sources preserve the retained header and row; their queryable event JSON is a lossy projection.",
				"Personal labels are not included. Source locations may contain local paths or capture identifiers.",
			},
		}
		report.ObservationSnapshot.CapturedAt = report.GeneratedAt
		if err := tx.QueryRowContext(ctx, "SELECT coalesce(max(id),0) FROM observations").Scan(&report.ObservationSnapshot.MaxID); err != nil {
			return err
		}
		seqs := make([]string, len(investigation.Events))
		for i, event := range investigation.Events {
			seqs[i] = strconv.FormatInt(event.Event.Seq, 10)
		}
		if len(seqs) == 0 {
			return fmt.Errorf("the investigation has no retained events")
		}
		where := "e.seq IN (" + strings.Join(seqs, ",") + ")"
		observations := " FROM observations o JOIN events e ON e.eventKey=o.eventKey WHERE " + where + " AND o.id<=" + strconv.FormatInt(report.ObservationSnapshot.MaxID, 10)
		var sourceCount int
		var eventBytes, sourceBytes, sourceMetadataBytes int64
		if err := tx.QueryRowContext(ctx, "SELECT coalesce(sum(octet_length(encode(e.raw))),0) FROM events e WHERE "+where).Scan(&eventBytes); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, "SELECT count(*),coalesce(sum(octet_length(encode(o.original))),0),coalesce(sum(6*(octet_length(encode(o.source))+octet_length(encode(o.format))+octet_length(encode(o.observedAt))+octet_length(encode(o.sha256)))+512),0)"+observations).Scan(&sourceCount, &sourceBytes, &sourceMetadataBytes); err != nil {
			return err
		}
		if sourceCount > investigationReportObservationLimit {
			return fmt.Errorf("report exceeds %d source observations; narrow the investigation window or relationship", investigationReportObservationLimit)
		}
		if sourceMetadataBytes > investigationReportMetadataLimit {
			return reportMetadataError()
		}
		if eventBytes > investigationReportByteLimit || sourceBytes > investigationReportByteLimit-eventBytes {
			return reportSizeError()
		}
		report.Summary = InvestigationExportSummary{EventCount: len(investigation.Events), TotalMatches: investigation.Total, ObservationCount: sourceCount, Truncated: len(investigation.Events) < investigation.Total}
		archive := &reportArchive{ctx: ctx, zip: zip.NewWriter(&contextReportWriter{ctx: ctx, dst: dst}), remaining: investigationReportByteLimit}
		defer archive.zip.Close()
		indexes := make(map[int64]int, len(seqs))
		// Write one original event at a time; never decode it through Go or JavaScript numbers.
		rows, err := tx.QueryContext(ctx, "SELECT e.seq,e.raw FROM events e WHERE "+where+" ORDER BY e.seq")
		if err != nil {
			return err
		}
		for rows.Next() {
			var seq int64
			var raw string
			if err := rows.Scan(&seq, &raw); err != nil {
				rows.Close()
				return err
			}
			if !json.Valid([]byte(raw)) {
				rows.Close()
				return fmt.Errorf("event %d has invalid source JSON; report cancelled", seq)
			}
			path := fmt.Sprintf("events/%d.json", seq)
			if err := archive.text(path, raw); err != nil {
				rows.Close()
				return err
			}
			indexes[seq] = len(report.Evidence)
			report.Evidence = append(report.Evidence, reportEvent{Seq: seq, Path: path, SHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(raw))), Bytes: int64(len(raw)), Sources: []reportSource{}})
		}
		if err := closeReportRows(rows); err != nil {
			return err
		}
		if len(report.Evidence) != len(seqs) {
			return fmt.Errorf("a retained event is unavailable; report cancelled")
		}
		rows, err = tx.QueryContext(ctx, "SELECT e.seq,o.id,o.sha256,o.source,o.ordinal,o.format,o.lossy,o.observedAt,o.sha256=e.evidenceHash,o.raw=e.raw,o.original"+observations+" ORDER BY e.seq,o.id")
		if err != nil {
			return err
		}
		count := 0
		for rows.Next() {
			var seq int64
			var source reportSource
			var original string
			var sameDisplayedRaw bool
			if err := rows.Scan(&seq, &source.ID, &source.SHA256, &source.Source, &source.Ordinal, &source.Format, &source.Lossy, &source.ObservedAt, &source.Displayed, &sameDisplayedRaw, &original); err != nil {
				rows.Close()
				return err
			}
			if source.Displayed && !sameDisplayedRaw {
				rows.Close()
				return fmt.Errorf("event %d differs from its displayed source projection; report cancelled", seq)
			}
			if fmt.Sprintf("%x", sha256.Sum256([]byte(original))) != source.SHA256 {
				rows.Close()
				return fmt.Errorf("source observation %d does not match its saved hash; report cancelled", source.ID)
			}
			source.Path, source.Bytes = fmt.Sprintf("sources/%d.txt", source.ID), int64(len(original))
			if err := archive.text(source.Path, original); err != nil {
				rows.Close()
				return err
			}
			index, ok := indexes[seq]
			if !ok {
				rows.Close()
				return fmt.Errorf("source observation references an unavailable event")
			}
			report.Evidence[index].Sources = append(report.Evidence[index].Sources, source)
			count++
		}
		if err := closeReportRows(rows); err != nil {
			return err
		}
		if count != sourceCount {
			return fmt.Errorf("source observations changed while exporting; report cancelled")
		}
		for i := range report.Evidence {
			variants := map[string]bool{}
			displayed := false
			for _, source := range report.Evidence[i].Sources {
				variants[source.SHA256] = true
				displayed = displayed || source.Displayed
			}
			if !displayed {
				return fmt.Errorf("event %d has no retained source for its displayed record; report cancelled", report.Evidence[i].Seq)
			}
			report.Evidence[i].Variants = len(variants)
		}
		if err := archive.entry("manifest.json", func(w io.Writer) error {
			return writeReportManifest(w, report)
		}); err != nil {
			return err
		}
		if err := archive.entry("report.html", func(w io.Writer) error { return investigationReportTemplate.Execute(w, report) }); err != nil {
			return err
		}
		if err := archive.zip.Close(); err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		summary = report.Summary
		return nil
	})
	if err != nil {
		return InvestigationExportSummary{}, err
	}
	return summary, nil
}

func (s *Store) ExportInvestigationFile(ctx context.Context, options InvestigationOptions, path string) (InvestigationExportSummary, error) {
	var summary InvestigationExportSummary
	err := writeCompletedExport(ctx, path, func(dst io.Writer) error {
		var err error
		summary, err = s.ExportInvestigation(ctx, options, dst)
		return err
	})
	if err != nil {
		return InvestigationExportSummary{}, err
	}
	return summary, nil
}

func closeReportRows(rows *sql.Rows) error {
	err := rows.Err()
	if closeErr := rows.Close(); err == nil {
		err = closeErr
	}
	return err
}

func reportMetadataError() error {
	return fmt.Errorf("report context or source metadata exceeds 8 MiB; narrow the investigation window or relationship")
}

// Keep query serialization bounded before it crosses into Go. A single large
// projected row becomes NULL in SQL instead of first allocating that string in
// the caller; the cumulative budget also bounds the decoded context. Ordinary
// Investigate calls continue to use their existing query helper.
func boundedReportQuery(ctx context.Context, tx *sql.Tx) func(string, any) error {
	remaining := investigationReportMetadataLimit
	return func(query string, dst any) error {
		query = strings.TrimSuffix(strings.TrimSpace(query), ";")
		rows, err := tx.QueryContext(ctx, fmt.Sprintf("WITH report_rows AS (SELECT to_json(result)::VARCHAR AS report_json FROM (%s) result) SELECT CASE WHEN octet_length(encode(report_json))<=%d THEN report_json ELSE NULL END FROM report_rows", query, remaining))
		if err != nil {
			return err
		}
		defer rows.Close()
		var data bytes.Buffer
		data.WriteByte('[')
		for rows.Next() {
			var row sql.NullString
			if err := rows.Scan(&row); err != nil {
				return err
			}
			if !row.Valid || int64(len(row.String))+1 > remaining {
				return reportMetadataError()
			}
			remaining -= int64(len(row.String)) + 1
			if data.Len() > 1 {
				data.WriteByte(',')
			}
			data.WriteString(row.String)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		data.WriteByte(']')
		return json.Unmarshal(data.Bytes(), dst)
	}
}

type reportJSONField struct {
	name  string
	value any
}
type reportJSONObject []reportJSONField
type reportJSONArray []any

// Encode large arrays one element at a time. A long shared correlation value can
// occur in many event reasons; encoding the whole manifest with json.Encoder
// would allocate every repeated copy before the archive size guard could run.
func writeReportManifest(dst io.Writer, report investigationReport) error {
	events := make(reportJSONArray, len(report.Investigation.Events))
	for i := range events {
		events[i] = report.Investigation.Events[i]
	}
	evidence := make(reportJSONArray, len(report.Evidence))
	for i := range evidence {
		evidence[i] = report.Evidence[i]
	}
	result := report.Investigation
	return streamReportJSON(dst, reportJSONObject{
		{"schema", report.Schema}, {"version", report.Version}, {"generatedAt", report.GeneratedAt},
		{"scope", report.Scope}, {"summary", report.Summary}, {"observationSnapshot", report.ObservationSnapshot},
		{"investigation", reportJSONObject{
			{"snapshot", result.Snapshot}, {"anchor", result.Anchor}, {"resources", result.Resources},
			{"resourcesTruncated", result.ResourcesTruncated}, {"events", events}, {"total", result.Total},
			{"limit", result.Limit}, {"fromMs", result.FromMs}, {"toMs", result.ToMs}, {"notes", result.Notes},
		}},
		{"evidence", evidence}, {"notes", report.Notes},
	})
}

func streamReportJSON(dst io.Writer, value any) error {
	write := func(text string) error { _, err := io.WriteString(dst, text); return err }
	switch v := value.(type) {
	case reportJSONObject:
		if err := write("{\n"); err != nil {
			return err
		}
		for i, field := range v {
			if i > 0 {
				if err := write(",\n"); err != nil {
					return err
				}
			}
			// All keys here are fixed format names, never source data.
			if err := write(strconv.Quote(field.name) + ": "); err != nil {
				return err
			}
			if err := streamReportJSON(dst, field.value); err != nil {
				return err
			}
		}
		return write("}\n")
	case reportJSONArray:
		if err := write("[\n"); err != nil {
			return err
		}
		for i, item := range v {
			if i > 0 {
				if err := write(",\n"); err != nil {
					return err
				}
			}
			if err := streamReportJSON(dst, item); err != nil {
				return err
			}
		}
		return write("]\n")
	default:
		encoder := json.NewEncoder(dst)
		// This is a standalone JSON entry, never embedded in an HTML/script
		// context. Avoid multiplying harmless '<' characters into six bytes.
		encoder.SetEscapeHTML(false)
		return encoder.Encode(value)
	}
}

func reportSizeError() error {
	return fmt.Errorf("report exceeds 128 MiB of uncompressed content; narrow the investigation window or relationship")
}

type contextReportWriter struct {
	ctx context.Context
	dst io.Writer
}

func (w *contextReportWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	return w.dst.Write(p)
}

type reportArchive struct {
	ctx       context.Context
	zip       *zip.Writer
	remaining int64
}

func (a *reportArchive) text(path, value string) error {
	return a.entry(path, func(dst io.Writer) error { _, err := io.WriteString(dst, value); return err })
}

func (a *reportArchive) entry(path string, write func(io.Writer) error) error {
	if err := a.ctx.Err(); err != nil {
		return err
	}
	w, err := a.zip.Create(path)
	if err != nil {
		return err
	}
	return write(&reportEntryWriter{archive: a, dst: w})
}

type reportEntryWriter struct {
	archive *reportArchive
	dst     io.Writer
}

func (w *reportEntryWriter) Write(p []byte) (int, error) {
	if err := w.archive.ctx.Err(); err != nil {
		return 0, err
	}
	if int64(len(p)) > w.archive.remaining {
		return 0, reportSizeError()
	}
	n, err := w.dst.Write(p)
	w.archive.remaining -= int64(n)
	return n, err
}
