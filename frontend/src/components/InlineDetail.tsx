import { useState } from "react";
import type { CloudTrailEvent, FilterField, Lineage, QueryOp } from "../api/types";
import { eventResult } from "../api/types";
import { RawJsonModal } from "./RawJsonModal";
import { FieldTree } from "./FieldTree";
import { LineageGraph } from "./LineageGraph";

interface Props {
  event: CloudTrailEvent;
  lineage?: Lineage | null; // assumed-role ancestry (null = still loading, for AssumedRole events)
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
  onOpenLineage?: (seq: number) => void; // open the full lineage graph view
}

export function InlineDetail({ event: e, lineage, onPivot, onOpenLineage }: Props) {
  const [rawOpen, setRawOpen] = useState(false);
  const isRole = e.userIdentity.type === "AssumedRole";

  // The full, original event (all fields incl. nested requestParameters,
  // sessionContext, tlsDetails, …) lives in rawJSON - render the whole thing.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(e.rawJSON);
  } catch {
    /* fall back to raw text below */
  }

  // Non-role identities have no AssumeRole ancestry to trace - say so explicitly so the
  // absent lineage panel reads as "N/A by design", not "missing/broken". The access-key
  // prefix is itself a signal: AKIA… = long-term IAM user key; ASIA… = temp session.
  const accessKeyId = (parsed as { userIdentity?: { accessKeyId?: string } } | null)?.userIdentity?.accessKeyId ?? "";
  const idNote = isRole
    ? ""
    : e.userIdentity.type === "IAMUser"
    ? accessKeyId.startsWith("ASIA")
      ? "IAM user using temporary session credentials (ASIA…, e.g. GetSessionToken/MFA) - not an assumed role, so there's no lineage chain to trace."
      : accessKeyId.startsWith("AKIA")
      ? "Direct call from a long-term IAM user access key (AKIA…) - this identity is the origin, so there's no role-assumption ancestry."
      : "IAM user - the origin identity; no role-assumption ancestry to trace."
    : e.userIdentity.type === "Root"
    ? "Root account - the origin identity; no role-assumption ancestry to trace."
    : e.userIdentity.type === "AWSService"
    ? "AWS service principal - not an assumed-role session; no lineage chain."
    : `${e.userIdentity.type || "This identity"} - no assumed-role ancestry to trace.`;

  return (
    <div className="xd">
      <div className="xd-head">
        <span className={`dot-sev ${e.errorCode ? "err" : "ok"}`} />
        <span className="xd-title">{e.eventName}</span>
        <span className="xd-sub">{e.eventSource}</span>
        <span className={`xd-result ${e.errorCode ? "fail" : "ok"}`}>{eventResult(e)}</span>
        <span className="xd-time">{new Date(e.eventTime).toLocaleString()}</span>
        <button className="xd-raw-btn" onClick={() => setRawOpen(true)}>
          {"{ }"} Raw JSON
        </button>
      </div>

      {e.errorMessage && (
        <div className="xd-errline">
          {e.errorCode}: {e.errorMessage}
        </div>
      )}

      {parsed ? (
        isRole ? (
          <div className="xd-cols">
            <div className="xd-tree">
              <FieldTree data={parsed} onPivot={onPivot} />
            </div>
            {lineage ? (
              <LineageGraph lineage={lineage} current={e} onPivot={onPivot} onFullView={onOpenLineage ? () => onOpenLineage(e.seq) : undefined} />
            ) : (
              <div className="lg lg-loading">Tracing role lineage…</div>
            )}
          </div>
        ) : (
          <>
            {idNote && (
              <div className="xd-idnote">
                <span className="xd-idnote-glyph">◈</span>
                <span>{idNote}</span>
              </div>
            )}
            <FieldTree data={parsed} onPivot={onPivot} />
          </>
        )
      ) : (
        <pre className="xd-raw">{e.rawJSON}</pre>
      )}

      {rawOpen && <RawJsonModal title={`${e.eventName} · ${e.eventID}`} json={e.rawJSON} onClose={() => setRawOpen(false)} />}
    </div>
  );
}
