import {useLayoutEffect, useRef, useState} from "react";
import type {ConnectionConfig, RecoveryState} from "../api/types";
import {ConnectionScreen} from "./ConnectionScreen";
import "./sources-panel.css";

/** One entry point; existing source operations retain their consent and recovery rules. */
export function SourcesPanel({capturing, onPause, onConnect, onRestore, onRecovery, onClose}: {
  capturing: boolean;
  onPause: () => Promise<void>;
  onConnect: (config: ConnectionConfig) => Promise<void>;
  onRestore: (state: RecoveryState, resume: boolean) => Promise<void>;
  onRecovery: (state: RecoveryState) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const target = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    target?.showModal();
    return () => {target?.close(); if (previous?.isConnected) previous.focus({preventScroll: true});};
  }, []);
  const locked = busy || pausing;
  return <dialog ref={dialog} className="sources-panel" aria-modal="true" aria-labelledby="sources-heading" onCancel={event => {event.preventDefault(); if (!locked) onClose();}} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
  }}>
    <header className="sources-head"><div><h2 id="sources-heading">Sources</h2><p>Import logs, open saved evidence, or manage capture.</p></div><button className="btn-ghost" disabled={locked} onClick={onClose} aria-label="Close Sources">×</button></header>
    {capturing && <div className="sources-live"><span>Capture running · saved evidence stays local</span><button className="btn-ghost" disabled={locked} onClick={async () => {
      setPausing(true); setError("");
      try {await onPause();} catch (failure) {setError(String(failure));}
      finally {setPausing(false); setRefresh(value => value+1);}
    }}>Pause capture</button></div>}
    {error && <p className="sources-error" role="alert">{error}</p>}
    <ConnectionScreen embedded initialMode="import-dump" refresh={refresh} onBusyChange={setBusy} onRecovery={onRecovery}
      onConnect={async config => {await onConnect(config); onClose();}}
      onRestore={async (state, resume) => {await onRestore(state, resume); onClose();}} />
  </dialog>;
}
