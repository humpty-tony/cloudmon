// Facets describe the complete applied-query snapshot, never the loaded page.
import type { CloudTrailEvent, FacetMetadata, FilterField } from "./types";
import { filterFieldValue } from "./types";

export interface FacetValue {
  value: string;
  count: number;
  fraction: number; // 0..1 of the maximum count in this field
}

export interface FacetGroup {
  field: FilterField;
  label: string;
  values: FacetValue[];
  /** @deprecated Distinct values, NOT field presence. Unknown in legacy responses. */
  total?: number;
  metadata?: FacetMetadata;
}

export interface FacetFieldDef {
  field: FilterField;
  label: string;
}

export const FACET_VALUE_LIMIT = 25;
export const DEFAULT_FACET_FIELDS: FilterField[] = ["eventSource", "userName", "sourceIPAddress", "result"];
export const FACET_FIELDS: FacetFieldDef[] = [
  { field: "eventSource", label: "Service" },
  { field: "userName", label: "User / issuer name" },
  { field: "sourceIPAddress", label: "Source IP" },
  { field: "result", label: "Result" },
  { field: "accountId", label: "Account" },
  { field: "awsRegion", label: "Region" },
  { field: "eventName", label: "Event name" },
  { field: "errorCode", label: "Error code" },
  { field: "roleArn", label: "Role ARN" },
  { field: "identityType", label: "Identity type" },
];

// DuckDB's default string ordering compares UTF-8 code points, not locale names.
const compareValue = (a: string, b: string): number => {
  const left = Array.from(a, c => c.codePointAt(0)!);
  const right = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
};

export function computeFacets(events: CloudTrailEvent[], topN = FACET_VALUE_LIMIT): FacetGroup[] {
  return FACET_FIELDS.map((def) => {
    const counts = new Map<string, number>();
    let presentEvents = 0;
    for (const event of events) {
      const value = filterFieldValue(event, def.field);
      if (!value) continue;
      presentEvents++;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || compareValue(a[0], b[0]));
    const max = sorted.length ? sorted[0][1] : 1;
    const values = sorted.slice(0, topN).map(([value, count]) => ({value, count, fraction: count / max}));
    return {
      ...def,
      total: sorted.length,
      values,
      metadata: {
        totalEvents: events.length, presentEvents, missingEvents: events.length - presentEvents,
        distinctValues: sorted.length, returnedValues: values.length, limit: topN, truncated: sorted.length > values.length,
      },
    };
  });
}
