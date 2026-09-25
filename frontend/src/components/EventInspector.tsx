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
import { EventOverview } from "./EventOverview";
import { LineageView } from "./LineageView";
import { LineageSummary } from "./LineageSummary";
import { RawJsonModal } from "./RawJsonModal";
import { SourceText } from "./SourceText";
import { useWorkspaceActive } from "./WorkspaceActivity";
import "./event-inspector.css";

export interface EventInspectorProps {
  event: CloudTrailEvent | null;
  /** Side pane is retained for existing callers; dock fills its parent pane. */
  layout?: "dock" | "side" | "review";
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
  /** Hand off the selected event without substituting a focused lineage node. */
  onInvestigate?: (event: CloudTrailEvent, snapshot?: EvidenceSnapshot) => void;
  onClose: () => void;
  timeZone: TimeZonePref;
}

const TABS = [
  { id: "fields", label: "Fields" },
  { id: "original", label: "Original JSON" },
  { id: "lineage", label: "Lineage" },
] as const;
const DOCK_TABS = [
  { id: "lineage", label: "Context" },
  { id: "fields", label: "Fields" },
  { id: "original", label: "Original JSON" },
] as const;
const REVIEW_TABS = [{id: "overview", label: "Overview"}, {id: "fields", label: "Fields"}, {id: "original", label: "Original JSON"}] as const;
type Tab = typeof TABS[number]["id"] | "overview";

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

function SelectedInspector({ event: e, layout = "side", snapshot, rawJSON, rawLoading, rawError, lineage, lineageLoading, lineageError, onRetry, onPivot, onOpenLineage, onInvestigate, onClose, timeZone, tab, onSelectTab }: EventInspectorProps & { event: CloudTrailEvent; tab: Tab; onSelectTab: (tab: Tab) => void }) {
  const dock = layout === "dock";
  const review = layout === "review";
  const workspaceActive = useWorkspaceActive();
  const items = review ? REVIEW_TABS : dock ? DOCK_TABS : TABS;
  const [fieldsVisited, setFieldsVisited] = useState(layout === "side" || tab === "fields");
  const selectTab = (next: Tab) => { if (next === "fields") setFieldsVisited(true); onSelectTab(next); };
  const [dialog, setDialog] = useState<"investigate" | "sources" | "original" | "lineage" | null>(null);
  const [evidenceEpoch, setEvidenceEpoch] = useState(0);
  const handOff = (open: () => void) => { setEvidenceEpoch(n => n + 1); open(); };
  const [sourceSeq, setSourceSeq] = useState(e.seq);
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
    if (event.key === "ArrowRight") next = (current + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (current + items.length - 1) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    selectTab(items[next].id);
    tabs.current[next]?.focus();
  };

  const rawStatus = rawError ? <div className="ei-state" role="alert"><strong>Could not load the original record</strong>{typeof rawError === "string" && <p>{rawError}</p>}<button onClick={onRetry}>Retry event</button></div>
    : !hasRaw ? <div className="ei-state" role="status">Loading original event…</div> : null;

  const context = <div className="ei-context" aria-label="Selected event context">
      {dock && <span className="ei-eyebrow">Selected event context</span>}
      <div className="ei-event-source"><span title={e.eventSource}>{e.eventSource || "Service not recorded"}</span><span className={`ei-result ${e.errorCode ? "error" : "success"}`} title={eventResult(e)}>{eventResult(e)}</span></div>
      <time dateTime={e.eventTime} title={e.eventTime}>{timestamp}</time>
      <dl className="ei-summary">
        <dt>Principal</dt><dd><button className="ei-pivot" disabled={!e.userIdentity.arn && !e.userIdentity.principalId} title={actor} onClick={() => onPivot(e.userIdentity.arn ? "identityArn" : "principalId", actor, "include")}>{actor}</button><AliasBadge kind="arn" value={e.userIdentity.arn || ""} /></dd>
        <dt>Source IP</dt><dd><button className="ei-pivot" disabled={!e.sourceIPAddress} title={e.sourceIPAddress} onClick={() => onPivot("sourceIPAddress", e.sourceIPAddress, "include")}>{e.sourceIPAddress || "Not recorded"}</button></dd>
        <dt>Region</dt><dd title={e.awsRegion}>{e.awsRegion || "Not recorded"}{!dock && <span className="ei-account" title={e.recipientAccountId}>{e.recipientAccountId || ""}</span>}</dd>
        {dock && <><dt>Account</dt><dd title={e.recipientAccountId}>{e.recipientAccountId || "Not recorded"}</dd></>}
      </dl>
      {e.errorMessage && <p className="ei-error-message" title={`${e.errorCode || "Error"}: ${e.errorMessage}`}>{e.errorMessage}</p>}
    </div>;
  const actions = <div className="ei-actions" aria-label={`Selected event actions: ${e.eventName} · ${e.eventID}`}>
      <button className="ei-investigate" disabled={!onInvestigate && !snapshot} title={`Around selected event: ${e.eventName} · ${e.eventID}`} onClick={() => onInvestigate ? handOff(() => onInvestigate(e, snapshot)) : setDialog("investigate")}>{dock || review || onInvestigate ? "Around this event" : "Investigate"}</button>
      <button disabled={!snapshot} title={`Sources / versions for selected event: ${e.eventName} · ${e.eventID}`} onClick={() => { setSourceSeq(e.seq); setDialog("sources"); }}>Sources &amp; hashes</button>
      {review && <button disabled={!snapshot} aria-haspopup="dialog" onClick={() => onOpenLineage ? onOpenLineage(e.seq) : setDialog("lineage")}>Resolve lineage</button>}
      <span className="ei-comparison">{hasRaw ? <PinComparisonButton event={e} json={rawJSON} /> : <button disabled title="Load the original record before pinning">Pin comparison</button>}</span>
    </div>;
  const details = <>
    <div className="ei-tabs" role="tablist" aria-label="Event details">
      {items.map((item, index) => <button key={item.id} ref={element => { tabs.current[index] = element; }} type="button" role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-${item.id}-panel`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => selectTab(item.id)} onKeyDown={event => navigateTabs(event, index)}>{item.label}</button>)}
    </div>
    {review && <section className="ei-panel ei-panel-overview" role="tabpanel" id={`${id}-overview-panel`} aria-labelledby={`${id}-overview`} hidden={tab !== "overview"} tabIndex={0}>
      {tab === "overview" && <EventOverview event={e} rawJSON={hasRaw ? rawJSON : ""} loading={rawLoading} onPivot={onPivot}/>}
      {rawError && <div role="alert" className="ei-state">Original record unavailable. <button onClick={onRetry}>Retry event</button></div>}
    </section>}
    <section className="ei-panel ei-panel-fields" role="tabpanel" id={`${id}-fields-panel`} aria-labelledby={`${id}-fields`} tabIndex={0} hidden={tab !== "fields"}>
      {/* Keep the worker and expanded fields alive while switching tabs. */}
      {fieldsVisited && (rawStatus || <InspectorFields json={rawJSON} onPivot={onPivot} />)}
    </section>
    <section className="ei-panel ei-panel-original" role="tabpanel" id={`${id}-original-panel`} aria-labelledby={`${id}-original`} tabIndex={0} hidden={tab !== "original"}>
      {tab === "original" && (rawStatus || <><div className="ei-original-head"><span>Exact retained event record</span><button onClick={() => setDialog("original")}>Open full JSON</button></div><SourceText text={rawJSON} json className="ei-source" /></>)}
    </section>
    {!review && <section className="ei-panel ei-panel-lineage" role="tabpanel" id={`${id}-lineage-panel`} aria-labelledby={`${id}-lineage`} tabIndex={0} hidden={tab !== "lineage"}>
      {(dock || tab === "lineage") && (
        !supportsLineage ? <div className="ei-state"><strong>Credential lineage is not applicable</strong><p>{lineage?.reason || `${e.userIdentity.type || "This identity"} does not have an assumed-role credential chain. Inspect the identity fields or investigate nearby activity.`}</p></div>
          : lineageError ? <div className="ei-state" role="alert"><strong>Could not load credential lineage</strong>{typeof lineageError === "string" && <p>{lineageError}</p>}<button onClick={onRetry}>Retry lineage</button></div>
            : lineageLoading || !lineage ? <div className="ei-state" role="status">Tracing credential lineage…</div>
              : dock ? <LineageSummary lineage={lineage} current={e} snapshot={snapshot} evidenceActive={workspaceActive && tab === "lineage" && dialog === null} evidenceEpoch={evidenceEpoch} onSources={seq => { setSourceSeq(seq); setDialog("sources"); }} onPivot={onPivot} onFullView={onOpenLineage ? () => handOff(() => onOpenLineage(e.seq)) : undefined} />
                : <LineageGraph lineage={lineage} current={e} onPivot={onPivot} onFullView={onOpenLineage ? () => onOpenLineage(e.seq) : undefined} />
      )}
    </section>}
    {dock && tab === "lineage" && <p className="ei-lineage-note">Observed credentials only. Human operator not verified.</p>}
  </>;
  return <>
    <header className="ei-head">
      <div className="ei-heading"><span className="ei-eyebrow">{dock || review ? "Selected event" : "Event inspector"}</span><h2 title={`${e.eventName} · ${e.eventID}`}>{e.eventName}</h2></div>
      {dock && actions}
      <button className="ei-close" onClick={onClose} aria-label="Close inspector" title="Clear selected event">×</button>
    </header>
    {review ? <><div className="ei-review-meta"><span>{e.eventSource}</span><time dateTime={e.eventTime}>{timestamp}</time></div>{actions}{details}</> : dock ? <div className="ei-dock-body">{context}<div className="ei-details">{details}</div></div> : <>{context}{actions}{details}</>}
    {dialog === "lineage" && <LineageView seq={e.seq} initialSnapshot={snapshot} onClose={() => setDialog(null)} onPivot={onPivot}/>}
    {dialog === "investigate" && <InvestigationView event={e} initialSnapshot={snapshot} onClose={() => setDialog(null)} />}
    {dialog === "sources" && <EvidenceModal seq={sourceSeq} snapshot={snapshot} onClose={() => setDialog(null)} />}
    {dialog === "original" && hasRaw && <RawJsonModal title={`${e.eventName} · ${e.eventID}`} json={rawJSON} onClose={() => setDialog(null)} />}
  </>;
}

/** Stable Workbench pane; selection never changes the event table's row height. */
export const EventInspector = memo(function EventInspector(props: EventInspectorProps) {
  const e = props.event;
  const layout = props.layout ?? "side";
  // Keep the analyst's mode across rows, but key evidence/disclosure/workers to
  // the selected record below. Dataset-session remount still resets the mode.
  const defaultTab: Tab = layout === "review" ? "overview" : layout === "dock" ? "lineage" : "fields";
  const [mode, setMode] = useState<{layout: typeof layout; tab: Tab}>(() => ({layout, tab: defaultTab}));
  const tab = mode.layout === layout ? mode.tab : defaultTab;
  // Remount transient dialogs/workers when evidence identity changes. A sequence
  // number can be reused after replacing a dataset, so include its generation.
  const selectionKey = e ? `${props.snapshot?.generation ?? ""}:${props.snapshot?.maxSeq ?? ""}:${e.seq}:${e.eventID}` : "empty";
  return <aside className={`event-inspector event-inspector--${props.layout ?? "side"} workbench-inspector ${e ? "has-event" : "is-empty"}`} aria-label="Event inspector">
    {e ? <SelectedInspector key={selectionKey} {...props} event={e} tab={tab} onSelectTab={tab => setMode({layout, tab})} /> : <>
      <header className="ei-head"><span className="ei-eyebrow">Event inspector</span></header>
      <div className="ei-empty"><span className="ei-empty-glyph" aria-hidden="true">⌕</span><h2>Select an event</h2><p>Inspect fields, follow credential lineage, and investigate related activity here.</p><span>Click a row to keep its evidence beside the event list.</span></div>
    </>}
  </aside>;
});
