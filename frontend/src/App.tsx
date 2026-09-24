import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SavedCapture, RecoveryState, CloudTrailEvent, ConnectionConfig, FilterField, Lineage, QueryExpr, QueryFilter, QueryOp, QueryTerm } from "./api/types";
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
import { fmtClock, fmtStamp } from "./api/time";
import { QUERY_FIELDS } from "./api/types";
import { CaptureDescription, removalPrompt } from "./components/RecoveryCard";
import { ConnectionScreen } from "./components/ConnectionScreen";
import { Toolbar } from "./components/Toolbar";
import { QueryBar } from "./components/QueryBar";
import { FacetSidebar } from "./components/FacetSidebar";
import { HistogramStrip } from "./components/HistogramStrip";
import { EventTable } from "./components/EventTable";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { HelpModal } from "./components/HelpModal";
import { StatsBar } from "./components/StatsBar";
import { DEFAULT_THEME } from "./api/themes";
import { TitleBar } from "./components/TitleBar";
import { LineageView } from "./components/LineageView";
import { SigmaView } from "./components/SigmaView";
import { SettingsModal } from "./components/SettingsModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installCrashLogging } from "./api/log";

const OFFLINE_CONFIG: ConnectionConfig = { mode: "import-dump", region: "", profile: "", queueUrl: "", ruleArn: "", dumpPath: "", dumpText: "", capturePattern: "" };

const PAGE = 2000; // rows fetched per page (appended on scroll)
const MAX_LOADED = 20000; // hard cap on rows held in the browser (refine filter past this)
const STREAM_APPEND_MS = 350; // live-tail throttle - only fetches + PREPENDS new rows (cheap), so it can be snappy
const AGG_REFRESH_MS = 2500; // facets/histogram/stats are a full scan - refresh them on a slower cadence while streaming

const EMPTY_AGG: QueryResult = {
  total: 0,
  facets: [],
  histogram: { buckets: [], step: 60_000, from: 0, to: 0, max: 0 },
  stats: { shown: 0, total: 0, errors: 0, errorRate: 0, principals: 0, sources: 0, regions: 0, span: "-" },
};

// FilterField → engine column (the DuckDB events table's column names).
const FIELD_COL: Record<string, string> = {
  eventName: "eventName", eventSource: "eventSource", awsRegion: "awsRegion",
  sourceIPAddress: "sourceIPAddress", identityType: "identityType", user: "userName",
  errorCode: "errorCode", recipientAccountId: "recipientAccountId", eventID: "eventID",
  // concrete, round-tripping identity fields (extracted by the engine)
  userName: "userName", identityArn: "identityArn", roleArn: "roleArn",
  sessionName: "sessionName", principalId: "principalId", accountId: "accountId",
  userAgent: "userAgent",
};

// Query-language field tokens, for case-insensitive resolution + validation.
const QUERY_FIELD_SET = new Set<string>(QUERY_FIELDS.map(String));

/** Compile the click-driven terms + toggles + the parsed query expression into
 *  the engine's structured filter. The expression carries the free-text bar. */
function buildFilter(terms: QueryTerm[], sensitiveOnly: boolean, expr: QueryExpr | null, sensitiveSet: Set<string> | null): QueryFilter {
  const includes: Record<string, string[]> = {};
  const excludes: Record<string, string[]> = {};
  let errorsOnly = false;
  let hideReadOnly = false;
  let fromMs = 0;
  let toMs = 0;
  for (const t of terms) {
    if (t.kind === "time") { fromMs = t.from; toMs = t.to; continue; }
    const f = String(t.field);
    if (f === "errorCode" && t.op === "exists") { errorsOnly = true; continue; }
    if (f === "readOnly") { if (t.op === "exclude" && t.value === "true") hideReadOnly = true; continue; }
    if (f === "result") continue; // derivable, not a stored column
    const col = FIELD_COL[f];
    if (!col) continue;
    if (t.op === "include") (includes[col] || (includes[col] = [])).push(t.value);
    else if (t.op === "exclude") (excludes[col] || (excludes[col] = [])).push(t.value);
  }
  // "Sensitive only": NARROW to the effective set. Intersect with any explicit
  // eventName filter so it never widens one, and use a no-match sentinel when the
  // set/intersection is empty - an empty IN-list is a no-op that would otherwise
  // show everything, diverging from the (correctly empty) row highlight.
  if (sensitiveOnly && sensitiveSet) {
    const existing = includes.eventName;
    const narrowed = existing && existing.length ? existing.filter((v) => sensitiveSet.has(v)) : [...sensitiveSet];
    includes.eventName = narrowed.length ? narrowed : ["\u0000__none__"];
  }
  return { includes, excludes, errorsOnly, hideReadOnly, fromMs, toMs, text: "", expr };
}

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
  const [config, setConfig] = useState<ConnectionConfig | null>(null);
  const [events, setEvents] = useState<CloudTrailEvent[]>([]); // loaded window, oldest-first (the table flips to newest-on-top)
  const [datasetTotal, setDatasetTotal] = useState(0); // total ingested events (unfiltered)
  const [agg, setAgg] = useState<QueryResult>(EMPTY_AGG); // total + facets + histogram + stats for the current filter
  const [querying, setQuerying] = useState(false); // running the filter query (aggregates + first page)
  const [loadingMore, setLoadingMore] = useState(false); // fetching the next page
  const [selectedRaw, setSelectedRaw] = useState(""); // lazily-fetched raw JSON for the expanded row
  const [selectedRawErr, setSelectedRawErr] = useState(false); // raw fetch failed (distinct from still-loading)
  const detailReq = useRef(0); // guards the detail fetch: a newer expand supersedes an in-flight older one
  const [selectedLineage, setSelectedLineage] = useState<Lineage | null>(null); // assumed-role ancestry for the expanded row
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
  const [cursorSeq, setCursorSeq] = useState(-1); // anchored to event identity, not row position
  const [follow, setFollow] = useState(true);
  const [newCount, setNewCount] = useState(0);

  const [presetKey, setPresetKey] = useState<string>(() => load("preset", DEFAULT_PRESET.key));
  const [visibleCols, setVisibleCols] = useState<string[]>(() => load("cols", DEFAULT_PRESET.columns));
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => load("colw", {}));
  const [customPresets, setCustomPresets] = useState<Preset[]>(() => load("customPresets", []));
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => load("sidebar", false));
  const [histCollapsed, setHistCollapsed] = useState<boolean>(() => load("hist", false));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [help, setHelp] = useState<{ open: boolean; tab: string }>({ open: false, tab: "getting-started" });
  const [narrow, setNarrow] = useState(false);
  const [theme, setTheme] = useState<string>(() => load("theme", DEFAULT_THEME));
  const [uiView, setUiView] = useState<"console" | "sigma">("console"); // top-level workspace
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

  // Persist uncaught errors/rejections to cloudmon.log (mount-once, before anything else).
  useEffect(() => installCrashLogging(), []);

  // Native Help-menu events + responsive sidebar collapse (mount-once).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onMq = () => setNarrow(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    const offHelp = onMenuEvent("help:open", (t) =>
      setHelp({ open: true, tab: typeof t === "string" && t ? t : "getting-started" })
    );
    return () => {
      mq.removeEventListener("change", onMq);
      offHelp();
    };
  }, []);

  useEffect(() => save("preset", presetKey), [presetKey]);
  useEffect(() => save("cols", visibleCols), [visibleCols]);
  useEffect(() => save("colw", colWidths), [colWidths]);
  useEffect(() => save("customPresets", customPresets), [customPresets]);
  useEffect(() => save("sidebar", sidebarCollapsed), [sidebarCollapsed]);
  useEffect(() => save("hist", histCollapsed), [histCollapsed]);
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
    datasetTotalRef.current = total;
    streamVersion.current++;
    setConfig(cfg);setDatasetTotal(total);setSavedCapture(capture);setCapturing(active);
    setEvents([]);setTerms([]);setQueryText("");setSelected(null);setCursorSeq(-1);setFollow(active);
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

  const columns = useMemo(
    () => visibleCols.map((k) => COLUMN_BY_KEY[k]).filter(Boolean),
    [visibleCols]
  );

  // Parse the query bar once per applied expression; a parse error keeps the
  // expression out of the filter (so terms/toggles still apply) and surfaces in
  // the bar instead of silently querying everything.
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
    () => buildFilter(terms, sensitiveOnly, compiled.error ? null : compiled.ast, activeSensitive),
    [terms, sensitiveOnly, compiled, activeSensitive]
  );
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // Append just-arrived rows (seq > current max) to the top - cheap, index-backed, and
  // it leaves the existing rows/scroll untouched. reqId guards against a filter change
  // landing mid-flight.
  const appendNewRows = useCallback(async () => {
    if (!followRef.current) return;
    appendInFlight.current = true;
    const cur = eventsRef.current;
    const maxSeq = cur.length ? cur[0].seq : 0; // events are newest-first → [0] is newest
    const id = reqId.current;
    // NB: the append is meant to be invisible - it does NOT touch `querying`, so it can't
    // flicker the "loading" indicator or clobber the loading state of an in-flight search.
    try {
      const fresh = await backend.queryNewer(filterRef.current, maxSeq, PAGE);
      if (id !== reqId.current || !followRef.current || fresh.length === 0) return;
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
    } catch {
      // Keep the visible rows; a later arrival retries the tail query.
    } finally {
      appendInFlight.current = false;
      if (appendPending.current && followRef.current) scheduleAppendRef.current();
    }
  }, []);

  // Facets/histogram/stats are a full scan - refresh them (window untouched) on a
  // slower cadence than the row append.
  const refreshAggregates = useCallback(async () => {
    if (aggregateInFlight.current || initialQuery.current !== null || aggregateVersion.current === streamVersion.current) return;
    aggregateInFlight.current = true;
    const id = reqId.current;
    const version = streamVersion.current;
    try {
      const a = await backend.queryAggregates(filterRef.current);
      if (id !== reqId.current || !followRef.current || !capturingRef.current) return;
      aggregateVersion.current = version;
      setAgg({ ...a, stats: { ...a.stats, total: datasetTotalRef.current } });
    } catch {
      // Leave this version dirty so the next cadence retries it.
    } finally {
      aggregateInFlight.current = false;
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
    if (!connected || config?.mode === "import-dump") return;
    const h = window.setInterval(() => {
      if (followRef.current && capturingRef.current) void refreshAggregates();
    }, AGG_REFRESH_MS);
    return () => window.clearInterval(h);
  }, [connected, config, refreshAggregates]);

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
    const version = streamVersion.current;
    initialQuery.current = id;
    setQuerying(true);
    Promise.all([backend.queryAggregates(filter), backend.queryPage(filter, 0, PAGE)])
      .then(([a, page]) => {
        if (id !== reqId.current) return;
        aggregateVersion.current = version;
        setAgg({ ...a, stats: { ...a.stats, total: datasetTotalRef.current } });
        setEvents(page); // newest-first
        setQuerying(false);
      })
      .catch(() => {
        if (id !== reqId.current) return;
        // Keep the last results if this request failed.
        setQuerying(false);
      })
      .finally(() => {
        if (initialQuery.current === id) initialQuery.current = null;
      });
  }, [connected, filter, refreshTick]);

  // Keep the "total" stat live while paused - datasetTotal climbs from the capture
  // signal - WITHOUT re-querying or replacing the (frozen) event window.
  useEffect(() => {
    setAgg((a) => ({ ...a, stats: { ...a.stats, total: datasetTotal } }));
  }, [datasetTotal]);

  // Fetch the NEXT page and append (never re-fetch the whole window). Capped so a
  // deep scroll can't balloon memory; loadingMoreRef prevents overlapping loads.
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || querying) return;
    if (events.length >= agg.total || events.length >= MAX_LOADED) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const id = reqId.current;
    backend
      .queryPage(filter, events.length, PAGE)
      .then((page) => {
        if (id !== reqId.current) return;
        setEvents((prev) => {
          // Dedupe: a live append may have prepended rows while this page was in flight,
          // shifting offsets - drop any seq we already hold before concatenating.
          const seen = new Set(prev.map((e) => e.seq));
          const add = page.filter((e) => !seen.has(e.seq));
          return add.length ? [...prev, ...add] : prev;
        });
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [filter, events.length, agg.total, querying]);

  const facets = agg.facets;
  const hist = agg.histogram;
  const stats = agg.stats;
  const atLoadCap = events.length >= MAX_LOADED && events.length < agg.total;

  const activeValues = useMemo(() => {
    const s = new Set<string>();
    for (const t of terms) if (t.kind === "field" && t.op === "include") s.add(`${String(t.field)} ${t.value}`);
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
  const resizeColumn = (key: string, px: number) => setColWidths((prev) => ({ ...prev, [key]: px }));
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

  const repin = () => {
    setFollow(true);
    setNewCount(0);
    setRefreshTick((t) => t + 1); // catch up to the newest page immediately on re-pin
  };
  const disengageFollow = useCallback(() => setFollow(false), []);

  // Engine returns newest-first and the table renders newest-on-top → display index
  // equals array index.
  const rowAtDisplay = (d: number) => events[d];
  const displayIndexOf = (seq: number) => (seq < 0 ? -1 : events.findIndex((e) => e.seq === seq));

  // Raw JSON + lineage aren't in the page rows; fetch them lazily on expand.
  const fetchDetail = (e: CloudTrailEvent) => {
    const id = ++detailReq.current; // a newer expand must win if an older fetch resolves late
    setSelectedRaw("");
    setSelectedRawErr(false);
    backend
      .getEventRaw(e.seq)
      .then((raw) => {
        if (id !== detailReq.current) return; // superseded by a newer selection
        if (raw) setSelectedRaw(raw);
        else setSelectedRawErr(true); // empty result: show a message instead of a forever "loading"
      })
      .catch(() => {
        if (id === detailReq.current) setSelectedRawErr(true);
      });
    // Assumed-role ancestry: only worth a query for AssumedRole events.
    setSelectedLineage(null);
    if (e.userIdentity.type === "AssumedRole") {
      backend
        .queryLineage(e.seq)
        .then((l) => {
          if (id === detailReq.current) setSelectedLineage(l);
        })
        .catch(() => {
          if (id === detailReq.current) setSelectedLineage(null);
        });
    }
  };
  const openAt = (d: number) => {
    const e = rowAtDisplay(d);
    if (e) {
      setSelected(e);
      setCursorSeq(e.seq);
      fetchDetail(e);
    }
  };
  // Row click: anchor here (disable follow) and toggle the inline detail.
  const handleRowClick = (e: CloudTrailEvent) => {
    setFollow(false);
    if (selected?.seq === e.seq) {
      detailReq.current++; // cancel any in-flight detail fetch for the row being collapsed
      setSelected(null);
      setSelectedRaw("");
      setSelectedRawErr(false);
      setSelectedLineage(null);
      return;
    }
    setSelected(e);
    fetchDetail(e);
  };

  // ---- keyboard ----
  useEffect(() => {
    if (!connected) return;
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen) return; // the settings modal owns its own keys (incl. Esc)
      if (uiView !== "console") return; // vim-style shortcuts are console-only (don't hijack the Sigma editor)
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing) {
        if (e.key === "Escape") (el as HTMLInputElement).blur();
        return;
      }
      // Everything below is a single-key (vim-style) shortcut. Never hijack
      // modifier combos - Ctrl+F, Cmd+F, Ctrl+G, Ctrl+J … belong to the
      // browser/OS, not to the pivot/move keys.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const d = displayIndexOf(cursorSeq);
      const moveTo = (nd: number) => {
        const ev = rowAtDisplay(nd);
        if (ev) {
          setFollow(false);
          setCursorSeq(ev.seq);
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
        else if (selected) setSelected(null);
        else if (terms.length) clearQ();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connected, events, cursorSeq, selected, terms.length, pivot, clearQ, help.open, settingsOpen, uiView]);

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
    setSelected(null);
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
    <div className="app">
      <TitleBar
        connected={connected}
        canExport={agg.total > 0}
        view={uiView}
        onView={setUiView}
        onOpenDataset={openDataset}
        onExport={exportSelection}
        onHelp={(t) => setHelp({ open: true, tab: t })}
        onSettings={() => setSettingsOpen(true)}
      />
      {!connected ? (
        <ConnectionScreen onConnect={connect} onRestore={restoreDataset} />
      ) : uiView === "sigma" ? (
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
      ) : (
      <>
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
      <StatsBar stats={stats} />
      <div className="obs-body">
        <FacetSidebar
          facets={facets}
          collapsed={sidebarCollapsed || narrow}
          activeValues={activeValues}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          onPick={(field, value, op) => pivot(field, value, op)}
        />
        <div className="center">
          <HistogramStrip
            hist={hist}
            collapsed={histCollapsed}
            timeZone={timeZone}
            onToggleCollapse={() => setHistCollapsed((v) => !v)}
            onBrush={(from, to) =>
              addQ(timeTerm(from, to, `${fmtClock(from, timeZone)}–${fmtClock(to, timeZone)}`))
            }
          />
          <QueryBar
            terms={terms}
            queryText={queryText}
            error={compiled.error}
            inputRef={queryInputRef}
            onQueryChange={setQueryText}
            onRemove={removeQ}
            onClear={clearQ}
          />
          <EventTable
            events={events}
            columns={columns}
            colWidths={colWidths}
            rowHeight={rowH}
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
            selectedRaw={selectedRaw}
            selectedRawError={selectedRawErr}
            selectedLineage={selectedLineage}
            onOpenLineage={setLineageSeq}
            loadingMore={loadingMore}
            atLoadCap={atLoadCap}
            isSensitive={isSensitiveFn}
            timeZone={timeZone}
          />
        </div>
      </div>
      <StatusBar
        streaming={!captureBusy && (savedCapture?.phase === "ready" || (!savedCapture && config?.mode !== "import-dump"))}
        following={follow}
        live={backend.live}
        cursorIndex={displayIndexOf(cursorSeq)}
        total={agg.total}
        bufferUsed={events.length}
        bufferMax={datasetTotal || 1}
        newCount={newCount}
        source={capInfra ? `sqs · ${capInfra.region} · ${capInfra.account}` : undefined}
        loading={querying}
        onRepin={repin}
      />
      </>
      )}
      {lineageSeq != null && (
        <ErrorBoundary label="Lineage view" onReset={() => setLineageSeq(null)}>
          <LineageView
            seq={lineageSeq}
            onClose={() => setLineageSeq(null)}
            onPivot={(f, v, o) => {
              pivot(f, v, o);
              setLineageSeq(null);
            }}
          />
        </ErrorBoundary>
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
