import { useState } from "react";
import { windowControls } from "../api/backend";
import logo from "../assets/logo.png";

interface Props {
  connected: boolean;
  sourceLabel?: string;
  canExport: boolean;
  canExportMatches: boolean;
  view: "console" | "sigma" | "analysis" | "hunts";
  onView: (v: "console" | "sigma" | "analysis" | "hunts") => void;
  onOpenDataset: () => void;
  onSources: () => void;
  onExport: () => void;
  onExportMatches: () => void;
  onHelp: (tab: string) => void;
  onSettings: () => void;
}

export function TitleBar({ connected, sourceLabel, canExport, canExportMatches, view, onView, onOpenDataset, onSources, onExport, onExportMatches, onHelp, onSettings }: Props) {
  const [menu, setMenu] = useState<null | "file" | "help">(null);
  const close = () => setMenu(null);
  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  return (
    <div className="titlebar">
      <div className="tbar-brand">
        <img className="tbar-mark" src={logo} alt="" /> CloudMon
      </div>

      <nav className="tbar-menus">
        <div className="tbar-menuwrap">
          <button className={`tbar-menubtn ${menu === "file" ? "open" : ""}`} onClick={() => setMenu(menu === "file" ? null : "file")}>
            File
          </button>
          {menu === "file" && (
            <>
              <div className="tbar-backdrop" onClick={close} />
              <div className="tbar-dropdown">
                <button className="tbar-item" onClick={run(onOpenDataset)}>
                  Open dataset…
                </button>
                <button className="tbar-item" onClick={run(onExport)} disabled={!connected || !canExport}>
                  Export loaded events…
                </button>
                <button className="tbar-item" onClick={run(onExportMatches)} disabled={!connected || !canExportMatches}>
                  Export all matching events…
                </button>
                <div className="menu-divider" />
                <button className="tbar-item" onClick={run(onSettings)}>
                  Settings…
                </button>
                <div className="menu-divider" />
                <button className="tbar-item" onClick={run(() => windowControls.close())}>
                  Quit
                </button>
              </div>
            </>
          )}
        </div>

        <div className="tbar-menuwrap">
          <button className={`tbar-menubtn ${menu === "help" ? "open" : ""}`} onClick={() => setMenu(menu === "help" ? null : "help")}>
            Help
          </button>
          {menu === "help" && (
            <>
              <div className="tbar-backdrop" onClick={close} />
              <div className="tbar-dropdown">
                <button className="tbar-item" onClick={run(() => onHelp("getting-started"))}>
                  Getting started
                </button>
                <button className="tbar-item" onClick={run(() => onHelp("connecting"))}>
                  Connecting
                </button>
                <button className="tbar-item" onClick={run(() => onHelp("query"))}>
                  Query language
                </button>
                <button className="tbar-item" onClick={run(() => onHelp("filtering"))}>
                  Filtering &amp; facets
                </button>
                <button className="tbar-item" onClick={run(() => onHelp("shortcuts"))}>
                  Keyboard shortcuts
                </button>
                <div className="menu-divider" />
                <button className="tbar-item" onClick={run(() => windowControls.openURL("https://github.com/humpty-tony/CloudMon/issues"))}>
                  Report an issue…
                </button>
              </div>
            </>
          )}
        </div>
      </nav>

      {connected && (
        <div className="tbar-views">
          <button className={`tbar-view ${view === "console" || view === "analysis" ? "on" : ""}`} onClick={() => onView("console")}>Events</button>
          <button className={`tbar-view ${view === "hunts" || view === "sigma" ? "on" : ""}`} onClick={() => onView("hunts")}>Hunt</button>
        </div>
      )}

      <div className="tbar-data" role="group" aria-label="Active evidence">
        <button className="tbar-menubtn tbar-sources" aria-haspopup="dialog" onClick={onSources}>Data sources…</button>
        {sourceLabel && <span className="tbar-source" title={sourceLabel}>{sourceLabel}</span>}
      </div>
      <div className="tbar-drag" />

      <div className="tbar-winctl">
        <button className="win-btn" onClick={() => windowControls.minimise()} title="Minimise" aria-label="Minimise">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button className="win-btn" onClick={() => windowControls.toggleMaximise()} title="Maximise" aria-label="Maximise">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button className="win-btn win-close" onClick={() => windowControls.close()} title="Close" aria-label="Close">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
