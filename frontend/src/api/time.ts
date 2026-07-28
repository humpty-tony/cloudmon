// Time formatting that honors the UTC/local preference (Settings → Display), so the
// histogram tooltip and time-range chips agree with the table's time column.

import type { TimeZonePref } from "./settings";

/** Clock time (HH:MM:SS) - histogram hover + brush chips. */
export function fmtClock(ms: number, tz: TimeZonePref): string {
  const d = new Date(ms);
  const opts: Intl.DateTimeFormatOptions = tz === "utc" ? { timeZone: "UTC", hour12: false } : { hour12: false };
  return d.toLocaleTimeString([], opts) + (tz === "utc" ? " UTC" : "");
}

/** Short date+time - time-range chips. */
export function fmtStamp(ms: number, tz: TimeZonePref): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  if (tz === "utc") opts.timeZone = "UTC";
  return new Date(ms).toLocaleString([], opts) + (tz === "utc" ? " UTC" : "");
}
