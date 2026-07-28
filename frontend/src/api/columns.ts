// Column registry. Each column maps to a CloudTrail field (for pivots/facets)
// and can be toggled/reordered. `get` is the raw display/title text; rich cells
// (time, identity, result) are rendered specially in EventTable by key.

import type { CloudTrailEvent, FilterField } from "./types";
import { eventUser, eventResult } from "./types";

export interface ColumnDef {
  key: string;
  label: string;
  field: FilterField; // pivot/facet target
  width: number; // default/min column width in px (overridable, resizable)
  defaultVisible: boolean;
  mono?: boolean;
  grow?: number; // if set, this column absorbs extra horizontal space (fr weight)
  get: (e: CloudTrailEvent) => string;
}

// Column titles ARE the query field tokens, so what you see is what you type.
// `grow` columns expand to use spare width (so text isn't cropped when there's room).
export const COLUMNS: ColumnDef[] = [
  { key: "time", label: "eventTime", field: "eventTime", width: 170, defaultVisible: true, mono: true, get: (e) => e.eventTime },
  { key: "identity", label: "user", field: "principalId", width: 230, defaultVisible: true, grow: 1.5, get: (e) => eventUser(e) },
  { key: "name", label: "eventName", field: "eventName", width: 240, defaultVisible: true, grow: 2, get: (e) => e.eventName },
  { key: "source", label: "eventSource", field: "eventSource", width: 190, defaultVisible: true, mono: true, grow: 1, get: (e) => e.eventSource },
  { key: "region", label: "awsRegion", field: "awsRegion", width: 120, defaultVisible: true, mono: true, get: (e) => e.awsRegion },
  { key: "ip", label: "sourceIPAddress", field: "sourceIPAddress", width: 150, defaultVisible: true, mono: true, get: (e) => e.sourceIPAddress },
  { key: "result", label: "result", field: "result", width: 160, defaultVisible: true, get: (e) => eventResult(e) },
  // Available via the column chooser / presets.
  { key: "identityType", label: "identityType", field: "identityType", width: 130, defaultVisible: false, get: (e) => e.userIdentity.type },
  // Concrete, round-tripping identity fields (the value IS what you type in the query bar).
  { key: "userName", label: "userName", field: "userName", width: 160, defaultVisible: false, mono: true, get: (e) => e.userIdentity.userName },
  { key: "roleArn", label: "roleArn", field: "roleArn", width: 300, defaultVisible: false, mono: true, grow: 2, get: (e) => e.userIdentity.roleArn ?? "" },
  { key: "sessionName", label: "sessionName", field: "sessionName", width: 170, defaultVisible: false, mono: true, get: (e) => e.userIdentity.sessionName ?? "" },
  { key: "principalId", label: "principalId", field: "principalId", width: 210, defaultVisible: false, mono: true, get: (e) => e.userIdentity.principalId },
  { key: "identityArn", label: "identityArn", field: "identityArn", width: 320, defaultVisible: false, mono: true, grow: 2, get: (e) => e.userIdentity.arn },
  { key: "account", label: "recipientAccountId", field: "recipientAccountId", width: 160, defaultVisible: false, mono: true, get: (e) => e.recipientAccountId },
  { key: "readOnly", label: "readOnly", field: "readOnly", width: 100, defaultVisible: false, get: (e) => String(e.readOnly) },
  { key: "userAgent", label: "userAgent", field: "userAgent", width: 260, defaultVisible: false, mono: true, grow: 2, get: (e) => e.userAgent },
  { key: "eventID", label: "eventID", field: "eventID", width: 300, defaultVisible: false, mono: true, get: (e) => e.eventID },
  { key: "errorMessage", label: "errorMessage", field: "errorMessage", width: 280, defaultVisible: false, grow: 2, get: (e) => e.errorMessage || "" },
];

export const COLUMN_BY_KEY: Record<string, ColumnDef> = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
export const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
