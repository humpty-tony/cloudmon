// The one canonical query. Every facet click, cell pivot, histogram brush,
// triage toggle and free-text search writes QueryTerms into a single array.
// Semantics: OR within a field's include terms (standard faceting), AND across
// different fields; excludes and exists are AND; text is AND substring; time is AND.

import type { CloudTrailEvent, FilterField, QueryOp, QueryTerm } from "./types";
import { filterFieldValue, QUERY_FIELDS } from "./types";

let termCounter = 0;
export const nextTermId = () => `t${++termCounter}`;

export function fieldTerm(field: FilterField, op: QueryOp, value: string, label?: string): QueryTerm {
  return { kind: "field", id: nextTermId(), field, op, value, label };
}
export function timeTerm(from: number, to: number, label: string): QueryTerm {
  return { kind: "time", id: nextTermId(), from, to, label };
}

/** Search each supported field, without inventing phrases across field boundaries. */
export function searchableValues(e: CloudTrailEvent): string[] {
  return QUERY_FIELDS.map(field => filterFieldValue(e, field));
}

/** Add a term, de-duplicating exact field/op/value repeats (e.g. double-clicks). */
export function addTerm(terms: QueryTerm[], term: QueryTerm): QueryTerm[] {
  if (term.kind === "field") {
    const dup = terms.some(
      (t) => t.kind === "field" && t.field === term.field && t.op === term.op && t.value === term.value
    );
    if (dup) return terms;
  }
  if (term.kind === "time") {
    // Only one time term at a time - replace.
    return [...terms.filter((t) => t.kind !== "time"), term];
  }
  return [...terms, term];
}

export function removeTerm(terms: QueryTerm[], id: string): QueryTerm[] {
  return terms.filter((t) => t.id !== id);
}

/** Toggle a triage-style field term on/off (used by the toolbar toggles). */
export function toggleFieldTerm(terms: QueryTerm[], field: FilterField, op: QueryOp, value: string, label?: string): QueryTerm[] {
  const existing = terms.find(
    (t) => t.kind === "field" && t.field === field && t.op === op && t.value === value
  );
  if (existing) return removeTerm(terms, existing.id);
  return addTerm(terms, fieldTerm(field, op, value, label));
}

/**
 * Apply a pivot (include/exclude) on a specific field+value, resolving conflicts:
 * include and exclude of the SAME field+value can never coexist. Clicking the
 * same op again toggles it off; the opposite op replaces it.
 */
export function applyPivot(terms: QueryTerm[], field: FilterField, op: QueryOp, value: string): QueryTerm[] {
  const sameExact = terms.find(
    (t) => t.kind === "field" && t.field === field && t.op === op && t.value === value
  );
  if (sameExact) return removeTerm(terms, sameExact.id); // toggle off
  // drop any term on this exact field+value (the opposite op) before adding
  const cleaned = terms.filter((t) => !(t.kind === "field" && t.field === field && t.value === value));
  return [...cleaned, fieldTerm(field, op, value)];
}

export function hasFieldTerm(terms: QueryTerm[], field: FilterField, op: QueryOp, value: string): boolean {
  return terms.some((t) => t.kind === "field" && t.field === field && t.op === op && t.value === value);
}

export function matchEvent(e: CloudTrailEvent, terms: QueryTerm[]): boolean {
  // group field-include by field for OR-within-field (case-insensitive)
  const includeGroups = new Map<FilterField, Set<string>>();
  for (const t of terms) {
    if (t.kind === "field" && t.op === "include") {
      if (!includeGroups.has(t.field)) includeGroups.set(t.field, new Set());
      includeGroups.get(t.field)!.add(t.value.toLowerCase());
    }
  }
  for (const [field, vals] of includeGroups) {
    if (!vals.has(filterFieldValue(e, field).toLowerCase())) return false;
  }
  for (const t of terms) {
    if (t.kind === "field" && t.op === "exclude") {
      if (filterFieldValue(e, t.field).toLowerCase() === t.value.toLowerCase()) return false;
    } else if (t.kind === "field" && t.op === "exists") {
      if (!filterFieldValue(e, t.field)) return false;
    } else if (t.kind === "time") {
      const ts = Date.parse(e.eventTime);
      if (ts < t.from || ts > t.to) return false;
    }
  }
  return true;
}

export function filterEvents(events: CloudTrailEvent[], terms: QueryTerm[]): CloudTrailEvent[] {
  if (!terms.length) return events;
  return events.filter((e) => matchEvent(e, terms));
}
