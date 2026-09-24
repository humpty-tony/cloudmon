import type { RecoveryState, SavedCapture } from "../api/types";

export function removalPrompt(capture: SavedCapture): string {
  return capture.infra.owned
    ? `Remove CloudMon's rule and queue in ${capture.infra.account} / ${capture.infra.region}? Unread queued messages will be lost. Saved local evidence and your CloudTrail trail will remain.`
    : "Disconnect this queue? CloudMon will stop consuming it. The queue and saved evidence will remain.";
}

export function CaptureDescription({ capture }: { capture: SavedCapture }) {
  const infra = capture.infra;
  return <>
    <div className="recovery-identity">{infra.account} · {infra.region} · profile {capture.config.profile || "default"}</div>
    <details className="recovery-resources">
      <summary>Resource identifiers</summary>
      <div>Queue: <code>{infra.queueUrl || infra.queueName}</code></div>
      {infra.ruleName && <div>Rule: <code>{infra.ruleArn || infra.ruleName}</code></div>}
    </details>
    <p>{infra.owned
      ? "Closing CloudMon pauses consumption. The rule and queue remain in AWS and can incur charges. Queued messages expire after the retention period (4 days by default)."
      : "Closing CloudMon pauses consumption. This existing queue remains in AWS; its configured retention period still applies."}</p>
    {capture.phase !== "ready" && <p className="recovery-warning">{capture.phase === "provisioning" ? "Setup was interrupted." : "Cleanup is incomplete."} Remove the retained resources before creating another capture.</p>}
  </>;
}

export function RecoveryCard({ state, busy, onRestore, onRemove }: {
  state: RecoveryState;
  busy: boolean;
  onRestore: (resume: boolean) => void;
  onRemove: () => void;
}) {
  const { evidence, capture, captureError } = state;
  if (!evidence.events && !capture && !captureError) return null;
  return <section className="recovery-card" aria-label="Saved session">
    <div className="recovery-heading"><h2>Pick up where you left off</h2><span>Saved on this device</span></div>
    <div className="recovery-counts"><strong>{evidence.events.toLocaleString()}</strong> {evidence.events === 1 ? "event" : "events"} · {evidence.observations.toLocaleString()} source observations</div>
    {(evidence.variantEvents > 0 || evidence.lossy > 0) && <p>{evidence.variantEvents.toLocaleString()} events with different source hashes · {evidence.lossy.toLocaleString()} lossy CSV observations</p>}
    {capture && <div className="recovery-capture"><h3>{state.active ? "Capture is running" : "Retained capture"}</h3><CaptureDescription capture={capture} /></div>}
    {captureError && <p className="recovery-warning" role="alert">Saved capture could not be read: {captureError}. Its recovery record has been kept; new capture is blocked.</p>}
    <div className="recovery-actions">
      {evidence.events > 0 && <button className="btn-primary" disabled={busy} onClick={()=>onRestore(false)}>Open saved evidence</button>}
      {capture?.phase === "ready" && <button className="btn-ghost" disabled={busy} onClick={()=>onRestore(true)}>{state.active ? "Open running capture" : "Resume capture"}</button>}
      {capture && <button className="btn-ghost" disabled={busy} onClick={onRemove}>{capture.infra.owned ? "Remove infrastructure…" : "Disconnect queue…"}</button>}
    </div>
  </section>;
}
