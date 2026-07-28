// Time-volume histogram buckets. Success/normal vs errored counts per bucket,
// bucket width auto-chosen from the visible time span.

import type { CloudTrailEvent } from "./types";

export interface Bucket {
  start: number; // epoch ms
  end: number;
  total: number;
  errors: number;
}

const NICE_STEPS_MS = [
  1_000, 5_000, 10_000, 30_000, 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000,
];

export function pickStep(spanMs: number, targetBuckets = 60): number {
  const ideal = spanMs / targetBuckets;
  for (const s of NICE_STEPS_MS) if (s >= ideal) return s;
  return NICE_STEPS_MS[NICE_STEPS_MS.length - 1];
}

export interface Histogram {
  buckets: Bucket[];
  step: number;
  from: number;
  to: number;
  max: number; // max total across buckets (for scaling)
}

export function computeHistogram(events: CloudTrailEvent[], now: number): Histogram {
  if (events.length === 0) {
    return { buckets: [], step: 60_000, from: now, to: now, max: 0 };
  }
  let min = Infinity;
  let max = -Infinity;
  let anyValid = false;
  for (const e of events) {
    const t = Date.parse(e.eventTime);
    if (isNaN(t)) continue; // ignore unparseable timestamps (never index buckets[NaN])
    anyValid = true;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!anyValid) return { buckets: [], step: 60_000, from: now, to: now, max: 0 };
  max = Math.max(max, now); // extend to "now" so the live edge is visible
  const span = Math.max(max - min, 1000);
  const step = pickStep(span);
  const from = Math.floor(min / step) * step;
  const to = Math.ceil(max / step) * step;
  const n = Math.max(1, Math.round((to - from) / step));
  const buckets: Bucket[] = Array.from({ length: n }, (_, i) => ({
    start: from + i * step,
    end: from + (i + 1) * step,
    total: 0,
    errors: 0,
  }));
  for (const e of events) {
    const t = Date.parse(e.eventTime);
    if (isNaN(t)) continue;
    let idx = Math.floor((t - from) / step);
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    buckets[idx].total++;
    if (e.errorCode) buckets[idx].errors++;
  }
  const maxTotal = buckets.reduce((m, b) => Math.max(m, b.total), 0);
  return { buckets, step, from, to, max: maxTotal };
}
