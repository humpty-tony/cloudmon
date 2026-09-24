import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { QueryTerm } from "../api/types";
import { QUERY_FIELDS } from "../api/types";
import { highlightQuery } from "../api/queryHighlight";
import { compileQuery } from "../api/queryLang";

const FIELD_SET = new Set<string>(QUERY_FIELDS.map(String));

interface Props {
  terms: QueryTerm[]; // click-driven chips (facets, pivots, brush)
  queryText: string; // the APPLIED query-language expression
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (v: string) => void; // commit (on Enter)
  onRemove: (id: string) => void;
  onClear: () => void;
}

function chipText(t: QueryTerm): { field: string; op: string; value: string } {
  if (t.kind === "time") return { field: "time", op: "", value: t.label };
  const op = t.op === "exclude" ? "≠" : t.op === "exists" ? "*" : "=";
  return { field: String(t.field), op, value: t.op === "exists" ? "" : t.value };
}

export function QueryBar({ terms, queryText, error, inputRef, onQueryChange, onRemove, onClear }: Props) {
  // Draft is what's being typed; it's applied to the stream only on Enter.
  const [draft, setDraft] = useState(queryText);
  useEffect(() => setDraft(queryText), [queryText]);

  const dirty = draft !== queryText;
  const active = terms.length > 0 || queryText.trim().length > 0 || draft.trim().length > 0;

  // Write-time validation: parse the draft on every keystroke so a malformed
  // query surfaces immediately, not only when applied on Enter.
  const draftError = useMemo(() => compileQuery(draft, FIELD_SET).error, [draft]);

  // Syntax-highlight overlay sits behind a transparent-text input; keep the two
  // horizontally scroll-synced so the colours track the caret.
  const segs = useMemo(() => highlightQuery(draft), [draft]);
  const hlRef = useRef<HTMLDivElement>(null);
  const syncScroll = () => {
    if (hlRef.current && inputRef.current) hlRef.current.scrollLeft = inputRef.current.scrollLeft;
  };

  // After a programmatic value edit (auto-close), restore the caret/selection once
  // React has committed the new value.
  const pendingSel = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    if (pendingSel.current && inputRef.current) {
      const [a, b] = pendingSel.current;
      inputRef.current.setSelectionRange(a, b);
      pendingSel.current = null;
      syncScroll();
    }
  });

  const CLOSE: Record<string, string> = { "(": ")", '"': '"' };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!draftError) onQueryChange(draft.trim());
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.currentTarget;
    const s = el.selectionStart ?? 0;
    const en = el.selectionEnd ?? 0;
    const v = draft;
    const collapsed = s === en;

    // Step over an auto-inserted closer instead of adding a second one.
    if (collapsed && (e.key === ")" || e.key === '"') && v[s] === e.key) {
      e.preventDefault();
      el.setSelectionRange(s + 1, s + 1); // no text change → move the caret directly
      syncScroll();
      return;
    }
    // Auto-close ( and " - wrap the selection if there is one, else insert an empty pair.
    if (e.key === "(" || e.key === '"') {
      e.preventDefault();
      const close = CLOSE[e.key];
      setDraft(v.slice(0, s) + e.key + v.slice(s, en) + close + v.slice(en));
      pendingSel.current = collapsed ? [s + 1, s + 1] : [s + 1, en + 1];
      return;
    }
    // Backspace between an empty pair deletes both.
    if (e.key === "Backspace" && collapsed && s > 0) {
      const before = v[s - 1];
      const after = v[s];
      if ((before === "(" && after === ")") || (before === '"' && after === '"')) {
        e.preventDefault();
        setDraft(v.slice(0, s - 1) + v.slice(s + 1));
        pendingSel.current = [s - 1, s - 1];
      }
    }
  };

  return (
    <div className="qbar-wrap">
      <div className={`qbar ${draftError ? "qbar--err" : dirty ? "qbar--dirty" : ""}`}>
        <span className="qbar-icon">⌕</span>
        <div className="qbar-field">
          <div className="qbar-hl" ref={hlRef} aria-hidden="true">
            {segs.map((s, i) => (s.cls ? <span key={i} className={s.cls}>{s.text}</span> : s.text))}
          </div>
          <input
            ref={inputRef}
            className="qbar-input"
            aria-label="Search query"
            aria-invalid={!!draftError}
            aria-describedby="query-status"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              requestAnimationFrame(syncScroll);
            }}
            onKeyDown={onKeyDown}
            onScroll={syncScroll}
            placeholder={'eventSource="ec2.amazonaws.com" and eventName="List*"   -   press Enter to search'}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {active && (
          <button className="qbar-clear" onClick={() => { setDraft(""); onClear(); }} title="Clear all filters">
            clear
          </button>
        )}
      </div>

      {terms.length > 0 && (
        <div className="qbar-terms">
          <span className="qbar-terms-label">filters</span>
          {terms.map((t) => {
            const c = chipText(t);
            const cls = t.kind === "field" && t.op === "exclude" ? "chip chip--exclude" : "chip";
            return (
              <span key={t.id} className={cls} onClick={() => onRemove(t.id)} title="Remove filter">
                {c.field && <span className="chip__field">{c.field}</span>}
                {c.op && <span className="chip__op">{c.op}</span>}
                {c.value && <span className="chip__val">{c.value}</span>}
                <span className="chip__x">✕</span>
              </span>
            );
          })}
        </div>
      )}

      <div className="qbar-status" id="query-status" aria-live="polite">
        {draftError ? (
          <span className="qbar-error">⚠ {draftError} · not applied</span>
        ) : dirty ? (
          <span className="qbar-apply">press Enter to apply</span>
        ) : error ? (
          <span className="qbar-error">⚠ {error}</span>
        ) : (
          <span className="qbar-hint">
            operators: <code>=</code> <code>!=</code> <code>~</code>(regex) <code>:</code>(contains) · wildcards <code>*</code>{" "}
            <code>?</code> · <code>and</code> <code>or</code> <code>not</code> <code>( )</code>
          </span>
        )}
      </div>
    </div>
  );
}
