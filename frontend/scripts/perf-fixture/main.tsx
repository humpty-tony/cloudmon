import { Profiler, useCallback, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { EventTable } from "../../src/components/EventTable";
import { EventInspector } from "../../src/components/EventInspector";
import { EvidenceComparisonProvider } from "../../src/components/EvidenceComparison";
import { COLUMNS } from "../../src/api/columns";
import type { CloudTrailEvent, Lineage } from "../../src/api/types";
import "../../src/app.css";

// This fixture exercises the production component. Counters observe the work
// from the outside, without adding instrumentation to application code.
const metrics = { keyReads: 0, rowResizes: 0, commits: 0, inspectorLoads: 0 };
const NativeResizeObserver = window.ResizeObserver;
window.ResizeObserver = class extends NativeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    super((entries, observer) => {
      metrics.rowResizes += entries.filter(entry => entry.target.classList.contains("rowwrap")).length;
      callback(entries, observer);
    });
  }
};
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
    if (message && typeof message === "object" && "json" in message) metrics.inspectorLoads++;
    if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
    else super.postMessage(message, transferOrOptions);
  }
};

function makeEvents(count: number): CloudTrailEvent[] {
  return Array.from({ length: count }, (_, index) => {
    const seq = count - index;
    const raw = {
      eventID: `fixture-${seq}`, eventTime: "2026-09-24T12:00:00Z",
      eventName: "GetObject", eventSource: "s3.amazonaws.com", awsRegion: "us-east-1",
      userIdentity: { type: "AssumedRole", principalId: "AROAFIXTURE:session", accountId: "111122223333", userName: "Investigator", arn: "arn:aws:sts::111122223333:assumed-role/Investigator/session", roleArn: "arn:aws:iam::111122223333:role/Investigator", sessionName: "session" },
      sourceIPAddress: "192.0.2.1", userAgent: "cloudmon-ui-fixture", recipientAccountId: "111122223333",
      readOnly: true, managementEvent: false,
      requestParameters: { bucketName: "synthetic-evidence", key: `events/${seq}.json` },
      responseElements: null,
    };
    return {
      ...raw, rawJSON: JSON.stringify(raw),
      get seq() { metrics.keyReads++; return seq; },
    };
  });
}
const datasets = { 20000: makeEvents(20000), 8: makeEvents(8) };
const columns = COLUMNS.filter(column => column.defaultVisible);
const widths = {};
const lineage: Lineage = {
  applicable: true, complete: true, sourceIdentity: "", nodes: [{
    identityType: "IAMUser", arn: "arn:aws:iam::111122223333:user/analyst", userName: "analyst",
    accountId: "111122223333", roleArn: "", sessionName: "", invokedBy: "",
    viaSeq: 1, viaEvent: "AssumeRole", viaTime: "2026-09-24T11:59:00Z", viaSourceIP: "192.0.2.1",
  }],
};
const noop = () => {};
const notSensitive = () => false;
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const painted = async () => { await nextFrame(); await nextFrame(); };

function Fixture() {
  const [count, setCount] = useState<keyof typeof datasets>(20000);
  const [cursor, setCursor] = useState(-1);
  const [selected, setSelected] = useState<CloudTrailEvent | null>(null);
  const [counter, setCounter] = useState(0);
  const events = datasets[count];
  const select = useCallback((event: CloudTrailEvent) => {
    setSelected(event);
  }, []);
  const closeInspector = useCallback(() => setSelected(null), []);

  useLayoutEffect(() => {
    window.perfFixture = {
      snapshot: () => ({ ...metrics }),
      async update(kind: "cursor" | "scroll" | "counter" | "selection", steps = 20) {
        const before = { ...metrics };
        const durations: number[] = [];
        for (let step = 0; step < steps; step++) {
          const start = performance.now();
          if (kind === "cursor") flushSync(() => setCursor(count - step));
          if (kind === "counter") flushSync(() => setCounter(value => value + 1));
          if (kind === "scroll") document.querySelector<HTMLDivElement>(".etbody")!.scrollTop = (step + 1) * 160;
          if (kind === "selection") flushSync(() => { setSelected(datasets[count][step % count]); setCursor(count - step % count); });
          await painted();
          durations.push(performance.now() - start);
        }
        return {
          keyReads: metrics.keyReads - before.keyReads,
          commits: metrics.commits - before.commits,
          rowResizes: metrics.rowResizes - before.rowResizes,
          durations,
        };
      },
      async smallDataset() {
        flushSync(() => { setSelected(null); setCursor(-1); setCount(8); });
        await painted();
      },
    };
  }, [count]);

  return <EvidenceComparisonProvider>
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>
      <div style={{ padding: 8 }}>Synthetic fixture · {count.toLocaleString()} rows · counter <span data-testid="counter">{counter}</span></div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
        <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
          <EventTable key={count} events={events} columns={columns} colWidths={widths} rowHeight={32} detailMode="external"
            selected={selected} cursorSeq={cursor} follow={false} onSelect={select} onCursor={setCursor}
            onPivot={noop} onDisengageFollow={noop} onReachTop={noop} onResizeColumn={noop}
            onRetryDetail={noop} isSensitive={notSensitive} timeZone="utc" />
        </div>
        <EventInspector event={selected} rawJSON={selected?.rawJSON ?? ""} lineage={lineage}
          onRetry={noop} onPivot={noop} onClose={closeInspector} timeZone="utc" />
      </div>
    </div>
  </EvidenceComparisonProvider>;
}

declare global {
  interface Window {
    perfFixture: {
      snapshot(): typeof metrics;
      update(kind: "cursor" | "scroll" | "counter" | "selection", steps?: number): Promise<{keyReads:number;commits:number;rowResizes:number;durations:number[]}>;
      smallDataset(): Promise<void>;
    };
  }
}
createRoot(document.getElementById("root")!).render(<Profiler id="fixture" onRender={() => metrics.commits++}><Fixture /></Profiler>);
