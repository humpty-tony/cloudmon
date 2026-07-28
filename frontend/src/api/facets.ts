// Facet computation: top values + counts per field over the current result set.

import type { CloudTrailEvent, FilterField } from "./types";
import { filterFieldValue } from "./types";

export interface FacetValue {
  value: string;
  count: number;
  fraction: number; // 0..1 of the max value in this facet (for the bar-in-row fill)
}

export interface FacetGroup {
  field: FilterField;
  label: string;
  values: FacetValue[];
  total: number; // distinct values seen
}

export interface FacetFieldDef {
  field: FilterField;
  label: string;
}

export const FACET_FIELDS: FacetFieldDef[] = [
  { field: "eventSource", label: "eventSource" },
  { field: "eventName", label: "eventName" },
  { field: "user", label: "user" },
  { field: "identityType", label: "identityType" },
  { field: "result", label: "result" },
  { field: "awsRegion", label: "awsRegion" },
  { field: "sourceIPAddress", label: "sourceIPAddress" },
];

export function computeFacets(events: CloudTrailEvent[], topN = 8): FacetGroup[] {
  return FACET_FIELDS.map((def) => {
    const counts = new Map<string, number>();
    for (const e of events) {
      const v = filterFieldValue(e, def.field);
      if (!v) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const max = sorted.length ? sorted[0][1] : 1;
    return {
      field: def.field,
      label: def.label,
      total: sorted.length,
      values: sorted.slice(0, topN).map(([value, count]) => ({
        value,
        count,
        fraction: count / max,
      })),
    };
  });
}
