interface Props {
  streaming: boolean;
  following: boolean;
  live: boolean;
  cursorIndex: number;
  total: number;
  bufferUsed: number;
  bufferMax: number;
  newCount: number; // events arrived while follow disengaged
  source?: string; // live capture source, e.g. "sqs · us-east-1 · 123456789012"
  loading?: boolean; // a fetch is in flight (streaming) - shows "loading new records…"
  onRepin: () => void;
}

const BUILD_TAG = import.meta.env.VITE_APP_VERSION || "dev";

export function StatusBar(p: Props) {
  const mode = !p.streaming ? "-- FILE --" : p.following ? "-- FOLLOW --" : "-- PAUSED --";
  const modeCls = !p.streaming ? "file" : p.following ? "live" : "paused";
  const fill = p.bufferMax ? Math.round((p.bufferUsed / p.bufferMax) * 100) : 0;
  const source = !p.streaming ? "imported file" : p.source ? p.source : p.live ? "sqs" : "mock feed";
  return (
    <div className="statusbar">
      <span className={`sb-mode ${modeCls}`}>{mode}</span>
      <span className="sb-cell">
        ln {p.total === 0 ? 0 : Math.max(1, p.cursorIndex + 1).toLocaleString()}/{p.total.toLocaleString()}
      </span>
      <span className="sb-cell sb-source" title={source} style={p.source ? { color: "var(--acc-text)" } : undefined}>
        {source}
      </span>

      <span className="sb-center">
        {p.streaming && p.loading ? (
          <span style={{ color: "var(--tx-3)" }}>loading new records…</span>
        ) : p.streaming && p.newCount > 0 ? (
          <button className="newpill" onClick={p.onRepin}>
            ↑ {p.newCount.toLocaleString()} new {p.newCount === 1 ? "event" : "events"}
          </button>
        ) : null}
      </span>

      {p.streaming && <span className="sb-cell">buf {fill}%</span>}
      <span className="sb-hint">
        <span className="sb-hint-navigation">
          <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>enter</kbd> open · <kbd>/</kbd> filter · <kbd>f</kbd> pivot ·
        </span>
        <kbd>Ctrl K</kbd> cmds
      </span>
      <span className="sb-cell sb-version" title={BUILD_TAG} style={{ color: "var(--acc-text)", fontWeight: 700, letterSpacing: "0.3px" }}>
        ⬢ {BUILD_TAG}
      </span>
    </div>
  );
}
