// Backend abstraction. In a Wails build, window.go.main.App.* and window.runtime
// are injected - we call those (DuckDB-backed, scales to multi-GB). In a plain
// browser (UI development / vision review) neither exists, so we fall back to an
// in-memory MockBackend over a JS array. Both implement the SAME windowed API:
// the UI pulls pages + aggregates, never the whole dataset.

import type {
  AwsIdentity,
  RecoveryState,
  SavedCapture,
  EvidencePage,
  AwsProfile,
  CaptureInfra,
  CloudTrailEvent,
  ConnectionConfig,
  ConnectionMode,
  TrailStatus,
  EngineAggregates,
  EventRow,
  FilterField,
  Lineage,
  LineageTree,
  QueryFilter,
  RequiredPermission,
  SigmaDiag,
  SigmaResultRaw,
} from "./types";
import { rowToEvent } from "./types";
import { MockFeed, mockPermissions } from "./mock";
import { parseDump } from "./dumpParser";
import { applyFilter } from "./searchFilter";
import { computeFacets, type FacetGroup } from "./facets";
import { computeHistogram, type Histogram } from "./histogram";
import { computeStats, fmtSpan, type Stats } from "../components/StatsBar";

type EventCb = (e: CloudTrailEvent) => void;

/** Aggregates in the shapes the UI components already consume. */
export interface QueryResult {
  total: number;
  facets: FacetGroup[];
  histogram: Histogram;
  stats: Stats;
}

/** Sigma test outcome with rows already mapped to the event shape the UI uses. */
export interface SigmaOutcome {
  parsed: boolean;
  supported: boolean;
  title: string;
  diagnostics: SigmaDiag[];
  sql: string;
  matches: number;
  scanned: number;
  events: CloudTrailEvent[];
}

export interface Backend {
  readonly live: boolean; // true => connected to a real Wails backend
  requiredPermissions(mode: ConnectionMode): Promise<RequiredPermission[]>;
  setConnection(cfg: ConnectionConfig): Promise<void>;
  // ---- Flow A live capture ----
  listProfiles(): Promise<AwsProfile[]>; // ~/.aws named profiles (SSO / assume-role / keys)
  verifyIdentity(profile: string, region: string): Promise<AwsIdentity>; // sts:GetCallerIdentity (read-only)
  checkTrail(profile: string, region: string): Promise<TrailStatus>; // is a trail actually feeding this region?
  checkQueue(profile: string, queueUrl: string): Promise<void>; // existing-sqs: reachable + right region + permitted?
  runLoginCommand(command: string): Promise<void>; // run the SSO-login the credential helper suggests
  startCapture(): Promise<CaptureInfra>; // provision rule+queue, start polling; returns the infra
  resumeCapture(): Promise<CaptureInfra>;
  getRecoveryState(): Promise<RecoveryState>;
  getEventEvidence(seq: number, offset: number): Promise<EvidencePage>;
  getObservation(id: number): Promise<string>;
  stopCapture(): Promise<void>; // stop polling, keep infra
  teardownCapture(): Promise<void>; // remove rule + target + queue
  applyCaptureFilter(pattern: string): Promise<void>;
  onEvent(cb: EventCb): () => void; // per-event (mock feed)
  onCaptureProgress(cb: (p: { added: number; total: number }) => void): () => void; // batch signal (live)

  // ---- windowed query model ----
  selectDumpPath(): Promise<string>; // native picker → path ("" in browser)
  ingestPath(path: string): Promise<number>; // desktop; returns total events
  ingestText(text: string): Promise<number>; // browser / fallback
  ingestNetworkBacklog(): Promise<number>; // for non-import modes (mock feed)
  queryPage(filter: QueryFilter, offset: number, limit: number): Promise<CloudTrailEvent[]>; // newest-first
  queryNewer(filter: QueryFilter, sinceSeq: number, limit: number): Promise<CloudTrailEvent[]>; // seq>sinceSeq, newest-first (live append)
  queryAggregates(filter: QueryFilter): Promise<QueryResult>;
  getEventRaw(seq: number): Promise<string>;
  queryLineage(seq: number): Promise<Lineage>; // assumed-role ancestry chain
  queryLineageGraph(seq: number): Promise<LineageTree>; // full lineage tree centred on the event
  queryLineageChildren(accessKeyId: string): Promise<LineageTree>; // lazy expand a node's child sessions
  queryLineageEvents(accessKeyId: string): Promise<LineageTree>; // expand a session's own events as nodes
  sigmaRun(ruleYAML: string): Promise<SigmaOutcome>; // validate + test a Sigma rule
}

interface WailsWindow {
  go?: { main?: { App?: Record<string, (...args: unknown[]) => Promise<unknown>> } };
  runtime?: { EventsOn: (name: string, cb: (data: unknown) => void) => () => void };
}

function wailsApp(): Record<string, (...args: unknown[]) => Promise<unknown>> | null {
  const w = window as unknown as WailsWindow;
  return w.go?.main?.App ?? null;
}

// ---- engine (Go) aggregate shape → the frontend component shapes ----

const FACET_DEFS: [string, FilterField, string][] = [
  ["eventSource", "eventSource", "eventSource"],
  ["eventName", "eventName", "eventName"],
  ["userName", "user", "user"],
  ["roleArn", "roleArn", "roleArn"],
  ["identityType", "identityType", "identityType"],
  ["sourceIPAddress", "sourceIPAddress", "sourceIPAddress"],
  ["awsRegion", "awsRegion", "awsRegion"],
];

function mapFacets(agg: EngineAggregates): FacetGroup[] {
  const out: FacetGroup[] = [];
  for (const [col, field, label] of FACET_DEFS) {
    const vals = agg.facets[col] || [];
    if (!vals.length) continue;
    const max = vals[0].count || 1;
    out.push({ field, label, total: vals.length, values: vals.map((v) => ({ value: v.value, count: v.count, fraction: v.count / max })) });
  }
  return out;
}

function mapHistogram(agg: EngineAggregates): Histogram {
  const step = agg.histStep || 60_000;
  if (!agg.histogram.length) return { buckets: [], step, from: 0, to: 0, max: 0 };
  const from = agg.histFrom;
  const to = agg.histTo;
  const n = Math.max(1, Math.round((to - from) / step));
  const buckets = Array.from({ length: n }, (_, i) => ({ start: from + i * step, end: from + (i + 1) * step, total: 0, errors: 0 }));
  let max = 0;
  for (const b of agg.histogram) {
    const idx = Math.round((b.t - from) / step);
    if (idx >= 0 && idx < n) {
      buckets[idx].total = b.n;
      buckets[idx].errors = b.e;
      if (b.n > max) max = b.n;
    }
  }
  return { buckets, step, from, to, max };
}

function mapStats(agg: EngineAggregates): Stats {
  const s = agg.stats;
  const span = s.maxMs && s.minMs && s.maxMs > s.minMs ? fmtSpan(s.maxMs - s.minMs) : "-";
  return {
    shown: agg.total,
    total: agg.total, // App overrides with the unfiltered dataset total
    errors: s.errors,
    errorRate: agg.total ? (s.errors / agg.total) * 100 : 0,
    principals: s.principals,
    sources: s.sources,
    regions: s.regions,
    span,
  };
}

class WailsBackend implements Backend {
  readonly live = true;
  private app = wailsApp()!;

  requiredPermissions(mode: ConnectionMode) {
    return this.app.RequiredPermissions(mode) as Promise<RequiredPermission[]>;
  }
  setConnection(cfg: ConnectionConfig) {
    return this.app.SetConnection(cfg) as Promise<void>;
  }
  listProfiles() {
    return this.app.ListProfiles() as Promise<AwsProfile[]>;
  }
  verifyIdentity(profile: string, region: string) {
    return this.app.VerifyIdentity(profile, region) as Promise<AwsIdentity>;
  }
  checkTrail(profile: string, region: string) {
    return this.app.CheckTrail(profile, region) as Promise<TrailStatus>;
  }
  async checkQueue(profile: string, queueUrl: string) {
    await this.app.CheckQueue(profile, queueUrl);
  }
  runLoginCommand(command: string) {
    return this.app.RunLoginCommand(command) as Promise<void>;
  }
  startCapture() {
    return this.app.StartCapture() as Promise<CaptureInfra>;
  }
  resumeCapture() { return this.app.ResumeCapture() as Promise<CaptureInfra>; }
  getRecoveryState() { return this.app.GetRecoveryState() as Promise<RecoveryState>; }
  getEventEvidence(seq: number, offset: number) { return this.app.GetEventEvidence(seq, offset) as Promise<EvidencePage>; }
  getObservation(id: number) { return this.app.GetObservation(id) as Promise<string>; }
  stopCapture() {
    return this.app.StopCapture() as Promise<void>;
  }
  teardownCapture() {
    return this.app.TeardownCapture() as Promise<void>;
  }
  applyCaptureFilter(pattern: string) {
    return this.app.ApplyCaptureFilter(pattern) as Promise<void>;
  }
  onEvent(cb: EventCb): () => void {
    const w = window as unknown as WailsWindow;
    return w.runtime!.EventsOn("cloudmon:event", (data) => cb(data as CloudTrailEvent));
  }
  onCaptureProgress(cb: (p: { added: number; total: number }) => void): () => void {
    const w = window as unknown as WailsWindow;
    return w.runtime!.EventsOn("cloudmon:events", (data) => cb(data as { added: number; total: number }));
  }

  selectDumpPath() {
    return (this.app.SelectDumpFile?.() ?? Promise.resolve("")) as Promise<string>;
  }
  ingestPath(path: string) {
    return this.app.IngestFile(path) as Promise<number>;
  }
  ingestText(text: string) {
    return this.app.IngestText(text) as Promise<number>;
  }
  async ingestNetworkBacklog() {
    return (await this.getRecoveryState()).evidence.events;
  }
  async queryPage(filter: QueryFilter, offset: number, limit: number) {
    const rows = (await this.app.QueryPage(filter, offset, limit)) as EventRow[];
    return (rows || []).map(rowToEvent);
  }
  async queryNewer(filter: QueryFilter, sinceSeq: number, limit: number) {
    const rows = (await this.app.QueryNewer(filter, sinceSeq, limit)) as EventRow[];
    return (rows || []).map(rowToEvent);
  }
  async queryAggregates(filter: QueryFilter): Promise<QueryResult> {
    const agg = (await this.app.QueryAggregates(filter)) as EngineAggregates;
    return { total: agg.total, facets: mapFacets(agg), histogram: mapHistogram(agg), stats: mapStats(agg) };
  }
  getEventRaw(seq: number) {
    return this.app.GetEventRaw(seq) as Promise<string>;
  }
  queryLineage(seq: number) {
    return this.app.QueryLineage(seq) as Promise<Lineage>;
  }
  queryLineageGraph(seq: number) {
    return this.app.QueryLineageGraph(seq) as Promise<LineageTree>;
  }
  queryLineageChildren(accessKeyId: string) {
    return this.app.QueryLineageChildren(accessKeyId) as Promise<LineageTree>;
  }
  queryLineageEvents(accessKeyId: string) {
    return this.app.QueryLineageEvents(accessKeyId) as Promise<LineageTree>;
  }
  async sigmaRun(ruleYAML: string): Promise<SigmaOutcome> {
    const r = (await this.app.SigmaRun(ruleYAML)) as SigmaResultRaw;
    return {
      parsed: r.parsed, supported: r.supported, title: r.title,
      diagnostics: r.diagnostics || [], sql: r.sql, matches: r.matches, scanned: r.scanned,
      events: (r.rows || []).map(rowToEvent),
    };
  }
}

// ---- in-memory mock (browser preview): same windowed API over a JS array ----

class MockBackend implements Backend {
  readonly live = false;
  private feed = new MockFeed();
  private capture: SavedCapture | null = null;
  private connection: ConnectionConfig | null = null;
  private active = false;
  private data: CloudTrailEvent[] = [];
  private mode: ConnectionMode | "" = ""; // tracked from setConnection so startCapture mirrors the real owned flag

  async requiredPermissions(mode: ConnectionMode) {
    return mockPermissions(mode);
  }
  async setConnection(cfg: ConnectionConfig) {
    this.mode = cfg.mode;
    this.connection = cfg;
  }
  async listProfiles(): Promise<AwsProfile[]> {
    return [
      { name: "default", kind: "keys", region: "us-east-1" },
      { name: "coveo-prod", kind: "sso", region: "us-west-2" },
      { name: "audit-ro", kind: "assume-role", region: "us-east-1" },
    ];
  }
  async verifyIdentity(profile: string, region: string): Promise<AwsIdentity> {
    return {
      account: "123456789012",
      arn: `arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_Demo/${profile}`,
      userId: "AROAEXAMPLE:demo",
      profile,
      region,
    };
  }
  async checkTrail(): Promise<TrailStatus> {
    return { hasLoggingTrail: true, trailCount: 1, globalCovered: true, readManagement: true, writeManagement: true, coverageKnown: true, coverageComplete: true, summary: "Demo: management read/write selectors enabled. EventBridge delivery is regional and best-effort." };
  }
  async checkQueue() {}
  async runLoginCommand() {}
  async startCapture(): Promise<CaptureInfra> {
    const infra: CaptureInfra = {
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/cloudmon-capture-demo",
      queueName: "cloudmon-capture-demo",
      queueArn: "arn:aws:sqs:us-east-1:123456789012:cloudmon-capture-demo",
      ruleName: "cloudmon-cloudtrail-demo",
      ruleArn: "arn:aws:events:us-east-1:123456789012:rule/cloudmon-cloudtrail-demo",
      region: "us-east-1", account: "123456789012", allManagement: true, owned: this.mode !== "existing-sqs",
    };
    this.capture = {version: 1, phase: "ready", config: this.connection!, infra};
    this.feed.start(); this.active = true;
    return infra;
  }
  async resumeCapture() {
    if (!this.capture) throw Error("No saved capture");
    this.feed.start(); this.active = true;
    return this.capture.infra;
  }
  async getRecoveryState(): Promise<RecoveryState> {
    return {evidence: {events: this.data.length, observations: this.data.length, variantEvents: 0, lossy: 0}, capture: this.capture, captureError: "", active: this.active};
  }
  async getEventEvidence(seq: number): Promise<EvidencePage> {
    const raw = await this.getEventRaw(seq);
    const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
    const sha256 = [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
    return {total: 1, variants: 1, observations: [{id: seq, sha256, source: "browser-preview", ordinal: seq, format: "demo-json", lossy: false, observedAt: "", displayed: true}]};
  }
  getObservation(id: number) { return this.getEventRaw(id); }
  async stopCapture() { this.feed.stop(); this.active = false; }
  async teardownCapture() { this.feed.stop(); this.active = false; this.capture = null; }
  async applyCaptureFilter() {}
  onEvent(cb: EventCb): () => void {
    return this.feed.onEvent((e) => {
      this.data.push(e);
      cb(e);
    });
  }
  onCaptureProgress(): () => void {
    return () => {};
  }

  async selectDumpPath() {
    return ""; // no native path in the browser
  }
  async ingestPath() {
    return 0; // browser has no filesystem path
  }
  async ingestText(text: string) {
    this.data = parseDump(text);
    return this.data.length;
  }
  async ingestNetworkBacklog() {
    this.data = this.feed.backlog(2000);
    return this.data.length;
  }
  async queryPage(filter: QueryFilter, offset: number, limit: number) {
    // Sort by seq DESC to match the real backend + queryNewer, so events[0] is the max
    // seq (the invariant the live append relies on) in browser preview too.
    const filtered = applyFilter(this.data, filter).sort((a, b) => b.seq - a.seq);
    return filtered.slice(offset, offset + limit);
  }
  async queryNewer(filter: QueryFilter, sinceSeq: number, limit: number) {
    const filtered = applyFilter(this.data, filter)
      .filter((e) => e.seq > sinceSeq)
      .sort((a, b) => b.seq - a.seq);
    return filtered.slice(0, limit);
  }
  async queryAggregates(filter: QueryFilter): Promise<QueryResult> {
    const filtered = applyFilter(this.data, filter);
    return {
      total: filtered.length,
      facets: computeFacets(filtered),
      histogram: computeHistogram(filtered, Date.now()),
      stats: computeStats(filtered, this.data.length),
    };
  }
  async getEventRaw(seq: number) {
    return this.data.find((e) => e.seq === seq)?.rawJSON ?? "";
  }
  async queryLineage(): Promise<Lineage> {
    return { applicable: false, sourceIdentity: "", complete: false, nodes: [] }; // no engine in the browser preview
  }
  async queryLineageGraph(): Promise<LineageTree> {
    return { applicable: false, currentId: "", rootId: "", nodes: [], edges: [], notes: [] };
  }
  async queryLineageChildren(): Promise<LineageTree> {
    return { applicable: false, currentId: "", rootId: "", nodes: [], edges: [], notes: [] };
  }
  async queryLineageEvents(): Promise<LineageTree> {
    return { applicable: false, currentId: "", rootId: "", nodes: [], edges: [], notes: [] };
  }
  async sigmaRun(): Promise<SigmaOutcome> {
    // The Sigma engine lives in Go - unavailable in the browser preview.
    return { parsed: false, supported: false, title: "", sql: "", matches: 0, scanned: 0, events: [],
      diagnostics: [{ severity: "warning", message: "Sigma testing needs the desktop app (the Go engine)." }] };
  }
}

export const backend: Backend = wailsApp() ? new WailsBackend() : new MockBackend();

/** Subscribe to a Wails runtime event (e.g. native-menu clicks). No-op in the browser preview. */
export function onMenuEvent(name: string, cb: (data?: unknown) => void): () => void {
  const w = window as unknown as WailsWindow;
  if (w.runtime?.EventsOn) return w.runtime.EventsOn(name, cb);
  return () => {};
}

/** Maximize the desktop window (no-op in the browser preview). */
export function maximizeWindow(): void {
  const app = wailsApp();
  if (app?.MaximizeWindow) void app.MaximizeWindow();
}

// ---- Frameless window controls. Backed by the Wails runtime; no-ops in browser. ----
interface WailsRuntimeControls {
  WindowMinimise?: () => void;
  WindowToggleMaximise?: () => void;
  Quit?: () => void;
  BrowserOpenURL?: (url: string) => void;
}
function rtControls(): WailsRuntimeControls | undefined {
  return (window as unknown as { runtime?: WailsRuntimeControls }).runtime;
}
export const windowControls = {
  available: () => !!rtControls()?.WindowMinimise,
  minimise: () => rtControls()?.WindowMinimise?.(),
  toggleMaximise: () => rtControls()?.WindowToggleMaximise?.(),
  close: () => rtControls()?.Quit?.(),
  openURL: (url: string) => {
    const r = rtControls();
    if (r?.BrowserOpenURL) r.BrowserOpenURL(url);
    else window.open(url, "_blank");
  },
};

/** Export events as a re-importable CloudTrail JSON ({"Records":[…]}). */
export async function exportEvents(events: CloudTrailEvent[]): Promise<string | null> {
  const app = wailsApp();
  // Page rows carry an empty rawJSON (the engine omits it to keep windows light), so
  // fetch the real records from the backend by seq. Without this the export would
  // silently emit the flattened UI object instead of the original CloudTrail record.
  const raws = app?.RawBySeqs
    ? await app.RawBySeqs(events.map(e=>e.seq)) as string[]
    : events.map(e=>e.rawJSON);
  if (!raws || raws.length !== events.length) throw Error("Some source records are unavailable; refresh before exporting.");
  for (const raw of raws) {
    if (!raw) throw Error("A source record is missing; export cancelled.");
    JSON.parse(raw); // validate only; never re-encode through JavaScript numbers
  }
  const json = '{"Records":[\n' + raws.join(',\n') + '\n]}';
  if (app?.ExportEventsJSON) {
    return (await app.ExportEventsJSON(json)) as string;
  }
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cloudtrail-selection.json";
  a.click();
  URL.revokeObjectURL(url);
  return "cloudtrail-selection.json";
}
