import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  tab: string;
  onTab: (tab: string) => void;
  onClose: () => void;
}

const TABS: { key: string; label: string }[] = [
  { key: "getting-started", label: "Getting started" },
  { key: "connecting", label: "Connecting" },
  { key: "query", label: "Query language" },
  { key: "filtering", label: "Filtering & facets" },
  { key: "shortcuts", label: "Keyboard shortcuts" },
];

function Row({ ex, desc }: { ex: string; desc: string }) {
  return (
    <div className="help-ex">
      <code>{ex}</code>
      <span>{desc}</span>
    </div>
  );
}

function Key({ k, desc }: { k: string; desc: string }) {
  return (
    <div className="help-key">
      <kbd>{k}</kbd>
      <span>{desc}</span>
    </div>
  );
}

function Content({ tab }: { tab: string }) {
  switch (tab) {
    case "connecting":
      return (
        <>
          <h3>Connecting a source</h3>
          <p>CloudMon reads CloudTrail three ways. Pick one on the launch screen.</p>
          <h4>Create infrastructure</h4>
          <p>
            CloudMon provisions an EventBridge rule → SQS queue and streams live management events. Needs{" "}
            <code>events:PutRule/PutTargets</code> and <code>sqs:CreateQueue/SetQueueAttributes/ReceiveMessage</code>.
            Closing the app pauses consumption and retains its resources. Resume or remove them from the saved-session card on the next launch. AWS charges and queue retention still apply.
          </p>
          <h4>Connect to existing SQS</h4>
          <p>
            Point at a queue already fed by CloudTrail - paste its URL (and the feeding rule ARN to set a capture
            filter). Needs <code>sqs:ReceiveMessage/DeleteMessage</code>. Use when a pipeline already exists.
          </p>
          <h4>Import a dump</h4>
          <p>
            Load a local export offline - <b>no AWS access required</b>. Accepts console “Event history → Download as
            JSON”, S3 log files (<code>.json.gz</code>), <code>aws cloudtrail lookup-events</code> output, NDJSON, and
            CSV. The previous dataset remains intact if an import fails. Expand a record and choose <b>Sources &amp; hashes</b> to inspect its original observations.
          </p>
        </>
      );
    case "query":
      return (
        <>
          <h3>Query language</h3>
          <p>Type in the query bar and press <kbd>Enter</kbd> to apply. Field names are case-insensitive.</p>
          <h4>Operators</h4>
          <p>
            <code>=</code> equals · <code>!=</code> not-equals · <code>:</code> contains · <code>~</code> regex ·{" "}
            <code>!~</code> regex-not · <code>*</code>/<code>?</code> wildcards (glob) · <code>field=</code> means
            “exists”. Combine with <code>and</code> / <code>or</code> / <code>not</code> and parentheses.
          </p>
          <p>Matches are case-insensitive. Missing and empty values count as absent: <code>errorCode=*</code> finds
            errors, while <code>errorCode!=*</code> finds events without an error. <code>not</code> includes missing
            values when its comparison does not match.</p>
          <p>Regex uses RE2 syntax; lookarounds, backreferences, and trailing flags such as <code>/pattern/i</code> are
            unsupported. Use inline flags such as <code>(?s)</code>. Invalid drafts remain unapplied.</p>
          <p>Free text searches the supported event and identity fields, not nested request or response JSON.
            Clicked values are literal, including any <code>*</code> or <code>?</code> characters.</p>
          <h4>Examples</h4>
          <Row ex={`eventName:ConsoleLogin`} desc="console logins (contains)" />
          <Row ex={`eventName="List*"`} desc="any List… API (glob)" />
          <Row ex={`errorCode=* and not readOnly=true`} desc="failed write attempts" />
          <Row ex={`identityType=Root`} desc="root activity" />
          <Row ex={`sourceIPAddress:"192.0.2"`} desc="one IP range" />
          <Row ex={`eventName ~ "^Delete"`} desc="deletions (regex)" />
          <Row ex={`(eventSource:iam or eventSource:sts) and errorCode=*`} desc="denied identity calls" />
        </>
      );
    case "filtering":
      return (
        <>
          <h3>Filtering & facets</h3>
          <p>
            Facet clicks, the histogram brush, the toolbar toggles and the query bar all compose into <b>one</b> filter
            set - each appears as a removable chip under the query bar.
          </p>
          <ul>
            <li>Click a value in the left <b>facet sidebar</b> to include it; the <code>−</code> button excludes it.</li>
            <li>Hover any cell and use <b>⌕+ / ⌕−</b> to filter for / out that value.</li>
            <li>The <b>histogram</b> is brushable - drag to filter a time window; error bars are stacked in red.</li>
            <li>
              Toolbar toggles <b>Errors only</b>, <b>Hide read-only</b>, <b>Sensitive only</b>, and <b>⧖ Time</b> (quick
              ranges or last-N) all add composable terms.
            </li>
            <li>Press <kbd>Esc</kbd> or <b>clear</b> to drop filters.</li>
          </ul>
        </>
      );
    case "shortcuts":
      return (
        <>
          <h3>Keyboard shortcuts</h3>
          <div className="help-keys">
            <div className="help-keys-group">
              <div className="help-keys-title">Navigation</div>
              <Key k="j / ↓" desc="move cursor down" />
              <Key k="k / ↑" desc="move cursor up" />
              <Key k="g / G" desc="jump to newest / oldest" />
              <Key k="Enter · o" desc="expand the focused row" />
            </div>
            <div className="help-keys-group">
              <div className="help-keys-title">Query & view</div>
              <Key k="/" desc="focus the query bar" />
              <Key k="f" desc="filter for the cursor row's event" />
              <Key k="Ctrl / ⌘ + K" desc="command palette" />
              <Key k="Esc" desc="close detail / clear filters" />
            </div>
            <div className="help-keys-group">
              <div className="help-keys-title">Help</div>
              <Key k="?" desc="this shortcuts view" />
              <Key k="F1" desc="open Help" />
            </div>
          </div>
        </>
      );
    default:
      return (
        <>
          <h3>Getting started</h3>
          <p>
            CloudMon is a live, filterable view of AWS CloudTrail - think Process Monitor for your AWS account. The
            window has three regions:
          </p>
          <ul>
            <li><b>Left</b> - facet sidebar: top values per field, click to filter.</li>
            <li><b>Center</b> - a time histogram, the query bar, and the event table.</li>
            <li><b>Row click</b> - expands inline to the event's full field tree.</li>
          </ul>
          <h4>Your first query</h4>
          <ol>
            <li>Connect a source (or <b>Import a dump</b> to try it offline).</li>
            <li>Pick a window with <b>⧖ Time</b>.</li>
            <li>Type <code>eventName:ConsoleLogin</code> and press <kbd>Enter</kbd>.</li>
            <li>Click a row to read its full detail; use <b>⌕+</b> on any value to pivot.</li>
          </ol>
          <p>The status bar at the bottom shows mode, cursor position, and buffer.</p>
        </>
      );
  }
}

export function HelpModal({ open, tab, onTab, onClose }: Props) {
  if (!open) return null;
  return createPortal(
    <div className="help-scrim" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <span className="help-title">CloudMon Help</span>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="help-body">
          <nav className="help-nav">
            {TABS.map((t) => (
              <button key={t.key} className={`help-navitem ${tab === t.key ? "active" : ""}`} onClick={() => onTab(t.key)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="help-content">
            <Content tab={tab} />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
