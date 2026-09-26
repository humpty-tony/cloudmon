import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspaceActive } from "./WorkspaceActivity";
import { COLUMNS, COLUMN_BY_KEY } from "../api/columns";
import type { Preset } from "../api/presets";

interface Props {
  compact?: boolean;
  capturing: boolean;
  follow: boolean;
  live: boolean;
  streaming: boolean; // false when viewing an imported file
  shown: number;
  total: number;
  presetKey: string;
  presets: Preset[];
  errorsOnly: boolean;
  hideReadOnly: boolean;
  sensitiveOnly: boolean;
  visibleCols: string[];
  onToggleCapture: () => void;
  onClear: () => void;
  onToggleFollow: () => void;
  onPreset: (key: string) => void;
  onSavePreset: () => void;
  onDeletePreset: (key: string) => void;
  onToggleErrors: () => void;
  onToggleReadOnly: () => void;
  onToggleSensitive: () => void;
  onToggleColumn: (key: string) => void;
  onReorderColumns: (from: string, to: string) => void;
  onOpenPalette: () => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  onTimeRange: (from: number, to: number) => void;
  onClearTime: () => void;
}

const TIME_PRESETS: [string, number][] = [
  ["Last 5m", 5],
  ["Last 15m", 15],
  ["Last 1h", 60],
  ["Last 6h", 360],
  ["Last 24h", 1440],
];

const TIME_UNITS: { key: string; label: string; ms: number }[] = [
  { key: "m", label: "minutes", ms: 60_000 },
  { key: "h", label: "hours", ms: 3_600_000 },
  { key: "d", label: "days", ms: 86_400_000 },
];

type Pos = { left?: number; right?: number; top: number };

// Portal-based popover: the menu renders into document.body with fixed positioning
// so it can never be clipped by the toolbar's overflow or trapped under sibling panels.
export function Popover({
  label,
  active,
  menuClass,
  align = "left",
  children,
}: {
  label: React.ReactNode;
  active?: boolean;
  menuClass?: string;
  align?: "left" | "right";
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const workspaceActive = useWorkspaceActive();
  useLayoutEffect(() => { if (!workspaceActive) setOpen(false); }, [workspaceActive]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<Pos>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos(align === "right" ? { right: window.innerWidth - r.right, top: r.bottom + 6 } : { left: r.left, top: r.bottom + 6 });
    }
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); btnRef.current?.focus();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="pop">
      <button ref={btnRef} aria-expanded={open} className={`tb-btn ${open || active ? "active" : ""}`} onClick={() => setOpen((v) => !v)}>
        {label} <span className="caret">▾</span>
      </button>
      {open && workspaceActive &&
        createPortal(
          <>
            <div className="pop-backdrop" onClick={close} />
            <div
              className={`pop-menu ${menuClass || ""}`}
              style={{ position: "fixed", top: pos.top, left: pos.left ?? "auto", right: pos.right ?? "auto" }}
            >
              {children(close)}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

function TimeRangePopover({ onApply, onClear }: { onApply: (f: number, t: number) => void; onClear: () => void }) {
  const [n, setN] = useState("30");
  const [unit, setUnit] = useState("m");
  return (
    <Popover label={<>⧖ Time</>} menuClass="timemenu">
      {(close) => {
        const preset = (mins: number) => {
          const now = Date.now();
          onApply(now - mins * 60000, now);
          close();
        };
        const applyCustom = () => {
          const num = parseInt(n, 10);
          const u = TIME_UNITS.find((x) => x.key === unit);
          if (isNaN(num) || num <= 0 || !u) return;
          const now = Date.now();
          onApply(now - num * u.ms, now);
          close();
        };
        return (
          <>
            <div className="menu-label">Quick ranges</div>
            <div className="time-presets">
              {TIME_PRESETS.map(([label, mins]) => (
                <button key={label} className="time-preset" onClick={() => preset(mins)}>
                  {label}
                </button>
              ))}
              <button className="time-preset" onClick={() => { onClear(); close(); }}>
                All time
              </button>
            </div>
            <div className="menu-divider" />
            <div className="menu-label">Custom - last…</div>
            <div className="time-custom">
              <input className="time-num" type="number" min="1" value={n} onChange={(e) => setN(e.target.value)} />
              <select className="time-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {TIME_UNITS.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </select>
              <button className="btn-primary btn-sm" onClick={applyCustom}>
                Apply
              </button>
            </div>
          </>
        );
      }}
    </Popover>
  );
}

// One column row: the ⠿ grip is the ONLY drag handle; clicking the name toggles
// the column on/off. The whole row is a drop target for reordering.
function ColItem({
  col,
  shown,
  isOver,
  dragKey,
  setOver,
  onToggle,
  onReorder,
}: {
  col: (typeof COLUMNS)[number];
  shown: boolean;
  isOver: boolean;
  dragKey: React.MutableRefObject<string | null>;
  setOver: (k: string | null) => void;
  onToggle: (key: string) => void;
  onReorder: (from: string, to: string) => void;
}) {
  return (
    <div
      className={`col-item ${shown ? "on" : "off"} ${isOver ? "col-item--over" : ""}`}
      onDragOver={(e) => {
        if (dragKey.current && dragKey.current !== col.key) {
          e.preventDefault();
          setOver(col.key);
        }
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        if (dragKey.current) onReorder(dragKey.current, col.key);
        dragKey.current = null;
        setOver(null);
      }}
    >
      <span
        className="col-grip"
        draggable
        title="Drag to reorder"
        onDragStart={() => (dragKey.current = col.key)}
        onDragEnd={() => {
          dragKey.current = null;
          setOver(null);
        }}
      >
        ⠿
      </span>
      <button className="col-name" onClick={() => onToggle(col.key)} title={shown ? "Hide column" : "Show column"}>
        <span className="col-check">{shown ? "✓" : ""}</span>
        <span className="col-label">{col.label}</span>
        <span className="menu-fld">{String(col.field)}</span>
      </button>
    </div>
  );
}

// Columns menu, in visibleCols order (so it mirrors the results). Grip = drag to
// reorder; click the name to show/hide. Hidden columns can be dragged in too.
export function ColumnsMenu({
  visibleCols,
  onToggleColumn,
  onReorderColumns,
}: {
  visibleCols: string[];
  onToggleColumn: (key: string) => void;
  onReorderColumns: (from: string, to: string) => void;
}) {
  const dragKey = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const visible = visibleCols.map((k) => COLUMN_BY_KEY[k]).filter(Boolean);
  const hidden = COLUMNS.filter((c) => !visibleCols.includes(c.key));
  const item = (c: (typeof COLUMNS)[number], shown: boolean) => (
    <ColItem
      key={c.key}
      col={c}
      shown={shown}
      isOver={over === c.key}
      dragKey={dragKey}
      setOver={setOver}
      onToggle={onToggleColumn}
      onReorder={onReorderColumns}
    />
  );
  return (
    <>
      <div className="menu-label">Shown - grip to reorder, click to hide</div>
      {visible.map((c) => item(c, true))}
      {hidden.length > 0 && (
        <>
          <div className="menu-divider" />
          <div className="menu-label">Hidden - click to show, or drag in</div>
          {hidden.map((c) => item(c, false))}
        </>
      )}
    </>
  );
}

export function Toolbar(p: Props) {
  const isCustom = (k: string) => k.startsWith("custom-");
  return (
    <div className={`toolbar ${p.compact ? "toolbar--review" : ""}`}>
      <div className="toolbar-scope" role="group" aria-label="Search filters">
      {p.streaming && (
        <>
          <button
            className={`tb-btn ${p.capturing ? "cap-live" : "cap-paused"}`}
            onClick={p.onToggleCapture}
            title={p.capturing ? "Capturing - click to pause" : "Paused - click to capture"}
          >
            {p.capturing ? "❚❚ Pause" : "▶ Capture"}
          </button>
          <button className="tb-btn" onClick={p.onClear}>
            Clear
          </button>
          <button className={`tb-btn ${p.follow ? "active" : ""}`} onClick={p.onToggleFollow} title="Follow live tail">
            ⤒ Follow
          </button>
          <span className="tb-sep" />
        </>
      )}

      {p.compact ? <Popover label="Quick filters" active={p.errorsOnly || p.hideReadOnly || p.sensitiveOnly}>
        {() => <div className="review-lenses">
      <button className={`tb-btn ${p.errorsOnly ? "active sev-err" : ""}`} onClick={p.onToggleErrors}>
        Errors only
      </button>
      <button className={`tb-btn ${p.hideReadOnly ? "active" : ""}`} onClick={p.onToggleReadOnly}>
        Hide read-only
      </button>
      <button className={`tb-btn ${p.sensitiveOnly ? "active sev-warn" : ""}`} onClick={p.onToggleSensitive}>
        Sensitive only
      </button>
        </div>}
      </Popover> : <>
      <button className={`tb-btn ${p.errorsOnly ? "active sev-err" : ""}`} onClick={p.onToggleErrors}>
        Errors only
      </button>
      <button className={`tb-btn ${p.hideReadOnly ? "active" : ""}`} onClick={p.onToggleReadOnly}>
        Hide read-only
      </button>
      <button className={`tb-btn ${p.sensitiveOnly ? "active sev-warn" : ""}`} onClick={p.onToggleSensitive}>
        Sensitive only
      </button>
      </>}

      <span className="tb-sep" />

      <TimeRangePopover onApply={p.onTimeRange} onClear={p.onClearTime} />
      </div>
      <div className="toolbar-display" role="group" aria-label="Display options">

      <Popover label="Column layout">
        {(close) => (
          <>
            {p.presets.map((pr) => (
              <div key={pr.key} className={`menu-item ${pr.key === p.presetKey ? "on" : ""}`}>
                <button className="menu-item-main" onClick={() => { p.onPreset(pr.key); close(); }}>
                  <span className="menu-check">{pr.key === p.presetKey ? "✓" : ""}</span>
                  {pr.label}
                </button>
                {isCustom(pr.key) && (
                  <button className="menu-del" title="Delete preset" onClick={() => p.onDeletePreset(pr.key)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            <div className="menu-divider" />
            <button className="menu-item menu-action" onClick={() => { p.onSavePreset(); close(); }}>
              ＋ Save current columns as preset…
            </button>
          </>
        )}
      </Popover>

      <Popover label="Columns" menuClass="colmenu">
        {() => (
          <ColumnsMenu
            visibleCols={p.visibleCols}
            onToggleColumn={p.onToggleColumn}
            onReorderColumns={p.onReorderColumns}
          />
        )}
      </Popover>

      </div>
      <div className="tb-right" hidden={p.compact}>
        <button className="tb-btn subtle" onClick={p.onOpenSettings} title="Settings">
          ⚙
        </button>
        <button className="tb-btn subtle" onClick={p.onOpenHelp} title="Help (F1)">
          ?
        </button>
        <button className="tb-btn subtle" onClick={p.onOpenPalette} title="Command palette (Ctrl+K)">
          <kbd>Ctrl K</kbd>
        </button>
        <span className="tb-count">
          <b>{p.shown.toLocaleString()}</b>
          {p.shown !== p.total && <span className="tb-count-of"> of {p.total.toLocaleString()}</span>} events
        </span>
      </div>
    </div>
  );
}
