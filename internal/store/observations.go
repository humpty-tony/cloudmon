package store

import (
	"context"
	"database/sql"
	"fmt"
)

// EvidencePage omits record bodies until requested, keeping expanded events cheap.
type EvidencePage struct {
	Total        int              `json:"total"`
	Variants     int              `json:"variants"`
	Observations []SourceEvidence `json:"observations"`
}

type SourceEvidence struct {
	ID         int64  `json:"id"`
	SHA256     string `json:"sha256"`
	Source     string `json:"source"`
	Ordinal    int64  `json:"ordinal"`
	Format     string `json:"format"`
	Lossy      bool   `json:"lossy"`
	ObservedAt string `json:"observedAt"`
	Displayed  bool   `json:"displayed"`
}

type EvidenceStats struct {
	Events        int `json:"events"`
	Observations  int `json:"observations"`
	VariantEvents int `json:"variantEvents"`
	Lossy         int `json:"lossy"`
}

func (s *Store) EvidenceStats() (EvidenceStats, error) {
	var rows []EvidenceStats
	err := s.queryJSON(`SELECT (SELECT count(*) FROM events) AS events,
		(SELECT count(*) FROM observations) AS observations,
		(SELECT count(*) FROM (SELECT eventKey FROM observations GROUP BY eventKey HAVING count(DISTINCT sha256)>1)) AS variantEvents,
		(SELECT count(*) FROM observations WHERE lossy) AS lossy;`, &rows)
	if err != nil {
		return EvidenceStats{}, err
	}
	if len(rows) != 1 {
		return EvidenceStats{}, fmt.Errorf("evidence summary unavailable")
	}
	return rows[0], nil
}

func (s *Store) Evidence(seq int64, offset int) (EvidencePage, error) {
	return evidencePage(seq, offset, s.queryJSON)
}
func evidencePage(seq int64, offset int, query func(string, any) error) (EvidencePage, error) {
	if offset < 0 {
		offset = 0
	}
	result := EvidencePage{Observations: []SourceEvidence{}}
	var totals []struct {
		Total    int `json:"total"`
		Variants int `json:"variants"`
	}
	where := fmt.Sprintf(" FROM observations o JOIN events e ON o.eventKey=e.eventKey WHERE e.seq=%d", seq)
	if err := query("SELECT count(*) AS total,count(DISTINCT o.sha256) AS variants"+where+";", &totals); err != nil {
		return result, err
	}
	if len(totals) == 0 || totals[0].Total == 0 {
		return result, fmt.Errorf("event %d has no saved evidence", seq)
	}
	result.Total, result.Variants = totals[0].Total, totals[0].Variants
	err := query("SELECT o.id,o.sha256,o.source,o.ordinal,o.format,o.lossy,o.observedAt,o.sha256=e.evidenceHash AS displayed"+where+fmt.Sprintf(" ORDER BY o.id LIMIT 25 OFFSET %d;", offset), &result.Observations)
	return result, err
}

// Observation returns exactly the bytes hashed when this observation was staged.
// CSV evidence is the original header plus row, not reconstructed CloudTrail JSON.
func (s *Store) Observation(id int64) (string, error) {
	var rows []struct {
		Original string `json:"original"`
	}
	if err := s.queryJSON(fmt.Sprintf("SELECT original FROM observations WHERE id=%d;", id), &rows); err != nil {
		return "", err
	}
	if len(rows) != 1 {
		return "", fmt.Errorf("source observation %d is no longer available", id)
	}
	return rows[0].Original, nil
}

// The event cutoff is fixed; source observations added for that event remain
// inspectable. Generation validation prevents reused IDs opening another dataset.
func (s *Store) EvidenceSnapshot(seq int64, offset int, snapshot Snapshot) (EvidencePage, error) {
	var result EvidencePage
	err := s.readSnapshot(context.Background(), func(ctx context.Context, tx *sql.Tx) error {
		if err := validateSnapshot(ctx, tx, snapshot); err != nil {
			return err
		}
		if seq <= 0 || seq > snapshot.MaxSeq {
			return fmt.Errorf("event is outside this snapshot")
		}
		var err error
		result, err = evidencePage(seq, offset, func(q string, dst any) error { return queryJSONOn(ctx, tx, q, dst) })
		return err
	})
	return result, err
}
func (s *Store) ObservationSnapshot(id int64, snapshot Snapshot) (string, error) {
	var result string
	err := s.readSnapshot(context.Background(), func(ctx context.Context, tx *sql.Tx) error {
		if err := validateSnapshot(ctx, tx, snapshot); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, "SELECT original FROM observations o JOIN events e ON e.eventKey=o.eventKey WHERE o.id=? AND e.seq<=?", id, snapshot.MaxSeq).Scan(&result)
	})
	return result, err
}
