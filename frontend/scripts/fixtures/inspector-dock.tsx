import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceActivity } from "../../src/components/WorkspaceActivity";
import { EventInspector, type EventInspectorProps } from "../../src/components/EventInspector";
import { ComparisonBar, EvidenceComparisonProvider } from "../../src/components/EvidenceComparison";
import { backend } from "../../src/api/backend";
import type { CloudTrailEvent, EvidenceSnapshot, Lineage } from "../../src/api/types";
import "../../src/app.css";

// Synthetic bridge fixture only. Never requests AWS or alters the app's source.
export const snapshot: EvidenceSnapshot = { generation: "dock-fixture", maxSeq: 30, capturedAt: "2026-09-24T10:00:00Z" };
export const raw = '{\n  "eventName": "GetSecretValue", "exact": 9007199254740993,\n  "decimal": 0.123456789012345678901, "items": [' + Array.from({length: 20000}, (_, i) => i).join(",") + ']\n}';
export const event: CloudTrailEvent = {
  seq: 30, eventID: "synthetic-selected-event", eventTime: "2026-09-24T09:42:18Z", eventName: "GetSecretValue",
  eventSource: "secretsmanager.amazonaws.com", awsRegion: "us-east-1", sourceIPAddress: "198.51.100.24", userAgent: "fixture",
  userIdentity: { type: "AssumedRole", principalId: "AROAFIXTURE:cli-session", arn: "arn:aws:sts::111122223333:assumed-role/ProdDeploy/cli-session", accountId: "111122223333", userName: "ProdDeploy", roleArn: "arn:aws:iam::111122223333:role/platform/ProdDeploy", sessionName: "cli-session" },
  readOnly: true, managementEvent: true, recipientAccountId: "111122223333", rawJSON: "",
};
export const lineage: Lineage = {
  applicable: true, complete: true, status: "complete", sourceIdentity: "fixture-attribute", reason: "",
  nodes: [
    { identityType: "IAMUser", arn: "arn:aws:iam::444455556666:user/maya.chen", userName: "maya.chen", accountId: "444455556666", roleArn: "", sessionName: "", invokedBy: "", viaSeq: 10, viaEvent: "AssumeRole", viaTime: "2026-09-24T09:39:41Z", viaSourceIP: "198.51.100.24", evidence: "Exact returned access-key match; expiration not recorded", evidenceSeqs: [10, 11] },
    { identityType: "AssumedRole", arn: "arn:aws:sts::444455556666:assumed-role/SecurityAudit/maya-session", userName: "SecurityAudit", accountId: "444455556666", roleArn: "arn:aws:iam::444455556666:role/security/SecurityAudit", sessionName: "maya-session", invokedBy: "", viaSeq: 20, viaEvent: "AssumeRole", viaTime: "2026-09-24T09:41:32Z", viaSourceIP: "198.51.100.24", evidence: "Exact returned access-key match; recorded lifetime checked", evidenceSeqs: [20] },
  ],
};
const state = {
  calls: [] as unknown[], rawCalls: [] as unknown[], evidenceCalls: [] as unknown[], observationCalls: [] as unknown[],
  retries: 0, closes: 0, pivots: [] as unknown[], workerLoads: 0, failRaw: false, delayRaw: false,
  resolveRaw: null as (() => void) | null,
  update: (_props: Record<string, unknown>) => {},
};
Object.assign(window, { inspectorDock: state });
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
    if (message && typeof message === "object" && "json" in message) state.workerLoads++;
    if (Array.isArray(options)) super.postMessage(message, options);
    else super.postMessage(message, options);
  }
};
backend.queryLineageRaw = async (seq, snap) => {
  state.rawCalls.push({seq, snapshot: snap});
  if (state.failRaw) throw Error("Issuance storage unavailable");
  if (state.delayRaw) await new Promise<void>(resolve => { state.resolveRaw = resolve; });
  return `{ "issuanceSeq": ${seq}, "exact": 9007199254740993 }`;
};
backend.getEventEvidence = async (seq, offset, snap) => {
  state.evidenceCalls.push({seq, offset, snapshot: snap});
  return {total: 2, variants: 2, observations: [1,2].map(id => ({id, sha256: String(id).repeat(64), source: "synthetic-source.ndjson", ordinal: id, format: "ndjson", lossy: false, observedAt: "2026-09-24T10:00:00Z", displayed: id === 1}))};
};
backend.getObservation = async (id, snap) => { state.observationCalls.push({id, snapshot: snap}); return `{ "source": ${id}, "exact": 9007199254740993 }`; };
backend.investigate = async () => { throw Error("Synthetic fixture: investigation engine not running"); };
function Fixture() {
  const [active, setActive] = useState(true);
  const [props, setProps] = useState<EventInspectorProps>({
    event, snapshot, rawJSON: raw, lineage, timeZone: "utc", layout: "dock",
    onInvestigate: (event: CloudTrailEvent, snapshot?: EvidenceSnapshot) => state.calls.push({event, snapshot}),
    onRetry: () => { state.retries++; }, onClose: () => { state.closes++; },
    onPivot: (...args: unknown[]) => state.pivots.push(args),
    onOpenLineage: (seq: number) => state.calls.push({fullLineage: seq}),
  });
  state.update = updates => setProps(previous => ({...previous, ...updates}));
  return <EvidenceComparisonProvider>
    <style>{`body {margin:0; background:var(--bg-0); color:var(--tx-1);}
      .dock-fixture-label {position:absolute;top:20px;left:24px;color:var(--tx-2);font:12px var(--sans)}
      .dock-fixture-frame {position:absolute;right:20px;bottom:50px;width:1060px;height:300px;border:1px solid var(--line-struct);}
      .dock-fixture-pins {position:absolute;bottom:0;left:0;right:0;}
    `}</style>
    <div className="dock-fixture-label">Synthetic fixture · actual EventInspector · 1060 × 300 · no cloud connection <button onClick={() => setActive(false)}>Other workspace</button><button onClick={() => setActive(true)}>Return to review</button></div>
    <WorkspaceActivity.Provider value={active}><div className="dock-fixture-frame" hidden={!active}><EventInspector {...props} /></div></WorkspaceActivity.Provider>
    <div className="dock-fixture-pins"><ComparisonBar /></div>
  </EvidenceComparisonProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
