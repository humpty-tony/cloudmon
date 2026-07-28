// Regenerates frontend/src/api/sensitiveApis.ts from the curated catalog in
// scripts/sensitive-events.json (the adversarially-reviewed classification of
// security-relevant CloudTrail events across all AWS service domains).
//
//   node scripts/gen-sensitive.mjs
//
// The catalog carries every genuinely security-relevant event; the emitted
// DEFAULT_SENSITIVE_APIS set is every event at HIGH or MEDIUM severity (rule:
// severity !== "low"). It's the DEFAULT — the user can add/remove events in
// Settings (a persisted delta), so this stays the baseline, not the final word.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "sensitive-events.json");
const DST = join(here, "..", "frontend", "src", "api", "sensitiveApis.ts");

const events = JSON.parse(readFileSync(SRC, "utf8"));
const sevRank = { high: 3, medium: 2, low: 1 };

// Dedup by eventName (an event can appear under multiple services). Keep the most
// severe entry; badge it by default if ANY of its entries flags it.
const byName = new Map();
for (const e of events) {
  const cur = byName.get(e.event);
  if (!cur) {
    byName.set(e.event, { ...e, defaultFlag: !!e.defaultFlag });
  } else {
    cur.defaultFlag = cur.defaultFlag || !!e.defaultFlag;
    if ((sevRank[e.severity] || 0) > (sevRank[cur.severity] || 0)) {
      cur.severity = e.severity; cur.category = e.category; cur.note = e.note; cur.service = e.service;
    }
  }
}

// "Sensitive" = every genuinely security-relevant event EXCEPT the low-severity
// recon noise (Describe*/List*/Get* floods). This is the analyst's manual filter,
// so we err toward inclusion: high + medium severity (GetSecretValue, AssumeRole,
// CreateUser, …), not just the "always-alert" defaultFlag subset.
const flagged = [...byName.values()].filter((e) => e.severity !== "low").sort((a, b) =>
  a.service === b.service ? a.event.localeCompare(b.event) : a.service.localeCompare(b.service)
);

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const setLines = flagged.map((e) => `  "${esc(e.event)}",`).join("\n");
const infoLines = flagged
  .map((e) => `  "${esc(e.event)}": { service: "${esc(e.service)}", category: "${esc(e.category)}", severity: "${e.severity}", defaultFlag: ${!!e.defaultFlag}, note: "${esc(e.note || "")}" },`)
  .join("\n");

const file = `// Sensitive CloudTrail events — the DEFAULT set behind the "Sensitive only"
// filter and the row highlight. Curated from a per-service classification (10 AWS
// domains): every security-relevant event at HIGH or MEDIUM severity (rule:
// severity !== "low" — GetSecretValue, AssumeRole, CreateUser, StopLogging, …).
// Low-severity recon reads (Describe*/List*/Get* floods) are excluded.
//
// This is the BASELINE. The user tunes it in Settings (see api/settings.ts:
// effectiveSensitive), which layers a persisted add/remove delta on top — so the
// app reads the EFFECTIVE set, and DEFAULT_SENSITIVE_APIS/isSensitive are only the
// default. SENSITIVE_INFO powers the editor rows (service/category/severity/why).
//
// GENERATED — edit scripts/sensitive-events.json and run scripts/gen-sensitive.mjs.

export interface SensitiveInfo {
  service: string;
  category: string; // credential-access, privilege-escalation, persistence, defense-evasion, discovery, lateral-movement, exfiltration, impact, data-access
  severity: "high" | "medium" | "low";
  defaultFlag: boolean; // catalog metadata (the tighter "always warrants a look" subset); not used for badging
  note: string; // why it's sensitive / the context that makes it matter
}

export const DEFAULT_SENSITIVE_APIS = new Set<string>([
${setLines}
]);

// Per-event detail (service, category, severity, and the "why") — powers the
// Settings sensitive-events editor and hover tooltips.
export const SENSITIVE_INFO: Record<string, SensitiveInfo> = {
${infoLines}
};

/** Default-set membership (baseline). The app uses the user's EFFECTIVE set
 *  (api/settings.ts effectiveSensitive) instead; this is the fallback/default. */
export function isSensitive(eventName: string): boolean {
  return DEFAULT_SENSITIVE_APIS.has(eventName);
}

/** The "why this is flagged" note for a sensitive event, for hover tooltips. */
export function sensitiveNote(eventName: string): string | undefined {
  return SENSITIVE_INFO[eventName]?.note;
}
`;

writeFileSync(DST, file);
console.error(`wrote ${DST} — ${flagged.length} badge events from ${events.length} catalog entries`);
