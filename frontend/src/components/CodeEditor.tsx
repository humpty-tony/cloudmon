import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { linter, lintGutter, forceLinting, type Diagnostic } from "@codemirror/lint";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as tg } from "@lezer/highlight";
import type { SigmaDiag } from "../api/types";

// Dark theme wired to the app's CSS tokens, so it tracks whatever theme is active.
const cmTheme = EditorView.theme(
  {
    "&": { backgroundColor: "var(--bg-0)", color: "var(--tx-1)", height: "100%", fontSize: "12.5px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
    ".cm-content": { caretColor: "var(--acc)" },
    ".cm-gutters": { backgroundColor: "var(--bg-0)", color: "var(--tx-3)", border: "none" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.028)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--tx-2)" },
    ".cm-cursor": { borderLeftColor: "var(--acc)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--acc-sel)" },
    ".cm-lintRange-error": { textDecoration: "underline wavy var(--sev-err)" },
    ".cm-lintRange-warning": { textDecoration: "underline wavy var(--sev-warn)" },
  },
  { dark: true }
);

const cmHighlight = HighlightStyle.define([
  { tag: [tg.propertyName, tg.definition(tg.propertyName)], color: "#7aa2f7" }, // keys
  { tag: [tg.string, tg.special(tg.string)], color: "#9ece6a" },
  { tag: tg.comment, color: "var(--tx-3)", fontStyle: "italic" },
  { tag: [tg.number, tg.bool, tg.null, tg.atom], color: "#ff9e64" },
  { tag: tg.keyword, color: "var(--acc)" },
  { tag: tg.meta, color: "var(--tx-3)" },
]);

interface Props {
  value: string;
  onChange: (v: string) => void;
  diagnostics: SigmaDiag[]; // only entries with a `line` are shown inline
  onSubmit?: () => void; // Ctrl/Cmd+Enter
}

export function CodeEditor({ value, onChange, diagnostics, onSubmit }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const diags = useRef<SigmaDiag[]>(diagnostics);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    if (!host.current) return;
    const lintSource = (v: EditorView): Diagnostic[] => {
      const doc = v.state.doc;
      const out: Diagnostic[] = [];
      for (const d of diags.current) {
        if (!d.line || d.line < 1 || d.line > doc.lines) continue;
        const line = doc.line(d.line);
        out.push({ from: line.from, to: line.to, severity: d.severity === "error" ? "error" : "warning", message: d.message });
      }
      return out;
    };
    const state = EditorState.create({
      doc: value,
      extensions: [
        // Ctrl/Cmd+Enter → run. Highest precedence so it wins over any default.
        keymap.of([{ key: "Mod-Enter", preventDefault: true, run: () => (onSubmitRef.current?.(), true) }]),
        basicSetup,
        yaml(),
        cmTheme,
        syntaxHighlighting(cmHighlight),
        lintGutter(),
        linter(lintSource, { delay: 50 }),
        keymap.of([indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (e.g. loading a rule) - dispatch only if genuinely different.
  useEffect(() => {
    const v = view.current;
    if (v && value !== v.state.doc.toString()) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  // Push new diagnostics into the linter.
  useEffect(() => {
    diags.current = diagnostics;
    if (view.current) forceLinting(view.current);
  }, [diagnostics]);

  return <div className="cm-host" ref={host} />;
}
