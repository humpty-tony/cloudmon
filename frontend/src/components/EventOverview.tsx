import {useMemo, type ReactNode} from "react";
import {LosslessNumber} from "lossless-json";
import {parseEvidence} from "../api/inspectorModel";
import {eventServiceLabel, presentEventActor} from "../api/eventPresentation";
import type {CloudTrailEvent, FilterField, QueryOp} from "../api/types";
import {AliasBadge} from "./AliasBadge";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof LosslessNumber) ? value as ObjectValue : {};
const scalar = (value: unknown): string => typeof value === "string" ? value : value instanceof LosslessNumber ? value.value : typeof value === "boolean" ? String(value) : "";
// Identifiers only: never expose arbitrary request values or returned secrets.
const TARGET_KEYS = ["secretId", "bucketName", "roleArn", "roleName", "userName", "policyArn", "instanceId", "groupId", "keyId", "tableName", "functionName", "resourceArn", "resourceId", "trailName", "targetArn"];

export interface EventOverviewProps {
  event: CloudTrailEvent;
  rawJSON: string;
  loading?: boolean;
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
  lineageAction?: ReactNode;
  /** Parent-owned related activity, with its own explicit count/query scope. */
  reviewContext?: ReactNode;
  aroundAction?: ReactNode;
  evidenceActions?: ReactNode;
}

export function EventOverview({event: e, rawJSON, loading, onPivot, lineageAction, reviewContext, aroundAction, evidenceActions}: EventOverviewProps) {
  const source = useMemo(() => {
    // Overview never synchronously parses an unbounded record. Fields keeps its
    // worker-backed parser; Original always receives untouched source bytes.
    if (!rawJSON) return {record: {}, note: "Original record unavailable; showing indexed facts."};
    if (rawJSON.length > 256_000) return {record: {}, note: "Large record: additional details are in Fields / Original."};
    try {
      const parsed = parseEvidence(rawJSON);
      const record = object(parsed);
      return {record, note: record === parsed ? "" : "Record could not be summarized. Inspect Original."};
    } catch { return {record: {}, note: "Record could not be summarized safely. Inspect Original."}; }
  }, [rawJSON]);
  const record = source.record;
  const identity = object(record.userIdentity);
  const session = object(identity.sessionContext);
  const attributes = object(session.attributes);
  const issuer = object(session.sessionIssuer);
  const request = object(record.requestParameters);
  const resources = Array.isArray(record.resources) ? record.resources : [];
  const parameters = TARGET_KEYS.flatMap(key => {
    const value = scalar(request[key]);
    return value ? [{name: key, value}] : [];
  });
  // A generic "key" could be sensitive: only treat S3's object key as a target.
  if (/^s3\.amazonaws\.com(?:\.cn)?$/.test(e.eventSource) && scalar(request.key)) parameters.push({name: "key", value: scalar(request.key)});
  const targets = [...parameters, ...resources.slice(0, 20).map(value => {
    const resource = object(value);
    return {name: scalar(resource.type) || "Resource ARN", value: scalar(resource.ARN) || scalar(resource.arn)};
  }).filter(item => item.value)];
  const uniqueTargets = targets.filter((target, index) => targets.findIndex(other => other.value === target.value) === index);
  const actorArn = scalar(identity.arn) || e.userIdentity.arn;
  const principalId = scalar(identity.principalId) || e.userIdentity.principalId;
  const actor = actorArn || principalId;
  const role = scalar(issuer.arn) || e.userIdentity.roleArn || "";
  const account = scalar(identity.accountId) || e.userIdentity.accountId;
  const presentation = presentEventActor({
    ...e.userIdentity, arn: actorArn, principalId, accountId: account, roleArn: role,
    type: scalar(identity.type) || e.userIdentity.type,
    userName: scalar(identity.userName) || e.userIdentity.userName,
    sessionName: scalar(identity.sessionName) || e.userIdentity.sessionName,
  });
  const mode = record.readOnly === true ? "Read-only" : record.readOnly === false ? "Non-read-only" : "Not recorded";
  const service = eventServiceLabel(e.eventSource);
  const secret = /^secretsmanager\.amazonaws\.com(?:\.cn)?$/.test(e.eventSource) && scalar(request.secretId);
  const targetTitle = secret ? "Requested secret" : parameters.length ? "Requested target" : "Recorded targets";
  const renderValue = (value: string, field?: FilterField, label = value) => {
    const shown = label.length > 700 ? label.slice(0, 700) + "…" : label;
    return !value ? <span className="eo-missing">Not recorded</span> : field
      ? <button className="eo-pivot" title={value} onClick={() => onPivot(field, value, "include")}>{shown}</button>
      : <span title={value}>{shown}</span>;
  };
  return <div className="event-overview">
    <section className="eo-section" aria-label="Actor and session">
      <div className="eo-section-head"><h3>Actor</h3>{lineageAction}</div>
      <div className="eo-value-main">{actor ? renderValue(actor, actorArn ? "identityArn" : "principalId", presentation.name) : presentation.name}{presentation.session && <span className="eo-session"> / {renderValue(presentation.session)}</span>}<AliasBadge kind="arn" value={actorArn}/>{role && role !== actorArn && <AliasBadge kind="arn" value={role}/>}</div>
      <div className="eo-value-meta">{presentation.typeLabel} · account {renderValue(account, "accountId")}<AliasBadge kind="account" value={account}/></div>
      <details className="eo-disclosure">
        <summary>Recorded identity</summary>
        <dl className="eo-kv">
          <dt>Principal ARN</dt><dd>{renderValue(actorArn, "identityArn")}</dd>
          <dt>Principal ID</dt><dd>{renderValue(principalId, "principalId")}</dd>
          {role && <><dt>Issuer role</dt><dd>{renderValue(role, "roleArn")}</dd></>}
          <dt>Session</dt><dd>{renderValue(presentation.session)}</dd>
          <dt>Credential ID</dt><dd>{renderValue(scalar(identity.accessKeyId))}</dd>
          <dt>Recorded MFA</dt><dd>{renderValue(scalar(attributes.mfaAuthenticated))}</dd>
          {scalar(session.sourceIdentity) && <><dt>Source identity</dt><dd>{renderValue(scalar(session.sourceIdentity))}</dd></>}
        </dl>
        <p className="eo-missing">Recorded identity / session, not a verified human.</p>
      </details>
    </section>
    <section className="eo-section" aria-label="Recorded targets">
      <div className="eo-section-head"><h3>{targetTitle}</h3></div>
      {loading ? <p className="eo-missing" role="status">Loading original record…</p> : <>
        {uniqueTargets.length > 0 ? <>
          <div className="eo-value-main">{renderValue(uniqueTargets[0].value)}</div>
          {uniqueTargets.length > 1 && <p className="eo-missing">{uniqueTargets.length - 1} more recorded identifier{uniqueTargets.length > 2 ? "s" : ""}</p>}
        </> : <p className="eo-missing">No target identifiers in this overview. Check Fields / Original.</p>}
        <div className="eo-value-meta">{service} · {renderValue(e.awsRegion, "awsRegion")}</div>
        {targets.length > 0 && <details className="eo-disclosure">
          <summary>Recorded target identifiers</summary>
          <dl className="eo-kv">{targets.map((target, index) => <div className="eo-pair" key={index}><dt>{target.name}</dt><dd>{renderValue(target.value)}</dd></div>)}</dl>
          <p className="eo-missing">Request / resource identifiers, not proof of impact.</p>
        </details>}
        {resources.length > 20 && <p className="eo-missing">First 20 resources shown; Fields / Original contains the rest.</p>}
        {source.note && <p className="eo-missing">{source.note}</p>}
      </>}
    </section>
    <section className="eo-section" aria-label="Origin">
      <div className="eo-section-head"><h3>Origin</h3></div>
      <dl className="eo-origin">
        <div><dt>Source IP</dt><dd>{renderValue(e.sourceIPAddress, "sourceIPAddress")}</dd></div>
        <div><dt>Client</dt><dd>{renderValue(e.userAgent)}</dd></div>
      </dl>
    </section>
    {reviewContext}
    {aroundAction && <div className="eo-around">{aroundAction}</div>}
    <details className="eo-evidence">
      <summary>Evidence &amp; provenance</summary>
      <dl className="eo-kv">
        <dt>Event ID</dt><dd>{renderValue(e.eventID)}</dd>
        <dt>Recipient account</dt><dd>{renderValue(e.recipientAccountId, "recipientAccountId")}<AliasBadge kind="account" value={e.recipientAccountId}/></dd>
        <dt>Read-only</dt><dd>{mode}</dd>
        {scalar(record.eventCategory) && <><dt>Category</dt><dd>{renderValue(scalar(record.eventCategory))}</dd></>}
        {scalar(record.requestID) && <><dt>Request ID</dt><dd>{renderValue(scalar(record.requestID))}</dd></>}
      </dl>
      {evidenceActions}
    </details>
  </div>;
}
