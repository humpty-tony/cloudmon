import { useRef, useState } from "react";
import type { Histogram } from "../api/histogram";
import type { TimeZonePref } from "../api/settings";
import { fmtClock } from "../api/time";

interface Props {
  hist: Histogram;
  collapsed: boolean;
  timeZone: TimeZonePref;
  onToggleCollapse: () => void;
  onBrush: (from: number, to: number) => void;
}

interface HoverInfo {
  x: number;
  time: string;
  total: number;
  errors: number;
}

export function HistogramStrip({ hist, collapsed, timeZone, onToggleCollapse, onBrush }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);

  if (collapsed) {
    return (
      <div className="hist hist--collapsed">
        <button className="hist-toggle" onClick={onToggleCollapse} title="Show histogram">
          ▾ volume
        </button>
      </div>
    );
  }

  const { buckets, max } = hist;

  const bucketAtClientX = (clientX: number): number => {
    const el = ref.current;
    if (!el || buckets.length === 0) return 0;
    const r = el.getBoundingClientRect();
    const frac = Math.min(0.999, Math.max(0, (clientX - r.left) / r.width));
    return Math.floor(frac * buckets.length);
  };

  const onDown = (e: React.MouseEvent) => {
    const i = bucketAtClientX(e.clientX);
    setDrag({ x0: i, x1: i });
  };
  const onMove = (e: React.MouseEvent) => {
    const i = bucketAtClientX(e.clientX);
    if (drag) setDrag({ ...drag, x1: i });
    const b = buckets[i];
    if (b) {
      const el = ref.current!;
      setHover({
        x: e.clientX - el.getBoundingClientRect().left,
        time: fmtClock(b.start, timeZone),
        total: b.total,
        errors: b.errors,
      });
    }
  };
  const onUp = () => {
    if (drag) {
      const lo = Math.min(drag.x0, drag.x1);
      const hi = Math.max(drag.x0, drag.x1);
      if (buckets[lo] && buckets[hi]) onBrush(buckets[lo].start, buckets[hi].end);
      setDrag(null);
    }
  };

  const brushStyle = (): React.CSSProperties | undefined => {
    if (!drag || buckets.length === 0) return undefined;
    const lo = Math.min(drag.x0, drag.x1);
    const hi = Math.max(drag.x0, drag.x1);
    return { left: `${(lo / buckets.length) * 100}%`, width: `${((hi - lo + 1) / buckets.length) * 100}%` };
  };

  return (
    <div className="hist">
      <div className="review-hist-label"><span>Event volume</span><span>Drag to narrow time · errors highlighted</span></div>
      <button className="hist-collapse" onClick={onToggleCollapse} title="Hide histogram">
        ▴
      </button>
      <div
        className="hist-canvas"
        ref={ref}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => {
          setHover(null);
          if (drag) onUp();
        }}
      >
        {buckets.map((b, i) => {
          const h = max ? (b.total / max) * 100 : 0;
          const errH = b.total ? (b.errors / b.total) * h : 0;
          return (
            <div key={i} className="hist-bar" style={{ height: `${Math.max(b.total ? 4 : 0, h)}%` }}>
              {b.errors > 0 && <div className="hist-bar-err" style={{ height: `${(errH / (h || 1)) * 100}%` }} />}
            </div>
          );
        })}
        {drag && <div className="hist-brush" style={brushStyle()} />}
        {hover && !drag && (
          <div className="hist-tip" style={{ left: hover.x }}>
            <b>{hover.time}</b> · {hover.total} events
            {hover.errors > 0 && <span className="hist-tip-err"> · {hover.errors} failed</span>}
          </div>
        )}
      </div>
      <div className="review-hist-axis"><span>{hist.from ? fmtClock(hist.from, timeZone) : ""}</span><span>{hist.to ? fmtClock(hist.to, timeZone) : ""} {timeZone === "utc" ? "UTC" : "local"}</span></div>
    </div>
  );
}
