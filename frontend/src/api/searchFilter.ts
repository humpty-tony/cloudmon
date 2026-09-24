import type { CloudTrailEvent, FilterField, QueryExpr, QueryFilter, QueryTerm } from "./types";
import { filterFieldValue, QUERY_FIELDS } from "./types";
import { evalAst, validateQueryExpr } from "./queryLang";
import { searchableValues } from "./query";

/** Clicked values are literal, including any * or ? characters in evidence. */
export function buildFilter(terms: QueryTerm[], sensitiveOnly: boolean, expr: QueryExpr | null, sensitiveSet: Set<string> | null): QueryFilter {
  const includes: Record<string, string[]> = Object.create(null);
  const excludes: Record<string, string[]> = Object.create(null);
  const exists: string[] = [];
  let fromMs = 0, toMs = 0, matchNone = false;
  for (const term of terms) {
    if (term.kind === "time") { fromMs = term.from; toMs = term.to; continue; }
    if (term.op === "include") (includes[term.field] ||= []).push(term.value);
    else if (term.op === "exclude") (excludes[term.field] ||= []).push(term.value);
    else exists.push(term.field);
  }
  if (sensitiveOnly && sensitiveSet) {
    const allowed = new Set([...sensitiveSet].map(value => value.toLowerCase()));
    const values = (includes.eventName?.length ? includes.eventName : [...sensitiveSet]).filter(value => allowed.has(value.toLowerCase()));
    includes.eventName = values;
    matchNone = values.length === 0;
  }
  return { includes, excludes, exists, matchNone, errorsOnly: false, hideReadOnly: false, fromMs, toMs, text: "", expr };
}

const fields = new Map(QUERY_FIELDS.map(field => [field.toLowerCase(), field]));
function fieldName(name: string): FilterField {
  const field = fields.get(name.toLowerCase());
  if (!field) throw new Error(`unknown query field "${name}"`);
  return field;
}

/** Browser preview uses the same field set, literal pivots, and missing values as SQL. */
export function applyFilter(events: CloudTrailEvent[], filter: QueryFilter): CloudTrailEvent[] {
  const includes = Object.entries(filter.includes).map(([name, values]) => [fieldName(name), new Set(values.map(value => value.toLowerCase()))] as const);
  const excludes = Object.entries(filter.excludes).map(([name, values]) => [fieldName(name), new Set(values.map(value => value.toLowerCase()))] as const);
  const exists = (filter.exists ?? []).map(fieldName);
  if (filter.expr) validateQueryExpr(filter.expr);
  if (filter.fromMs && filter.toMs && filter.fromMs > filter.toMs) throw new Error("time range starts after it ends");
  if (filter.matchNone) return [];
  return events.filter(event => {
    for (const [field, values] of includes) if (values.size && !values.has(filterFieldValue(event, field).toLowerCase())) return false;
    for (const [field, values] of excludes) if (values.has(filterFieldValue(event, field).toLowerCase())) return false;
    if (exists.some(field => filterFieldValue(event, field) === "")) return false;
    if (filter.errorsOnly && !event.errorCode) return false;
    if (filter.hideReadOnly && event.readOnly) return false;
    if (filter.fromMs || filter.toMs) {
      const time = Date.parse(event.eventTime);
      if (!Number.isFinite(time) || (filter.fromMs && time < filter.fromMs) || (filter.toMs && time > filter.toMs)) return false;
    }
    if (filter.text && !searchableValues(event).some(value => value.toLowerCase().includes(filter.text.toLowerCase()))) return false;
    return !filter.expr || evalAst(event, filter.expr);
  });
}
