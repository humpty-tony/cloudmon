// User-tunable settings. Pure frontend: App.tsx owns the state and persists each
// under the existing "cloudmon.*" localStorage convention (its load/save helpers).
// This module holds the types, defaults, and the derived "effective sensitive set".

import { DEFAULT_SENSITIVE_APIS } from "./sensitiveApis";

export type TimeZonePref = "local" | "utc";
export type Density = "comfortable" | "compact";

/** Add/remove delta layered over DEFAULT_SENSITIVE_APIS. Stored as a DELTA (not a
 *  frozen snapshot of the effective set) so a future catalog regeneration still
 *  delivers new default-sensitive events - only explicitly-removed ones drop out. */
export interface SensitiveOverride {
  add: string[]; // events the user marks sensitive on top of the default set
  remove: string[]; // default-sensitive events the user marks NOT sensitive
}

export const DEFAULT_SENSITIVE_OVERRIDE: SensitiveOverride = { add: [], remove: [] };
export const DEFAULT_TIMEZONE: TimeZonePref = "local";
export const DEFAULT_DENSITY: Density = "comfortable";

/** The effective sensitive set = (defaults ∪ add) \ remove. Tolerates a partial or
 *  legacy override shape (missing add/remove). */
export function effectiveSensitive(ov: SensitiveOverride | null | undefined): Set<string> {
  const s = new Set(DEFAULT_SENSITIVE_APIS);
  for (const a of ov?.add ?? []) s.add(a);
  for (const r of ov?.remove ?? []) s.delete(r);
  return s;
}

/** Is an event in the default (shipped) sensitive set? Drives the "overridden" /
 *  revert affordance in the editor. */
export function isDefaultSensitive(eventName: string): boolean {
  return DEFAULT_SENSITIVE_APIS.has(eventName);
}

/** Table row height (px) per density - MUST stay in sync with --row-h in app.css
 *  (the :root[data-density] blocks). */
export const ROW_H_BY_DENSITY: Record<Density, number> = { comfortable: 36, compact: 26 };

/** Remove every persisted "cloudmon.*" preference (the Settings → reset action).
 *  The crash log is a file on disk, not localStorage, so nothing here touches it.
 *  Caller reloads afterward so state re-initialises from defaults. */
export function resetAllPreferences(): void {
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("cloudmon.")) doomed.push(k);
  }
  for (const k of doomed) localStorage.removeItem(k);
}
