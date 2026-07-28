import { Component, type ReactNode } from "react";
import { logError } from "../api/log";

interface Props {
  label: string; // what this boundary wraps, for the log line + fallback title
  children: ReactNode;
  onReset?: () => void; // e.g. close the failing overlay so the app stays usable
}
interface State {
  err: Error | null;
}

/** Catches render-time errors in its subtree, logs them to cloudmon.log, and
 *  shows a dismissable panel instead of blanking the whole app. (Does not catch
 *  a native renderer crash - that leaves no JS error - but the log breadcrumbs
 *  around it still tell us what state we were in.) */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }
  componentDidCatch(err: Error, info: { componentStack: string }) {
    logError(`ErrorBoundary(${this.props.label}): ${err.message}\n${err.stack || ""}\n${info.componentStack}`);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="eb-fallback">
          <div className="eb-title">⚠ {this.props.label} hit an error</div>
          <pre className="eb-msg">{this.state.err.message}</pre>
          <button
            className="eb-btn"
            onClick={() => {
              this.setState({ err: null });
              this.props.onReset?.();
            }}
          >
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
