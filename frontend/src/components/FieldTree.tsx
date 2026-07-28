import { useState } from "react";
import type { FilterField, QueryOp } from "../api/types";

// Leaf paths (dotted) that map to a filterable field → get pivot affordances.
// Each maps to a CONCRETE, round-tripping field: the value shown at that JSON
// position is exactly what the query bar matches, so clicking it filters cleanly.
const PATH_FIELD: Record<string, FilterField> = {
  eventName: "eventName",
  eventSource: "eventSource",
  awsRegion: "awsRegion",
  sourceIPAddress: "sourceIPAddress",
  userAgent: "userAgent",
  errorCode: "errorCode",
  recipientAccountId: "recipientAccountId",
  readOnly: "readOnly",
  eventID: "eventID",
  // identity - mapped to their extraction points so the expanded record is pivotable
  "userIdentity.type": "identityType",
  "userIdentity.userName": "userName",
  "userIdentity.arn": "identityArn",
  "userIdentity.principalId": "principalId",
  "userIdentity.accountId": "accountId",
  "userIdentity.sessionContext.sessionIssuer.arn": "roleArn",
  "userIdentity.sessionContext.sessionIssuer.userName": "userName", // assumed-role name → userName (coalesced by the engine)
};

type PivotFn = (field: FilterField, value: string, op: QueryOp) => void;

// Keys never worth showing in the tree (internal / empty-by-design).
const HIDE_KEYS = new Set(["rawJSON"]);

function valClass(v: unknown): string {
  if (v === null) return "ft-null";
  if (typeof v === "number") return "ft-num";
  if (typeof v === "boolean") return "ft-bool";
  return "ft-str";
}

function Leaf({ k, v, path, onPivot }: { k: string; v: unknown; path: string; onPivot: PivotFn }) {
  const field = PATH_FIELD[path];
  const val = v === null ? "null" : String(v);
  return (
    <div className="ft-row">
      <span className="ft-key">{k}</span>
      <span className={`ft-val ${valClass(v)}`}>{val}</span>
      {field && val && val !== "null" && (
        <span className="ft-pivot">
          <button className="pv" title={`Filter for ${val}`} onClick={() => onPivot(field, val, "include")}>
            <span className="pv-loupe">⌕</span>
            <span className="pv-sign">+</span>
          </button>
          <button className="pv" title={`Filter out ${val}`} onClick={() => onPivot(field, val, "exclude")}>
            <span className="pv-loupe">⌕</span>
            <span className="pv-sign">−</span>
          </button>
        </span>
      )}
    </div>
  );
}

function Branch({ k, v, path, onPivot }: { k: string; v: object; path: string; onPivot: PivotFn }) {
  const [open, setOpen] = useState(true);
  const isArr = Array.isArray(v);
  const entries: [string, unknown][] = isArr
    ? (v as unknown[]).map((x, i) => [String(i), x])
    : Object.entries(v).filter(([k]) => !HIDE_KEYS.has(k));
  return (
    <div className="ft-branch">
      <button className="ft-toggle" onClick={() => setOpen((o) => !o)}>
        <span className={`ft-caret ${open ? "open" : ""}`}>▸</span>
        <span className="ft-key">{k}</span>
        <span className="ft-meta">{isArr ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open && (
        <div className="ft-nested">
          {entries.map(([ck, cv]) => (
            <Node key={ck} k={ck} v={cv} path={path ? `${path}.${ck}` : ck} onPivot={onPivot} />
          ))}
        </div>
      )}
    </div>
  );
}

function Node({ k, v, path, onPivot }: { k: string; v: unknown; path: string; onPivot: PivotFn }) {
  if (v !== null && typeof v === "object") {
    const empty = Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0;
    if (empty) return <Leaf k={k} v={Array.isArray(v) ? "[ ]" : "{ }"} path={path} onPivot={onPivot} />;
    return <Branch k={k} v={v} path={path} onPivot={onPivot} />;
  }
  return <Leaf k={k} v={v} path={path} onPivot={onPivot} />;
}

/** Renders an entire parsed CloudTrail event as a collapsible key/value tree. */
export function FieldTree({ data, onPivot }: { data: unknown; onPivot: PivotFn }) {
  if (data === null || typeof data !== "object") return null;
  return (
    <div className="ft">
      {Object.entries(data)
        .filter(([k]) => !HIDE_KEYS.has(k))
        .map(([k, v]) => (
          <Node key={k} k={k} v={v} path={k} onPivot={onPivot} />
        ))}
    </div>
  );
}
