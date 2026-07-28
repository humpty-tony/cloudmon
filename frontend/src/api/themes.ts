// Theme registry. Each key maps to a `:root[data-theme="<key>"]` block in app.css
// that overrides the color tokens. Geometry/motion stay global. "graphite" is the
// built-in default (the base :root), so it needs no override block.

export interface ThemeDef {
  key: string;
  label: string;
  group: "dark" | "light";
}

export const THEMES: ThemeDef[] = [
  { key: "graphite", label: "Graphite", group: "dark" },
  { key: "tokyo-night", label: "Tokyo Night", group: "dark" },
  { key: "nord", label: "Nord", group: "dark" },
  { key: "dracula", label: "Dracula", group: "dark" },
  { key: "gruvbox", label: "Gruvbox", group: "dark" },
  { key: "solarized", label: "Solarized", group: "dark" },
  { key: "one-dark", label: "One Dark", group: "dark" },
  { key: "light", label: "Light", group: "light" },
];

export const DEFAULT_THEME = "graphite";
