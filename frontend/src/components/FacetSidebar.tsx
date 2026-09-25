import { useState } from "react";
import { DEFAULT_FACET_FIELDS, type FacetGroup } from "../api/facets";
import type { FilterField } from "../api/types";
import "./facet-sidebar.css";

interface Props {
  facets: FacetGroup[];
  collapsed: boolean;
  activeValues: Set<string>; // "field value"; literal field values, never aliases
  onToggleCollapse: () => void;
  onPick: (field: FilterField, value: string, op: "include" | "exclude") => void;
  activeExcludes?: Set<string>;
  onClearField?: (field: FilterField) => void;
  onClearFacets?: () => void;
}

const key = (field: FilterField, value: string) => `${String(field)} ${value}`;
const COLLAPSED_LIMIT = 3;
const count = (value: number) => value.toLocaleString();
const NO_EXCLUDES = new Set<string>();
const selectedValues = (selected: Set<string>, field: FilterField) => [...selected].filter(value => value.startsWith(`${field} `)).map(value => value.slice(field.length + 1));

export function FacetSidebar({ facets, collapsed, activeValues, onToggleCollapse, onPick, activeExcludes = NO_EXCLUDES, onClearField, onClearFacets }: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState<FilterField[]>(DEFAULT_FACET_FIELDS);
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [wrapped, setWrapped] = useState<Record<string, boolean>>({});
  const hasSelection = (field: FilterField) => selectedValues(activeValues, field).length + selectedValues(activeExcludes, field).length > 0;
  const visible = facets.filter(group => shown.includes(group.field) || hasSelection(group.field));
  const available = facets.filter(group => !visible.includes(group));
  const clearField = (field: FilterField) => {
    if (onClearField) { onClearField(field); return; }
    // Existing App onPick toggles the exact structured term. Never construct a
    // query-language string: wildcards, quotes and the empty string stay literal.
    for (const value of selectedValues(activeValues, field)) onPick(field, value, "include");
    for (const value of selectedValues(activeExcludes, field)) onPick(field, value, "exclude");
  };
  const clearAll = () => onClearFacets ? onClearFacets() : facets.forEach(group => clearField(group.field));

  if (collapsed) return <aside className="facets facet-selector facets--rail" aria-label="Facets collapsed">
    <button className="facet-rail-btn" onClick={onToggleCollapse} aria-label="Expand facets" title="Expand facets">⇥</button>
  </aside>;

  return <aside className="facets facet-selector" aria-label="Facets">
    <div className="facets-head"><span>Facets</span><button className="icon-btn" onClick={onToggleCollapse} aria-label="Collapse facets" title="Collapse facets">⇤</button></div>
    <p className="facet-scope">Applied query · time filters · snapshot</p>
    <div className="facets-scroll">
      {visible.map(group => {
        const field = group.field, meta = group.metadata, open = !closed[field];
        const selected = [...new Set([...selectedValues(activeValues, field), ...selectedValues(activeExcludes, field)])];
        const search = searches[field] || "";
        const matching = group.values.filter(value => value.value.toLowerCase().includes(search.toLowerCase()));
        const returned = search || expanded[field] ? matching : matching.slice(0, COLLAPSED_LIMIT);
        const values: {value: string; count?: number}[] = [...returned];
        // Active values remain removable even when excluded, beyond the top list,
        // or absent from a new snapshot. An absent count is not a zero count.
        for (const value of selected) if (value && !values.some(row => row.value === value)) {
          values.push({value, count: group.values.find(row => row.value === value)?.count});
        }
        const row = (value: string, events: number | undefined, missing = false) => {
          const included = activeValues.has(key(field, value)), excluded = activeExcludes.has(key(field, value));
          const label = missing ? "missing / empty" : value;
          return <div key={missing ? "missing" : `value:${value}`} className={`facet-row ${included ? "active" : ""} ${excluded ? "excluded" : ""}`} title={missing ? field === "userName" ? "No nonempty userIdentity.userName or sessionIssuer.userName" : "Missing and empty recorded values" : value}>
            <button className="facet-val facet-include" aria-label={missing ? "Include missing / empty" : undefined} aria-pressed={included} onClick={() => onPick(field, value, "include")}>{missing ? "Missing / empty" : value}</button>
            <span className="facet-count" title={events === undefined ? "Count unavailable: value is not in the returned list" : `${count(events)} events`}>{events === undefined ? <span className="facet-unknown">Count unavailable</span> : count(events)}</span>
            <button className="facet-excl" aria-label={`Exclude ${label}`} aria-pressed={excluded} title={`Exclude ${label}`} onClick={() => onPick(field, value, "exclude")}>−</button>
          </div>;
        };
        return <section key={field} className={`facet-group ${open ? "" : "facet-group--closed"} ${wrapped[field] ? "facet-group--wrapped" : ""}`} data-field={field}>
          <div className="facet-group-tools">
            <button className="facet-group-head" aria-expanded={open} onClick={() => setClosed(current => ({...current, [field]: open}))}>
              <span className="facet-caret" aria-hidden="true">{open ? "⌄" : "›"}</span><span className="facet-group-label">{group.label}</span>
              <span className="facet-presence" title={meta ? `${count(meta.presentEvents)} events with ${field === "userName" ? "a normalized user / issuer name" : "this field"} / ${count(meta.totalEvents)} matching events` : "Presence unavailable"}>{meta ? `${count(meta.presentEvents)}/${count(meta.totalEvents)}` : "—"}</span>
            </button>
            {hasSelection(field) && <button className="facet-tool" aria-label={`Clear ${group.label}`} onClick={() => clearField(field)}>Clear</button>}
            {!DEFAULT_FACET_FIELDS.includes(field) && !hasSelection(field) && <button className="facet-tool" aria-label={`Remove ${group.label} facet`} onClick={() => setShown(current => current.filter(value => value !== field))}>×</button>}
          </div>
          {search && <div className="facet-value-search">
            <span>Value search: {search}<br/>returned values only</span>
            <button className="facet-tool" aria-label={`Clear ${group.label} value search`} onClick={() => setSearches(current => ({...current, [field]: ""}))}>Clear search</button>
          </div>}
          {!meta && <p className="facet-note">Presence unavailable</p>}
          {open && <div className="facet-list">
            {field === "userName" && <p className="facet-note">Normalized userName</p>}
            {field === "result" && <p className="facet-note">errorCode or derived Success</p>}
            {!meta && <p className="facet-note">Distinct count and completeness unavailable</p>}
            <details className="facet-search">
              <summary title="Find / enter value">{meta ? meta.truncated ? `Top ${count(meta.returnedValues)} of ${count(meta.distinctValues)}` : `${count(meta.distinctValues)} distinct` : "Returned values"} · Find</summary>
              {field === "userName" && <p>Uses userIdentity.userName, falling back to sessionIssuer.userName. Same names group together across users and roles; not a verified human. Presence counts nonempty normalized names, not raw field presence.</p>}
              {meta && <p>{count(meta.returnedValues)} returned / {count(meta.distinctValues)} distinct values{meta.truncated ? " · top values only" : " · complete list"}.</p>}
              <p>Search only the returned values. Enter a full value to filter beyond this list.</p>
              <input aria-label={`Find returned ${group.label} values`} placeholder="Find or enter exact value…" value={search} onChange={event => setSearches(current => ({...current, [field]: event.target.value}))} />
              <div className="facet-exact-actions">
                <button disabled={!search} onClick={() => onPick(field, search, "include")}>Include exact value</button>
                <button disabled={!search} onClick={() => onPick(field, search, "exclude")}>Exclude exact value</button>
              </div>
              <label><input type="checkbox" aria-label={`Wrap full ${group.label} values`} checked={!!wrapped[field]} onChange={event => setWrapped(current => ({...current, [field]: event.target.checked}))} /> Wrap full values</label>
            </details>
            {search && !matching.length && <p className="facet-note">No returned value matches. This does not search omitted values.</p>}
            {values.map(value => row(value.value, value.count))}
            {!search && group.values.length > COLLAPSED_LIMIT && <button className="facet-more" onClick={() => setExpanded(current => ({...current, [field]: !current[field]}))}>{expanded[field] ? "Show fewer" : `Show all ${count(group.values.length)} returned`}</button>}
            <div className="facet-missing">{meta ? meta.missingEvents || selected.includes("") ? row("", meta.missingEvents, true) : <span className="facet-note">0 missing / empty</span> : <>Missing count unavailable{selected.includes("") && row("", undefined, true)}</>}</div>
          </div>}
        </section>;
      })}
    </div>
    <footer className="facet-footer">
      <select aria-label="Add facet" value="" onChange={event => {setShown(current => [...current, event.target.value as FilterField]);}} disabled={!available.length}>
        <option value="">+ Add facet…</option>{available.map(group => <option key={group.field} value={group.field}>{group.label}</option>)}
      </select>
      {facets.some(group => hasSelection(group.field)) && <button className="facet-more" aria-label="Clear facet selections" onClick={clearAll}>Clear facet selections</button>}
      <span>Headers: present / matching events.<br/>Rows: events with this value.</span>
    </footer>
  </aside>;
}
