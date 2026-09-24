// TypeScript mirror of internal/model/event.go (json tags). Keep in sync with Go.

export interface UserIdentity {
  type: string;
  principalId: string;
  arn: string;
  accountId: string;
  userName: string;
  roleArn?: string; // sessionContext.sessionIssuer.arn - the assumed-role's underlying role
  sessionName?: string; // session name for assumed-role / federated identities
}

export interface CloudTrailEvent {
  seq: number;
  eventID: string;
  eventTime: string; // RFC3339
  eventName: string;
  eventSource: string;
  awsRegion: string;
  sourceIPAddress: string;
  userAgent: string;
  userIdentity: UserIdentity;
  readOnly: boolean;
  managementEvent: boolean;
  errorCode?: string;
  errorMessage?: string;
  recipientAccountId: string;
  rawJSON: string;
}

export type ConnectionMode = "create-infra" | "existing-sqs" | "import-dump";

export interface ConnectionConfig {
  mode: ConnectionMode;
  region: string;
  profile: string;
  queueUrl: string;
  ruleArn: string;
  dumpPath: string;
  dumpText: string; // file contents read in the browser (import-dump mode)
  capturePattern: string;
  writeOnly?: boolean; // Flow A: true = write-only management events (default: all, incl. reads)
}

export interface RequiredPermission {
  action: string;
  reason: string;
}

// ---- Flow A live capture (mirror internal/awsflow) ----

/** A named AWS profile on the machine, classified for the connect picker. */
export interface AwsProfile {
  name: string;
  kind: string; // "sso" | "assume-role" | "keys" | "other"
  region: string;
}

/** Confirmed caller from sts:GetCallerIdentity. */
export interface AwsIdentity {
  account: string;
  arn: string;
  userId: string;
  profile: string;
  region: string;
}

/** Whether a CloudTrail trail is actually feeding the region (Flow A precondition). */
export interface TrailStatus {
  hasLoggingTrail: boolean;
  trailCount: number;
  globalCovered: boolean;
  readManagement?: boolean;
  writeManagement?: boolean;
  coverageKnown: boolean;
  coverageComplete?: boolean;
  summary: string;
}

/** Resources StartCapture provisioned (for display + teardown). */
export interface CaptureInfra {
  queueUrl: string;
  queueName?: string;
  queueArn: string;
  ruleName: string;
  ruleArn: string;
  region: string;
  account: string;
  allManagement: boolean;
  owned: boolean; // false = a queue you already had (never torn down); true = CloudMon created it
}

// ---- Scalable (DuckDB-backed) query model: the UI pulls windows + aggregates
// instead of holding the whole dataset. EventRow mirrors internal/store.Row. ----

export interface EventRow {
  seq: number;
  eventID: string;
  eventTime: string;
  eventName: string;
  eventSource: string;
  awsRegion: string;
  sourceIPAddress: string;
  userAgent: string;
  identityType: string;
  identityArn: string;
  userName: string;
  accountId: string;
  principalId: string;
  roleArn: string;
  sessionName: string;
  errorCode: string;
  errorMessage: string;
  recipientAccountId: string;
  readOnly: boolean;
  managementEvent: boolean;
  rawJSON: string;
}

/** Comparison operators the query language compiles to (mirrors internal/store cmpSQL).
 *  exists/nexists come from a bare `field=` / `field!=` (has-a-value / is-empty). */
export type CmpOp = "eq" | "ne" | "regex" | "nregex" | "contains" | "exists" | "nexists";

/** Parsed query-language expression (mirrors internal/store.Expr). Built client-side
 *  by compileQuery; the engine turns it into SQL, the mock walks it via evalAst. */
export type QueryExpr =
  | { t: "and"; nodes: QueryExpr[] }
  | { t: "or"; nodes: QueryExpr[] }
  | { t: "not"; node: QueryExpr }
  | { t: "cmp"; field: string; op: CmpOp; value: string }
  | { t: "text"; value: string; regex?: boolean };

/** Injection-safe structured filter (mirrors internal/store.Filter). Keys are query fields. */
export interface QueryFilter {
  includes: Record<string, string[]>;
  excludes: Record<string, string[]>;
  exists?: string[];
  matchNone?: boolean;
  errorsOnly: boolean;
  hideReadOnly: boolean;
  fromMs: number;
  toMs: number;
  text: string;
  expr: QueryExpr | null; // the free-text query language, parsed to a tree
}

/** Raw aggregate shape returned by the Go engine (App.QueryAggregates). */
export interface EvidenceSnapshot { generation: string; maxSeq: number; capturedAt: string }
export interface EngineAggregates {
  snapshot: EvidenceSnapshot;
  total: number;
  stats: { errors: number; principals: number; sources: number; regions: number; minMs: number; maxMs: number };
  facets: Record<string, { value: string; count: number }[]>;
  histogram: { t: number; n: number; e: number }[];
  histStep: number;
  histFrom: number;
  histTo: number;
}

// ---- Credential lineage (mirror internal/store Lineage). ----

export interface LineageNode {
  identityType: string;
  arn: string;
  userName: string;
  accountId: string;
  roleArn: string;
  sessionName: string;
  invokedBy: string; // for AWSService: the calling service
  viaSeq: number; // the AssumeRole event this node performed to mint the session below it
  viaEvent: string;
  viaTime: string;
  viaSourceIP: string;
  evidence?: string;
  evidenceSeqs?: number[];
}
export interface Lineage {
  applicable: boolean; // false unless the event is an AssumedRole
  sourceIdentity: string; // recorded session attribute
  complete: boolean; // reached a recorded non-session principal
  status?: string;
  reason?: string;
  nodes: LineageNode[]; // origin-first → immediate parent
}

// ---- Full lineage graph (the Lineage view; mirror internal/store). ----

export interface GraphNode {
  id: string;
  kind: string; // origin | ancestor | parent | current | sibling | descendant
  identityType: string;
  arn: string;
  roleArn: string;
  roleName: string;
  userName: string;
  sessionName: string;
  accountId: string;
  accessKeyId: string;
  invokedBy: string; // for AWSService: the calling service
  identityNote?: string;
  originKind?: string; // sso | service-linked | service - drives a badge
  events: number; // activity count for THIS session key
  childCount: number; // # AssumeRole calls this session made (expandable if > shown)
  roleEvents?: number; // events across every session of this role (rollup)
  roleSessions?: number; // distinct session keys this role minted
  // event nodes (kind "event") - the session's own activity
  seq?: number;
  eventName?: string;
  eventSource?: string;
  eventTime?: string;
  errorCode?: string;
  readOnly?: boolean;
  resource?: string; // the object the API acted on (KMS key, S3 object, secret, …)
}
export interface GraphEdge {
  parent: string;
  child: string;
  viaSeq: number;
  viaEvent: string;
  viaTime: string;
  viaIP: string;
  evidence?: string;
  evidenceSeqs?: number[];
  crossAccount?: boolean; // caller and role live in different accounts
}
export interface LineageTree {
  snapshot?: EvidenceSnapshot;
  applicable: boolean;
  currentId: string;
  rootId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  notes: string[];
}

// ---- Sigma testbench (mirror internal/store.SigmaResult / SigmaDiag). ----

export interface SigmaDiag {
  severity: "error" | "warning";
  message: string;
  line?: number; // 1-based; 0/absent = no position
}
/** Raw result from App.SigmaRun (rows are flat EventRow, mapped to events client-side). */
export interface SigmaResultRaw {
  parsed: boolean; // YAML + Sigma grammar parsed
  supported: boolean; // fully translatable → actually run
  title: string;
  diagnostics: SigmaDiag[];
  sql: string;
  matches: number; // dataset-wide match count
  scanned: number; // total events evaluated
  rows: EventRow[];
}

/** Map an EventRow (flat) back to the CloudTrailEvent shape the UI components use.
 *  rawJSON is empty here - it's fetched lazily on row expand (see App.getEventRaw). */
export function rowToEvent(r: EventRow): CloudTrailEvent {
  return {
    seq: r.seq,
    eventID: r.eventID,
    eventTime: r.eventTime,
    eventName: r.eventName,
    eventSource: r.eventSource,
    awsRegion: r.awsRegion,
    sourceIPAddress: r.sourceIPAddress,
    userAgent: r.userAgent,
    userIdentity: {
      type: r.identityType,
      principalId: r.principalId,
      arn: r.identityArn,
      accountId: r.accountId,
      userName: r.userName,
      roleArn: r.roleArn,
      sessionName: r.sessionName,
    },
    readOnly: r.readOnly,
    managementEvent: r.managementEvent,
    errorCode: r.errorCode || undefined,
    errorMessage: r.errorMessage || undefined,
    recipientAccountId: r.recipientAccountId,
    rawJSON: r.rawJSON || "", // lazy - fetched on expand
  };
}

// ---- Filtering: one canonical query of removable terms ----

export type FilterField =
  | keyof CloudTrailEvent
  | "user"
  | "result"
  | "identityType"
  | "userName"
  | "identityArn"
  | "roleArn"
  | "sessionName"
  | "principalId"
  | "accountId";

export type QueryOp = "include" | "exclude" | "exists";

export interface FieldTerm {
  kind: "field";
  id: string;
  field: FilterField;
  op: QueryOp;
  value: string; // ignored for "exists"
  label?: string; // optional human label (e.g. for the time-range term)
}

export interface TimeTerm {
  kind: "time";
  id: string;
  from: number; // epoch ms
  to: number;
  label: string;
}

export type QueryTerm = FieldTerm | TimeTerm;

// ---- Derivations used across the UI ----

export function eventResult(e: CloudTrailEvent): string {
  return e.errorCode ? e.errorCode : "Success";
}

export function eventUser(e: CloudTrailEvent): string {
  const ui = e.userIdentity;
  if (ui.type === "Root") return "root";
  if (ui.userName) return ui.userName;
  if (ui.arn) return ui.arn.split("/").pop() || ui.arn;
  return ui.type || "-";
}

/** Raw value used for filtering / faceting / pivots (never the truncated display text). */
export function filterFieldValue(e: CloudTrailEvent, field: FilterField): string {
  switch (field) {
    case "user":
      return eventUser(e);
    case "result":
      return eventResult(e);
    case "identityType":
      return e.userIdentity.type;
    case "userName":
      return e.userIdentity.userName;
    case "identityArn":
      return e.userIdentity.arn;
    case "roleArn":
      return e.userIdentity.roleArn ?? "";
    case "sessionName":
      return e.userIdentity.sessionName ?? "";
    case "principalId":
      return e.userIdentity.principalId;
    case "accountId":
      return e.userIdentity.accountId;
    default:
      return String((e as unknown as Record<string, unknown>)[field] ?? "");
  }
}

/** Field tokens accepted by the query language (and shown as column/facet titles). */
export const QUERY_FIELDS: FilterField[] = [
  "eventTime",
  "eventName",
  "eventSource",
  "user",
  "userName",
  "identityType",
  "identityArn",
  "roleArn",
  "sessionName",
  "principalId",
  "accountId",
  "awsRegion",
  "sourceIPAddress",
  "userAgent",
  "result",
  "errorCode",
  "errorMessage",
  "readOnly",
  "managementEvent",
  "recipientAccountId",
  "eventID",
];

/** A short glyph for an identity type - paired with text so it survives grayscale. */
export function identityGlyph(type: string): string {
  switch (type) {
    case "Root":
      return "★";
    case "IAMUser":
      return "●";
    case "AssumedRole":
      return "⇄";
    case "AWSService":
      return "⚙";
    case "FederatedUser":
      return "◆";
    default:
      return "○";
  }
}

/** Middle-truncate an ARN, keeping the recognizable tail (…role/AdminRole). */
export function truncateArn(arn: string, keepTail = 28): string {
  if (!arn) return "";
  if (arn.length <= keepTail + 6) return arn;
  return "…" + arn.slice(-keepTail);
}

export interface SavedCapture {
  version: number;
  phase: "provisioning" | "ready" | "cleanup";
  config: ConnectionConfig;
  infra: CaptureInfra;
}
export interface RecoveryState {
  evidence: { events: number; observations: number; variantEvents: number; lossy: number };
  capture: SavedCapture | null;
  captureError: string;
  active: boolean;
}
export interface SourceEvidence {
  id: number; sha256: string; source: string; ordinal: number;
  format: string; lossy: boolean; observedAt: string; displayed: boolean;
}
export interface EvidencePage { total: number; variants: number; observations: SourceEvidence[] }

export function hasCredentialLineage(event: CloudTrailEvent): boolean {
  return ["AssumedRole", "FederatedUser", "IAMUser", "Root"].includes(event.userIdentity.type);
}

export interface ResourceReference { arn: string; kind: string; source: string }
export interface CorrelationReason { kind: string; label: string; value?: string }
export interface InvestigationOptions { seq: number; eventID: string; minutes: number; relation: string; snapshot: EvidenceSnapshot | null }
export interface InvestigationResult {
  snapshot: EvidenceSnapshot;
  anchor: EventRow;
  resources: ResourceReference[];
  resourcesTruncated: boolean;
  events: {event: EventRow; reasons: CorrelationReason[]; deltaMs: number}[];
  total: number;
  limit: number;
  fromMs: number;
  toMs: number;
  notes: string[];
}
