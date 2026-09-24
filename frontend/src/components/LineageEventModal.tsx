import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FilterField, QueryOp } from "../api/types";
import { FieldTree } from "./FieldTree";
import { RawJsonModal } from "./RawJsonModal";

interface Props {
  title: string;
  json: string;
  onClose: () => void;
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
}

/** The same bounded, lossless field inspector as the event table. */
export function LineageEventModal({ title, json, onClose, onPivot }: Props) {
  const [original, setOriginal] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (original) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, original]);

  return createPortal(
    <div className="rawmodal-scrim" onClick={event => { event.stopPropagation(); onClose(); }}>
      <div className="rawmodal" role="dialog" aria-modal="true" aria-label="Lineage event" onClick={event => event.stopPropagation()}>
        <div className="rawmodal-head">
          <div className="rawmodal-title">{title}</div>
          <div className="rawmodal-actions">
            <button className="rawmodal-copy" onClick={() => setOriginal(true)}>Original JSON</button>
            <button ref={close} className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close lineage event">✕</button>
          </div>
        </div>
        <div className="lineage-event-fields">
          <FieldTree json={json} height={Math.max(112, Math.min(560, window.innerHeight * 0.65 - 80))} onPivot={onPivot} />
        </div>
      </div>
      {original && <div onClick={event => event.stopPropagation()}><RawJsonModal title={title} json={json} onClose={() => setOriginal(false)} /></div>}
    </div>, document.body
  );
}
