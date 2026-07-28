import { useState } from "react";
import type { FacetGroup } from "../api/facets";
import type { FilterField } from "../api/types";

interface Props {
  facets: FacetGroup[];
  collapsed: boolean;
  activeValues: Set<string>; // "field value" of active include terms, to mark selected
  onToggleCollapse: () => void;
  onPick: (field: FilterField, value: string, op: "include" | "exclude") => void;
}

const key = (field: FilterField, value: string) => `${String(field)} ${value}`;
const COLLAPSED_LIMIT = 6; // values shown per group before "show all"

export function FacetSidebar({ facets, collapsed, activeValues, onToggleCollapse, onPick }: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isOpen = (f: string) => !closed[f];

  if (collapsed) {
    return (
      <div className="facets facets--rail">
        <button className="facet-rail-btn" onClick={onToggleCollapse} title="Expand facets">
          ⋮≡
        </button>
        {facets.slice(0, 8).map((g) => (
          <div key={String(g.field)} className="facet-rail-item" title={`${g.label} - ${g.total} values`}>
            {g.label.slice(0, 2)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="facets">
      <div className="facets-head">
        <span>Facets</span>
        <button className="icon-btn" onClick={onToggleCollapse} title="Collapse">
          ⟨
        </button>
      </div>
      <div className="facets-scroll">
        {facets.map((g) => {
          const f = String(g.field);
          const open = isOpen(f);
          const showAll = expanded[f];
          const vals = showAll ? g.values : g.values.slice(0, COLLAPSED_LIMIT);
          const more = g.values.length - COLLAPSED_LIMIT;
          return (
            <div key={f} className={`facet-group ${open ? "" : "facet-group--closed"}`}>
              <button className="facet-group-head" onClick={() => setClosed((c) => ({ ...c, [f]: open }))}>
                <span className={`facet-caret ${open ? "open" : ""}`}>▶</span>
                <span className="facet-group-label">{g.label}</span>
                <span className="facet-group-count">{g.total}</span>
              </button>
              {open && (
                <div className="facet-list">
                  {vals.map((v) => {
                    const active = activeValues.has(key(g.field, v.value));
                    return (
                      <div
                        key={v.value}
                        className={`facet-row ${active ? "active" : ""}`}
                        style={{ "--bar": `${Math.max(3, v.fraction * 100)}%` } as React.CSSProperties}
                        onClick={() => onPick(g.field, v.value, "include")}
                        title={v.value}
                      >
                        <span className="facet-val">{v.value}</span>
                        <span className="facet-count">{v.count.toLocaleString()}</span>
                        <button
                          className="facet-excl"
                          title="Exclude"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPick(g.field, v.value, "exclude");
                          }}
                        >
                          −
                        </button>
                      </div>
                    );
                  })}
                  {more > 0 && (
                    <button className="facet-more" onClick={() => setExpanded((x) => ({ ...x, [f]: !showAll }))}>
                      {showAll ? "Show less" : `Show ${more} more`}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
