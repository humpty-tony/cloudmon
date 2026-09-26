import {useEffect, useState, type ComponentProps} from "react";
import {backend} from "../api/backend";
import {rowToEvent, type CloudTrailEvent, type EvidenceSnapshot, type InvestigationResult} from "../api/types";
import {EventTable} from "./EventTable";
import {useWorkspaceActive} from "./WorkspaceActivity";

export interface ReviewContextScope {
  anchor: CloudTrailEvent;
  snapshot: EvidenceSnapshot;
  relation: string;
  minutes: number;
}
export const REVIEW_RELATIONS = [
  ["all", "Related events"], ["credential", "Matching credential"],
  ["principal", "Same recorded principal"], ["ip", "Same source IP"],
  ["resources", "Shared resource ARN"],
] as const;

type TableProps = Omit<ComponentProps<typeof EventTable>, "events" | "follow" | "onSelect" | "onNeedMore" | "loadingMore" | "atLoadCap" | "onReachTop" | "onDisengageFollow">;

/** An alternate scope in the Workbench grid, not a second investigation workspace. */
export function ReviewContext({scope, onChange, onClose, onInspect, tableProps}: {
  scope: ReviewContextScope; onChange: (scope: ReviewContextScope) => void; onClose: () => void;
  onInspect: (event: CloudTrailEvent, snapshot: EvidenceSnapshot) => void; tableProps: TableProps;
}) {
  const active = useWorkspaceActive();
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [failure, setFailure] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let current = true;
    setResult(null); setFailure("");
    backend.investigate({seq: scope.anchor.seq, eventID: scope.anchor.eventID, minutes: scope.minutes, relation: scope.relation, snapshot: scope.snapshot}, controller.signal)
      .then(value => { if (current) setResult(value); })
      .catch(error => { if (current && !controller.signal.aborted) setFailure(String(error)); });
    return () => { current = false; controller.abort(); };
  }, [active, scope.anchor.seq, scope.anchor.eventID, scope.snapshot.generation, scope.snapshot.maxSeq, scope.minutes, scope.relation, retry]);
  const rows = result?.events.slice().reverse().map(item => rowToEvent(item.event)) ?? [];
  const selected = result?.events.find(item => item.event.seq === tableProps.selected?.seq);
  return <section className="workbench-results review-context" aria-label="Contextual event results">
    <div className="workbench-context-scope"><span><strong>{REVIEW_RELATIONS.find(item => item[0] === scope.relation)?.[1]}</strong> · {scope.anchor.eventName}<time dateTime={scope.anchor.eventTime}> · {scope.anchor.eventTime}</time></span><button className="btn-ghost" onClick={onClose}>Back to Events</button></div>
    <div className="review-context-controls">
      <label>Window <select value={scope.minutes} onChange={event => onChange({...scope, minutes: Number(event.target.value)})}>{[1,2,5,15,60].map(n => <option key={n} value={n}>±{n} min</option>)}</select></label>
      <span>All evidence in this snapshot · browsing filters not applied</span>
    </div>
    {result && <>
      <div className="workbench-list-heading"><strong>{result.total.toLocaleString()} matching events</strong><button className="btn-ghost" onClick={() => onInspect(scope.anchor, scope.snapshot)} title={scope.anchor.eventID}>Inspect anchor · {scope.anchor.eventTime}</button><span className="workbench-order">Newest event time first</span></div>
      {result.total > result.events.length && <div className="search-notice" role="status">Showing {result.events.length} of {result.total.toLocaleString()} events nearest the anchor. Narrow the window to review more.</div>}
      {result.notes.length > 0 && <details className="review-context-notes"><summary>Evidence boundaries ({result.notes.length})</summary>{result.notes.map(note => <p key={note}>{note}</p>)}</details>}
      {rows.length ? <EventTable {...tableProps} events={rows} follow={false} onSelect={event => onInspect(event, result.snapshot)} onReachTop={() => {}} onDisengageFollow={() => {}} /> : <div className="review-context-empty"><strong>No related events in this window.</strong><p>Choose another relationship or widen the time window.</p>{scope.minutes < 60 && <button className="btn-ghost" onClick={() => onChange({...scope, minutes: scope.minutes < 15 ? 15 : 60})}>Widen time window</button>}</div>}
      <div className="workbench-list-footer">{selected?.reasons.map(reason => reason.label).join(" · ") || "Select an event to inspect its recorded context."}</div>
    </>}
    {!result && <div className="ei-state" role={failure ? "alert" : "status"}>{failure ? <><strong>Could not load contextual activity</strong><p>{failure}</p><button onClick={() => setRetry(n => n+1)}>Retry context</button></> : "Loading snapshot-bound activity…"}</div>}
  </section>;
}
