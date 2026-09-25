import { Fragment, useId, useLayoutEffect, useRef, useState } from "react";
import type { CloudTrailEvent, EvidenceSnapshot, FilterField, Lineage, LineageNode, QueryOp } from "../api/types";
import { AliasBadge } from "./AliasBadge";
import { backend } from "../api/backend";
import { LineageEventModal } from "./LineageEventModal";
import "./lineage-summary.css";

interface Props {
  lineage: Lineage;
  current: CloudTrailEvent;
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
  onFullView?: () => void;
  snapshot?: EvidenceSnapshot;
  onSources: (seq: number) => void;
  /** Request/modal lifetime, independent of the retained caller disclosure. */
  evidenceActive: boolean;
  /** A delegated view supersedes issuance without collapsing caller details. */
  evidenceEpoch: number;
}

/** Labels abbreviate recorded values only. They never qualify or create links. */
function label(identity: {userName?: string; roleArn?: string; arn?: string; invokedBy?: string; identityType?: string}) {
  return identity.userName || identity.invokedBy || identity.roleArn?.split("/").at(-1) || identity.arn?.split("/").at(-1) || identity.identityType || "Identity not recorded";
}

/** Each listed observation remains individually addressable at the same cutoff. */
function IssuanceEvidence({node, snapshot, onPivot, onSources, active}: {node: LineageNode; snapshot?: EvidenceSnapshot; onPivot: Props["onPivot"]; onSources: Props["onSources"]; active: boolean}) {
  const [seq, setSeq] = useState<number | null>(null);
  const [json, setJSON] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const records = Array.from(new Set([node.viaSeq, ...(node.evidenceSeqs ?? [])])).filter(value => Number.isSafeInteger(value) && value > 0);
  useLayoutEffect(() => {
    setJSON(""); setError("");
    // Hidden Context is retained, not unmounted. Retire its request before
    // another mode can receive focus, and never resume it on a later return.
    if (!active) { setSeq(null); return; }
    if (seq === null || !snapshot) return;
    let alive = true;
    backend.queryLineageRaw(seq, snapshot).then(raw => {
      if (!alive) return;
      if (raw) setJSON(raw); else setError("Original issuance record is unavailable.");
    }).catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [seq, snapshot, retry, active]);
  return <div className="ls-evidence">
    <p>Issuance observations · {node.viaEvent || "operation not recorded"}</p>
    <div className="ls-detail-actions">{records.map(value => <Fragment key={value}>
      <button disabled={!snapshot} title={!snapshot ? "Select an event with an evidence snapshot first" : `Exact original issuance record #${value}`} onClick={() => { setJSON(""); setError(""); setSeq(value); setRetry(n => n+1); }}>Original issuance #{value}</button>
      <button disabled={!snapshot} onClick={() => onSources(value)}>Sources for issuance #{value}</button>
    </Fragment>)}</div>
    {active && seq !== null && !json && (error ? <div className="ei-state" role="alert"><strong>Could not load issuance #{seq}</strong><p>{error}</p><button onClick={() => setRetry(n => n+1)}>Retry issuance #{seq}</button></div> : <p role="status">Loading issuance #{seq}…</p>)}
    {active && seq !== null && json && <LineageEventModal title={`Original issuance #${seq} · ${node.viaEvent || "Recorded issuance"}`} json={json} onPivot={onPivot} onClose={() => { setSeq(null); setJSON(""); }} />}
  </div>;
}

/** A projection of the qualified origin-first chain, not an identity resolver. */
export function LineageSummary({lineage, current, onPivot, onFullView, snapshot, onSources, evidenceActive, evidenceEpoch}: Props) {
  const [focused, setFocused] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const detailId = useId();
  const detail = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = detail.current;
    const pane = element?.closest<HTMLElement>(".ei-panel");
    if (!element || !pane) return;
    // The dock is deliberately short. Reveal the disclosure within this pane,
    // never scrolling or resizing the surrounding event grid.
    pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top - 10;
    element.focus({preventScroll: true});
  }, [focused]);
  const ui = current.userIdentity;
  const selected = {...ui, identityType: ui.type, invokedBy: ""};
  const identities = [...lineage.nodes, selected];
  const identity = focused === null ? null : identities[focused];
  // via* belongs to the issuance performed BY this caller, not TO this caller.
  const issuance = focused === null ? undefined : lineage.nodes[focused];
  const close = () => {
    const pane = detail.current?.closest<HTMLElement>(".ei-panel");
    if (pane) pane.scrollTop = 0;
    if (focused !== null) buttons.current[focused]?.focus();
    setFocused(null);
  };

  return <div className="ls-summary">
    <div className="ls-heading">
      <h3>Observed credential chain</h3>
      <span className={`ls-status ${lineage.complete ? "complete" : "incomplete"}`}>{lineage.complete ? "Principal observed" : lineage.status === "ambiguous" ? "Ambiguous" : "Chain incomplete"}</span>
      {onFullView && <button className="ls-expand" onClick={onFullView} aria-label="Expand selected-event lineage" title={`Expand lineage for ${current.eventName} · ${current.eventID}`}>Expand</button>}
    </div>
    {!lineage.complete && <p className="ls-gap">Earlier caller unresolved. {lineage.reason || "The available evidence does not establish an earlier link."}</p>}
    {lineage.complete && lineage.reason && <p className="ls-gap">{lineage.reason}</p>}
    <div className="ls-chain" role="group" aria-label="Origin-first observed credential chain" tabIndex={0}>
      {identities.map((node, index) => <Fragment key={index}>
        {index > 0 && <span className="ls-link"><span title={lineage.nodes[index-1].viaEvent}>{lineage.nodes[index-1].viaEvent || "Observed issuance"}</span><span aria-hidden="true">→</span></span>}
        <button ref={element => { buttons.current[index] = element; }} className={`ls-node ${index === lineage.nodes.length ? "ls-current" : ""}`} aria-label={index === lineage.nodes.length ? `Inspect selected-event identity: ${label(node)}` : `Inspect observed caller ${index+1}: ${label(node)}`} aria-expanded={focused === index} aria-controls={identity ? detailId : undefined} title={node.arn || node.roleArn || label(node)} onClick={() => setFocused(previous => previous === index ? null : index)}>
          <strong>{label(node)}</strong><span>{node.sessionName || node.identityType || "Type not recorded"}</span>
          <AliasBadge kind="arn" value={node.arn || ""} />
          {index === lineage.nodes.length && <small>Selected event</small>}
        </button>
      </Fragment>)}
    </div>
    {lineage.sourceIdentity && <p className="ls-attribute">sourceIdentity: <span>{lineage.sourceIdentity}</span> · recorded attribute</p>}
    {identity && <section ref={detail} tabIndex={-1} id={detailId} className="ls-detail" aria-label="Focused credential" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <header><strong>{label(identity)}</strong><span>{issuance ? "Observed caller" : "Selected-event identity"}</span><button onClick={close} aria-label="Close credential details">×</button></header>
      {issuance && <IssuanceEvidence key={`${focused}:${evidenceEpoch}`} node={issuance} snapshot={snapshot} onPivot={onPivot} onSources={onSources} active={evidenceActive} />}
      <dl>
        <dt>Principal ARN</dt><dd>{identity.arn || "Not recorded"}<AliasBadge kind="arn" value={identity.arn || ""} /></dd>
        <dt>Identity type</dt><dd>{identity.identityType || "Not recorded"}</dd>
        <dt>Account</dt><dd>{identity.accountId || "Not recorded"}</dd>
        <dt>Recorded role ARN</dt><dd>{identity.roleArn || "Not recorded"}</dd>
        <dt>Session name</dt><dd>{identity.sessionName || "Not recorded"}</dd>
        {issuance && <>
          <dt>Issued next credential</dt><dd>{issuance.viaEvent || "Operation not recorded"}</dd>
          <dt>Issuance time</dt><dd>{issuance.viaTime || "Not recorded"}</dd>
          <dt>Issuance source IP</dt><dd>{issuance.viaSourceIP || "Not recorded"}</dd>
          <dt>Link evidence</dt><dd>{issuance.evidence || "Evidence basis not supplied"}</dd>
        </>}
      </dl>
      <div className="ls-detail-actions">
        <button disabled={!identity.arn} onClick={() => onPivot("identityArn", identity.arn, "include")} title={identity.arn}>Filter focused principal</button>
      </div>
    </section>}
  </div>;
}
