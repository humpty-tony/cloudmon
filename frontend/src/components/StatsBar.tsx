import type { CloudTrailEvent } from "../api/types";

export interface Stats {
  shown: number;
  total: number;
  errors: number;
  errorRate: number;
  principals: number;
  sources: number;
  regions: number;
  span: string;
}

export function fmtSpan(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function computeStats(events: CloudTrailEvent[], total: number): Stats {
  let errors = 0;
  const principals = new Set<string>();
  const sources = new Set<string>();
  const regions = new Set<string>();
  let minT = Infinity;
  let maxT = -Infinity;
  for (const e of events) {
    if (e.errorCode) errors++;
    const p = e.userIdentity?.arn || e.userIdentity?.userName || e.userIdentity?.principalId;
    if (p) principals.add(p);
    if (e.eventSource) sources.add(e.eventSource);
    if (e.awsRegion) regions.add(e.awsRegion);
    const t = Date.parse(e.eventTime);
    if (!isNaN(t)) {
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
  }
  return {
    shown: events.length,
    total,
    errors,
    errorRate: events.length ? (errors / events.length) * 100 : 0,
    principals: principals.size,
    sources: sources.size,
    regions: regions.size,
    span: isFinite(minT) && isFinite(maxT) && maxT > minT ? fmtSpan(maxT - minT) : "-",
  };
}

export const REDESIGN_TAG = "R6"; // bumped with the insight-header redesign

export function StatsBar({ stats }: { stats: Stats }) {
  const tiles: { key: string; label: string; value: string; sub: string; tone?: string }[] = [
    {
      key: "events",
      label: "Events",
      value: stats.shown.toLocaleString(),
      sub: stats.shown === stats.total ? "in view" : `of ${stats.total.toLocaleString()}`,
    },
    {
      key: "errors",
      label: "Errors",
      value: stats.errors.toLocaleString(),
      sub: `${stats.errorRate.toFixed(stats.errorRate >= 10 ? 0 : 1)}% fail rate`,
      tone: stats.errors > 0 ? "err" : "ok",
    },
    { key: "principals", label: "Principals", value: stats.principals.toLocaleString(), sub: "identities" },
    { key: "sources", label: "Sources", value: stats.sources.toLocaleString(), sub: "services" },
    { key: "regions", label: "Regions", value: stats.regions.toLocaleString(), sub: "AWS regions" },
    { key: "window", label: "Window", value: stats.span, sub: "time span" },
  ];
  return (
    <div className="statstrip">
      {tiles.map((t) => (
        <div key={t.key} className={`stat ${t.tone ? "stat--" + t.tone : ""}`}>
          <div className="stat-top">
            <span className="stat-label">{t.label}</span>
          </div>
          <div className="stat-value">{t.value}</div>
          <div className="stat-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
