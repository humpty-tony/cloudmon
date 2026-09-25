// Column presets - one-click layouts tuned to a triage lens.

export interface Preset {
  key: string;
  label: string;
  columns: string[]; // ordered column keys
}

export const PRESETS: Preset[] = [
  { key: "workbench", label: "Workbench", columns: ["time", "name", "identity", "ip", "result"] },
  { key: "triage", label: "Triage", columns: ["time", "identity", "name", "source", "region", "ip", "result"] },
  { key: "identity", label: "Identity", columns: ["time", "identity", "identityType", "name", "account", "result"] },
  { key: "network", label: "Network", columns: ["time", "ip", "identity", "name", "source", "region", "result"] },
];

export const DEFAULT_PRESET = PRESETS[0];
