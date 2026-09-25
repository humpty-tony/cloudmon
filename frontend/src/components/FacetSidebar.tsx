import { useId, useRef, useState } from "react";
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
// Display only. Filtering, selections, keys and exact-value entry keep the source literal.
const SERVICE_LABELS: Readonly<Record<string, string>> = {
  "ec2.amazonaws.com": "EC2", "s3.amazonaws.com": "S3", "iam.amazonaws.com": "IAM",
  "sts.amazonaws.com": "STS", "kms.amazonaws.com": "KMS", "lambda.amazonaws.com": "Lambda",
  "secretsmanager.amazonaws.com": "Secrets Manager", "cloudtrail.amazonaws.com": "CloudTrail",
  "monitoring.amazonaws.com": "CloudWatch", "logs.amazonaws.com": "CloudWatch Logs",
  "dynamodb.amazonaws.com": "DynamoDB", "rds.amazonaws.com": "RDS",
};
const displayValue = (field: FilterField, value: string) => field === "eventSource"
  ? Object.hasOwn(SERVICE_LABELS, value) ? SERVICE_LABELS[value] : value
  : field === "result" && value === "Success" ? "No error recorded" : value;
const matchesValue = (field: FilterField, value: string, search: string) => value.toLowerCase().includes(search) || displayValue(field, value).toLowerCase().includes(search);

export function FacetSidebar({ facets, collapsed, activeValues, onToggleCollapse, onPick, activeExcludes = NO_EXCLUDES, onClearField, onClearFacets }: Props) {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState<FilterField[]>(DEFAULT_FACET_FIELDS);
  const [fieldSearch, setFieldSearch] = useState("");
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, boolean>>({});
  const [wrapped, setWrapped] = useState<Record<string, boolean>>({});
  const query = fieldSearch.toLowerCase();
  const hasSelection = (field: FilterField) => selectedValues(activeValues, field).length + selectedValues(activeExcludes, field).length > 0;
  const matchesField = (group: FacetGroup) => `${group.label} ${group.field}`.toLowerCase().includes(query);
  const visible = facets.filter(group => shown.includes(group.field) || hasSelection(group.field));
  const matchingGroups = query ? facets.filter(group => matchesField(group) || group.values.some(value => matchesValue(group.field, value.value, query)) || hasSelection(group.field) || searches[group.field]) : visible;
  const available = facets.filter(group => !visible.includes(group));
  const clearField = (field: FilterField) => {
    if (onClearField) { onClearField(field); return; }
    // App toggles exact structured terms: wildcards, quotes and empty stay literal.
    for (const value of selectedValues(activeValues, field)) onPick(field, value, "include");
    for (const value of selectedValues(activeExcludes, field)) onPick(field, value, "exclude");
  };
  const clearAll = () => onClearFacets ? onClearFacets() : facets.forEach(group => clearField(group.field));

  return <aside className={`facets facet-selector ${collapsed ? "facets--rail" : ""}`} aria-label={collapsed ? "Facets collapsed" : "Facets"}>
    <div className="facets-head">
      <span hidden={collapsed}>Narrow activity</span>
      <button className="icon-btn facet-rail-btn" onClick={onToggleCollapse} aria-expanded={!collapsed} aria-controls={`${id}-content`} aria-label={collapsed ? "Expand facets" : "Collapse facets"} title={collapsed ? "Expand facets" : "Collapse facets"}>{collapsed ? "⇥" : "⇤"}</button>
    </div>
    {/* Keep controls mounted: collapse must retain searches, disclosures and focus. */}
    <div className="facet-content" id={`${id}-content`} hidden={collapsed}>
      <div className="facet-searchbar">
        <input ref={searchRef} aria-label="Find facet fields or returned values" aria-describedby={`${id}-search-scope`} placeholder="Find a field or value…" value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} />
        {fieldSearch && <button className="facet-tool" aria-label="Clear facet search" onClick={() => {setFieldSearch(""); searchRef.current?.focus();}}>×</button>}
      </div>
      <p className="facet-search-scope" id={`${id}-search-scope`}>Search: returned values only</p>
      <p className="facet-scope" title="Counts and bars cover every matching event in the applied query, time filters and snapshot, not loaded rows.">Counts in matching events<br/><span>Applied query · time · snapshot</span></p>
      <div className="facets-scroll">
        {query && matchingGroups.length === 0 && <p className="facet-note">No returned fields or values match. Omitted values are not searched; clear this search to enter an exact value in a group’s Details.</p>}
        {facets.map(group => {
          const field = group.field, meta = group.metadata, open = !closed[field];
          const selected = [...new Set([...selectedValues(activeValues, field), ...selectedValues(activeExcludes, field)])];
          const search = searches[field] || "";
          const matching = group.values.filter(value => matchesValue(field, value.value, search.toLowerCase()) && (!query || matchesField(group) || matchesValue(field, value.value, query)));
          const returned = search || query || expanded[field] ? matching : matching.slice(0, COLLAPSED_LIMIT);
          const values: {value: string; count?: number}[] = [...returned];
          // Selected exclusions and omitted values stay removable, never falsely zero.
          for (const value of selected) if (value && !values.some(row => row.value === value)) {
            values.push({value, count: group.values.find(row => row.value === value)?.count});
          }
          const row = (value: string, events: number | undefined, missing = false) => {
            const included = activeValues.has(key(field, value)), excluded = activeExcludes.has(key(field, value));
            const label = missing ? "Missing / empty" : displayValue(field, value);
            const title = missing ? field === "userName" ? "No nonempty userIdentity.userName or sessionIssuer.userName" : "Missing and empty recorded values"
              : field === "result" && value === "Success" ? "No error code recorded; derived filter value: Success. Not a benignness verdict." : value;
            // Never use FacetValue.fraction (max-value scale) or a loaded-row total.
            const fraction = events !== undefined && meta && meta.totalEvents > 0 ? Math.min(1, Math.max(0, events / meta.totalEvents)) : undefined;
            return <div key={missing ? "missing" : `value:${value}`} className={`facet-row ${included ? "active" : ""} ${excluded ? "excluded" : ""} ${missing || label !== value ? "facet-row--label" : ""}`} title={title}>
              {fraction !== undefined && <span className="facet-bar-track" aria-hidden="true"><span className="facet-bar" style={{width: `${fraction * 100}%`}} /></span>}
              <button className="facet-val facet-include" aria-label={missing ? "Include missing / empty" : undefined} aria-pressed={included} onClick={() => onPick(field, value, "include")}>{label}</button>
              <span className="facet-count" title={events === undefined ? "Count unavailable: value is not in the returned list" : `${count(events)} matching events`}>{events === undefined ? <span className="facet-unknown" aria-label="Count unavailable">—</span> : count(events)}</span>
              <button className="facet-excl" aria-label={`Exclude ${missing ? "missing / empty" : label}`} aria-pressed={excluded} title={`Exclude ${missing ? "missing / empty" : value}`} onClick={() => onPick(field, value, "exclude")}>−</button>
            </div>;
          };
          return <section key={field} hidden={!matchingGroups.includes(group)} className={`facet-group ${open ? "" : "facet-group--closed"} ${wrapped[field] ? "facet-group--wrapped" : ""}`} data-field={field}>
            <div className="facet-group-tools">
              <button className="facet-group-head" aria-expanded={open} aria-controls={`${id}-${field}-list`} onClick={() => setClosed(current => ({...current, [field]: open}))}>
                <span className="facet-caret" aria-hidden="true">{open ? "⌄" : "›"}</span><span className="facet-group-label">{group.label}</span>
              </button>
              <button className="facet-details-toggle" aria-label={`${group.label} details and exact value`} aria-expanded={open && !!details[field]} aria-controls={`${id}-${field}-details`} onClick={() => {setClosed(current => ({...current, [field]: false})); setDetails(current => ({...current, [field]: !open || !current[field]}));}}>Details</button>
              {hasSelection(field) && <button className="facet-tool" aria-label={`Clear ${group.label}`} onClick={event => {event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(".facet-group-head")?.focus(); clearField(field);}}>Clear</button>}
              {!DEFAULT_FACET_FIELDS.includes(field) && shown.includes(field) && !hasSelection(field) && <button className="facet-tool" aria-label={`Remove ${group.label} facet`} onClick={() => {setShown(current => current.filter(value => value !== field)); searchRef.current?.focus();}}>×</button>}
            </div>
            {search && <div className="facet-value-search">
              <span>Value search: {search}</span>
              <button className="facet-tool" aria-label={`Clear ${group.label} value search`} onClick={event => {event.currentTarget.closest("section")?.querySelector<HTMLButtonElement>(".facet-group-head")?.focus(); setSearches(current => ({...current, [field]: ""}));}}>Clear</button>
            </div>}
            <div className="facet-list" id={`${id}-${field}-list`} hidden={!open}>
              {(search || query) && !matching.length && <p className="facet-note">No returned value matches.</p>}
              {values.map(value => row(value.value, value.count))}
              {(!!meta?.missingEvents || selected.includes("")) && <div className="facet-missing">{row("", meta?.missingEvents, true)}</div>}
              {!search && !query && group.values.length > COLLAPSED_LIMIT && <div className="facet-list-actions">
                <button className="facet-more" onClick={() => setExpanded(current => ({...current, [field]: !current[field]}))}>{expanded[field] ? "Show fewer" : `Show all ${count(group.values.length)} returned`}</button>
              </div>}
              <div className="facet-search" id={`${id}-${field}-details`} hidden={!details[field]}>
                {meta ? <>
                  <p className="facet-presence">{count(meta.presentEvents)} / {count(meta.totalEvents)} events with {field === "userName" ? "a normalized user / issuer name" : "this field"}. {count(meta.missingEvents)} missing / empty.</p>
                  <p>{count(meta.returnedValues)} returned / {count(meta.distinctValues)} distinct values{meta.truncated ? ` · top ${count(meta.limit)} only; omitted values are not searched` : " · complete list"}.</p>
                </> : <p>Presence unavailable. Missing count, distinct count and completeness unavailable. Bars need a matching-event total.</p>}
                {field === "userName" && <p>Normalized userName uses userIdentity.userName, falling back to sessionIssuer.userName. Same names group together across users and roles; not a verified human. Presence counts nonempty normalized names, not raw field presence.</p>}
                {field === "result" && <p>Uses errorCode or derived Success, displayed as “No error recorded”. This is not a benignness verdict.</p>}
                {field === "eventSource" && <p>Service names are display labels only. Hover a value for its recorded eventSource; filters keep that exact identifier.</p>}
                {field === "sourceIPAddress" && <p>Recorded sourceIPAddress may be an IP address or a service name.</p>}
                <p>Search only the returned values. Enter a full literal value to filter beyond this list.</p>
                <input aria-label={`Find returned ${group.label} values`} placeholder="Find or enter exact value…" value={search} onChange={event => setSearches(current => ({...current, [field]: event.target.value}))} />
                <div className="facet-exact-actions">
                  <button disabled={!search} onClick={() => onPick(field, search, "include")}>Include exact value</button>
                  <button disabled={!search} onClick={() => onPick(field, search, "exclude")}>Exclude exact value</button>
                </div>
                <label><input type="checkbox" aria-label={`Wrap full ${group.label} values`} checked={!!wrapped[field]} onChange={event => setWrapped(current => ({...current, [field]: event.target.checked}))} /> Wrap full values</label>
              </div>
            </div>
          </section>;
        })}
      </div>
      <footer className="facet-footer">
        <select aria-label="Add facet" value="" onChange={event => {setShown(current => [...current, event.target.value as FilterField]); setFieldSearch("");}} disabled={!available.length}>
          <option value="">+ Choose facets…</option>{available.map(group => <option key={group.field} value={group.field}>{group.label}</option>)}
        </select>
        {facets.some(group => hasSelection(group.field)) && <button className="facet-more" aria-label="Clear facet selections" onClick={() => {clearAll(); searchRef.current?.focus();}}>Clear facet selections</button>}
      </footer>
    </div>
  </aside>;
}
