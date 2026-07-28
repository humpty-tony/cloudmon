import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}

export function CommandPalette({ open, commands, onClose }: Props) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setI(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(s));
  }, [q, commands]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setI((v) => Math.min(filtered.length - 1, v + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setI((v) => Math.max(0, v - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[i]?.run();
      onClose();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="cmdk-scrim" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={onKey}
          placeholder="Type a command…"
          spellCheck={false}
        />
        <div className="cmdk-list">
          {filtered.map((c, idx) => (
            <button
              key={c.id}
              className={`cmdk-item ${idx === i ? "active" : ""}`}
              onMouseEnter={() => setI(idx)}
              onClick={() => {
                c.run();
                onClose();
              }}
            >
              <span>{c.label}</span>
              {c.hint && <span className="cmdk-hint">{c.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && <div className="cmdk-empty">No matching command</div>}
        </div>
      </div>
    </div>
  );
}
