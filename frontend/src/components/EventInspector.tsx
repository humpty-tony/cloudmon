import { memo, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TimeZonePref } from "../api/settings";
import type { CloudTrailEvent, EvidenceSnapshot, FilterField, Lineage, QueryOp } from "../api/types";
import { eventResult, eventUser, hasCredentialLineage } from "../api/types";
import { AliasBadge } from "./AliasBadge";
import { PinComparisonButton } from "./EvidenceComparison";
import { EvidenceModal } from "./EvidenceModal";
import { FieldTree } from "./FieldTree";
import { InvestigationView } from "./InvestigationView";
import { LineageGraph } from "./LineageGraph";
import { RawJsonModal } from "./RawJsonModal";
import { SourceText } from "./SourceText";
import "./event-inspector.css";

export interface EventInspectorProps {
  event: CloudTrailEvent | null;
  snapshot?: EvidenceSnapshot;
  /** Original source text, never a reserialized event projection. */
  rawJSON: string;
  rawLoading?: boolean;
  rawError?: string | boolean;
  lineage?: Lineage | null;
  lineageLoading?: boolean;
  lineageError?: string | boolean;
  onRetry: () => void;
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
  onOpenLineage?: (seq: number) => void;
  onClose: () => void;
  timeZone: TimeZonePref;
}

const TABS = [
  { id: "fields", label: "Fields" },
  { id: "original", label: "Original JSON" },
  { id: "lineage", label: "Lineage" },
] as const;
type Tab = typeof TABS[number]["id"];

/** Observe the available pane, keeping field work bounded to its visible rows. */
function InspectorFields({ json, onPivot }: { json: string; onPivot: EventInspectorProps["onPivot"] }) {
  const area = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(240);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const toolbar = element.querySelector<HTMLElement>(".ft-toolbar");
    const footnote = element.querySelector<HTMLElement>(".ft-footnote");
    let frame = 0;
    const measure = () => {
      const available = element.clientHeight - (toolbar?.offsetHeight ?? 40) - (footnote?.offsetHeight ?? 40);
      const next = Math.max(56, Math.min(1800, Math.floor(available)));
      setHeight(previous => previous === next ? previous : next);
    };
    const queue = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(queue);
    observer.observe(element);
    if (toolbar) observer.observe(toolbar);
    if (footnote) observer.observe(footnote);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return <div className="ei-field-area" ref={area}><FieldTree json={json} height={height} onPivot={onPivot} /></div>;
}

function SelectedInspector({ event: e, snapshot, rawJSON, rawLoading, rawError, lineage, lineageLoading, lineageError, onRetry, onPivot, onOpenLineage, onClose, timeZone }: EventInspectorProps & { event: CloudTrailEvent }) {
  const [tab, setTab] = useState<Tab>("fields");
  const [dialog, setDialog] = useState<"investigate" | "sources" | "original" | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const hasRaw = !!rawJSON && !rawLoading && !rawError;
  const supportsLineage = hasCredentialLineage(e) && (lineage?.applicable ?? true);
  const actor = e.userIdentity.arn || e.userIdentity.principalId || eventUser(e) || "Not recorded";
  const milliseconds = Date.parse(e.eventTime);
  const timestamp = Number.isFinite(milliseconds)
    ? new Date(milliseconds).toLocaleString([], { hour12: false, ...(timeZone === "utc" ? { timeZone: "UTC" } : {}) }) + (timeZone === "utc" ? " UTC" : " local")
    : e.eventTime || "Event time not recorded";

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, current: number) => {
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (current + TABS.length - 1) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabs.current[next]?.focus();
  };

  const rawStatus = rawError ? <div className="ei-state" role="alert"><strong>Could not load the original record</strong>{typeof rawError === "string" && <p>{rawError}</p>}<button onClick={onRetry}>Retry event</button></div>
    : !hasRaw ? <div className="ei-state" role="status">Loading original event…</div> : null;

  return <>
    <header className="ei-head">
      <div className="ei-heading"><span className="ei-eyebrow">Event inspector</span><h2 title={e.eventName}>{e.eventName}</h2></div>
      <button className="ei-close" onClick={onClose} aria-label="Close inspector" title="Clear selected event">×</button>
    </header>
    <div className="ei-context">
      <div className="ei-event-source"><span title={e.eventSource}>{e.eventSource || "Service not recorded"}</span><span className={`ei-result ${e.errorCode ? "error" : "success"}`} title={eventResult(e)}>{eventResult(e)}</span></div>
      <time dateTime={e.eventTime} title={e.eventTime}>{timestamp}</time>
      <dl className="ei-summary">
        <dt>Principal</dt><dd><button className="ei-pivot" disabled={!e.userIdentity.arn && !e.userIdentity.principalId} title={actor} onClick={() => onPivot(e.userIdentity.arn ? "identityArn" : "principalId", actor, "include")}>{actor}</button><AliasBadge kind="arn" value={e.userIdentity.arn || ""} /></dd>
        <dt>Source IP</dt><dd><button className="ei-pivot" disabled={!e.sourceIPAddress} title={e.sourceIPAddress} onClick={() => onPivot("sourceIPAddress", e.sourceIPAddress, "include")}>{e.sourceIPAddress || "Not recorded"}</button></dd>
        <dt>Region</dt><dd title={e.awsRegion}>{e.awsRegion || "Not recorded"}<span className="ei-account" title={e.recipientAccountId}>{e.recipientAccountId || ""}</span></dd>
      </dl>
      {e.errorMessage && <p className="ei-error-message" title={`${e.errorCode || "Error"}: ${e.errorMessage}`}>{e.errorMessage}</p>}
    </div>
    <div className="ei-actions" aria-label="Selected event actions">
      <button className="ei-investigate" disabled={!snapshot} onClick={() => setDialog("investigate")}>Investigate</button>
      <button disabled={!snapshot} onClick={() => setDialog("sources")}>Sources &amp; hashes</button>
      <span className="ei-comparison">{hasRaw ? <PinComparisonButton event={e} json={rawJSON} /> : <button disabled title="Load the original record before pinning">Pin comparison</button>}</span>
    </div>
    <div className="ei-tabs" role="tablist" aria-label="Event details">
      {TABS.map((item, index) => <button key={item.id} ref={element => { tabs.current[index] = element; }} type="button" role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-${item.id}-panel`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => navigateTabs(event, index)}>{item.label}</button>)}
    </div>
    <section className="ei-panel ei-panel-fields" role="tabpanel" id={`${id}-fields-panel`} aria-labelledby={`${id}-fields`} tabIndex={0} hidden={tab !== "fields"}>
      {/* Keep the worker and expanded fields alive while switching tabs. */}
      {rawStatus || <InspectorFields json={rawJSON} onPivot={onPivot} />}
    </section>
    <section className="ei-panel ei-panel-original" role="tabpanel" id={`${id}-original-panel`} aria-labelledby={`${id}-original`} tabIndex={0} hidden={tab !== "original"}>
      {tab === "original" && (rawStatus || <><div className="ei-original-head"><span>Exact retained event record</span><button onClick={() => setDialog("original")}>Open full JSON</button></div><SourceText text={rawJSON} json className="ei-source" /></>)}
    </section>
    <section className="ei-panel ei-panel-lineage" role="tabpanel" id={`${id}-lineage-panel`} aria-labelledby={`${id}-lineage`} tabIndex={0} hidden={tab !== "lineage"}>
      {tab === "lineage" && (
        !supportsLineage ? <div className="ei-state"><strong>Credential lineage is not applicable</strong><p>{lineage?.reason || `${e.userIdentity.type || "This identity"} does not have an assumed-role credential chain. Inspect the identity fields or investigate nearby activity.`}</p></div>
          : lineageError ? <div className="ei-state" role="alert"><strong>Could not load credential lineage</strong>{typeof lineageError === "string" && <p>{lineageError}</p>}<button onClick={onRetry}>Retry lineage</button></div>
            : lineageLoading || !lineage ? <div className="ei-state" role="status">Tracing credential lineage…</div>
              : <LineageGraph lineage={lineage} current={e} onPivot={onPivot} onFullView={onOpenLineage ? () => onOpenLineage(e.seq) : undefined} />
      )}
    </section>
    {dialog === "investigate" && <InvestigationView event={e} initialSnapshot={snapshot} onClose={() => setDialog(null)} />}
    {dialog === "sources" && <EvidenceModal seq={e.seq} snapshot={snapshot} onClose={() => setDialog(null)} />}
    {dialog === "original" && hasRaw && <RawJsonModal title={`${e.eventName} · ${e.eventID}`} json={rawJSON} onClose={() => setDialog(null)} />}
  </>;
}

/** Stable Workbench pane; selection never changes the event table's row height. */
export const EventInspector = memo(function EventInspector(props: EventInspectorProps) {
  const e = props.event;
  // Remount transient dialogs/workers when evidence identity changes. A sequence
  // number can be reused after replacing a dataset, so include its generation.
  const selectionKey = e ? `${props.snapshot?.generation ?? ""}:${props.snapshot?.maxSeq ?? ""}:${e.seq}:${e.eventID}` : "empty";
  return <aside className={`event-inspector workbench-inspector ${e ? "has-event" : "is-empty"}`} aria-label="Event inspector">
    {e ? <SelectedInspector key={selectionKey} {...props} event={e} /> : <>
      <header className="ei-head"><span className="ei-eyebrow">Event inspector</span></header>
      <div className="ei-empty"><span className="ei-empty-glyph" aria-hidden="true">⌕</span><h2>Select an event</h2><p>Inspect fields, follow credential lineage, and investigate related activity here.</p><span>Click a row to keep its evidence beside the event list.</span></div>
    </>}
  </aside>;
});
