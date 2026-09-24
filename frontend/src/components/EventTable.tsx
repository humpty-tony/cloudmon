import {AliasBadge} from "./AliasBadge";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CloudTrailEvent, EvidenceSnapshot, FilterField, Lineage, QueryOp } from "../api/types";
import { filterFieldValue, eventUser, identityGlyph, truncateArn } from "../api/types";
import type { ColumnDef } from "../api/columns";
import type { TimeZonePref } from "../api/settings";
import { InlineDetail } from "./InlineDetail";

interface Props {
  events: CloudTrailEvent[]; // newest-first; rendered newest-on-top (index 0 = top row)
  columns: ColumnDef[];
  colWidths: Record<string, number>;
  rowHeight: number; // collapsed row height; must match CSS --row-h
  selected: CloudTrailEvent | null; // the inline-expanded row
  cursorSeq: number;
  follow: boolean;
  onSelect: (e: CloudTrailEvent) => void;
  onCursor: (seq: number) => void;
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
  onDisengageFollow: () => void;
  onReachTop: () => void;
  onResizeColumn: (key: string, px: number) => void;
  onReorderColumns?: (from: string, to: string) => void; // drag a header onto another to reorder
  onNeedMore?: () => void; // scrolled near the bottom of the loaded window
  selectedSnapshot?:EvidenceSnapshot;
  selectedRaw?: string; // lazily-fetched raw JSON for the expanded row ("" = loading)
  selectedRawError?: boolean; // the raw fetch failed (show an error instead of "loading" forever)
  selectedLineage?: Lineage | null; // assumed-role ancestry for the expanded row
  selectedLineageError?: boolean;
  onRetryDetail: () => void;
  onOpenLineage?: (seq: number) => void; // open the full lineage graph view
  loadingMore?: boolean;
  atLoadCap?: boolean;
  isSensitive: (eventName: string) => boolean; // effective set (user-tunable) → row highlight
  timeZone: TimeZonePref; // render eventTime in browser-local or UTC
}

function TimeCell({ e, tz }: { e: CloudTrailEvent; tz: TimeZonePref }) {
  const d = new Date(e.eventTime);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  const utc = tz === "utc";
  const h = utc ? d.getUTCHours() : d.getHours();
  const m = utc ? d.getUTCMinutes() : d.getMinutes();
  const s = utc ? d.getUTCSeconds() : d.getSeconds();
  const ms = utc ? d.getUTCMilliseconds() : d.getMilliseconds();
  return (
    <span className="c-time-main">
      {p(h)}:{p(m)}:{p(s)}
      <span className="c-time-ms">.{p(ms, 3)}</span>
      {utc && <span className="c-time-tz">Z</span>}
    </span>
  );
}

function IdentityCell({ e }: { e: CloudTrailEvent }) {
  const ui = e.userIdentity;
  return (
    <span className="c-ident">
      <span className={`c-ident-glyph t-${ui.type}`}>{identityGlyph(ui.type)}</span>
      <span className="c-ident-name">{eventUser(e)}</span>
      {ui.arn && <span className="c-ident-arn">{truncateArn(ui.arn, 22)}</span>}
      <AliasBadge kind="arn" value={ui.arn||""} />
    </span>
  );
}

function ResultCell({ e }: { e: CloudTrailEvent }) {
  if (e.errorCode) {
    return (
      <span className="c-result">
        <span className="dot-sev err" />
        <span className="c-result-code">{e.errorCode}</span>
      </span>
    );
  }
  return (
    <span className="c-result">
      <span className="dot-sev ok" />
      <span className="c-result-ok">Success</span>
    </span>
  );
}

// Scrolling changes the virtual range, not the contents of rows that remain
// visible. Keep those cells (including labels and pivot controls) out of the
// scroll render path. Selection, columns, density and time zone still update
// through explicit props; alias subscriptions update directly.
const EventRow = memo(function EventRow({
  event: e, className, grid, rowHeight, columns, timeZone, onSelect, onCursor, onPivot,
}: Pick<Props, "rowHeight" | "columns" | "timeZone" | "onSelect" | "onCursor" | "onPivot"> & {
  event: CloudTrailEvent;
  className: string;
  grid: string;
}) {
  return (
    <div
      className={className}
      style={{ gridTemplateColumns: grid, height: rowHeight }}
      onClick={() => {
        onSelect(e);
        onCursor(e.seq);
      }}
    >
      {columns.map((c) => {
        const rawVal = filterFieldValue(e, c.field);
        const displayValue = c.get(e);
        let content;
        if (c.key === "time") content = <TimeCell e={e} tz={timeZone} />;
        else if (c.key === "identity") content = <IdentityCell e={e} />;
        else if (c.key === "result") content = <ResultCell e={e} />;
        else content = displayValue;
        const pivotable = c.field !== "eventTime";
        return (
          <div key={c.key} className={`cell ${c.mono ? "mono" : ""} c-${c.key}`} title={displayValue}>
            <span className="cell-inner">{content}{c.key!=="identity"&&<AliasBadge field={c.field} value={rawVal}/>}</span>
            {pivotable && (
              <span className="pivot-icons">
                <button
                  className="pv"
                  title={`Filter for ${rawVal}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onPivot(c.field, rawVal, "include");
                  }}
                >
                  <span className="pv-loupe">⌕</span>
                  <span className="pv-sign">+</span>
                </button>
                <button
                  className="pv"
                  title={`Filter out ${rawVal}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onPivot(c.field, rawVal, "exclude");
                  }}
                >
                  <span className="pv-loupe">⌕</span>
                  <span className="pv-sign">−</span>
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

export const EventTable = memo(function EventTable({
  events,
  columns,
  colWidths,
  rowHeight,
  selected,
  cursorSeq,
  follow,
  onSelect,
  onCursor,
  onPivot,
  onDisengageFollow,
  onReachTop,
  onResizeColumn,
  onReorderColumns,
  onNeedMore,
  selectedSnapshot,
  selectedRaw,
  selectedRawError,
  selectedLineage,
  selectedLineageError,
  onRetryDetail,
  onOpenLineage,
  loadingMore,
  atLoadCap,
  isSensitive,
  timeZone,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const dragKey = useRef<string | null>(null); // header being dragged (reorder)
  const [overKey, setOverKey] = useState<string | null>(null); // header under the drag
  const [viewportW, setViewportW] = useState(0); // visible width → the pinned panel's fixed width
  const [viewportH, setViewportH] = useState(400);

  const {grid, minTotal} = useMemo(() => {
    const widths = columns.map((c) => colWidths[c.key] ?? c.width);
    const minTotal = widths.reduce((a, b) => a + b, 0);
    // grow-flagged columns (that the user hasn't manually resized) absorb spare
    // width via fr so text isn't cropped when there's room; everything else is
    // fixed. If NOTHING is flexible (every column pinned by a manual resize, or a
    // grow-less preset) promote the last track to 1fr so the grid always fills the
    // width - no dead right gutter (native last-column-autoexpand). minWidth:minTotal
    // on the surfaces keeps rows scrollable when there are too many columns to fit.
    const hasFlex = columns.some((c) => !colWidths[c.key] && c.grow);
    const tracks = columns.map((c, i) =>
      !colWidths[c.key] && c.grow ? `minmax(${widths[i]}px, ${c.grow}fr)` : `${widths[i]}px`
    );
    if (tracks.length && !hasFlex) {
      tracks[tracks.length - 1] = `minmax(${widths[widths.length - 1]}px, 1fr)`;
    }
    return { grid: tracks.join(" "), minTotal };
  }, [columns, colWidths]);
  const n = events.length;

  // getItemKey participates in TanStack's measurement-cache dependencies.
  // A fresh callback on each scroll render rebuilds every loaded row's layout.
  // Change it only when row identities/order can actually have changed.
  const getItemKey = useCallback((index: number) => events[index].seq, [events]);
  const getScrollElement = useCallback(() => parentRef.current, []);
  const estimateSize = useCallback(() => rowHeight, [rowHeight]);
  const rowVirtualizer = useVirtualizer({
    count: n,
    getScrollElement,
    estimateSize,
    overscan: 10,
    getItemKey,
  });

  useEffect(() => {
    rowVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight]);

  // Track the visible width so the pinned expanded panel can size to it.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => { setViewportW(el.clientWidth); setViewportH(el.clientHeight); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    if (follow) el.scrollTop = 0; // newest is at the top; following pins there
  }, [n, follow, rowHeight]);

  useEffect(() => {
    if (follow || cursorSeq < 0) return;
    if (selected && selected.seq === cursorSeq) return; // the expand effect below owns this row
    const ci = events.findIndex((e) => e.seq === cursorSeq);
    if (ci >= 0) rowVirtualizer.scrollToIndex(ci, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorSeq]);

  // When a row expands, bring its TOP into view so the detail panel opens predictably.
  // align:"start" targets the row's start offset - stable as the row grows to full
  // height - which avoids the align:"auto" re-resolve that otherwise overshoots and
  // parks the expanded panel's bottom edge at the very top of the viewport.
  useEffect(() => {
    if (!selected) return;
    const si = events.findIndex((e) => e.seq === selected.seq);
    if (si >= 0) rowVirtualizer.scrollToIndex(si, { align: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.seq]);

  const onScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    if (headRef.current) headRef.current.scrollLeft = el.scrollLeft; // sync header horizontally
    if (onNeedMore && el.scrollHeight - el.scrollTop - el.clientHeight < 600) onNeedMore();
    if (follow) {
      if (el.scrollTop > 40) onDisengageFollow();
    } else if (!selected && el.scrollTop <= 4) {
      // Resizing/expanding a detail can scroll the table back to zero. Keep an
      // open inspection paused until the user explicitly chooses Follow.
      onReachTop(); // scrolled back to the top → resume following
    }
  };

  const startResize = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    const startX = e.clientX;
    const startW = th.offsetWidth;
    const move = (ev: MouseEvent) => onResizeColumn(key, Math.max(60, startW + (ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Rows render in NORMAL FLOW between two spacer divs (not absolutely positioned)
  // so the sticky expanded panel has no absolute/transformed ancestor to fight -
  // that's what makes the pin stay put deterministically while columns scroll.
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const padTop = virtualItems.length ? virtualItems[0].start : 0;
  const padBottom = virtualItems.length ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <div className="etable">
      <div className="ethead-wrap" ref={headRef}>
        <div className="ethead" style={{ gridTemplateColumns: grid, width: "100%", minWidth: minTotal }}>
          {columns.map((c) => (
            <div
              key={c.key}
              className={`eth ${overKey === c.key ? "eth--drop" : ""}`}
              onDragOver={(e) => {
                if (dragKey.current && dragKey.current !== c.key) {
                  e.preventDefault();
                  setOverKey(c.key);
                }
              }}
              onDragLeave={() => setOverKey((o) => (o === c.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragKey.current && onReorderColumns) onReorderColumns(dragKey.current, c.key);
                dragKey.current = null;
                setOverKey(null);
              }}
            >
              <span
                className="eth-label"
                draggable={!!onReorderColumns}
                onDragStart={(e) => {
                  dragKey.current = c.key;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  dragKey.current = null;
                  setOverKey(null);
                }}
                title={onReorderColumns ? "Drag to reorder" : undefined}
              >
                {c.label}
              </span>
              <span className="eth-grip" onMouseDown={(e) => startResize(e, c.key)} />
            </div>
          ))}
        </div>
      </div>
      <div className="etbody" ref={parentRef} onScroll={onScroll}>
        {n === 0 && (
          <div className="et-empty">
            No events to show - adjust filters, widen the time range, or import a dump. Press <kbd>?</kbd> for help.
          </div>
        )}
        <div className="etbody-inner" style={{ width: "100%", minWidth: minTotal }}>
          {padTop > 0 && <div style={{ height: padTop }} aria-hidden="true" />}
          {virtualItems.map((vi) => {
            const ri = vi.index;
            const e = events[ri];
            const expanded = selected?.seq === e.seq;
            const sev = e.errorCode ? "row--err" : isSensitive(e.eventName) ? "row--sensitive" : "";
            const cls = [
              "row",
              ri % 2 === 0 ? "row--zebra" : "",
              sev,
              e.readOnly ? "row--readonly" : "",
              expanded ? "row--selected" : "",
              e.seq === cursorSeq ? "row--cursor" : "",
            ].join(" ");
            return (
              <div
                key={e.seq}
                data-index={vi.index}
                ref={rowVirtualizer.measureElement}
                className="rowwrap"
              >
                <EventRow event={e} className={cls} grid={grid} rowHeight={rowHeight}
                  columns={columns} timeZone={timeZone} onSelect={onSelect} onCursor={onCursor} onPivot={onPivot} />
                {expanded && (
                  <div className="row-expand">
                    <div className="row-expand-pin" style={{ width: viewportW || undefined }}>
                      {selectedRaw ? (
                        <InlineDetail key={e.seq} event={e} snapshot={selectedSnapshot} rawJSON={selectedRaw} fieldHeight={Math.max(84,Math.min(392,viewportH-160))} lineage={selectedLineage} lineageError={selectedLineageError} onRetry={onRetryDetail} onPivot={onPivot} onOpenLineage={onOpenLineage} />
                      ) : selectedRawError ? (
                        <div className="xd-loading" role="alert">Could not load this event. <button className="btn-ghost" onClick={onRetryDetail}>Retry event</button></div>
                      ) : (
                        <div className="xd-loading">Loading event…</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {padBottom > 0 && <div style={{ height: padBottom }} aria-hidden="true" />}
        </div>
        {loadingMore && <div className="et-foot">Loading more…</div>}
        {atLoadCap && !loadingMore && (
          <div className="et-foot">Reached the load limit - refine the filter to see more.</div>
        )}
      </div>
    </div>
  );
});
