package main

import (
	"cloudmon/internal/attribution"
	"cloudmon/internal/store"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type LineageAttribution struct {
	Result attribution.Result `json:"result"`
	Graph  store.LineageTree  `json:"graph"`
	Raw    map[int64]string   `json:"raw"`
	Cached bool               `json:"cached"`
}

func attributionDir() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "cloudmon", "attribution"), nil
}

func (a *App) GetAttributionSettings() (attribution.Config, error) {
	a.attributionMu.Lock()
	defer a.attributionMu.Unlock()
	cfg := attribution.Config{AWSRegions: []string{}, EntraMappings: []attribution.FederationMapping{}, EntraTokenEnv: "CLOUDMON_ENTRA_TOKEN", VaultTokenEnv: "VAULT_TOKEN"}
	dir, err := attributionDir()
	if err != nil {
		return cfg, err
	}
	raw, err := readAttributionFile(filepath.Join(dir, "settings.json"), 64<<10)
	if errors.Is(err, os.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err = json.Unmarshal(raw, &cfg); err != nil {
		return cfg, fmt.Errorf("invalid attribution settings")
	}
	return cfg, validateAttributionSettings(cfg)
}

var attributionEnv = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)

func validateAttributionSettings(cfg attribution.Config) error {
	raw, err := json.Marshal(cfg)
	if err != nil || len(raw) > 64<<10 {
		return fmt.Errorf("attribution settings exceed 64 KiB")
	}
	if len(cfg.AWSRegions) > 8 || len(cfg.EntraMappings) > 32 {
		return fmt.Errorf("configure at most 8 Regions and 32 provider mappings")
	}
	for _, name := range []string{cfg.EntraTokenEnv, cfg.VaultTokenEnv} {
		if name != "" && !attributionEnv.MatchString(name) {
			return fmt.Errorf("token fields require environment-variable names, never token values")
		}
	}
	if cfg.VaultAddress != "" {
		u, err := url.Parse(cfg.VaultAddress)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return fmt.Errorf("Vault address must be HTTPS without credentials, query or fragment")
		}
	}
	for _, m := range cfg.EntraMappings {
		from, e1 := time.Parse(time.RFC3339, m.ValidFrom)
		to, e2 := time.Parse(time.RFC3339, m.ValidTo)
		_, e3 := time.Parse(time.RFC3339, m.VerifiedAt)
		if !strings.HasPrefix(m.RoleARN, "arn:") || !strings.Contains(m.RoleARN, ":role/") || e1 != nil || e2 != nil || e3 != nil || !from.Before(to) || strings.TrimSpace(m.Note) == "" {
			return fmt.Errorf("each Entra mapping needs an exact role ARN, valid UTC interval, verification time and note")
		}
	}
	return nil
}
func (a *App) SaveAttributionSettings(cfg attribution.Config) error {
	if err := validateAttributionSettings(cfg); err != nil {
		return err
	}
	a.attributionMu.Lock()
	defer a.attributionMu.Unlock()
	dir, err := attributionDir()
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return writeAttributionFile(dir, "settings.json", raw)
}

func readAttributionFile(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("attribution file exceeds size limit")
	}
	return data, nil
}
func writeAttributionFile(dir, name string, raw []byte) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if err := os.Chmod(dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".attribution-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(raw); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), filepath.Join(dir, name))
}

func attributionCacheName(material store.LineageMaterial, cfg attribution.Config) string {
	// CapturedAt is presentation metadata; generation/maxSeq and raw observations bind evidence.
	material.Snapshot.CapturedAt = ""
	raw, _ := json.Marshal(struct {
		Material store.LineageMaterial
		Config   attribution.Config
	}{material, cfg})
	hash := sha256.Sum256(raw)
	return "result-" + hex.EncodeToString(hash[:]) + ".json"
}
func (a *App) attributionInput(seq int64, snapshot store.Snapshot) (*store.Store, store.LineageMaterial, error) {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	db := a.ensureDB()
	if db == nil {
		return nil, store.LineageMaterial{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	material, err := db.LineageContext(seq, snapshot)
	return db, material, err
}
func buildLineageAttribution(db *store.Store, seq int64, snapshot store.Snapshot, result attribution.Result, cached bool) (*LineageAttribution, error) {
	raws := make([]string, 0, len(result.Records))
	for _, record := range result.Records {
		raws = append(raws, record.Raw)
	}
	overlay, err := db.HistoricalLineage(seq, snapshot, raws)
	if err != nil {
		return nil, err
	}
	if result.Sources == nil {
		result.Sources = []attribution.SourceStatus{}
	}
	if result.Evidence == nil {
		result.Evidence = []attribution.Evidence{}
	}
	if result.Records == nil {
		result.Records = []attribution.Record{}
	}
	return &LineageAttribution{Result: result, Graph: overlay.Graph, Raw: overlay.Raw, Cached: cached}, nil
}

// GetLineageAttribution is strictly offline: never initiates provider calls.
func (a *App) GetLineageAttribution(seq int64, snapshot store.Snapshot) (*LineageAttribution, error) {
	db, material, err := a.attributionInput(seq, snapshot)
	if err != nil {
		return nil, err
	}
	cfg, err := a.GetAttributionSettings()
	if err != nil {
		return nil, err
	}
	dir, err := attributionDir()
	if err != nil {
		return nil, err
	}
	raw, err := readAttributionFile(filepath.Join(dir, attributionCacheName(material, cfg)), 64<<20)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var result attribution.Result
	if err = json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("saved attribution is invalid; refresh from sources")
	}
	return buildLineageAttribution(db, seq, snapshot, result, true)
}

// ResolveLineageAttribution performs only the explicitly requested, bounded lookup.
func (a *App) ResolveLineageAttribution(requestID string, seq int64, snapshot store.Snapshot) (*LineageAttribution, error) {
	ctx, done, err := a.queries.Begin(a.ctx, requestID)
	if err != nil {
		return nil, err
	}
	defer done()
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	db, material, err := a.attributionInput(seq, snapshot)
	if err != nil {
		return nil, err
	}
	cfg, err := a.GetAttributionSettings()
	if err != nil {
		return nil, err
	}
	resolve := a.resolveAttribution
	if resolve == nil {
		resolve = attribution.Resolve
	}
	result, err := resolve(ctx, material.Seed, material.Records, cfg)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	view, err := buildLineageAttribution(db, seq, snapshot, result, false)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	// Revalidate snapshot/observations after network work; never cache under a replaced dataset.
	_, current, err := a.attributionInput(seq, snapshot)
	if err != nil {
		return nil, err
	}
	name := attributionCacheName(material, cfg)
	if attributionCacheName(current, cfg) != name {
		return nil, fmt.Errorf("lineage evidence changed during lookup; reopen lineage")
	}
	dir, err := attributionDir()
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if len(raw) > 64<<20 {
		return nil, fmt.Errorf("attribution result exceeds 64 MiB cache limit")
	}
	a.attributionMu.Lock()
	defer a.attributionMu.Unlock()
	if err = writeAttributionFile(dir, name, raw); err != nil {
		return nil, fmt.Errorf("cannot save attribution evidence: %w", err)
	}
	if err = pruneAttributionCache(dir, name); err != nil {
		view.Graph.Notes = append(view.Graph.Notes, "Old attribution cache entries could not be pruned.")
	}
	return view, nil
}
func pruneAttributionCache(dir, keep string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	type item struct {
		name string
		size int64
		at   time.Time
	}
	items := []item{}
	var size int64
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "result-") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		items = append(items, item{entry.Name(), info.Size(), info.ModTime()})
		size += info.Size()
	}
	sort.Slice(items, func(i, j int) bool { return items[i].at.Before(items[j].at) })
	count := len(items)
	for _, entry := range items {
		if count <= 32 && size <= 256<<20 {
			break
		}
		if entry.name == keep {
			continue
		}
		if err = os.Remove(filepath.Join(dir, entry.name)); err != nil {
			return err
		}
		count--
		size -= entry.size
	}
	return nil
}
