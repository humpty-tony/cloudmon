package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LineageMaterial is snapshot-bound evidence, never an inferred actor.
type LineageMaterial struct {
	Snapshot Snapshot `json:"snapshot"`
	Seed     string   `json:"seed"`
	Records  []string `json:"records"`
}

type LineageOverlay struct {
	Graph LineageTree      `json:"graph"`
	Raw   map[int64]string `json:"raw"`
}

// LineageContext retains competing observations as well as successful ancestry.
// Otherwise an enrichment could silently erase an ambiguity in the loaded data.
func (s *Store) LineageContext(seq int64, snapshot Snapshot, additionalKeys ...string) (LineageMaterial, error) {
	out := LineageMaterial{Snapshot: snapshot, Records: []string{}}
	_, err := s.lineageRead(&snapshot, func(r *lineageReader) error {
		seed, err := r.seed(seq)
		if err != nil {
			return err
		}
		var initial []struct {
			Raw string `json:"raw"`
		}
		if err = r.queryJSON(fmt.Sprintf("SELECT raw FROM events WHERE seq=%d", seq), &initial); err != nil {
			return err
		}
		if len(initial) != 1 {
			return fmt.Errorf("selected event is unavailable")
		}
		out.Seed = initial[0].Raw
		size := len(out.Seed)
		if size > 32<<20 {
			return fmt.Errorf("local lineage evidence exceeds 32 MiB limit")
		}
		seenRaw := map[string]bool{out.Seed: true}
		seenSeq := map[int64]bool{}
		keys := append([]string{seed.NodeKey}, additionalKeys...)
		seenKey := map[string]bool{}
		appendObservations := func(eventSeq int64) error {
			if seenSeq[eventSeq] {
				return nil
			}
			seenSeq[eventSeq] = true
			var rows []struct {
				Raw string `json:"raw"`
			}
			q := fmt.Sprintf("SELECT DISTINCT raw FROM observations WHERE eventKey=(SELECT eventKey FROM events WHERE seq=%d) ORDER BY raw LIMIT 65", eventSeq)
			if err := r.queryJSON(q, &rows); err != nil {
				return err
			}
			if len(rows) > 64 {
				return fmt.Errorf("too many source versions to safely enrich this lineage")
			}
			for _, row := range rows {
				if !seenRaw[row.Raw] {
					size += len(row.Raw)
					if size > 32<<20 {
						return fmt.Errorf("local lineage evidence exceeds 32 MiB limit")
					}
					out.Records = append(out.Records, row.Raw)
					seenRaw[row.Raw] = true
				}
			}
			if len(out.Records) > 512 {
				return fmt.Errorf("local lineage evidence exceeds enrichment limit")
			}
			return nil
		}
		if err = appendObservations(seq); err != nil {
			return err
		}
		for depth := 0; depth < lineageMaxDepth && len(keys) > 0; depth++ {
			next := []string{}
			for _, key := range keys {
				if key == "" || seenKey[key] {
					continue
				}
				seenKey[key] = true
				var candidates []struct {
					Seq int64  `json:"seq"`
					Key string `json:"key"`
				}
				if err = r.queryJSON("SELECT seq, accessKeyId AS key FROM events WHERE issuedKeyId="+sqlStr(key)+" AND "+issuancePredicate+" ORDER BY seq LIMIT 65", &candidates); err != nil {
					return err
				}
				if len(candidates) > issuanceCap {
					return fmt.Errorf("too many issuance candidates to safely enrich this lineage")
				}
				for _, candidate := range candidates {
					if err = appendObservations(candidate.Seq); err != nil {
						return err
					}
					next = append(next, candidate.Key)
				}
			}
			keys = next
		}
		return nil
	})
	return out, err
}

// HistoricalLineage uses the production resolver in an isolated temporary store.
// Negative sequence IDs belong only to this response's Raw map. No query in the
// main evidence database ever receives them. The browsing dataset is unchanged.
func (s *Store) HistoricalLineage(seq int64, snapshot Snapshot, remote []string) (LineageOverlay, error) {
	out := LineageOverlay{Raw: map[int64]string{}}
	if len(remote) > 512 {
		return out, fmt.Errorf("historical lineage exceeds 512-record limit")
	}
	// Remote ancestors may reveal keys whose contradictory local issuances were
	// unreachable from the original seed. Include every such key before applying
	// the strict resolver, retaining all local candidates and their observations.
	keys := []string{}
	remoteSize := 0
	for _, raw := range remote {
		remoteSize += len(raw)
		if remoteSize > 32<<20 {
			return out, fmt.Errorf("historical lineage exceeds 32 MiB limit")
		}
		var event struct {
			Identity struct {
				Key string `json:"accessKeyId"`
			} `json:"userIdentity"`
			Response struct {
				Credentials struct {
					Key string `json:"accessKeyId"`
				} `json:"credentials"`
			} `json:"responseElements"`
		}
		if err := json.Unmarshal([]byte(raw), &event); err != nil {
			return out, fmt.Errorf("invalid historical evidence JSON")
		}
		keys = append(keys, event.Identity.Key, event.Response.Credentials.Key)
	}
	material, err := s.LineageContext(seq, snapshot, keys...)
	if err != nil {
		return out, err
	}
	records := append([]string{material.Seed}, material.Records...)
	records = append(records, remote...)
	size := 0
	for _, raw := range records {
		size += len(raw)
		if !json.Valid([]byte(raw)) {
			return out, fmt.Errorf("invalid historical evidence JSON")
		}
	}
	if size > 32<<20 {
		return out, fmt.Errorf("historical lineage exceeds 32 MiB limit")
	}
	dir, err := os.MkdirTemp("", "cloudmon-lineage-*")
	if err != nil {
		return out, err
	}
	defer os.RemoveAll(dir)
	isolated := New(filepath.Join(dir, "lineage.duckdb"))
	defer isolated.Close()
	if err = isolated.Open(); err != nil {
		return out, err
	}
	if _, err = isolated.IngestReader(strings.NewReader("{\"Records\":["+strings.Join(records, ",")+"]}"), "lineage-enrichment"); err != nil {
		return out, err
	}
	// Event sequences are assigned by event time, not input order.
	var seedRows []struct {
		Seq int64 `json:"seq"`
	}
	if err = isolated.queryJSON("SELECT seq FROM events WHERE raw="+sqlStr(material.Seed), &seedRows); err != nil {
		return out, err
	}
	if len(seedRows) != 1 {
		return out, fmt.Errorf("selected record could not be bound to historical overlay")
	}
	graph, err := isolated.LineageGraph(seedRows[0].Seq)
	if err != nil {
		return out, err
	}
	var rows []struct {
		Seq int64  `json:"seq"`
		Raw string `json:"raw"`
	}
	if err = isolated.queryJSON("SELECT seq,raw FROM events ORDER BY seq", &rows); err != nil {
		return out, err
	}
	for _, row := range rows {
		out.Raw[-row.Seq] = row.Raw
	}
	for i := range graph.Edges {
		edge := &graph.Edges[i]
		edge.ViaSeq = -edge.ViaSeq
		for j := range edge.EvidenceSeqs {
			edge.EvidenceSeqs[j] = -edge.EvidenceSeqs[j]
		}
	}
	for i := range graph.Nodes {
		if graph.Nodes[i].Seq > 0 {
			graph.Nodes[i].Seq = -graph.Nodes[i].Seq
		}
	}
	// Activity remains scoped to the original loaded snapshot, not the tiny overlay.
	_, err = s.lineageRead(&snapshot, func(r *lineageReader) error {
		keys, roles := []string{}, []string{}
		for _, node := range graph.Nodes {
			keys = append(keys, node.AccessKeyID)
			roles = append(roles, node.RoleArn)
		}
		counts, e := r.countBy(keys, "")
		if e != nil {
			return e
		}
		children, e := r.childCounts(keys)
		if e != nil {
			return e
		}
		roleCounts, e := r.roleActivity(roles)
		if e != nil {
			return e
		}
		for i := range graph.Nodes {
			n := &graph.Nodes[i]
			n.Events = counts[n.AccessKeyID]
			n.ChildCount = children[n.AccessKeyID]
			n.RoleEvents = roleCounts[n.RoleArn][0]
			n.RoleSessions = roleCounts[n.RoleArn][1]
		}
		return nil
	})
	if err != nil {
		return out, err
	}
	for i, note := range graph.Notes {
		if note == "No successful supported STS issuance for this key is present in the loaded evidence." && len(graph.Edges) > 0 {
			graph.Notes[i] = "Earlier issuance for the upstream credential is still missing; the recovered links shown below remain supported."
		}
	}
	graph.Snapshot = &snapshot
	graph.Notes = append(graph.Notes, "Historical issuance evidence is shown separately; activity counts and browsing remain on the original loaded snapshot.")
	out.Graph = graph
	return out, nil
}
