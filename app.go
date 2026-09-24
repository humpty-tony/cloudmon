package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime" // stdlib - GOOS
	"strings"
	"sync"
	"time"

	"cloudmon/internal/awsflow"
	"cloudmon/internal/capture"
	"cloudmon/internal/config"
	"cloudmon/internal/ingest"
	"cloudmon/internal/model"
	"cloudmon/internal/queryjob"
	"cloudmon/internal/store"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	rt "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the Wails-bound backend. Its exported methods become window.go.main.App.*
// in the frontend (see frontend/src/api/backend.ts for the contract).
type App struct {
	ctx    context.Context
	mu     sync.Mutex
	events []model.CloudTrailEvent
	cfg    config.ConnectionConfig

	db       *store.Store // DuckDB-backed engine for large dumps
	dbErr    error        // set if the evidence database could not be opened
	dataLock *os.File     // OS lock retained for this process lifetime
	dbOnce   sync.Once    // guards one-time async initialization of the engine
	queries  queryjob.Registry

	logMu sync.Mutex // guards the on-disk troubleshooting log
	logW  *os.File   // cloudmon.log next to the exe (a blank WebView2 leaves no console)

	// Live capture (Flow A) state.
	capMu       sync.Mutex
	capCancel   context.CancelFunc // cancels the running poller
	capInfra    awsflow.Infra      // resources StartCapture created (for teardown)
	capActive   bool
	capDone     chan struct{}    // closed only after the poller has exited
	capLoaded   bool             // guarded by lifecycleMu
	capSession  *capture.Session // durable checkpoint, guarded by lifecycleMu
	capProfile  string           // credentials selected when this pipeline was created
	lifecycleMu sync.Mutex       // serialize start, stop, teardown, and dataset replacement
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.openLog()
	// Open the saved database off the startup path so the window paints first.
	go a.ensureDB()
}

// ensureDB opens the persistent embedded engine exactly once. Startup warms it
// asynchronously; the first query waits for initialization if it arrives sooner.
func (a *App) ensureDB() *store.Store {
	a.dbOnce.Do(func() {
		root, err := os.UserConfigDir()
		if err != nil {
			a.dbErr = err
			return
		}
		dir := filepath.Join(root, "cloudmon", "evidence")
		if err = os.MkdirAll(dir, 0o700); err != nil {
			a.dbErr = err
			return
		}
		if err = os.Chmod(dir, 0o700); err != nil {
			a.dbErr = err
			return
		}
		lock, err := store.LockSession(filepath.Join(dir, "session.lock"))
		if err != nil {
			a.dbErr = err
			return
		}
		db := store.New(filepath.Join(dir, "events.duckdb"))
		if err = db.Open(); err != nil {
			db.Close()
			lock.Close()
			a.dbErr = err
			return
		}
		a.dataLock = lock
		a.db = db
	})
	return a.db
}

// openLog opens (append) cloudmon.log next to the executable. When the WebView2
// renderer crashes it goes blank and takes the console with it, so we persist
// breadcrumbs to disk - the frontend forwards errors + lifecycle events via Log.
func (a *App) openLog() {
	dir := "."
	if exe, err := os.Executable(); err == nil {
		dir = filepath.Dir(exe)
	}
	f, err := os.OpenFile(filepath.Join(dir, "cloudmon.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	a.logW = f
	fmt.Fprintf(f, "\n==== session start pid=%d %s ====\n", os.Getpid(), time.Now().Format("2006-01-02 15:04:05"))
	_ = f.Sync()
}

// Log appends a line to cloudmon.log and flushes immediately (the next line the
// frontend meant to write might be lost to a renderer crash). Called from JS via
// window.go.main.App.Log - see frontend/src/api/log.ts.
func (a *App) Log(level, msg string) {
	a.logMu.Lock()
	defer a.logMu.Unlock()
	if a.logW == nil {
		return
	}
	fmt.Fprintf(a.logW, "%s [%s] %s\n", time.Now().Format("15:04:05.000"), level, msg)
	_ = a.logW.Sync()
}

// --- DuckDB-backed scalable ingestion + query (window/aggregate model). The UI
// calls these instead of holding the whole dataset in JS, so multi-GB dumps stay
// on disk and only pages + summaries cross the bridge. ---

func (a *App) IngestFile(path string) (int, error) {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	a.stopCapture()
	if a.ensureDB() == nil {
		return 0, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.Ingest(path)
}

// IngestText stages browser-supplied records without replacing saved evidence on
// parse failure. Desktop imports use IngestFile to avoid a large bridge transfer.
func (a *App) IngestText(text string) (int, error) {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	a.stopCapture()
	if a.ensureDB() == nil {
		return 0, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.IngestReader(strings.NewReader(text), "browser-import")
}

func (a *App) GetEventEvidence(seq int64, offset int) (store.EvidencePage, error) {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	if a.ensureDB() == nil {
		return store.EvidencePage{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.Evidence(seq, offset)
}

func (a *App) GetObservation(id int64) (string, error) {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	if a.ensureDB() == nil {
		return "", fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.Observation(id)
}

func (a *App) QueryPage(f store.Filter, offset, limit int) ([]store.Row, error) {
	if a.ensureDB() == nil {
		return nil, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.Page(f, offset, limit)
}

// QueryNewer returns events matching the filter with seq greater than sinceSeq
// (newest-first) - the live tail appends these instead of refetching the whole page.
func (a *App) QueryNewer(f store.Filter, sinceSeq int64, limit int) ([]store.Row, error) {
	if a.ensureDB() == nil {
		return nil, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.Newer(f, sinceSeq, limit)
}

func (a *App) QueryAggregates(f store.Filter) (store.Aggregates, error) {
	if a.ensureDB() == nil {
		return store.Aggregates{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.Aggregates(f)
}

func (a *App) QuerySearch(f store.Filter, requestID string, limit int) (store.SearchResult, error) {
	if a.ensureDB() == nil {
		return store.SearchResult{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	ctx, done, err := a.queries.Begin(a.ctx, requestID)
	if err != nil {
		return store.SearchResult{}, err
	}
	defer done()
	return a.db.Search(ctx, f, limit)
}

func (a *App) QueryAggregatesRequest(f store.Filter, requestID string) (store.Aggregates, error) {
	if a.ensureDB() == nil {
		return store.Aggregates{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	ctx, done, err := a.queries.Begin(a.ctx, requestID)
	if err != nil {
		return store.Aggregates{}, err
	}
	defer done()
	return a.db.AggregatesContext(ctx, f)
}

func (a *App) CancelQuery(requestID string) { a.queries.Cancel(requestID) }

func (a *App) QuerySnapshotPage(f store.Filter, snapshot store.Snapshot, before int64, limit int) ([]store.Row, error) {
	if a.ensureDB() == nil {
		return nil, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.PageSnapshot(a.ctx, f, snapshot, before, limit)
}

type FilteredExport struct {
	Path  string `json:"path"`
	Count int    `json:"count"`
}

func (a *App) ExportFiltered(f store.Filter, snapshot store.Snapshot, requestID string) (FilteredExport, error) {
	if a.ensureDB() == nil {
		return FilteredExport{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	ctx, done, err := a.queries.Begin(a.ctx, requestID)
	if err != nil {
		return FilteredExport{}, err
	}
	defer done()
	path, err := rt.SaveFileDialog(a.ctx, rt.SaveDialogOptions{Title: "Export all matching events", DefaultFilename: "cloudtrail-matches.json", Filters: []rt.FileFilter{{DisplayName: "JSON (*.json)", Pattern: "*.json"}}})
	if err != nil || path == "" {
		return FilteredExport{}, err
	}
	count, err := a.db.ExportFile(ctx, f, snapshot, path)
	if err != nil {
		return FilteredExport{}, fmt.Errorf("export was not saved: %w", err)
	}
	return FilteredExport{Path: path, Count: count}, nil
}

func (a *App) GetEventRaw(seq int64) (string, error) {
	if a.ensureDB() == nil {
		return "", fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.Raw(seq)
}

// RawBySeqs returns the raw CloudTrail JSON for the given event seqs (order preserved),
// so an export can write faithful, re-importable records even though page rows omit raw.
func (a *App) RawBySeqs(seqs []int64) ([]string, error) {
	if a.ensureDB() == nil {
		return nil, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.RawBySeqs(seqs)
}

func (a *App) QueryLineage(seq int64) (store.Lineage, error) {
	if a.ensureDB() == nil {
		return store.Lineage{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.Lineage(seq)
}

func (a *App) QueryLineageGraph(seq int64) (store.LineageTree, error) {
	if a.ensureDB() == nil {
		return store.LineageTree{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.LineageGraph(seq)
}

func (a *App) QueryLineageChildren(accessKeyID string) (store.LineageTree, error) {
	if a.ensureDB() == nil {
		return store.LineageTree{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.LineageChildren(accessKeyID)
}

func (a *App) QueryLineageEvents(accessKeyID string) (store.LineageTree, error) {
	if a.ensureDB() == nil {
		return store.LineageTree{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.LineageEvents(accessKeyID)
}

// SigmaRun validates a Sigma rule and, if supported, returns the matching events +
// the generated SQL + diagnostics (the Sigma testbench view calls this).
func (a *App) SigmaRun(ruleYAML string) (store.SigmaResult, error) {
	if a.ensureDB() == nil {
		return store.SigmaResult{}, fmt.Errorf("query engine unavailable: %v", a.dbErr)
	}
	return a.db.SigmaRun(ruleYAML, 500)
}

// RequiredPermissions lists the IAM actions a connection mode needs.
func (a *App) RequiredPermissions(mode string) []config.RequiredPermission {
	return config.RequiredPermissions(mode)
}

// SetConnection stores the chosen configuration. For import-dump with a server-side
// path it loads immediately; the file-input flow uses LoadDumpText instead.
func (a *App) SetConnection(cfg config.ConnectionConfig) error {
	a.mu.Lock()
	a.cfg = cfg
	a.mu.Unlock()
	if config.Mode(cfg.Mode) == config.ModeImportDump && cfg.DumpPath != "" {
		_, err := a.LoadDumpPath(cfg.DumpPath)
		return err
	}
	return nil
}

// GetInitialEvents returns the currently loaded event set (never nil, so the
// frontend always receives a JSON array).
func (a *App) GetInitialEvents() []model.CloudTrailEvent {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.events == nil {
		return []model.CloudTrailEvent{}
	}
	return a.events
}

// LoadDumpText parses dump content supplied by the frontend (e.g. from a file
// <input>) and stores it. Returns the normalized events.
func (a *App) LoadDumpText(text string) ([]model.CloudTrailEvent, error) {
	evs, err := ingest.ParseDump([]byte(text))
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.events = evs
	a.mu.Unlock()
	return evs, nil
}

// LoadDumpPath reads and parses a file from disk (handles gzip + large files
// better than pushing bytes across the bridge). Returns the normalized events.
func (a *App) LoadDumpPath(path string) ([]model.CloudTrailEvent, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	evs, err := ingest.ParseDump(data)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.events = evs
	a.mu.Unlock()
	return evs, nil
}

// SelectDumpFile opens a native file dialog and returns the chosen path (or "").
func (a *App) SelectDumpFile() (string, error) {
	return rt.OpenFileDialog(a.ctx, rt.OpenDialogOptions{
		Title: "Select a CloudTrail export",
		Filters: []rt.FileFilter{
			{DisplayName: "CloudTrail exports (*.json, *.json.gz, *.csv)", Pattern: "*.json;*.jsonl;*.ndjson;*.json.gz;*.gz;*.csv"},
			{DisplayName: "All files", Pattern: "*.*"},
		},
	})
}

// ExportEventsJSON opens a native save dialog and writes the supplied JSON
// (the frontend serializes the currently-filtered events). Returns the path
// written, or "" if the user cancelled.
func (a *App) ExportEventsJSON(data string) (string, error) {
	path, err := rt.SaveFileDialog(a.ctx, rt.SaveDialogOptions{
		Title:           "Export current selection",
		DefaultFilename: "cloudtrail-selection.json",
		Filters: []rt.FileFilter{
			{DisplayName: "JSON (*.json)", Pattern: "*.json"},
			{DisplayName: "All files", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		return "", fmt.Errorf("write %s: %w", path, err)
	}
	return path, nil
}

// applicationMenu builds the native menu bar. The thin native items are the
// OS-consistent discovery point; the rich Help content lives in an in-app modal
// opened via the emitted "help:open" events (see App.tsx).
func (a *App) applicationMenu() *menu.Menu {
	m := menu.NewMenu()
	if runtime.GOOS == "darwin" {
		m.Append(menu.AppMenu())  // app name, Hide, Quit
		m.Append(menu.EditMenu()) // Cmd+C/V/X/Z inside inputs
	}

	help := m.AddSubmenu("Help")
	help.AddText("Getting Started", keys.Key("F1"), func(_ *menu.CallbackData) {
		rt.EventsEmit(a.ctx, "help:open", "getting-started")
	})
	help.AddText("Connecting", nil, func(_ *menu.CallbackData) {
		rt.EventsEmit(a.ctx, "help:open", "connecting")
	})
	help.AddText("Query Language Reference", nil, func(_ *menu.CallbackData) {
		rt.EventsEmit(a.ctx, "help:open", "query")
	})
	help.AddText("Filtering & Facets", nil, func(_ *menu.CallbackData) {
		rt.EventsEmit(a.ctx, "help:open", "filtering")
	})
	help.AddText("Keyboard Shortcuts", keys.CmdOrCtrl("/"), func(_ *menu.CallbackData) {
		rt.EventsEmit(a.ctx, "help:open", "shortcuts")
	})
	help.AddSeparator()
	help.AddText("Report an Issue…", nil, func(_ *menu.CallbackData) {
		rt.BrowserOpenURL(a.ctx, "https://github.com/humpty-tony/CloudMon/issues")
	})
	help.AddText("About CloudMon", nil, func(_ *menu.CallbackData) {
		rt.MessageDialog(a.ctx, rt.MessageDialogOptions{
			Type:          rt.InfoDialog,
			Title:         "About CloudMon",
			Message:       "CloudMon 0.1.0\nProcMon-style CloudTrail monitor\nBuilt with Wails + Go + React",
			Buttons:       []string{"OK"},
			DefaultButton: "OK",
		})
	})
	return m
}

// MaximizeWindow maximizes the window - the frontend calls this after a
// successful connection so the console fills the screen (the launch screen
// stays comfortably windowed).
func (a *App) MaximizeWindow() {
	rt.WindowMaximise(a.ctx)
}

// ClearEvents empties the in-memory event set.
func (a *App) ClearEvents() {
	a.mu.Lock()
	a.events = nil
	a.mu.Unlock()
}

// --- Live capture (Flow A: EventBridge -> SQS). CloudMon provisions its own rule +
// queue in the caller's account, polls the queue, appends events to the DuckDB table,
// and notifies the UI via the "cloudmon:events" runtime event. It never touches the
// customer's trail. ---

// ListProfiles enumerates the named AWS profiles on this machine (SSO, assume-role,
// access keys) so the connect screen can offer them instead of a free-text field.
func (a *App) ListProfiles() ([]awsflow.Profile, error) {
	return awsflow.ListProfiles()
}

// VerifyIdentity confirms who a profile authenticates as via sts:GetCallerIdentity -
// a read-only call, before anything is created.
func (a *App) VerifyIdentity(profile, region string) (awsflow.Identity, error) {
	cfg, err := awsflow.LoadConfig(a.ctx, profile, region)
	if err != nil {
		a.Log("warn", fmt.Sprintf("verify %q: config load failed: %s", profile, err.Error()))
		return awsflow.Identity{}, err
	}
	id, err := awsflow.VerifyIdentity(a.ctx, cfg, profile, region)
	if err != nil {
		// The UI shows only the clean message; log the full underlying error for triage.
		detail := err.Error()
		if u := errors.Unwrap(err); u != nil {
			detail = u.Error()
		}
		a.Log("warn", fmt.Sprintf("verify %q failed: %s", profile, detail))
	}
	return id, err
}

// StartCapture provisions the Flow A pipeline using the stored connection config and
// starts polling. Returns the created infrastructure so the UI can show ARNs and
// offer teardown. Idempotent while a capture is already running.
// CheckTrail reports whether a CloudTrail trail is actually feeding the region - the
// precondition for Flow A to receive events. The connect screen calls it after identity
// confirms and warns if nothing would arrive.
func (a *App) CheckTrail(profile, region string) (awsflow.TrailStatus, error) {
	cfg, err := awsflow.LoadConfig(a.ctx, profile, region)
	if err != nil {
		return awsflow.TrailStatus{}, err
	}
	return awsflow.CheckTrail(a.ctx, cfg, region)
}

// CheckQueue validates that an existing SQS queue is reachable with the chosen profile
// before the user connects to it (existing-sqs mode). The region is taken from the queue
// URL, which must be a standard SQS URL we can parse.
func (a *App) CheckQueue(profile, queueURL string) error {
	if queueURL == "" {
		return fmt.Errorf("enter an SQS queue URL")
	}
	region := awsflow.RegionFromQueueURL(queueURL)
	if region == "" {
		return fmt.Errorf("couldn't read the queue's region from that URL - use the full https://sqs.<region>.amazonaws.com/... form")
	}
	cfg, err := awsflow.LoadConfig(a.ctx, profile, region)
	if err != nil {
		return err
	}
	return awsflow.CheckQueue(a.ctx, cfg, queueURL)
}

// onLiveBatch returns only after the database commits. No acknowledged event is
// parked in an in-memory buffer; the poller retains and retries a failed batch.
func (a *App) onLiveBatch(ctx context.Context, evs []model.CloudTrailEvent) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	a.capMu.Lock()
	source := a.capInfra.QueueURL
	a.capMu.Unlock()
	total, err := a.db.AppendFromContext(ctx, evs, source)
	if err != nil {
		return err
	}
	if a.ctx != nil {
		rt.EventsEmit(a.ctx, "cloudmon:events", map[string]int{"added": len(evs), "total": total})
	}
	return nil
}

// StopCapture halts polling but leaves the provisioned infrastructure in place so
// capture can resume instantly.
func (a *App) StopCapture() {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	a.stopCapture()
}

// Caller holds lifecycleMu; joining prevents writes crossing a dataset switch.
func (a *App) stopCapture() {
	a.capMu.Lock()
	cancel := a.capCancel
	done := a.capDone
	a.capCancel = nil
	a.capDone = nil
	a.capActive = false
	a.capMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
	a.Log("info", "capture stopped (infrastructure kept)")
}

// RunLoginCommand runs an SSO-login command the credential helper suggested (e.g.
// `granted sso login …` or `aws sso login --profile …`) with its console window
// hidden. Called by the connect screen's "run login" affordance. Blocks until the
// browser flow completes (bounded to a few minutes).
func (a *App) RunLoginCommand(command string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	a.Log("info", "running login command: "+command)
	if err := awsflow.RunLoginCommand(ctx, command); err != nil {
		a.Log("warn", "login command failed: "+err.Error())
		return err
	}
	a.Log("info", "login command completed")
	return nil
}

// onShutdown joins the poller. Evidence and the capture journal remain available
// after restart; infrastructure is removed only by an explicit cleanup action.
func (a *App) onShutdown(_ context.Context) {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	a.stopCapture()
	if db := a.ensureDB(); db != nil {
		if err := db.Close(); err != nil {
			a.Log("error", "close evidence: "+err.Error())
		}
	}
	a.Log("info", "app closed; saved evidence and capture resources retained")
}

// ApplyCaptureFilter stores a custom EventBridge pattern; it takes effect on the next
// StartCapture (changing a live rule in place is a later refinement).
func (a *App) ApplyCaptureFilter(pattern string) {
	a.mu.Lock()
	a.cfg.CapturePattern = pattern
	a.mu.Unlock()
	a.Log("info", "capture filter stored (applies on next start)")
}
