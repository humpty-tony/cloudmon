package store

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type SigmaRuleInput struct {
	Name string `json:"name"`
	YAML string `json:"yaml"`
}
type SigmaSuiteEntry struct {
	Name   string      `json:"name"`
	Result SigmaResult `json:"result"`
}
type SigmaSuiteResult struct {
	Snapshot Snapshot          `json:"snapshot"`
	Results  []SigmaSuiteEntry `json:"results"`
}
type preparedSigma struct {
	result   SigmaResult
	where    string
	searches map[string]string
}

func prepareSigma(source string) preparedSigma {
	prepared := preparedSigma{result: SigmaResult{Diagnostics: []SigmaDiag{}, Rows: []Row{}, Explanations: map[int64][]SigmaSelection{}}}
	rule, err := parseSigmaEvidence(source)
	if err != nil {
		prepared.result.Diagnostics = append(prepared.result.Diagnostics, SigmaDiag{Severity: "error", Message: err.Error()})
		return prepared
	}
	prepared.result.Parsed = true
	prepared.result.Title = rule.Title
	where, diags, ok := compileRule(rule)
	prepared.result.Diagnostics = append(prepared.result.Diagnostics, diags...)
	if !ok {
		return prepared
	}
	prepared.where = where
	prepared.result.Supported = true
	prepared.searches = map[string]string{}
	for name, search := range rule.Detection.Searches {
		predicate, _ := compileSearch(name, search)
		prepared.searches[name] = predicate
	}
	return prepared
}

// One CTE scopes both the outer selection and every legacy count subquery.
// Count, returned rows, and explanations are evaluated within the same read.
func runSigmaOn(ctx context.Context, tx *sql.Tx, prepared preparedSigma, snapshot Snapshot, limit int) (SigmaResult, error) {
	result := prepared.result
	result.Snapshot = &snapshot
	if !result.Supported {
		return result, nil
	}
	cte := fmt.Sprintf("WITH events AS (SELECT * FROM main.events WHERE seq <= %d) ", snapshot.MaxSeq)
	result.SQL = cte + "SELECT " + pageCols + " FROM events WHERE " + prepared.where + " ORDER BY seq DESC LIMIT " + strconv.Itoa(limit)
	if err := tx.QueryRowContext(ctx, cte+"SELECT count(*) FROM events").Scan(&result.Scanned); err != nil {
		return SigmaResult{}, fmt.Errorf("sigma dataset count: %w", err)
	}
	if err := tx.QueryRowContext(ctx, cte+"SELECT count(*) FROM events WHERE "+prepared.where).Scan(&result.Matches); err != nil {
		return SigmaResult{}, fmt.Errorf("sigma count: %w", err)
	}
	names := make([]string, 0, len(prepared.searches))
	for name := range prepared.searches {
		names = append(names, name)
	}
	sort.Strings(names)
	explain := make([]string, 0, len(names))
	for _, name := range names {
		explain = append(explain, "struct_pack(name := "+sqlStr(name)+", matched := COALESCE(("+prepared.searches[name]+"),FALSE))")
	}
	query := cte + "SELECT " + pageCols + ", [" + strings.Join(explain, ",") + "] AS selections FROM events WHERE " + prepared.where + " ORDER BY seq DESC LIMIT " + strconv.Itoa(limit)
	var rows []struct {
		Row
		Selections []SigmaSelection `json:"selections"`
	}
	if err := queryJSONOn(ctx, tx, query, &rows); err != nil {
		return SigmaResult{}, fmt.Errorf("sigma results: %w", err)
	}
	for _, row := range rows {
		result.Rows = append(result.Rows, row.Row)
		result.Explanations[row.Seq] = row.Selections
	}
	return result, nil
}

func (s *Store) SigmaRun(ruleYAML string, limit int) (SigmaResult, error) {
	return s.SigmaRunContext(context.Background(), ruleYAML, limit)
}
func (s *Store) SigmaRunContext(ctx context.Context, ruleYAML string, limit int) (SigmaResult, error) {
	if err := ctx.Err(); err != nil {
		return SigmaResult{}, err
	}
	prepared := prepareSigma(ruleYAML)
	if !prepared.result.Supported {
		return prepared.result, nil
	}
	if limit <= 0 {
		limit = 500
	}
	limit = min(limit, 500)
	var result SigmaResult
	err := s.readSnapshot(ctx, func(ctx context.Context, tx *sql.Tx) error {
		snapshot, err := snapshotOn(ctx, tx)
		if err != nil {
			return err
		}
		result, err = runSigmaOn(ctx, tx, prepared, snapshot, limit)
		return err
	})
	return result, err
}

// A suite is one bounded, cancellable snapshot. Unsupported rules retain their
// diagnostics. A query/storage failure fails the suite rather than returning a
// success-looking partial run.
func (s *Store) SigmaSuite(ctx context.Context, rules []SigmaRuleInput) (SigmaSuiteResult, error) {
	if len(rules) == 0 || len(rules) > 25 {
		return SigmaSuiteResult{}, fmt.Errorf("select between 1 and 25 rules")
	}
	prepared := make([]preparedSigma, len(rules))
	seen := map[string]bool{}
	for i, rule := range rules {
		if err := ctx.Err(); err != nil {
			return SigmaSuiteResult{}, err
		}
		if strings.TrimSpace(rule.Name) == "" || len(rule.Name) > 160 || seen[rule.Name] {
			return SigmaSuiteResult{}, fmt.Errorf("suite rule names must be unique and between 1 and 160 bytes")
		}
		seen[rule.Name] = true
		prepared[i] = prepareSigma(rule.YAML)
	}
	result := SigmaSuiteResult{Results: []SigmaSuiteEntry{}}
	err := s.readSnapshot(ctx, func(ctx context.Context, tx *sql.Tx) error {
		var err error
		result.Snapshot, err = snapshotOn(ctx, tx)
		if err != nil {
			return err
		}
		for i, rule := range prepared {
			run, err := runSigmaOn(ctx, tx, rule, result.Snapshot, 100)
			if err != nil {
				return fmt.Errorf("rule %q: %w", rules[i].Name, err)
			}
			result.Results = append(result.Results, SigmaSuiteEntry{Name: rules[i].Name, Result: run})
		}
		return ctx.Err()
	})
	if err != nil {
		return SigmaSuiteResult{}, err
	}
	return result, nil
}
