import { useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  json: string;
  onClose: () => void;
}

function highlight(json: string): string {
  const esc = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = "j-num";
      if (/^"/.test(m)) cls = /:$/.test(m) ? "j-key" : "j-str";
      else if (/true|false/.test(m)) cls = "j-bool";
      else if (/null/.test(m)) cls = "j-null";
      return `<span class="${cls}">${m}</span>`;
    }
  );
}

export function RawJsonModal({ title, json, onClose }: Props) {
  const [status, setStatus] = useState<"idle" | "ok" | "fail">("idle");
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
      <div className="rawmodal" onClick={(e) => e.stopPropagation()}>
        <div className="rawmodal-head">
          <div className="rawmodal-title">{title}</div>
          <div className="rawmodal-actions">
            <button className={`rawmodal-copy ${status === "fail" ? "fail" : ""}`} onClick={copy}>
              {status === "ok" ? "✓ Copied" : status === "fail" ? "⚠ Copy blocked" : "⧉ Copy"}
            </button>
            <button className="icon-btn" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </div>
        <pre className="rawmodal-body" dangerouslySetInnerHTML={{ __html: highlight(json) }} />
      </div>
    </div>,
    document.body
  );
}
