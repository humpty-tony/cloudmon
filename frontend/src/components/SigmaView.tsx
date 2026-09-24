import { SigmaSuite } from "./SigmaSuite";
import { LineageView } from "./LineageView";
import { hasCredentialLineage } from "../api/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { backend, type SigmaOutcome } from "../api/backend";
import type { ColumnDef } from "../api/columns";
import type { TimeZonePref } from "../api/settings";
import type { CloudTrailEvent, FilterField, Lineage, QueryOp } from "../api/types";
import { CodeEditor } from "./CodeEditor";
import { EventTable } from "./EventTable";
import { Popover, ColumnsMenu } from "./Toolbar";
import { BUNDLED_RULES, deleteUserRule, loadUserRules, saveUserRule, type SigmaRuleEntry } from "../api/sigmaRules";

const STARTER = `title: Root account activity
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    userIdentity.type: Root
  condition: selection
level: high`;

interface Props {
  columns: ColumnDef[];
  visibleCols: string[];
  colWidths: Record<string, number>;
  rowHeight: number;
  timeZone: TimeZonePref;
  isSensitive: (name: string) => boolean;
  onResizeColumn: (key: string, px: number) => void;
  onReorderColumns: (from: string, to: string) => void;
  onToggleColumn: (key: string) => void;
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
  onOpenLineage: (seq: number) => void;
}

export function SigmaView(p: Props) {
  const [rule, setRule] = useState(STARTER);
  const [out, setOut] = useState<SigmaOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [mode,setMode]=useState<"single"|"suite">("single");
  const [error,setError]=useState("");
  const [graphSeq,setGraphSeq]=useState<number|null>(null);
  const active=useRef<AbortController|null>(null);
  const reqId = useRef(0);
  const ruleRef = useRef(rule);
  ruleRef.current = rule;

  // row expansion state (mirrors the console's inline detail)
  const [selected, setSelected] = useState<CloudTrailEvent | null>(null);
  const [cursorSeq, setCursorSeq] = useState(-1);
  const [selectedRaw, setSelectedRaw] = useState("");
  const [selectedRawError, setSelectedRawError] = useState(false);
  const [selectedLineageError, setSelectedLineageError] = useState(false);
  const detailReq = useRef(0);
  useEffect(()=>()=>{++detailReq.current;++reqId.current;active.current?.abort()},[]);
  const [selectedLineage, setSelectedLineage] = useState<Lineage | null>(null);
  const [userRules, setUserRules] = useState<SigmaRuleEntry[]>(() => loadUserRules());

  // Load a rule into the editor and clear the previous run (so the results/pill reset
  // to idle instead of showing stale matches for a different rule).
  const cancel=()=>{++reqId.current;active.current?.abort();active.current=null;setRunning(false)};
  const loadRule = (yaml: string) => {
    cancel();setError("");setGraphSeq(null);ruleRef.current=yaml;
    ++detailReq.current;
    ++reqId.current;
    setRunning(false);
    setRule(yaml);
    setOut(null);
    setSelected(null);
    setSelectedRaw("");
    setSelectedLineage(null);
  };
  const saveCurrent = () => {
    const m = ruleRef.current.match(/^title:\s*(.+)$/m); // default to THIS rule's title
    const name = window.prompt("Save this rule as", (m && m[1].trim()) || out?.title || "My rule");
    if (name && name.trim()) {try{setUserRules(saveUserRule(name.trim(), ruleRef.current));setError("")}catch(e){setError(String(e))}}
  };

  // Explicit run - Run button or Ctrl/Cmd+Enter (no auto-run, so switching tabs
  // doesn't fire a query). Reads the latest rule via a ref.
  const run = useCallback(() => {
    if(active.current)return;
    const abort=new AbortController();active.current=abort;
    ++detailReq.current;
    const id = ++reqId.current;
    setRunning(true);setError("");setOut(null);setGraphSeq(null);
    setSelected(null);
    backend
      .sigmaRun(ruleRef.current,abort.signal)
      .then((r) => {if(id===reqId.current)setOut(r)})
      .catch((e) => {if(id===reqId.current&&!abort.signal.aborted)setError(String(e))})
      .finally(()=>{if(id===reqId.current){active.current=null;setRunning(false)}});
  }, []);

  // Raw JSON + lineage aren't in the row; fetch lazily on expand (as the console does).
  const fetchDetail = useCallback((e: CloudTrailEvent) => {
    if(!out?.snapshot)return;
    const id=++detailReq.current;
    setSelectedRaw("");
    setSelectedRawError(false);setSelectedLineageError(false);
    backend.queryLineageRaw(e.seq,out.snapshot).then(raw=>{if(id===detailReq.current){setSelectedRaw(raw);setSelectedRawError(!raw)}})
      .catch(()=>{if(id===detailReq.current)setSelectedRawError(true)});
    setSelectedLineage(null);
    if (hasCredentialLineage(e)) {
      backend.queryLineage(e.seq,out.snapshot).then(lineage=>{if(id===detailReq.current)setSelectedLineage(lineage)})
        .catch(()=>{if(id===detailReq.current)setSelectedLineageError(true)});
    }
  },[out?.snapshot]);
  const retryDetail=useCallback(()=>{if(selected)fetchDetail(selected)},[selected,fetchDetail]);
  const onRowClick = (e: CloudTrailEvent) => {
    if (selected?.seq === e.seq) {
      ++detailReq.current;
      setSelected(null);
      setSelectedRaw("");
      setSelectedLineage(null);
      return;
    }
    setSelected(e);
    fetchDetail(e);
  };

  const status: "idle" | "valid" | "unsupported" | "error" = !out
    ? "idle"
    : !out.parsed
    ? "error"
    : !out.supported
    ? "unsupported"
    : "valid";
  const errors = out?.diagnostics.filter((d) => d.severity === "error") ?? [];
  const warnings = out?.diagnostics.filter((d) => d.severity === "warning") ?? [];
  const events = out?.events ?? [];

  const pill: Record<typeof status, string> = {
    idle: "Not run",
    valid: `✓ Ran · ${(out?.matches ?? 0).toLocaleString()} matches`,
    unsupported: "⚠ Can’t run yet",
    error: "✗ Invalid",
  };

  return (
    <div className="sigma-workbench">
      <nav className="sg-mode" aria-label="Sigma mode"><button className="btn-ghost" aria-pressed={mode==="single"} onClick={()=>setMode("single")}>Single rule</button><button className="btn-ghost" aria-pressed={mode==="suite"} onClick={()=>{cancel();setMode("suite")}}>Rule suite</button><span>Matches are leads to investigate; they do not establish malicious activity.</span></nav>
      {mode==="suite"?<SigmaSuite saved={userRules} onOpen={(yaml,result)=>{loadRule(yaml);setOut(result);setMode("single")}}/>:<div className="sigma">
      {/* LEFT - matches */}
      <div className="sg-pane sg-left">
        <div className="sg-head">
          <span className="sg-title">Matches</span>
          {status === "valid" && (
            <span className="sg-sub">
              <b>{out!.matches.toLocaleString()}</b> match · {out!.scanned.toLocaleString()} scanned
            </span>
          )}
          {status === "unsupported" && <span className="sg-sub warn">rule not run - see diagnostics</span>}
          {running && <span className="sg-spin">running…</span>}
          <span style={{ marginLeft: "auto" }} />
          <Popover label="Columns" align="right" menuClass="colmenu">
            {() => <ColumnsMenu visibleCols={p.visibleCols} onToggleColumn={p.onToggleColumn} onReorderColumns={p.onReorderColumns} />}
          </Popover>
        </div>
        {out?.snapshot&&<div className="sg-snapshot">Snapshot through event {out.snapshot.maxSeq.toLocaleString()} · {out.snapshot.capturedAt}</div>}
        {selected&&out?.explanations[selected.seq]&&<section className="sg-explanations" aria-label="Selection explanations"><strong>Why this event matched</strong><div>{out.explanations[selected.seq].map(reason=><span key={reason.name} className={reason.matched?"matched":"unmatched"}>{reason.matched?"✓":"−"} {reason.name}: {reason.matched?"matched":"did not match"}</span>)}</div><small>Selection results for this event. The rule condition combines these; count thresholds use the full snapshot.</small></section>}
        <div className="sg-body">
          {status === "idle" && (
            <div className="sg-empty">Press <b>Run</b> (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>) to test the rule.</div>
          )}
          {status !== "valid" && status !== "idle" && <div className="sg-empty">Rule not run - fix the diagnostics on the right.</div>}
          {status === "valid" && events.length === 0 && <div className="sg-empty">No events match this rule.</div>}
          {status === "valid" && events.length > 0 && (
            <>
              <EventTable
                events={events}
                columns={p.columns}
                colWidths={p.colWidths}
                rowHeight={p.rowHeight}
                selected={selected}
                cursorSeq={cursorSeq}
                follow={false}
                onSelect={onRowClick}
                onCursor={setCursorSeq}
                onPivot={p.onPivot}
                onDisengageFollow={() => {}}
                onReachTop={() => {}}
                onResizeColumn={p.onResizeColumn}
                onReorderColumns={p.onReorderColumns}
                onNeedMore={() => {}}
                selectedRaw={selectedRaw}
                selectedRawError={selectedRawError}
                selectedLineage={selectedLineage}
                selectedLineageError={selectedLineageError}
                onRetryDetail={retryDetail}
                onOpenLineage={setGraphSeq}
                selectedSnapshot={out?.snapshot??undefined}
                isSensitive={p.isSensitive}
                timeZone={p.timeZone}
              />
              {out!.matches > events.length && (
                <div className="sg-cap">Showing the first {events.length.toLocaleString()} of {out!.matches.toLocaleString()} matches - narrow the rule to see the rest.</div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="sg-divider" />

      {/* RIGHT - editor */}
      <div className="sg-pane sg-right">
        <div className="sg-ed-head">
          <Popover label="Rules" menuClass="colmenu">
            {(close) => (
              <>
                {userRules.length > 0 && (
                  <>
                    <div className="menu-label">Saved</div>
                    {userRules.map((r) => (
                      <div key={r.name} className="menu-item">
                        <button className="menu-item-main" onClick={() => { loadRule(r.yaml); close(); }}>{r.name}</button>
                        <button className="menu-del" title="Delete" onClick={() => {try{setUserRules(deleteUserRule(r.name))}catch(e){setError(String(e))}}}>✕</button>
                      </div>
                    ))}
                    <div className="menu-divider" />
                  </>
                )}
                <div className="menu-label">Examples</div>
                {BUNDLED_RULES.map((r) => (
                  <button key={r.name} className="menu-item menu-item-main" onClick={() => { loadRule(r.yaml); close(); }}>{r.name}</button>
                ))}
                <div className="menu-divider" />
                <button className="menu-item menu-action" onClick={() => { saveCurrent(); close(); }}>＋ Save current rule…</button>
              </>
            )}
          </Popover>
          <span className="sg-fname" title={out?.title||"rule.yml"}>{out?.title||"rule.yml"}</span>
          <span className={`sg-pill ${status}`}>{pill[status]}</span>
          {running&&<button className="btn-ghost" onClick={cancel}>Cancel rule</button>}
          <button className="sg-run" onClick={run} disabled={running} title="Run (Ctrl/Cmd+Enter)">
            {running ? "…" : "▶ Run"}
          </button>
        </div>
        <div className="sg-editor">
          <CodeEditor value={rule} onChange={(value)=>{if(value!==ruleRef.current)loadRule(value)}} diagnostics={out?.diagnostics ?? []} onSubmit={run} />
        </div>
        <div className="sg-foot">
          {error&&<div className="sg-diag err" role="alert">{error}</div>}
          {errors.length === 0 && warnings.length === 0 && status === "valid" && <div className="sg-diag ok">Rule compiles cleanly.</div>}
          {errors.map((d, i) => (
            <div key={"e" + i} className="sg-diag err">✗ {d.line ? `line ${d.line}: ` : ""}{d.message}</div>
          ))}
          {warnings.map((d, i) => (
            <div key={"w" + i} className="sg-diag warn">⚠ {d.line ? `line ${d.line}: ` : ""}{d.message}</div>
          ))}
          {out?.sql && (
            <div className="sg-sql">
              <button className="sg-sqltoggle" onClick={() => setShowSql((v) => !v)}>{showSql ? "▾" : "▸"} generated SQL</button>
              {showSql && <pre className="sg-sqlbody">{out.sql}</pre>}
            </div>
          )}
        </div>
      </div>
    </div>}
    {graphSeq!=null&&out?.snapshot&&<LineageView seq={graphSeq} initialSnapshot={out.snapshot} onClose={()=>setGraphSeq(null)} onPivot={p.onPivot}/>}
    </div>
  );
}
