import {AliasSettings} from "./AliasSettings";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_SENSITIVE_APIS, SENSITIVE_INFO, type SensitiveInfo } from "../api/sensitiveApis";
import {
  effectiveSensitive,
  isDefaultSensitive,
  type Density,
  type SensitiveOverride,
  type TimeZonePref,
} from "../api/settings";
import { THEMES } from "../api/themes";

interface Props {
  onClose: () => void;
  // Sensitivity
  override: SensitiveOverride;
  onOverride: (next: SensitiveOverride) => void;
  // Display
  theme: string;
  onTheme: (key: string) => void;
  density: Density;
  onDensity: (d: Density) => void;
  timeZone: TimeZonePref;
  onTimeZone: (t: TimeZonePref) => void;
  // General
  onResetAll: () => void;
}

const TABS = [
  { key: "sensitivity", label: "Sensitive actions" },
  { key: "display", label: "Display" },
  { key: "aliases", label: "Personal labels" },
  { key: "general", label: "General" },
];

const uniq = (a: string[]) => [...new Set(a)];

// ---- Sensitivity editor -----------------------------------------------------

function SevPill({ sev }: { sev: SensitiveInfo["severity"] }) {
  return <span className={`set-sev sev-${sev}`}>{sev}</span>;
}

function SensitivityTab({ override, onOverride }: { override: SensitiveOverride; onOverride: (n: SensitiveOverride) => void }) {
  const [q, setQ] = useState("");
  const [sevFilter, setSevFilter] = useState<"all" | "high" | "medium">("all");
  const [groupBy, setGroupBy] = useState<"category" | "severity">("category");
  const [addText, setAddText] = useState("");

  const effective = useMemo(() => effectiveSensitive(override), [override]);
  const catalog = useMemo(() => Object.entries(SENSITIVE_INFO), []);
  // Custom entries: user-added events not in the shipped catalog.
  const custom = useMemo(() => override.add.filter((n) => !SENSITIVE_INFO[n]), [override.add]);
  // Count by membership (not raw array length) so baseline + added − removed always
  // equals effective.size, even for a stale/legacy override with wrong-side entries.
  const addedN = useMemo(() => override.add.filter((n) => !DEFAULT_SENSITIVE_APIS.has(n)).length, [override.add]);
  const removedN = useMemo(() => override.remove.filter((n) => DEFAULT_SENSITIVE_APIS.has(n)).length, [override.remove]);

  const toggle = (name: string) => {
    const on = effective.has(name);
    const def = isDefaultSensitive(name);
    let add = override.add;
    let remove = override.remove;
    if (on) {
      add = add.filter((a) => a !== name);
      if (def) remove = uniq([...remove, name]);
    } else {
      remove = remove.filter((r) => r !== name);
      if (!def) add = uniq([...add, name]);
    }
    onOverride({ add, remove });
  };
  const revert = (name: string) => onOverride({ add: override.add.filter((a) => a !== name), remove: override.remove.filter((r) => r !== name) });
  const addByName = () => {
    const name = addText.trim();
    if (!name) return;
    if (isDefaultSensitive(name)) onOverride({ add: override.add, remove: override.remove.filter((r) => r !== name) });
    else onOverride({ add: uniq([...override.add, name]), remove: override.remove });
    setAddText("");
  };

  const needle = q.trim().toLowerCase();
  const rows = catalog.filter(([name, info]) => {
    if (sevFilter !== "all" && info.severity !== sevFilter) return false;
    if (!needle) return true;
    return (
      name.toLowerCase().includes(needle) ||
      info.service.toLowerCase().includes(needle) ||
      info.category.toLowerCase().includes(needle) ||
      (info.note || "").toLowerCase().includes(needle)
    );
  });

  // group
  const groups = new Map<string, [string, SensitiveInfo][]>();
  for (const [name, info] of rows) {
    const g = groupBy === "category" ? info.category : info.severity;
    (groups.get(g) || groups.set(g, []).get(g)!).push([name, info]);
  }
  const groupKeys = [...groups.keys()].sort();

  const overridden = (name: string) => override.add.includes(name) || override.remove.includes(name);

  return (
    <>
      <div className="set-tally">
        <span>
          baseline <b>{DEFAULT_SENSITIVE_APIS.size}</b>
          {addedN > 0 && <> · +{addedN} added</>}
          {removedN > 0 && <> · −{removedN} removed</>}
          {" = "}
          <b>{effective.size}</b> effective
        </span>
        {(override.add.length > 0 || override.remove.length > 0) && (
          <button className="set-link" onClick={() => onOverride({ add: [], remove: [] })}>
            Reset to defaults
          </button>
        )}
      </div>

      <div className="set-toolbar">
        <input className="set-search" placeholder="Search event, service, category, or why…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="set-seg">
          {(["all", "high", "medium"] as const).map((s) => (
            <button key={s} className={sevFilter === s ? "on" : ""} onClick={() => setSevFilter(s)}>{s}</button>
          ))}
        </div>
        <div className="set-seg">
          {(["category", "severity"] as const).map((g) => (
            <button key={g} className={groupBy === g ? "on" : ""} onClick={() => setGroupBy(g)}>by {g}</button>
          ))}
        </div>
      </div>

      <div className="set-add">
        <input
          className="set-search"
          placeholder="Add an event by name (e.g. a new AWS API not in the catalog)…"
          value={addText}
          onChange={(e) => setAddText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addByName()}
        />
        <button className="btn-primary btn-sm" onClick={addByName} disabled={!addText.trim()}>Add</button>
      </div>

      <div className="set-list">
        {custom.length > 0 && (
          <div className="set-sec">
            <div className="set-sec-head">Custom - not in the shipped catalog</div>
            {custom.map((name) => (
              <div key={name} className="set-row custom">
                <button className={`set-toggle on`} onClick={() => toggle(name)} title="Remove from sensitive" aria-pressed={true} />
                <span className="set-ev">{name}</span>
                <span className="set-tag">custom</span>
                <span className="set-note">Added by you.</span>
                <button className="set-del" title="Delete custom event" onClick={() => onOverride({ add: override.add.filter((a) => a !== name), remove: override.remove })}>✕</button>
              </div>
            ))}
          </div>
        )}

        {groupKeys.map((g) => (
          <div key={g} className="set-sec">
            <div className="set-sec-head">{g} <span className="set-sec-count">{groups.get(g)!.length}</span></div>
            {groups.get(g)!.map(([name, info]) => {
              const on = effective.has(name);
              return (
                <div key={name} className={`set-row ${on ? "" : "off"}`}>
                  <button className={`set-toggle ${on ? "on" : ""}`} onClick={() => toggle(name)} aria-pressed={on} title={on ? "Sensitive - click to unflag" : "Not sensitive - click to flag"} />
                  <span className="set-ev">{name}</span>
                  <span className="set-tag">{info.service}</span>
                  <span className="set-cat">{info.category}</span>
                  <SevPill sev={info.severity} />
                  <span className="set-note" title={info.note}>{info.note}</span>
                  {overridden(name) && (
                    <button className="set-revert" title="Revert to default" onClick={() => revert(name)}>↺</button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {groupKeys.length === 0 && custom.length === 0 && <div className="set-empty">No events match “{q}”.</div>}
      </div>

      <p className="set-foot-note">
        Overrides key on <b>eventName</b> only, so a name used by two services (e.g. <code>CreateUser</code> in IAM and Identity Store) is one entry - it can’t be split per-service. Changes apply to both the “Sensitive only” filter and the row highlight.
      </p>
    </>
  );
}

// ---- Display ----------------------------------------------------------------

function DisplayTab({ theme, onTheme, density, onDensity, timeZone, onTimeZone }: Pick<Props, "theme" | "onTheme" | "density" | "onDensity" | "timeZone" | "onTimeZone">) {
  return (
    <div className="set-fields">
      <div className="set-field">
        <div className="set-field-head">
          <div className="set-field-name">Theme</div>
          <div className="set-field-desc">Color scheme for the whole app.</div>
        </div>
        <div className="set-themes">
          {THEMES.map((t) => (
            <button key={t.key} className={`set-theme ${theme === t.key ? "on" : ""}`} onClick={() => onTheme(t.key)}>
              <span className={`theme-swatch swatch-${t.key}`} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="set-field">
        <div className="set-field-head">
          <div className="set-field-name">Row density</div>
          <div className="set-field-desc">Compact fits more events per screen for flood-scanning.</div>
        </div>
        <div className="set-seg wide">
          {(["comfortable", "compact"] as Density[]).map((d) => (
            <button key={d} className={density === d ? "on" : ""} onClick={() => onDensity(d)}>{d}</button>
          ))}
        </div>
      </div>

      <div className="set-field">
        <div className="set-field-head">
          <div className="set-field-name">Timestamps</div>
          <div className="set-field-desc">CloudTrail records <code>eventTime</code> in UTC - match it for IR timelines and cross-log correlation.</div>
        </div>
        <div className="set-seg wide">
          {(["local", "utc"] as TimeZonePref[]).map((t) => (
            <button key={t} className={timeZone === t ? "on" : ""} onClick={() => onTimeZone(t)}>{t === "local" ? "Local" : "UTC"}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- General ----------------------------------------------------------------

function GeneralTab({ onResetAll }: { onResetAll: () => void }) {
  return (
    <div className="set-fields">
      <div className="set-field">
        <div className="set-field-head">
          <div className="set-field-name">Preferences storage</div>
          <div className="set-field-desc">All settings are stored locally in this app’s data - nothing leaves your machine, and they persist across updates.</div>
        </div>
      </div>
      <div className="set-field danger">
        <div className="set-field-head">
          <div className="set-field-name">Reset all preferences</div>
          <div className="set-field-desc">Clears every saved setting (sensitive overrides, theme, columns, layout, filters, personal labels) and reloads. Your imported data is not touched.</div>
        </div>
        <button
          className="set-danger-btn"
          onClick={() => {
            if (window.confirm("Reset ALL CloudMon preferences to defaults and reload? Imported events are not affected.")) onResetAll();
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

export function SettingsModal(p: Props) {
  const [tab, setTab] = useState("sensitivity");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.onClose]);
  return createPortal(
    <div className="settings-scrim" onClick={p.onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">Settings</span>
          <button className="icon-btn" onClick={p.onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav">
            {TABS.map((t) => (
              <button key={t.key} className={`settings-navitem ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {tab === "sensitivity" && <SensitivityTab override={p.override} onOverride={p.onOverride} />}
            {tab === "display" && <DisplayTab theme={p.theme} onTheme={p.onTheme} density={p.density} onDensity={p.onDensity} timeZone={p.timeZone} onTimeZone={p.onTimeZone} />}
            {tab === "aliases" && <AliasSettings />}
            {tab === "general" && <GeneralTab onResetAll={p.onResetAll} />}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
