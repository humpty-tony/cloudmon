// Browser-side CloudTrail dump parser - mirrors internal/ingest/dump.go for the
// shapes readable as text (no gzip in the browser). Used by the mock backend so
// the preview can load a real export; the desktop app parses in Go instead.

import type { CloudTrailEvent } from "./types";

type RawRecord = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function recordToEvent(raw: RawRecord): CloudTrailEvent {
  const ui = (raw.userIdentity as RawRecord) || {};
  const context = (ui.sessionContext as RawRecord) || {};
  const issuer = (context.sessionIssuer as RawRecord) || {};
  const errorCode = str(raw.errorCode) || undefined;
  return {
    seq: 0,
    eventID: str(raw.eventID),
    eventTime: str(raw.eventTime),
    eventName: str(raw.eventName),
    eventSource: str(raw.eventSource),
    awsRegion: str(raw.awsRegion),
    sourceIPAddress: str(raw.sourceIPAddress),
    userAgent: str(raw.userAgent),
    userIdentity: {
      type: str(ui.type),
      principalId: str(ui.principalId),
      arn: str(ui.arn),
      accountId: str(ui.accountId),
      userName: str(ui.userName) || str(issuer.userName),
      roleArn: str(issuer.arn),
      sessionName: str(ui.principalId).split(":")[1] ?? "",
    },
    readOnly: raw.readOnly === true,
    managementEvent: raw.managementEvent == null ? true : raw.managementEvent === true,
    errorCode,
    errorMessage: str(raw.errorMessage) || undefined,
    recipientAccountId: str(raw.recipientAccountId),
    rawJSON: JSON.stringify(raw, null, 2),
  };
}

function assignSeq(events: CloudTrailEvent[]): CloudTrailEvent[] {
  events.sort((a, b) => {
    const ta = Date.parse(a.eventTime);
    const tb = Date.parse(b.eventTime);
    if (isNaN(ta) || isNaN(tb)) return 0;
    return ta - tb;
  });
  return events.map((e, i) => ({ ...e, seq: i + 1 }));
}

// minimal RFC4180-ish CSV (handles quoted fields + embedded commas/quotes)
function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseCSV(text: string): CloudTrailEvent[] {
  const rows = parseCSVRows(text);
  if (rows.length < 2) throw new Error("CSV has no data rows");
  const idx: Record<string, number> = {};
  rows[0].forEach((h, i) => (idx[h.trim().toLowerCase()] = i));
  const col = (row: string[], ...names: string[]) => {
    for (const n of names) if (idx[n] !== undefined) return (row[idx[n]] || "").trim();
    return "";
  };
  return rows.slice(1).map((row) =>
    recordToEvent({
      eventID: col(row, "event id", "eventid"),
      eventTime: col(row, "event time", "eventtime"),
      eventName: col(row, "event name", "eventname"),
      eventSource: col(row, "event source", "eventsource"),
      awsRegion: col(row, "aws region", "awsregion", "region"),
      sourceIPAddress: col(row, "source ip address", "sourceipaddress", "source ip"),
      errorCode: col(row, "error code", "errorcode"),
      userIdentity: { userName: col(row, "user name", "username") },
    })
  );
}

/** Parse a CloudTrail export (Records[], lookup-events Events[], bare array, NDJSON, or CSV). */
export function parseDump(text: string): CloudTrailEvent[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("file is empty");

  let events: CloudTrailEvent[] = [];
  if (trimmed[0] === "{" || trimmed[0] === "[") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // maybe NDJSON (one object per line)
      const nd = ndjson(trimmed);
      if (nd.length) events = nd;
      else throw new Error("invalid JSON");
    }
    if (!events.length && parsed !== undefined) {
      events = fromParsed(parsed);
    }
  } else {
    events = parseCSV(trimmed);
  }

  if (!events.length) throw new Error("no CloudTrail events found in file");
  // A real CloudTrail record always has an eventName - reject arbitrary JSON.
  if (!events.some((e) => e.eventName)) {
    throw new Error("this doesn't look like a CloudTrail export - no events with an eventName");
  }
  return assignSeq(events);
}

function ndjson(text: string): CloudTrailEvent[] {
  const out: CloudTrailEvent[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(recordToEvent(JSON.parse(t) as RawRecord));
    } catch {
      /* skip */
    }
  }
  return out;
}

function fromParsed(parsed: unknown): CloudTrailEvent[] {
  if (Array.isArray(parsed)) return parsed.map((r) => recordToEvent(r as RawRecord));
  const obj = parsed as RawRecord;
  if (Array.isArray(obj.Records)) return (obj.Records as RawRecord[]).map(recordToEvent);
  if (Array.isArray(obj.Events)) {
    // `aws cloudtrail lookup-events` - each event is a JSON string
    const out: CloudTrailEvent[] = [];
    for (const ev of obj.Events as RawRecord[]) {
      const s = str(ev.CloudTrailEvent);
      if (!s) continue;
      try {
        out.push(recordToEvent(JSON.parse(s) as RawRecord));
      } catch {
        /* skip */
      }
    }
    return out;
  }
  // single bare event object
  return [recordToEvent(obj)];
}
