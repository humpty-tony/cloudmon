import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SourceText } from "./SourceText";

interface Props {
  title: string;
  json: string;
  onClose: () => void;
}

export function RawJsonModal({ title, json, onClose }: Props) {
  const [status, setStatus] = useState<"idle" | "ok" | "fail">("idle");
  const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    close.current?.focus();
    return ()=>previous?.focus();
  },[]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();onClose()}};
    window.addEventListener('keydown',onKey,true);
    return ()=>window.removeEventListener('keydown',onKey,true);
  },[onClose]);
  const copy = async () => {
    let ok = false;
    // Preferred path (needs a secure context + clipboard-write permission)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        ok = true;
      }
    } catch {
      ok = false;
    }
    // Fallback for sandboxed iframes / non-secure contexts where the async API is blocked
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = json;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setStatus(ok ? "ok" : "fail");
    setTimeout(() => setStatus("idle"), 1600);
  };
  // Portal to <body> so `position: fixed` escapes the row's CSS transform -
  // otherwise the overlay is contained by (and offset within) the clicked row.
  return createPortal(
    <div className="rawmodal-scrim" onClick={onClose}>
      <div className="rawmodal" role="dialog" aria-modal="true" aria-label="Raw JSON" onClick={(e) => e.stopPropagation()}>
        <div className="rawmodal-head">
          <div className="rawmodal-title">{title}</div>
          <div className="rawmodal-actions">
            <button className={`rawmodal-copy ${status === "fail" ? "fail" : ""}`} onClick={copy}>
              {status === "ok" ? "✓ Copied" : status === "fail" ? "⚠ Copy blocked" : "⧉ Copy"}
            </button>
            <button ref={close} className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close raw JSON">
              ✕
            </button>
          </div>
        </div>
        <SourceText text={json} json className="rawmodal-body" />
      </div>
    </div>,
    document.body
  );
}
