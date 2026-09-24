package store

import (
	"archive/zip"
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
		investigation, err := investigateOn(ctx, tx, options)
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
		var eventBytes, sourceBytes int64
		if err := tx.QueryRowContext(ctx, "SELECT coalesce(sum(octet_length(encode(e.raw))),0) FROM events e WHERE "+where).Scan(&eventBytes); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, "SELECT count(*),coalesce(sum(octet_length(encode(o.original))+octet_length(encode(o.source))),0)"+observations).Scan(&sourceCount, &sourceBytes); err != nil {
			return err
		}
		if sourceCount > investigationReportObservationLimit {
			return fmt.Errorf("report exceeds %d source observations; narrow the investigation window or relationship", investigationReportObservationLimit)
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
		rows, err = tx.QueryContext(ctx, "SELECT e.seq,o.id,o.sha256,o.source,o.ordinal,o.format,o.lossy,o.observedAt,o.sha256=e.evidenceHash,o.original"+observations+" ORDER BY e.seq,o.id")
		if err != nil {
			return err
		}
		count := 0
		for rows.Next() {
			var seq int64
			var source reportSource
			var original string
			if err := rows.Scan(&seq, &source.ID, &source.SHA256, &source.Source, &source.Ordinal, &source.Format, &source.Lossy, &source.ObservedAt, &source.Displayed, &original); err != nil {
				rows.Close()
				return err
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
			encoder := json.NewEncoder(w)
			encoder.SetIndent("", "  ")
			return encoder.Encode(report)
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
