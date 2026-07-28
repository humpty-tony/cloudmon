// Browser-mode mock feed. Used when the app runs outside Wails (plain browser,
// for UI development and vision review). Produces plausible CloudTrail traffic -
// including a deliberate AccessDenied burst anomaly - so the table, facets,
// histogram, filtering and detail pane are all exercisable without AWS.

import type { CloudTrailEvent, ConnectionMode, RequiredPermission } from "./types";

interface Template {
  eventName: string;
  eventSource: string;
  readOnly: boolean;
  errorChance: number;
  error?: string;
}

const TEMPLATES: Template[] = [
  { eventName: "ConsoleLogin", eventSource: "signin.amazonaws.com", readOnly: false, errorChance: 0.15, error: "Failed authentication" },
  { eventName: "AssumeRole", eventSource: "sts.amazonaws.com", readOnly: false, errorChance: 0.05, error: "AccessDenied" },
  { eventName: "GetCallerIdentity", eventSource: "sts.amazonaws.com", readOnly: true, errorChance: 0.0 },
  { eventName: "RunInstances", eventSource: "ec2.amazonaws.com", readOnly: false, errorChance: 0.1, error: "Client.UnauthorizedOperation" },
  { eventName: "TerminateInstances", eventSource: "ec2.amazonaws.com", readOnly: false, errorChance: 0.08, error: "Client.UnauthorizedOperation" },
  { eventName: "AuthorizeSecurityGroupIngress", eventSource: "ec2.amazonaws.com", readOnly: false, errorChance: 0.12, error: "Client.UnauthorizedOperation" },
  { eventName: "PutObject", eventSource: "s3.amazonaws.com", readOnly: false, errorChance: 0.06, error: "AccessDenied" },
  { eventName: "GetObject", eventSource: "s3.amazonaws.com", readOnly: true, errorChance: 0.2, error: "AccessDenied" },
  { eventName: "DeleteBucket", eventSource: "s3.amazonaws.com", readOnly: false, errorChance: 0.3, error: "AccessDenied" },
  { eventName: "CreateUser", eventSource: "iam.amazonaws.com", readOnly: false, errorChance: 0.1, error: "AccessDenied" },
  { eventName: "AttachUserPolicy", eventSource: "iam.amazonaws.com", readOnly: false, errorChance: 0.15, error: "AccessDenied" },
  { eventName: "CreateAccessKey", eventSource: "iam.amazonaws.com", readOnly: false, errorChance: 0.1, error: "AccessDenied" },
  { eventName: "ListBuckets", eventSource: "s3.amazonaws.com", readOnly: true, errorChance: 0.0 },
  { eventName: "DescribeInstances", eventSource: "ec2.amazonaws.com", readOnly: true, errorChance: 0.0 },
  { eventName: "GetSecretValue", eventSource: "secretsmanager.amazonaws.com", readOnly: true, errorChance: 0.25, error: "AccessDenied" },
  { eventName: "Decrypt", eventSource: "kms.amazonaws.com", readOnly: true, errorChance: 0.1, error: "AccessDenied" },
  { eventName: "StopLogging", eventSource: "cloudtrail.amazonaws.com", readOnly: false, errorChance: 0.2, error: "AccessDenied" },
];

const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-2", "eu-central-1"];

interface Principal {
  type: string;
  userName: string;
  arn: string;
}
const PRINCIPALS: Principal[] = [
  { type: "IAMUser", userName: "alice", arn: "arn:aws:iam::123456789012:user/alice" },
  { type: "IAMUser", userName: "bob", arn: "arn:aws:iam::123456789012:user/bob" },
  { type: "AssumedRole", userName: "deploy-role", arn: "arn:aws:sts::123456789012:assumed-role/deploy-role/ci-session" },
  { type: "AssumedRole", userName: "admin-role", arn: "arn:aws:sts::123456789012:assumed-role/admin-role/console" },
  { type: "Root", userName: "root", arn: "arn:aws:iam::123456789012:root" },
  { type: "AWSService", userName: "", arn: "" },
];

const AGENTS = [
  "aws-cli/2.15.0 Python/3.11 Linux/6.1",
  "Boto3/1.34.0 Python/3.12",
  "console.amazonaws.com",
  "Terraform/1.7.0 (+https://www.terraform.io)",
  "AWS Internal",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomIP(): string {
  return `${1 + Math.floor(Math.random() * 223)}.${Math.floor(Math.random() * 256)}.${Math.floor(
    Math.random() * 256
  )}.${Math.floor(Math.random() * 256)}`;
}

interface Overrides {
  eventName?: string;
  eventSource?: string;
  readOnly?: boolean;
  sourceIPAddress?: string;
  principal?: Principal;
  fail?: boolean | string; // undefined = template chance; string = errorCode; false = force success
}

function makeRecord(seq: number, when: Date, o: Overrides = {}): CloudTrailEvent {
  const t = pick(TEMPLATES);
  const p = o.principal ?? pick(PRINCIPALS);
  const eventName = o.eventName ?? t.eventName;
  const eventSource = o.eventSource ?? t.eventSource;
  const readOnly = o.readOnly ?? t.readOnly;

  let errorCode = "";
  if (o.fail === undefined) errorCode = Math.random() < t.errorChance ? t.error ?? "AccessDenied" : "";
  else if (o.fail === false) errorCode = "";
  else errorCode = typeof o.fail === "string" ? o.fail : t.error ?? "AccessDenied";
  const failed = !!errorCode;

  const ip = o.sourceIPAddress ?? (p.type === "AWSService" ? eventSource : randomIP());

  const raw = {
    eventVersion: "1.09",
    eventID: crypto.randomUUID(),
    eventTime: when.toISOString(),
    eventName,
    eventSource,
    awsRegion: pick(REGIONS),
    sourceIPAddress: ip,
    userAgent: pick(AGENTS),
    readOnly,
    managementEvent: true,
    eventCategory: "Management",
    recipientAccountId: "123456789012",
    userIdentity: {
      type: p.type,
      principalId: "AIDA" + Math.random().toString(36).slice(2, 12).toUpperCase(),
      arn: p.arn,
      accountId: "123456789012",
      userName: p.userName,
    },
    requestParameters: { placeholder: "mock request parameters" },
    responseElements: failed ? null : { placeholder: "mock response" },
    ...(failed ? { errorCode, errorMessage: `${errorCode}: request was denied by an explicit policy` } : {}),
  };

  return {
    seq,
    eventID: raw.eventID,
    eventTime: raw.eventTime,
    eventName,
    eventSource,
    awsRegion: raw.awsRegion,
    sourceIPAddress: ip,
    userAgent: raw.userAgent,
    userIdentity: raw.userIdentity,
    readOnly,
    managementEvent: true,
    errorCode: failed ? errorCode : undefined,
    errorMessage: failed ? `${errorCode}: request was denied by an explicit policy` : undefined,
    recipientAccountId: raw.recipientAccountId,
    rawJSON: JSON.stringify(raw, null, 2),
  };
}

/** MockFeed produces an initial backlog and streams new events while capturing. */
export class MockFeed {
  private seq = 0;
  private timer: number | null = null;
  private listeners = new Set<(e: CloudTrailEvent) => void>();

  /** Backlog spread over ~25 min, denser toward now, plus one AccessDenied burst. */
  backlog(count: number): CloudTrailEvent[] {
    const now = Date.now();
    const span = 25 * 60_000;
    const out: CloudTrailEvent[] = [];

    for (let i = 0; i < count; i++) {
      const bias = Math.pow(Math.random(), 1.5); // cluster toward recent
      out.push(makeRecord(0, new Date(now - bias * span)));
    }

    // Anomaly: a recon burst - one assumed role from one IP hammering reads, all denied.
    const burstStart = now - 9 * 60_000;
    const burstIP = "192.0.2.66";
    const attacker: Principal = {
      type: "AssumedRole",
      userName: "app-ci-role",
      arn: "arn:aws:sts::123456789012:assumed-role/app-ci-role/i-0ab12ef",
    };
    const reconApis = ["ListBuckets", "GetObject", "GetSecretValue", "ListRoles", "GetCallerIdentity"];
    for (let i = 0; i < 46; i++) {
      out.push(
        makeRecord(0, new Date(burstStart + (i / 46) * 110_000 + Math.random() * 1200), {
          sourceIPAddress: burstIP,
          principal: attacker,
          eventName: pick(reconApis),
          eventSource: "s3.amazonaws.com",
          readOnly: true,
          fail: "AccessDenied",
        })
      );
    }

    out.sort((a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime));
    return out.map((e) => ({ ...e, seq: ++this.seq }));
  }

  onEvent(cb: (e: CloudTrailEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      const e = makeRecord(++this.seq, new Date());
      this.listeners.forEach((l) => l(e));
    }, 1100);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export function mockPermissions(mode: ConnectionMode): RequiredPermission[] {
  switch (mode) {
    case "create-infra":
      return [
        { action: "events:PutRule", reason: "Create the EventBridge rule that captures CloudTrail events" },
        { action: "events:PutTargets", reason: "Point the rule at the CloudMon SQS queue" },
        { action: "events:DeleteRule / RemoveTargets", reason: "Tear the capture pipeline down cleanly" },
        { action: "sqs:CreateQueue", reason: "Create the queue CloudMon polls" },
        { action: "sqs:SetQueueAttributes", reason: "Attach the policy allowing EventBridge to deliver" },
        { action: "sqs:GetQueueAttributes", reason: "Read queue ARN/attributes for wiring" },
        { action: "sqs:ReceiveMessage / DeleteMessage", reason: "Consume events at runtime" },
        { action: "cloudformation:*Stack", reason: "(optional) manage all of the above as one stack" },
      ];
    case "existing-sqs":
      return [
        { action: "sqs:ReceiveMessage", reason: "Poll the provided queue for events" },
        { action: "sqs:DeleteMessage", reason: "Acknowledge consumed messages" },
        { action: "sqs:GetQueueAttributes", reason: "Validate the queue is reachable" },
        { action: "events:PutRule / PutTargets", reason: "Only if you set a capture filter on the feeding rule" },
      ];
    case "import-dump":
      return [{ action: "(none)", reason: "Reads a local file - no AWS access required" }];
  }
}
