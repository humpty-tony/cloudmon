import {ComparisonBar} from "./components/EvidenceComparison";
import { hasCredentialLineage } from "./api/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SavedCapture, RecoveryState, CloudTrailEvent, ConnectionConfig, EvidenceSnapshot, FilterField, Lineage, QueryFilter, QueryOp, QueryTerm } from "./api/types";
import { backend, maximizeWindow, exportEvents, onMenuEvent, type QueryResult } from "./api/backend";
import { COLUMN_BY_KEY } from "./api/columns";
import { DEFAULT_PRESET, PRESETS, type Preset } from "./api/presets";
import {
  effectiveSensitive,
  resetAllPreferences,
  ROW_H_BY_DENSITY,
  DEFAULT_SENSITIVE_OVERRIDE,
  DEFAULT_TIMEZONE,
  DEFAULT_DENSITY,
  type Density,
  type SensitiveOverride,
  type TimeZonePref,
} from "./api/settings";
import { addTerm, applyPivot, removeTerm, timeTerm, toggleFieldTerm } from "./api/query";
import { compileQuery } from "./api/queryLang";
import { buildFilter } from "./api/searchFilter";
import { fmtClock, fmtStamp } from "./api/time";
import { QUERY_FIELDS } from "./api/types";
import { CaptureDescription, removalPrompt } from "./components/RecoveryCard";
import { ConnectionScreen } from "./components/ConnectionScreen";
import { Toolbar } from "./components/Toolbar";
import { WorkspaceActivity } from "./components/WorkspaceActivity";
import { QueryBar } from "./components/QueryBar";
import { FacetSidebar } from "./components/FacetSidebar";
import { HistogramStrip } from "./components/HistogramStrip";
import { EventInspector } from "./components/EventInspector";
import "./workbench.css";
import { EventTable } from "./components/EventTable";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { HelpModal } from "./components/HelpModal";
import { DEFAULT_THEME } from "./api/themes";
import { TitleBar } from "./components/TitleBar";
import { LineageView } from "./components/LineageView";
import { SigmaView } from "./components/SigmaView";
import { AnalysisView } from "./components/AnalysisView";
import { HuntView } from "./components/HuntView";
import { SettingsModal } from "./components/SettingsModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installCrashLogging } from "./api/log";

const OFFLINE_CONFIG: ConnectionConfig = { mode: "import-dump", region: "", profile: "", queueUrl: "", ruleArn: "", dumpPath: "", dumpText: "", capturePattern: "" };

const PAGE = 2000; // rows fetched per page (appended on scroll)
const MAX_LOADED = 20000; // hard cap on rows held in the browser (refine filter past this)
const STREAM_APPEND_MS = 350; // live-tail throttle - only fetches + PREPENDS new rows (cheap), so it can be snappy
const AGG_REFRESH_MS = 2500; // facets/histogram/stats are a full scan - refresh them on a slower cadence while streaming

const EMPTY_AGG: QueryResult = {
  snapshot: null,
  total: 0,
  facets: [],
  histogram: { buckets: [], step: 60_000, from: 0, to: 0, max: 0 },
  stats: { shown: 0, total: 0, errors: 0, errorRate: 0, principals: 0, sources: 0, regions: 0, span: "-" },
};

const QUERY_FIELD_SET = new Set<string>(QUERY_FIELDS);

// Browser-only file picker (desktop uses the native dialog via backend.selectDumpPath).
function pickFileText(): Promise<string> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.csv,.ndjson,application/json,text/csv";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve("");
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => resolve("");
      r.readAsText(f);
    };
    input.click();
  });
}

// tiny persistence helper
const load = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem("cloudmon." + k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem("cloudmon." + k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

export default function App() {
  const [connected, setConnected] = useState(false);
  const [datasetSession, setDatasetSession] = useState(0);
  const [config, setConfig] = useState<ConnectionConfig | null>(null);
  const [events, setEvents] = useState<CloudTrailEvent[]>([]); // loaded window, oldest-first (the table flips to newest-on-top)
  const [datasetTotal, setDatasetTotal] = useState(0); // total ingested events (unfiltered)
  const [agg, setAgg] = useState<QueryResult>(EMPTY_AGG); // total + facets + histogram + stats for the current filter
  const [querying, setQuerying] = useState(false); // running the filter query (aggregates + first page)
  const [queryFailure, setQueryFailure] = useState<string | null>(null);
  const resultsFilter = useRef<QueryFilter | null>(null);
  const searchBlocked = useRef(true);
  const pageSnapshot = useRef<EvidenceSnapshot | null>(null);
  const unloadedSnapshotRows = useRef(0);
  const tailFloor = useRef(0);
  const queryQueue = useRef<Promise<unknown>>(Promise.resolve());
  const aggregateAbort = useRef<AbortController | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const [exporting,setExporting] = useState(false);
  const [exportNotice,setExportNotice] = useState("");
  const [loadingMore, setLoadingMore] = useState(false); // fetching the next page
  const [selectedRaw, setSelectedRaw] = useState(""); // lazily-fetched raw JSON for the expanded row
  const [selectedRawErr, setSelectedRawErr] = useState(false); // raw fetch failed (distinct from still-loading)
  const detailReq = useRef(0); // guards the detail fetch: a newer expand supersedes an in-flight older one
  const [selectedLineage, setSelectedLineage] = useState<Lineage | null>(null); // assumed-role ancestry for the expanded row
  const [selectedLineageError, setSelectedLineageError] = useState(false);
  const [lineageSeq, setLineageSeq] = useState<number | null>(null); // full lineage graph overlay, focused on this event
  const [refreshTick, setRefreshTick] = useState(0); // streaming bumps this to re-query
  const [capturing, setCapturing] = useState(false);
  const [savedCapture, setSavedCapture] = useState<SavedCapture | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const capInfra = savedCapture?.infra ?? null;
  const [terms, setTerms] = useState<QueryTerm[]>([]);
  const [queryText, setQueryText] = useState("");
  const [sensitiveOnly, setSensitiveOnly] = useState<boolean>(() => load("sensitiveOnly", false)); // sticky across sessions
  const [selected, setSelected] = useState<CloudTrailEvent | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [selectedSnapshot, setSelectedSnapshot] = useState<EvidenceSnapshot | null>(null);
  const [cursorSeq, setCursorSeq] = useState(-1); // anchored to event identity, not row position
  const [follow, setFollow] = useState(true);
  const [newCount, setNewCount] = useState(0);

  const [presetKey, setPresetKey] = useState<string>(() => load("workbench.preset", DEFAULT_PRESET.key));
  const [visibleCols, setVisibleCols] = useState<string[]>(() => load("workbench.cols", DEFAULT_PRESET.columns));
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => load("workbench.colw", {}));
  const [customPresets, setCustomPresets] = useState<Preset[]>(() => load("customPresets", []));
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => load("sidebar", false));
  const [histCollapsed, setHistCollapsed] = useState<boolean>(() => load("workbench.hist", true));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [help, setHelp] = useState<{ open: boolean; tab: string }>({ open: false, tab: "getting-started" });
  const [theme, setTheme] = useState<string>(() => load("theme", DEFAULT_THEME));
  const [uiView, setUiView] = useState<"console" | "sigma" | "analysis" | "hunts">("console");
  const [visitedViews, setVisitedViews] = useState<typeof uiView[]>(["console"]);
  const selectView = useCallback((view: typeof uiView) => {
    setUiView(view);
    setVisitedViews(previous => previous.includes(view) ? previous : [...previous, view]);
  }, []);
  // ---- user settings (config menu) ----
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sensitiveOverride, setSensitiveOverride] = useState<SensitiveOverride>(() => {
    // Normalize at the load boundary so a partial/legacy shape can't crash the editor.
    const ov = load<Partial<SensitiveOverride> | null>("sensitiveOverride", DEFAULT_SENSITIVE_OVERRIDE);
    return { add: Array.isArray(ov?.add) ? ov!.add : [], remove: Array.isArray(ov?.remove) ? ov!.remove : [] };
  });
  const [timeZone, setTimeZone] = useState<TimeZonePref>(() => load("timeZone", DEFAULT_TIMEZONE));
  const [density, setDensity] = useState<Density>(() => load("density", DEFAULT_DENSITY));

  const queryInputRef = useRef<HTMLInputElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;
  const reqId = useRef(0); // bumped per filter query; guards stale responses/appends
  const loadingMoreRef = useRef(false);
  // Live-tail refs (read by handlers set up once) + the append throttle.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const datasetTotalRef = useRef(datasetTotal);
  datasetTotalRef.current = datasetTotal;
  const scheduleAppendRef = useRef<() => void>(() => {});
  const appendTimer = useRef<number | null>(null);
  const appendInFlight = useRef(false);
  const appendPending = useRef(false);
  const streamVersion = useRef(0);
  const aggregateVersion = useRef(-1);
  const aggregateInFlight = useRef(false);
  const initialQuery = useRef<number | null>(null);

  const closeInspector = useCallback(() => {
    ++detailReq.current;
    setSelected(null); setSelectedSnapshot(null); setSelectedRaw(""); setSelectedRawErr(false);
    setSelectedLineage(null); setSelectedLineageError(false);
  }, []);

  // Persist uncaught errors/rejections to cloudmon.log (mount-once, before anything else).
  useEffect(() => installCrashLogging(), []);

  // Native Help-menu events (mount-once).
  useEffect(() => {
    const offHelp = onMenuEvent("help:open", (t) =>
      setHelp({ open: true, tab: typeof t === "string" && t ? t : "getting-started" })
    );
    return () => {
      offHelp();
    };
  }, []);

  useEffect(() => save("workbench.preset", presetKey), [presetKey]);
  useEffect(() => save("workbench.cols", visibleCols), [visibleCols]);
  useEffect(() => save("workbench.colw", colWidths), [colWidths]);
  useEffect(() => save("customPresets", customPresets), [customPresets]);
  useEffect(() => save("sidebar", sidebarCollapsed), [sidebarCollapsed]);
  useEffect(() => save("workbench.hist", histCollapsed), [histCollapsed]);
  useEffect(() => save("sensitiveOnly", sensitiveOnly), [sensitiveOnly]);
  useEffect(() => save("sensitiveOverride", sensitiveOverride), [sensitiveOverride]);
  useEffect(() => save("timeZone", timeZone), [timeZone]);
  useEffect(() => {
    document.documentElement.dataset.density = density; // CSS reads this for --row-h + cell padding
    save("density", density);
  }, [density]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    save("theme", theme);
  }, [theme]);

  // Streaming: when following, APPEND (prepend) just-arrived rows via a light throttle -
  // no full-window replace, so scroll/virtualization don't reset. When paused, only
  // count arrivals for the pill and keep the window frozen.
  useEffect(() => {
    if (!connected) return;
    return backend.onEvent(() => {
      streamVersion.current++;
      if (!followRef.current) {
        setNewCount((n) => n + 1);
        return;
      }
      scheduleAppendRef.current();
    });
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    return backend.onCaptureProgress(({ total }) => {
      const newEvents = Math.max(0, total - datasetTotalRef.current);
      datasetTotalRef.current = total;
      setDatasetTotal(total); // total climbs even while paused (counter only)
      if (newEvents === 0) return; // source redelivery did not change searchable rows
      streamVersion.current++;
      if (!followRef.current) {
        setNewCount((n) => n + newEvents);
        return;
      }
      scheduleAppendRef.current();
    });
  }, [connected]);

  const enterDataset = (cfg: ConnectionConfig, total: number, capture: SavedCapture | null, active: boolean) => {
    ++detailReq.current;
    searchBlocked.current = true;
    resultsFilter.current = null;
    setQueryFailure(null);
    datasetTotalRef.current = total;
    streamVersion.current++;
    setConfig(cfg);setDatasetTotal(total);setSavedCapture(capture);setCapturing(active);
    setEvents([]);setTerms([]);setQueryText("");closeInspector();setCursorSeq(-1);setFollow(active);
    // Retain view state within a dataset, never across a source replacement.
    setDatasetSession(n => n + 1);setUiView("console");setVisitedViews(["console"]);setLineageSeq(null);
    setRefreshTick(n=>n+1);setConnected(true);maximizeWindow();
  };
  const connect = async (cfg: ConnectionConfig) => {
    if (cfg.mode === "import-dump") {
      cfg.dumpPath ? await backend.ingestPath(cfg.dumpPath) : await backend.ingestText(cfg.dumpText);
    } else {
      await backend.setConnection(cfg);
      await backend.ingestNetworkBacklog();
      await backend.startCapture();
    }
    const state = await backend.getRecoveryState();
    enterDataset(cfg, state.evidence.events, state.capture, state.active);
  };
  const restoreDataset = async (state: RecoveryState, resume: boolean) => {
    if(resume) await backend.resumeCapture();
    else if(state.active) await backend.stopCapture();
    const fresh = await backend.getRecoveryState();
    enterDataset(resume && fresh.capture ? {...fresh.capture.config, dumpText: ""} : OFFLINE_CONFIG, fresh.evidence.events, fresh.capture, resume);
  };

  const columns = useMemo(() => visibleCols.map((key) => COLUMN_BY_KEY[key]).filter(Boolean).map(column => {
    if (presetKey !== "workbench" || uiView !== "console") return column;
    const width = column.key === "time" ? 88 : column.key === "name" ? 160 : column.key === "result" ? 108 : column.width;
    return {...column, width, label: column.key === "time" ? "Time" : column.key === "name" ? "Action / principal" : column.key === "result" ? "Result" : column.label};
  }), [visibleCols, presetKey, uiView]);

  // Invalid applied expressions fail closed; never discard an invalid predicate
  // and accidentally broaden the search.
  const compiled = useMemo(() => compileQuery(queryText, QUERY_FIELD_SET), [queryText]);
  // The effective sensitive set = shipped defaults + user overrides. BOTH the
  // "Sensitive only" filter and the row highlight read it, so they never disagree.
  const sensitiveSet = useMemo(() => effectiveSensitive(sensitiveOverride), [sensitiveOverride]);
  const isSensitiveFn = useMemo(() => (name: string) => sensitiveSet.has(name), [sensitiveSet]);
  const rowH = ROW_H_BY_DENSITY[density];
  // Feed the set into the QUERY only when the lens is on; otherwise editing the
  // sensitive list would needlessly re-run aggregates+page over the whole dataset
  // (the row highlight still updates live off sensitiveSet - that's cheap).
  const activeSensitive = sensitiveOnly ? sensitiveSet : null;
  const filter = useMemo(
    () => ({ ...buildFilter(terms, sensitiveOnly, compiled.ast, activeSensitive), ...(compiled.error ? { matchNone: true } : {}) }),
    [terms, sensitiveOnly, compiled, activeSensitive]
  );
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // Append just-arrived rows (seq > current max) to the top - cheap, index-backed, and
  // it leaves the existing rows/scroll untouched. reqId guards against a filter change
  // landing mid-flight.
  const appendNewRows = useCallback(async () => {
    if (!followRef.current || searchBlocked.current || resultsFilter.current !== filterRef.current) return;
    appendInFlight.current = true;
    const cur = eventsRef.current;
    const maxSeq = Math.max(tailFloor.current, cur.length ? cur[0].seq : 0);
    const id = reqId.current;
    // NB: the append is meant to be invisible - it does NOT touch `querying`, so it can't
    // flicker the "loading" indicator or clobber the loading state of an in-flight search.
    try {
      const fresh = await backend.queryNewer(filterRef.current, maxSeq, PAGE);
      if (id !== reqId.current || searchBlocked.current || !followRef.current || fresh.length === 0) return;
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.seq));
        const add = fresh.filter((e) => !seen.has(e.seq));
        if (!add.length) return prev;
        const merged = [...add, ...prev]; // fresh is newest-first and all newer than prev
        return merged.length > MAX_LOADED ? merged.slice(0, MAX_LOADED) : merged;
      });
      // A full page came back → a burst is still draining; keep pulling instead of
      // waiting for the next arrival (Store.Newer returns oldest-unseen, so no gap).
      if (fresh.length >= PAGE) scheduleAppendRef.current();
    } catch (error) {
      if (id === reqId.current) {
        searchBlocked.current = true;
        setQueryFailure(String(error));
      }
    } finally {
      appendInFlight.current = false;
      if (appendPending.current && followRef.current) scheduleAppendRef.current();
    }
  }, []);

  // Facets/histogram/stats are a full scan - refresh them (window untouched) on a
  // slower cadence than the row append.
  const refreshAggregates = useCallback(async () => {
    if (searchBlocked.current || resultsFilter.current !== filterRef.current || aggregateInFlight.current || initialQuery.current !== null || aggregateVersion.current === streamVersion.current) return;
    aggregateInFlight.current = true;
    const id = reqId.current;
    const version = streamVersion.current;
    const controller = new AbortController();
    aggregateAbort.current = controller;
    try {
      const a = await backend.queryAggregates(filterRef.current, controller.signal);
      if (id !== reqId.current || searchBlocked.current || !followRef.current || !capturingRef.current) return;
      aggregateVersion.current = version;
      setAgg({ ...a, stats: { ...a.stats, total: datasetTotalRef.current } });
    } catch (error) {
      if (id === reqId.current && !controller.signal.aborted) {
        searchBlocked.current = true;
        setQueryFailure(String(error));
      }
    } finally {
      aggregateInFlight.current = false;
      if (aggregateAbort.current === controller) aggregateAbort.current = null;
    }
  }, []);

  const scheduleAppend = useCallback(() => {
    appendPending.current = true;
    if (appendTimer.current != null || appendInFlight.current) return;
    appendTimer.current = window.setTimeout(() => {
      appendTimer.current = null;
      appendPending.current = false;
      void appendNewRows();
    }, STREAM_APPEND_MS);
  }, [appendNewRows]);
  scheduleAppendRef.current = scheduleAppend;

  // While actively capturing AND following, refresh the aggregates on the slow
  // cadence. Gating on `capturing` too means a paused capture is a clean freeze:
  // the facet/histogram/stats panel holds still (no stray refresh from a final
  // drain) and catches up all at once on resume via repin → refreshTick.
  useEffect(() => {
    // Saved evidence is initially opened in import mode, but its retained
    // capture can resume later. The live state controls refresh eligibility.
    if (!connected) return;
    const h = window.setInterval(() => {
      if (followRef.current && capturingRef.current) void refreshAggregates();
    }, AGG_REFRESH_MS);
    return () => window.clearInterval(h);
  }, [connected, refreshAggregates]);

  // Clear any pending append timer on unmount so it can't fire after teardown.
  useEffect(
    () => () => {
      if (appendTimer.current != null) {
        window.clearTimeout(appendTimer.current);
        appendTimer.current = null;
      }
    },
    []
  );

  // On filter/refresh change: fetch aggregates (full-set accurate) + the first page
  // together, and REPLACE the window. reqId guards against stale responses.
  useEffect(() => {
    if (!connected) return;
    const id = ++reqId.current;
    aggregateAbort.current?.abort();
    searchBlocked.current = true;
    setQueryFailure(null);
    if (compiled.error) {
      setQueryFailure(compiled.error);
      setQuerying(false);
      return;
    }
    const version = streamVersion.current;
    const controller = new AbortController();
    initialQuery.current = id;
    setQuerying(true);
    // Cancel the obsolete job and wait for it to release its connection. Queued
    // effects skip themselves when superseded; only the newest search runs.
    const task = queryQueue.current.catch(() => {}).then(async () => {
      if (controller.signal.aborted) return;
      const {aggregates:a,events:page} = await backend.querySearch(filter, PAGE, controller.signal);
        if (id !== reqId.current) return;
        aggregateVersion.current = version;
        setAgg({ ...a, stats: { ...a.stats, total: datasetTotalRef.current } });
        const inspected = selectedRef.current;
        if (inspected && !page.some(event => event.seq === inspected.seq && event.eventID === inspected.eventID)) closeInspector();
        setEvents(page); // newest-first
        pageSnapshot.current = a.snapshot;
        unloadedSnapshotRows.current = Math.max(0,a.total-page.length);
        tailFloor.current = a.snapshot?.maxSeq ?? 0;
        resultsFilter.current = filter;
        searchBlocked.current = false;
        setQuerying(false);
        if (streamVersion.current !== version && followRef.current) scheduleAppendRef.current();
      });
    queryQueue.current = task.catch((error) => {
        if (id !== reqId.current) return;
        // Keep the last results if this request failed.
        setQueryFailure(String(error));
        setQuerying(false);
      })
      .finally(() => {
        if (initialQuery.current === id) initialQuery.current = null;
      });
    return () => { ++reqId.current; controller.abort(); };
  }, [connected, filter, refreshTick, compiled.error, closeInspector]);

  // Fetch the NEXT page and append (never re-fetch the whole window). Capped so a
  // deep scroll can't balloon memory; loadingMoreRef prevents overlapping loads.
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || querying || searchBlocked.current || resultsFilter.current !== filter) return;
    const snapshot = pageSnapshot.current;
    if (!snapshot) return;
    if (unloadedSnapshotRows.current <= 0 || events.length >= MAX_LOADED) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const id = reqId.current;
    backend
      .querySnapshotPage(filter, snapshot, events.at(-1)?.seq ?? 0, PAGE)
      .then((page) => {
        if (id !== reqId.current || searchBlocked.current) return;
        unloadedSnapshotRows.current = page.length ? Math.max(0,unloadedSnapshotRows.current-page.length) : 0;
        setEvents((prev) => {
          // Sequence cursors remain stable even while live rows are prepended.
          const seen = new Set(prev.map((e) => e.seq));
          const add = page.filter((e) => !seen.has(e.seq));
          return add.length ? [...prev, ...add] : prev;
        });
      })
      .catch((error) => {
        if (id === reqId.current) {
          searchBlocked.current = true;
          setQueryFailure(String(error));
        }
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [filter, events, querying]);

  const facets = agg.facets;
  const hist = agg.histogram;
  // The capture counter changes independently of the frozen search snapshot.
  // Derive its display value instead of scheduling a second App render for every
  // progress notification by copying it back into aggregate state.
  const stats = useMemo(() => ({ ...agg.stats, total: datasetTotal }), [agg.stats, datasetTotal]);
  const atLoadCap = events.length >= MAX_LOADED && events.length < agg.total;

  const activeValues = useMemo(() => {
    const s = new Set<string>();
    for (const t of terms) if (t.kind === "field" && t.op === "include") s.add(`${String(t.field)} ${t.value}`);
    return s;
  }, [terms]);

  const activeExcludes = useMemo(() => {
    const s = new Set<string>();
    for (const t of terms) if (t.kind === "field" && t.op === "exclude") s.add(`${String(t.field)} ${t.value}`);
    return s;
  }, [terms]);

  // ---- query mutations ----
  const addQ = useCallback((t: QueryTerm) => setTerms((prev) => addTerm(prev, t)), []);
  const removeQ = useCallback((id: string) => setTerms((prev) => removeTerm(prev, id)), []);
  const clearQ = useCallback(() => {
    setTerms([]);
    setQueryText("");
    setSensitiveOnly(false);
  }, []);
  const pivot = useCallback(
    (field: FilterField, value: string, op: QueryOp) => setTerms((prev) => applyPivot(prev, field, op, value)),
    []
  );

  const errorsOnly = terms.some((t) => t.kind === "field" && t.field === "errorCode" && t.op === "exists");
  const hideReadOnly = terms.some((t) => t.kind === "field" && t.field === "readOnly" && t.op === "exclude" && t.value === "true");

  const toggleErrors = () => setTerms((prev) => toggleFieldTerm(prev, "errorCode", "exists", ""));
  const toggleReadOnly = () => setTerms((prev) => toggleFieldTerm(prev, "readOnly", "exclude", "true"));

  const presets = useMemo<Preset[]>(() => [...PRESETS, ...customPresets], [customPresets]);

  const applyPreset = (key: string) => {
    const p = presets.find((x) => x.key === key);
    if (!p) return;
    setPresetKey(key);
    setVisibleCols(p.columns);
  };
  const savePreset = () => {
    const name = window.prompt("Name this preset", "My preset");
    if (!name || !name.trim()) return;
    const key = "custom-" + Date.now();
    setCustomPresets((prev) => [...prev, { key, label: name.trim(), columns: visibleCols }]);
    setPresetKey(key);
  };
  const deletePreset = (key: string) => {
    setCustomPresets((prev) => prev.filter((p) => p.key !== key));
    if (presetKey === key) {
      setPresetKey(DEFAULT_PRESET.key);
      setVisibleCols(DEFAULT_PRESET.columns);
    }
  };
  const resizeColumn = useCallback((key: string, px: number) => setColWidths((prev) => ({ ...prev, [key]: px })), []);
  const toggleColumn = (key: string) =>
    setVisibleCols((prev) => (prev.includes(key) ? (prev.length > 1 ? prev.filter((k) => k !== key) : prev) : [...prev, key]));
  // Move a column to sit before another shown column - drives the header drag and
  // the Columns dropdown drag (one ordered source of truth, so they stay in sync).
  // `from` may be hidden: dropping it onto a shown column inserts (shows) it there.
  const moveColumn = useCallback((from: string, to: string) => {
    setVisibleCols((prev) => {
      if (from === to || !prev.includes(to)) return prev; // target must be a shown column
      const arr = prev.filter((k) => k !== from);
      arr.splice(arr.indexOf(to), 0, from);
      return arr;
    });
  }, []);

  const applyTimeRange = (from: number, to: number) => {
    addQ(timeTerm(from, to, `${fmtStamp(from, timeZone)} → ${fmtStamp(to, timeZone)}`));
  };
  const clearTime = () => setTerms((prev) => prev.filter((t) => t.kind !== "time"));

  const repin = useCallback(() => {
    setFollow(true);
    setNewCount(0);
    setRefreshTick((t) => t + 1); // catch up to the newest page immediately on re-pin
  }, []);
  const disengageFollow = useCallback(() => setFollow(false), []);

  // Engine returns newest-first and the table renders newest-on-top → display index
  // equals array index.
  const rowAtDisplay = (d: number) => events[d];
  const cursorIndex = useMemo(() => cursorSeq < 0 ? -1 : events.findIndex(e => e.seq === cursorSeq), [events, cursorSeq]);

  // Capture one cheap evidence cutoff before loading details. Raw records,
  // lineage and downstream investigation all retain that scope while live data
  // continues arriving; a new selection supersedes every pending response.
  const fetchDetail = useCallback((e: CloudTrailEvent, retainedSnapshot?: EvidenceSnapshot) => {
    const id = ++detailReq.current;
    const expectedGeneration = pageSnapshot.current?.generation;
    setSelectedRaw(""); setSelectedRawErr(false);
    setSelectedLineage(null); setSelectedLineageError(false);
    if (!retainedSnapshot) setSelectedSnapshot(null);
    const scope = retainedSnapshot ? Promise.resolve(retainedSnapshot) : backend.getEvidenceSnapshot();
    void scope.then(snapshot => {
      if (id !== detailReq.current) return;
      if (expectedGeneration !== undefined && snapshot.generation !== expectedGeneration) throw new Error("The dataset changed; run the search again");
      setSelectedSnapshot(snapshot);
      void backend.queryLineageRaw(e.seq, snapshot).then(raw => {
        if (id !== detailReq.current) return;
        if (raw) setSelectedRaw(raw); else setSelectedRawErr(true);
      }).catch(() => { if (id === detailReq.current) setSelectedRawErr(true); });
      if (hasCredentialLineage(e)) {
        void backend.queryLineage(e.seq, snapshot).then(lineage => {
          if (id === detailReq.current) setSelectedLineage(lineage);
        }).catch(() => { if (id === detailReq.current) setSelectedLineageError(true); });
      }
    }).catch(() => {
      if (id !== detailReq.current) return;
      setSelectedRawErr(true); setSelectedLineageError(true);
    });
  }, []);
  const retryDetail = useCallback(() => { if (selected) fetchDetail(selected, selectedSnapshot ?? undefined); }, [selected, selectedSnapshot, fetchDetail]);
  const openAt = (d: number) => {
    const e = rowAtDisplay(d);
    if (e) handleRowClick(e);
  };
  // Inspection is a separate pane; selecting a row never changes its height.
  const handleRowClick = useCallback((e: CloudTrailEvent) => {
    setFollow(false);
    setCursorSeq(e.seq);
    if (selected?.seq === e.seq) return;
    setSelected(e);
    fetchDetail(e);
  }, [selected?.seq, fetchDetail]);

  // ---- keyboard ----
  useEffect(() => {
    if (!connected) return;
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen || lineageSeq != null || document.querySelector('[aria-modal="true"]')) return; // overlays own their keyboard interactions
      if (uiView !== "console") return; // vim-style shortcuts are console-only (don't hijack the Sigma editor)
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing || el?.isContentEditable || el?.tagName === "SELECT") {
        if (e.key === "Escape") (el as HTMLInputElement).blur();
        return;
      }
      if (e.key === "Escape" && selected) {
        e.preventDefault(); closeInspector();
        document.querySelector<HTMLElement>(".workbench-results .etbody")?.focus({preventScroll: true});
        return;
      }
      // Buttons, tabs and the inspector own their keyboard interaction. In
      // particular, Enter on Search must not open a row behind the control.
      if (el?.closest('button, a, [role="tablist"], .event-inspector, [role="listbox"]')) return;
      // Everything below is a single-key (vim-style) shortcut. Never hijack
      // modifier combos - Ctrl+F, Cmd+F, Ctrl+G, Ctrl+J … belong to the
      // browser/OS, not to the pivot/move keys.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const d = cursorIndex;
      const moveTo = (nd: number) => {
        const ev = rowAtDisplay(nd);
        if (ev) {
          setFollow(false);
          handleRowClick(ev);
        }
      };
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        moveTo(d < 0 ? 0 : Math.min(events.length - 1, d + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        moveTo(d <= 0 ? 0 : d - 1);
      } else if (e.key === "G") {
        moveTo(events.length - 1);
      } else if (e.key === "g") {
        moveTo(0);
      } else if (e.key === "Enter" || e.key === "o") {
        openAt(d >= 0 ? d : 0);
      } else if (e.key === "/") {
        e.preventDefault();
        queryInputRef.current?.focus();
      } else if (e.key === "f") {
        const ev = rowAtDisplay(d >= 0 ? d : 0);
        if (ev) pivot("eventName", ev.eventName, "include");
      } else if (e.key === "?") {
        e.preventDefault();
        setHelp({ open: true, tab: "shortcuts" });
      } else if (e.key === "F1") {
        e.preventDefault();
        setHelp({ open: true, tab: "getting-started" });
      } else if (e.key === "Escape") {
        if (help.open) setHelp((h) => ({ ...h, open: false }));
        else if (selected) closeInspector();
        else if (terms.length) clearQ();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connected, events, cursorSeq, selected, terms.length, pivot, clearQ, help.open, settingsOpen, lineageSeq, uiView, handleRowClick, closeInspector, cursorIndex]);

  const toggleCapture = async () => {
    if(captureBusy)return;
    setCaptureBusy(true);
    try {
      if(capturing){await backend.stopCapture();setCapturing(false)}
      else {
        if(savedCapture) await backend.resumeCapture(); else await backend.startCapture();
        const state=await backend.getRecoveryState();setSavedCapture(state.capture);setCapturing(state.active);repin();
      }
    } catch(e) {window.alert("Capture could not change: "+String(e))}
    finally {setCaptureBusy(false)}
  };
  const teardownCapture = async () => {
    if(captureBusy || !savedCapture || !window.confirm(removalPrompt(savedCapture)))return;
    setCaptureBusy(true);
    try {await backend.teardownCapture();setSavedCapture(null)}
    catch(e){window.alert("Cleanup incomplete: "+String(e))}
    finally {
      setCapturing(false);
      try {setSavedCapture((await backend.getRecoveryState()).capture)} catch(e){window.alert("Could not refresh recovery state: "+String(e))}
      setCaptureBusy(false);
    }
  };
  const clearEvents = async () => {
    // Streaming-only; the engine owns imported data. Reset the local view.
    setEvents([]);
    closeInspector();
    setCursorSeq(-1);
  };
  const openDataset = async () => {
    let total=0;
    try {
      if(backend.live){
        const path=await backend.selectDumpPath();if(!path)return;
        setCapturing(false);total=await backend.ingestPath(path);
      } else {
        const text=await pickFileText();if(!text)return;
        await backend.stopCapture();setCapturing(false);total=await backend.ingestText(text);
      }
      const state=await backend.getRecoveryState();
      enterDataset(OFFLINE_CONFIG,total,state.capture,false);
    } catch(e){window.alert("Could not load dataset; the previous evidence is retained: "+String(e))}
  };
  const exportSelection = async () => {
    try {if(events.length)await exportEvents(events)}
    catch(e){window.alert("Export cancelled: "+String(e))}
  };
  const exportMatches = async () => {
    if (exportAbort.current || searchBlocked.current || resultsFilter.current !== filter || !agg.snapshot) return;
    const controller = new AbortController(); exportAbort.current = controller; setExporting(true);
    setExportNotice(`Exporting all ${agg.total.toLocaleString()} matches from the search snapshot at ${fmtStamp(Date.parse(agg.snapshot.capturedAt),timeZone)}…`);
    try {
      const result = await backend.exportFiltered(filter,agg.snapshot,controller.signal);
      setExportNotice(result.path ? `Exported ${result.count.toLocaleString()} matching events to ${result.path}` : "Export cancelled.");
    } catch(error) { setExportNotice(controller.signal.aborted ? "Export cancelled; no incomplete file was saved." : `Export failed: ${String(error)}`); }
    finally { exportAbort.current=null;setExporting(false); }
  };

  const commands: Command[] = useMemo(
    () => [
      { id: "cap", label: capturing ? "Pause capture" : "Resume capture", hint: "", run: toggleCapture },
      ...(capInfra ? [{ id: "teardown", label: capInfra.owned ? "Remove capture infrastructure…" : "Disconnect queue…", run: teardownCapture }] : []),
      { id: "follow", label: follow ? "Stop following tail" : "Follow live tail", run: () => (follow ? setFollow(false) : repin()) },
      { id: "clear-ev", label: "Clear all events", run: clearEvents },
      { id: "clear-q", label: "Clear all filters", run: clearQ },
      { id: "errors", label: "Toggle: Errors only", run: toggleErrors },
      { id: "ro", label: "Toggle: Hide read-only", run: toggleReadOnly },
      { id: "sens", label: "Toggle: Sensitive only", run: () => setSensitiveOnly((v) => !v) },
      { id: "sidebar", label: "Toggle facet sidebar", run: () => setSidebarCollapsed((v) => !v) },
      { id: "hist", label: "Toggle histogram", run: () => setHistCollapsed((v) => !v) },
      { id: "focus-q", label: "Focus query bar", hint: "/", run: () => queryInputRef.current?.focus() },
      { id: "settings", label: "Open settings…", run: () => setSettingsOpen(true) },
      { id: "save-preset", label: "Save current columns as preset…", run: savePreset },
      ...presets.map((p) => ({ id: "preset-" + p.key, label: `Preset: ${p.label}`, run: () => applyPreset(p.key) })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capturing, savedCapture, captureBusy, follow, presets, visibleCols]
  );

  return (
    <div className={`app ${connected && uiView === "console" ? "app--workbench" : ""}`}>
      <TitleBar
        connected={connected}
        canExport={uiView === "console" && events.length > 0}
        canExportMatches={uiView === "console" && !exporting && !querying && !queryFailure && resultsFilter.current === filter && !!agg.snapshot}
        onExportMatches={exportMatches}
        view={uiView}
        onView={selectView}
        onOpenDataset={openDataset}
        onExport={exportSelection}
        onHelp={(t) => setHelp({ open: true, tab: t })}
        onSettings={() => setSettingsOpen(true)}
      />
      <ComparisonBar />
      {connected && (uiView === "hunts" || uiView === "sigma") && <nav className="hunt-modebar" aria-label="Hunt modes">
        <button className={`tb-btn ${uiView === "hunts" ? "active" : ""}`} onClick={() => selectView("hunts")}>Indicators &amp; sequences</button>
        <button className={`tb-btn ${uiView === "sigma" ? "active" : ""}`} onClick={() => selectView("sigma")}>Rules</button>
      </nav>}
      {connected && uiView === "analysis" && <div className="context-modebar"><button className="tb-btn" onClick={() => selectView("console")}>← Back to logs</button><span>Activity analysis · Workbench context</span></div>}
      {exportNotice && <div className="search-notice" role="status"><span>{exportNotice}</span>
        {exporting ? <button className="btn-ghost" onClick={()=>exportAbort.current?.abort()}>Cancel export</button>
          : <button className="btn-ghost" onClick={()=>setExportNotice("")}>Dismiss</button>}
      </div>}
      {!connected && <ConnectionScreen onConnect={connect} onRestore={restoreDataset} />}
      {connected && visitedViews.includes("hunts") && <WorkspaceActivity.Provider value={uiView === "hunts"}><div className="workspace-page" hidden={uiView !== "hunts"}><HuntView filter={filter}/></div></WorkspaceActivity.Provider>}
      {connected && visitedViews.includes("analysis") && <WorkspaceActivity.Provider value={uiView === "analysis"}><div className="workspace-page" hidden={uiView !== "analysis"}><AnalysisView filter={filter}/></div></WorkspaceActivity.Provider>}
      {connected && visitedViews.includes("sigma") && <WorkspaceActivity.Provider value={uiView === "sigma"}><div className="workspace-page" hidden={uiView !== "sigma"}>
        <SigmaView
          columns={columns}
          visibleCols={visibleCols}
          colWidths={colWidths}
          rowHeight={rowH}
          timeZone={timeZone}
          isSensitive={isSensitiveFn}
          onResizeColumn={resizeColumn}
          onReorderColumns={moveColumn}
          onToggleColumn={toggleColumn}
          onPivot={pivot}
          onOpenLineage={setLineageSeq}
        />
      </div></WorkspaceActivity.Provider>}
      {connected && <WorkspaceActivity.Provider value={uiView === "console"}><main key={datasetSession} className="workbench-page" hidden={uiView !== "console"}>
      <div className="workbench-search">
        <div className="workbench-search-tools">
          <button className={`tb-btn ${!sidebarCollapsed ? "active" : ""}`} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed(v => !v)}>Filters</button>
          <button className={`tb-btn ${!histCollapsed ? "active" : ""}`} aria-expanded={!histCollapsed} onClick={() => setHistCollapsed(v => !v)}>Histogram</button>
          <button className="tb-btn" onClick={() => selectView("analysis")}>Summarize</button>
        </div>
        <QueryBar terms={terms} queryText={queryText} error={compiled.error} inputRef={queryInputRef}
          onQueryChange={setQueryText} onRemove={removeQ} onClear={clearQ} />
      </div>
      <div className={`workbench-session ${sidebarCollapsed ? "workbench-session--no-filters" : ""}`}>
        <FacetSidebar facets={facets} collapsed={sidebarCollapsed} activeValues={activeValues} activeExcludes={activeExcludes}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)} onPick={pivot} />
        <div className="workbench-main">
      <div className="workbench-context">
        <div><h1>Event workbench</h1><span>{capInfra ? `${capInfra.account} · ${capInfra.region}` : config?.mode === "import-dump" ? "Imported evidence" : "CloudTrail activity"}</span></div>
        <span className="workbench-scope">{datasetTotal.toLocaleString()} recorded events · {backend.live ? "Local evidence" : "Browser preview"}</span>
      </div>
      <Toolbar
        capturing={capturing}
        follow={follow}
        live={backend.live}
        streaming={!captureBusy && (savedCapture?.phase === "ready" || (!savedCapture && config?.mode !== "import-dump"))}
        shown={agg.total}
        total={datasetTotal}
        presetKey={presetKey}
        presets={presets}
        errorsOnly={errorsOnly}
        hideReadOnly={hideReadOnly}
        sensitiveOnly={sensitiveOnly}
        visibleCols={visibleCols}
        onToggleCapture={toggleCapture}
        onClear={clearEvents}
        onToggleFollow={() => (follow ? setFollow(false) : repin())}
        onPreset={applyPreset}
        onSavePreset={savePreset}
        onDeletePreset={deletePreset}
        onToggleErrors={toggleErrors}
        onToggleReadOnly={toggleReadOnly}
        onToggleSensitive={() => setSensitiveOnly((v) => !v)}
        onToggleColumn={toggleColumn}
        onReorderColumns={moveColumn}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenHelp={() => setHelp({ open: true, tab: "getting-started" })}
        onOpenSettings={() => setSettingsOpen(true)}
        onTimeRange={applyTimeRange}
        onClearTime={clearTime}
      />
      {savedCapture && <div className="capture-status">
        <details><summary>{capturing ? "Capture running" : savedCapture.phase === "ready" ? "Capture paused" : "Capture needs cleanup"} · {savedCapture.infra.account} · {savedCapture.infra.region} <span>Resources retained after exit</span></summary><CaptureDescription capture={savedCapture} /></details>
        <button className="btn-ghost" disabled={captureBusy} onClick={teardownCapture}>{savedCapture.infra.owned ? "Remove infrastructure…" : "Disconnect queue…"}</button>
      </div>}
      {!histCollapsed && <HistogramStrip hist={hist} collapsed={false} timeZone={timeZone}
        onToggleCollapse={() => setHistCollapsed(true)}
        onBrush={(from, to) => addQ(timeTerm(from, to, `${fmtClock(from, timeZone)}–${fmtClock(to, timeZone)}`))} />}
      <div className="workbench-body">
        <section className="workbench-results" aria-label="Event results">
          <div className="workbench-list-heading">
            <strong>{agg.total.toLocaleString()} matches</strong>
            <span>{stats.errors.toLocaleString()} errors · {stats.principals.toLocaleString()} principals</span>
            <span className="workbench-order">Newest received first · {timeZone === "utc" ? "UTC" : "Local time"}</span>
          </div>
          {queryFailure ? (
            <div className="search-notice search-notice--error" role="alert">
              <div><strong>Search failed.</strong> Displayed results have not been updated. Retry to refresh them.
                <details><summary>Error details</summary><pre>{queryFailure}</pre></details>
              </div>
              <button className="btn-ghost" onClick={() => setRefreshTick(t => t + 1)}>Retry search</button>
            </div>
          ) : querying && events.length > 0 ? (
            <div className="search-notice" role="status">Applying search… previous results remain visible until it completes.</div>
          ) : null}
          <EventTable
            detailMode="external"
            compact={presetKey === "workbench"}
            events={events}
            columns={columns}
            colWidths={colWidths}
            rowHeight={presetKey === "workbench" ? Math.max(rowH, 52) : rowH}
            selected={selected}
            cursorSeq={cursorSeq}
            follow={follow}
            onSelect={handleRowClick}
            onCursor={setCursorSeq}
            onPivot={pivot}
            onDisengageFollow={disengageFollow}
            onReachTop={repin}
            onResizeColumn={resizeColumn}
            onReorderColumns={moveColumn}
            onNeedMore={loadMore}
            onRetryDetail={retryDetail}
            onOpenLineage={setLineageSeq}
            loadingMore={loadingMore}
            atLoadCap={atLoadCap}
            isSensitive={isSensitiveFn}
            timeZone={timeZone}
          />
          <div className="workbench-list-footer">↑ ↓ Inspect events · / Search · {events.length.toLocaleString()} loaded</div>
        </section>
        <EventInspector key={selected?.seq ?? "empty"} event={selected} snapshot={selectedSnapshot ?? undefined} rawJSON={selectedRaw}
          rawLoading={!!selected && !selectedRaw && !selectedRawErr}
          rawError={selectedRawErr ? "Could not load this event." : undefined}
          lineage={selectedLineage} lineageLoading={!!selected && hasCredentialLineage(selected) && !selectedLineage && !selectedLineageError}
          lineageError={selectedLineageError} onRetry={retryDetail} onPivot={pivot}
          onOpenLineage={setLineageSeq} onClose={closeInspector} timeZone={timeZone} />
      </div>
        </div>
      </div>
      <StatusBar
        streaming={!captureBusy && (savedCapture?.phase === "ready" || (!savedCapture && config?.mode !== "import-dump"))}
        following={follow}
        live={backend.live}
        cursorIndex={cursorIndex}
        total={agg.total}
        bufferUsed={events.length}
        bufferMax={datasetTotal || 1}
        newCount={newCount}
        source={capInfra ? `sqs · ${capInfra.region} · ${capInfra.account}` : undefined}
        loading={querying}
        onRepin={repin}
      />
      </main></WorkspaceActivity.Provider>}
      {lineageSeq != null && (
        <WorkspaceActivity.Provider value={uiView === "console"}>
        <ErrorBoundary label="Lineage view" onReset={() => setLineageSeq(null)}>
          <LineageView
            seq={lineageSeq}
            initialSnapshot={uiView === "console" && lineageSeq === selected?.seq ? selectedSnapshot ?? undefined : undefined}
            onClose={() => setLineageSeq(null)}
            onPivot={(f, v, o) => {
              pivot(f, v, o);
              setLineageSeq(null);
            }}
          />
        </ErrorBoundary>
        </WorkspaceActivity.Provider>
      )}
      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
      <HelpModal
        open={help.open}
        tab={help.tab}
        onTab={(t) => setHelp({ open: true, tab: t })}
        onClose={() => setHelp((h) => ({ ...h, open: false }))}
      />
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          override={sensitiveOverride}
          onOverride={setSensitiveOverride}
          theme={theme}
          onTheme={setTheme}
          density={density}
          onDensity={setDensity}
          timeZone={timeZone}
          onTimeZone={setTimeZone}
          onResetAll={() => {
            resetAllPreferences();
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
