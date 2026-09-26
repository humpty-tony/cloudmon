import {useEffect, useMemo, useRef, useState, type ComponentProps} from "react";
import {backend, type SearchResult} from "../api/backend";
import {fieldTerm} from "../api/query";
import {buildFilter} from "../api/searchFilter";
import type {CloudTrailEvent, FilterField, QueryOp} from "../api/types";
import {EventTable} from "./EventTable";
import {EventInspector} from "./EventInspector";
import {LineageView} from "./LineageView";

export interface HuntPivotScope {field: FilterField; value: string; op: QueryOp}
type TableProps = Pick<ComponentProps<typeof EventTable>, "columns" | "colWidths" | "rowHeight" | "onResizeColumn" | "onReorderColumns" | "isSensitive" | "timeZone" | "onPivot">;

/** Temporary Workbench results: never mutate the retained browsing session. */
export function HuntPivotResults({scope, tableProps, onReturn}: {scope: HuntPivotScope; tableProps: TableProps; onReturn: (destination: "console" | "hunts") => void}) {
  const filter = useMemo(() => buildFilter([fieldTerm(scope.field, scope.op, scope.value)], false, null, null), [scope]);
  const [result, setResult] = useState<SearchResult | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<CloudTrailEvent | null>(null), [cursor, setCursor] = useState(-1);
  const [source, setSource] = useState<{seq: number; snapshot: NonNullable<SearchResult["aggregates"]["snapshot"]>; raw: string; error: string} | null>(null);
  const [rawRetry, setRawRetry] = useState(0);
  const [graph, setGraph] = useState<number | null>(null);
  const back = useRef<HTMLButtonElement>(null);
  const snapshot = result?.aggregates.snapshot;
  // Selection can commit before the loading effect runs: never expose another identity's source.
  const currentSource = source?.seq === selected?.seq && source?.snapshot === snapshot ? source : null;
  const raw = currentSource?.raw ?? "", rawError = currentSource?.error ?? "";
  useEffect(() => {back.current?.focus();}, []);
  useEffect(() => {
    const abort = new AbortController();
    setResult(null); setError(""); setSelected(null); setGraph(null);
    backend.querySearch(filter, 2000, abort.signal)
      .then(value => {if (!abort.signal.aborted) setResult(value);})
      .catch(failure => {if (!abort.signal.aborted) setError(String(failure));});
    return () => abort.abort();
  }, [filter, retry]);
  useEffect(() => {
    let current = true;
    setSource(null);
    if (selected && snapshot) backend.queryLineageRaw(selected.seq, snapshot)
      .then(value => {if (current) setSource({seq: selected.seq, snapshot, raw: value, error: value ? "" : "No retained original record."});})
      .catch(failure => {if (current) setSource({seq: selected.seq, snapshot, raw: "", error: String(failure)});});
    return () => {current = false;};
  }, [selected, snapshot, rawRetry]);
  return <section className="workbench-page" role="region" aria-label="Hunt pivot results">
    <div className="workbench-context-scope"><span><strong>Hunt → Workbench</strong> · {scope.field} {scope.op === "exclude" ? "≠" : scope.op === "exists" ? "exists" : "="} <code>{scope.value || "(empty)"}</code></span><button className="btn-ghost" ref={back} onClick={() => onReturn("hunts")}>Back to Hunt</button><button className="btn-ghost" onClick={() => onReturn("console")}>Back to browsing</button></div>
    <div className="review-context-controls">Scope: all currently loaded evidence at pivot time. Workbench filters are not applied; your previous browsing session is unchanged.</div>
    <div className="workbench-body">
      <div className="workbench-results">
        {result && <>
          <div className="workbench-list-heading"><strong>{result.aggregates.total.toLocaleString()} matching events</strong><span className="workbench-order">Newest received first</span></div>
          {snapshot && <div className="review-context-controls">Fixed snapshot · {snapshot.capturedAt}</div>}
          {result.aggregates.total > result.events.length && <div className="search-notice" role="status">Showing the first {result.events.length.toLocaleString()} of {result.aggregates.total.toLocaleString()} matches. Use Workbench search to narrow the query.</div>}
          <EventTable {...tableProps} keyboardNavigation detailMode="external" compact events={result.events} selected={selected} cursorSeq={cursor} follow={false}
            onSelect={event => {setCursor(event.seq); setSelected(event);}} onCursor={setCursor} onDisengageFollow={() => {}} onReachTop={() => {}} onRetryDetail={() => setRawRetry(n => n+1)} />
        </>}
        {!result && <div className="ei-state" role={error ? "alert" : "status"}>{error ? <><p>{error}</p><button onClick={() => setRetry(n => n+1)}>Retry pivot</button></> : "Loading pivot results…"}</div>}
      </div>
      <EventInspector layout="review" event={selected} snapshot={snapshot ?? undefined} rawJSON={raw} rawLoading={!!selected && !raw && !rawError} rawError={rawError}
        onRetry={() => setRawRetry(n => n+1)} onPivot={tableProps.onPivot} onOpenLineage={setGraph} onClose={() => setSelected(null)} timeZone={tableProps.timeZone} />
    </div>
    {graph !== null && snapshot && <LineageView seq={graph} initialSnapshot={snapshot} onClose={() => setGraph(null)} onPivot={tableProps.onPivot} />}
  </section>;
}
