import { InvestigationView } from "./InvestigationView";
import { memo, useState } from "react";
import type { CloudTrailEvent, FilterField, Lineage, QueryOp } from "../api/types";
import { eventResult, hasCredentialLineage } from "../api/types";
import { EvidenceModal } from "./EvidenceModal";
import { RawJsonModal } from "./RawJsonModal";
import { FieldTree } from "./FieldTree";
import { LineageGraph } from "./LineageGraph";

interface Props {
  event: CloudTrailEvent;
  rawJSON: string;
  fieldHeight: number;
  lineageError?: boolean;
  onRetry: () => void;
  lineage?: Lineage | null; // assumed-role ancestry (null = still loading, for AssumedRole events)
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
  onOpenLineage?: (seq: number) => void; // open the full lineage graph view
}

export const InlineDetail = memo(function InlineDetail({ event: e, rawJSON, fieldHeight, lineage, lineageError, onRetry, onPivot, onOpenLineage }: Props) {
  const [investigating, setInvestigating] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const isRole = hasCredentialLineage(e) && (lineage?.applicable ?? true);

  const idNote = isRole ? "" : `${e.userIdentity.type || "This identity"} · inspect the identity fields and original source below.`;

  return (
    <div className="xd">
      <div className="xd-head">
        <span className={`dot-sev ${e.errorCode ? "err" : "ok"}`} />
        <span className="xd-title">{e.eventName}</span>
        <span className="xd-sub">{e.eventSource}</span>
        <span className={`xd-result ${e.errorCode ? "fail" : "ok"}`}>{eventResult(e)}</span>
        <span className="xd-time">{new Date(e.eventTime).toLocaleString()}</span>
        <button className="xd-raw-btn" onClick={() => setInvestigating(true)}>Investigate</button>
        <button className="xd-raw-btn" onClick={() => setEvidenceOpen(true)}>Sources & hashes</button>
        <button className="xd-raw-btn" onClick={() => setRawOpen(true)}>
          {"{ }"} Raw JSON
        </button>
      </div>

      {e.errorMessage && (
        <div className="xd-errline">
          {e.errorCode}: {e.errorMessage}
        </div>
      )}

      {isRole ? (
        <div className="xd-cols">
          <div className="xd-tree"><FieldTree json={rawJSON} height={fieldHeight} onPivot={onPivot} /></div>
          {lineage ? <LineageGraph lineage={lineage} current={e} onPivot={onPivot} onFullView={onOpenLineage ? () => onOpenLineage(e.seq) : undefined} />
            : lineageError ? <div className="lg lg-loading" role="alert">Could not load credential lineage. <button className="btn-ghost" onClick={onRetry}>Retry lineage</button></div>
            : <div className="lg lg-loading" role="status">Tracing credential lineage…</div>}
        </div>
      ) : <>
        {idNote && <div className="xd-idnote"><span className="xd-idnote-glyph">◈</span><span>{idNote}</span></div>}
        <FieldTree json={rawJSON} height={fieldHeight} onPivot={onPivot} />
      </>}

      {investigating && <InvestigationView event={e} onClose={()=>setInvestigating(false)} />}
      {evidenceOpen && <EvidenceModal key={e.seq} seq={e.seq} onClose={()=>setEvidenceOpen(false)} />}
      {rawOpen && <RawJsonModal title={`${e.eventName} · ${e.eventID}`} json={rawJSON} onClose={() => setRawOpen(false)} />}
    </div>
  );
});
