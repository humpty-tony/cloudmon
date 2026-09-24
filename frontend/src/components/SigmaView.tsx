import { useCallback, useRef, useState } from "react";
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
  const reqId = useRef(0);
  const ruleRef = useRef(rule);
  ruleRef.current = rule;

  // row expansion state (mirrors the console's inline detail)
  const [selected, setSelected] = useState<CloudTrailEvent | null>(null);
  const [cursorSeq, setCursorSeq] = useState(-1);
  const [selectedRaw, setSelectedRaw] = useState("");
  const [selectedLineage, setSelectedLineage] = useState<Lineage | null>(null);
  const [userRules, setUserRules] = useState<SigmaRuleEntry[]>(() => loadUserRules());

  // Load a rule into the editor and clear the previous run (so the results/pill reset
  // to idle instead of showing stale matches for a different rule).
  const loadRule = (yaml: string) => {
    setRule(yaml);
    setOut(null);
    setSelected(null);
    setSelectedRaw("");
    setSelectedLineage(null);
  };
  const saveCurrent = () => {
    const m = ruleRef.current.match(/^title:\s*(.+)$/m); // default to THIS rule's title
    const name = window.prompt("Save this rule as", (m && m[1].trim()) || out?.title || "My rule");
    if (name && name.trim()) setUserRules(saveUserRule(name.trim(), ruleRef.current));
  };

  // Explicit run - Run button or Ctrl/Cmd+Enter (no auto-run, so switching tabs
  // doesn't fire a query). Reads the latest rule via a ref.
  const run = useCallback(() => {
    const id = ++reqId.current;
    setRunning(true);
    setSelected(null);
    backend
      .sigmaRun(ruleRef.current)
      .then((r) => id === reqId.current && (setOut(r), setRunning(false)))
      .catch(() => id === reqId.current && setRunning(false));
  }, []);

  // Raw JSON + lineage aren't in the row; fetch lazily on expand (as the console does).
  const fetchDetail = (e: CloudTrailEvent) => {
    setSelectedRaw("");
    backend.getEventRaw(e.seq).then((raw) => setSelectedRaw(raw)).catch(() => setSelectedRaw(""));
    setSelectedLineage(null);
    if (e.userIdentity.type === "AssumedRole") {
      backend.queryLineage(e.seq).then(setSelectedLineage).catch(() => setSelectedLineage(null));
    }
  };
  const onRowClick = (e: CloudTrailEvent) => {
    if (selected?.seq === e.seq) {
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
    idle: "…",
    valid: `✓ Valid · ${(out?.matches ?? 0).toLocaleString()} match`,
    unsupported: "⚠ Can’t run yet",
    error: "✗ Invalid",
  };

  return (
    <div className="sigma">
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
                selectedLineage={selectedLineage}
                onOpenLineage={p.onOpenLineage}
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
                        <button className="menu-del" title="Delete" onClick={() => setUserRules(deleteUserRule(r.name))}>✕</button>
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
          <span className="sg-fname">rule.yml{out?.title ? ` · ${out.title}` : ""}</span>
          <span className={`sg-pill ${status}`}>{pill[status]}</span>
          <button className="sg-run" onClick={run} disabled={running} title="Run (Ctrl/Cmd+Enter)">
            {running ? "…" : "▶ Run"}
          </button>
        </div>
        <div className="sg-editor">
          <CodeEditor value={rule} onChange={setRule} diagnostics={out?.diagnostics ?? []} onSubmit={run} />
        </div>
        <div className="sg-foot">
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
    </div>
  );
}
