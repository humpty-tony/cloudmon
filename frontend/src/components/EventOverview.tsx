import {useMemo} from "react";
import {LosslessNumber} from "lossless-json";
import {parseEvidence} from "../api/inspectorModel";
import type {CloudTrailEvent, FilterField, QueryOp} from "../api/types";
import {AliasBadge} from "./AliasBadge";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof LosslessNumber) ? value as ObjectValue : {};
const scalar = (value: unknown): string => typeof value === "string" ? value : value instanceof LosslessNumber ? value.value : typeof value === "boolean" ? String(value) : "";
// Only recorded target identifiers, not arbitrary request values (which may contain secrets).
const TARGET_KEYS = ["secretId", "bucketName", "key", "roleArn", "roleName", "userName", "policyArn", "instanceId", "groupId", "keyId", "tableName", "functionName", "resourceArn", "resourceId", "trailName", "targetArn"];

export function EventOverview({event: e, rawJSON, loading, onPivot}: {
  event: CloudTrailEvent; rawJSON: string; loading?: boolean;
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
}) {
  const source = useMemo(() => {
    // Quick context must never synchronously parse an unbounded source record.
    // The existing worker-backed Fields tab and exact Original remain available.
    if (!rawJSON) return {record: {}, note: "Original record has not loaded; additional context is unavailable."};
    if (rawJSON.length > 256_000) return {record: {}, note: "Large record: inspect Fields or Original JSON for target and session details."};
    try { return {record: object(parseEvidence(rawJSON)), note: ""}; }
    catch { return {record: {}, note: "Could not summarize this record safely. Inspect Original JSON."}; }
  }, [rawJSON]);
  const record = source.record;
  const identity = object(record.userIdentity);
  const session = object(identity.sessionContext);
  const attributes = object(session.attributes);
  const issuer = object(session.sessionIssuer);
  const request = object(record.requestParameters);
  const resources = Array.isArray(record.resources) ? record.resources : [];
  const targets = resources.slice(0, 20).map(value => {
    const resource = object(value);
    return {name: scalar(resource.type) || "Resource", value: scalar(resource.ARN) || scalar(resource.arn)};
  }).filter(item => item.value);
  const parameters = TARGET_KEYS.flatMap(key => {
    const value = scalar(request[key]);
    return value ? [{name: key, value}] : [];
  });
  const actorArn = scalar(identity.arn) || e.userIdentity.arn;
  const actor = actorArn || e.userIdentity.principalId;
  const role = scalar(issuer.arn) || e.userIdentity.roleArn || "";
  const mode = record.readOnly === true ? "Read" : record.readOnly === false ? "Write / non-read-only" : "Read/write not recorded";
  const renderValue = (value: string, field?: FilterField) => !value ? <span className="eo-missing">Not recorded</span> : field
    ? <button className="eo-pivot" title={value} onClick={() => onPivot(field, value, "include")}>{value.length > 700 ? value.slice(0, 700) + "…" : value}</button>
    : <span title={value}>{value.length > 700 ? value.slice(0, 700) + "…" : value}</span>;
  return <div className="event-overview">
    <section className="eo-section" aria-label="Event outcome">
      <div className="eo-outcome"><strong className={e.errorCode ? "is-error" : "is-ok"}>{e.errorCode || "No error recorded"}</strong><span>{mode}</span></div>
      {e.errorMessage && <p className="eo-error">{e.errorMessage}</p>}
      <dl className="eo-kv">
        <dt>Account</dt><dd>{renderValue(e.recipientAccountId, "recipientAccountId")}<AliasBadge kind="account" value={e.recipientAccountId}/></dd>
        <dt>Region</dt><dd>{renderValue(e.awsRegion, "awsRegion")}</dd>
        <dt>Source IP</dt><dd>{renderValue(e.sourceIPAddress, "sourceIPAddress")}</dd>
      </dl>
    </section>
    <section className="eo-section" aria-label="Recorded targets">
      <h3>Targets <span>recorded, not proof of impact</span></h3>
      {loading ? <p className="eo-missing" role="status">Loading original record…</p> : <>
        {targets.length > 0 && <ul className="eo-targets">{targets.map((target, i) => <li key={i}><small>{target.name}</small>{renderValue(target.value)}</li>)}</ul>}
        {parameters.length > 0 && <dl className="eo-kv">{parameters.map(target => <div className="eo-pair" key={target.name}><dt>{target.name}</dt><dd>{renderValue(target.value)}</dd></div>)}</dl>}
        {!targets.length && !parameters.length && <p className="eo-missing">No target identifiers in the quick overview. Check Fields / Original JSON; this does not establish that no resource was involved.</p>}
        {resources.length > 20 && <p className="eo-missing">First 20 resource entries shown; inspect Fields for the complete list.</p>}
        {source.note && <p className="eo-missing">{source.note}</p>}
      </>}
    </section>
    <section className="eo-section" aria-label="Actor and session">
      <h3>Actor &amp; session</h3>
      <dl className="eo-kv">
        <dt>Principal</dt><dd>{renderValue(actor, actorArn ? "identityArn" : "principalId")}<AliasBadge kind="arn" value={actor}/></dd>
        <dt>Type</dt><dd>{renderValue(e.userIdentity.type)}</dd>
        <dt>Issuer role</dt><dd>{renderValue(role, "roleArn")}</dd>
        <dt>Session</dt><dd>{renderValue(e.userIdentity.sessionName || scalar(identity.sessionName))}</dd>
        {scalar(identity.accessKeyId) && <><dt>Access key ID</dt><dd>{renderValue(scalar(identity.accessKeyId))}</dd></>}
        {scalar(session.sourceIdentity) && <><dt>Source identity</dt><dd>{renderValue(scalar(session.sourceIdentity))}</dd></>}
        <dt>Recorded MFA</dt><dd>{renderValue(scalar(attributes.mfaAuthenticated))}</dd>
      </dl>
    </section>
    <section className="eo-section" aria-label="Request metadata">
      <h3>Request &amp; evidence</h3>
      <dl className="eo-kv">
        <dt>User agent</dt><dd>{renderValue(e.userAgent)}</dd>
        {scalar(record.eventCategory) && <><dt>Category</dt><dd>{renderValue(scalar(record.eventCategory))}</dd></>}
        <dt>Event ID</dt><dd>{renderValue(e.eventID)}</dd>
        {scalar(record.requestID) && <><dt>Request ID</dt><dd>{renderValue(scalar(record.requestID))}</dd></>}
      </dl>
    </section>
  </div>;
}
