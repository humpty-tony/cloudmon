# Hunt workspace verification / integration handoff

## Public API and ownership

Named exports from `src/components/HuntWorkspace.tsx`:

```ts
export interface HuntWorkspaceProps extends SigmaViewProps {
  filter: QueryFilter;
}
export function HuntWorkspace(props: HuntWorkspaceProps): JSX.Element;
```

`SigmaViewProps` is now exported from `SigmaView.tsx`; its existing fields and types are unchanged: `columns`, `visibleCols`, `colWidths`, `rowHeight`, `timeZone`, `isSensitive`, `onResizeColumn`, `onReorderColumns`, `onToggleColumn`, `onPivot`, `onOpenLineage`. There is no new required callback beyond those existing props. Pass the applied Workbench filter, not a query draft. Keep HuntWorkspace mounted/hidden after its first visit. It retains all three mode children; switching modes never starts a run. Existing `EvidenceComparisonProvider` must remain above it, as for the other inspectors.

Owned production changes: `HuntWorkspace.tsx`, `hunt-workspace.css`, `HuntView.tsx`, `SigmaView.tsx`. Dedicated verification: `scripts/check-hunt-workspace.mjs`, this document, `hunt-workspace.tsx`, `hunt-workspace-bridge.mjs`. No root shell, shared backend/types, EventInspector source, package scripts, general capture checks or roadmap changes. No commit/push/merge.

## Scope and real engines

- Indicators and Sequences default independently to all loaded evidence. The scope selector deliberately chooses current Workbench filters, including time bounds, literal include/exclude values, flags, text and expression independently.
- Saved definitions copy their resolved scope. Cross-mode load routes to the target mode, replaces that target's definition/results, cancels both source and target pending requests, and does not run automatically. Unrelated completed mode results remain intact.
- **Existing SigmaRun/SigmaSuite contracts have no QueryFilter input. Rules and suites therefore explicitly say “Scope: all loaded evidence. Workbench filters are not applied”. Rule conditions narrow the match. No client-side postfilter or misleading filtered counts were added. Supporting Workbench scope for Sigma requires a separate native/backend contract change.**
- Production calls existing `backend.hunt`, `backend.sigmaRun`, `backend.sigmaSuite`, savedHunts storage and local Sigma rule storage. Nothing replaces the actual engines.
- Shared EventInspector handles chosen indicator/sequence/rule evidence. Sequence step buttons select A–E. Raw record, lineage, Sources/hashes and investigation use the successful result snapshot, not the current authoring scope. Hunt-local full lineage expansion keeps that same snapshot.

## Strict TDD observations

The dedicated browser command was run after each vertical slice, first RED and then GREEN. Initial fixture used the existing HuntView as a fallback while HuntWorkspace did not yet exist; after GREEN the fixture was simplified to a direct typed import.

Observed RED assertions before their corresponding changes:

```text
Hunt must have one consolidated mode strip
0 !== 1

Hunt scope must explicitly offer all evidence vs current Workbench
0 !== 1

Inspecting a suite result must not discard the suite
0 !== 1

Rule results should use the shared inspector
0 !== 1

Hunt authoring must be a compact side pane
actual: null
expected: true

Hunt mode tabs must support keyboard navigation
'false' !== 'true'

Suite run control must stay visible while the rule list scrolls
actual: false
expected: true

Saved scope replacement must name the current destination
0 !== 1
```

Visual review also found the compact EventTable mode concatenating event name and identity when its Workbench-only styles were absent. A failing cell assertion reproduced this; Rules now uses the normal event-name cell with external inspection. The initial suite layout put Run below the viewport at 1280×800; the regression above drove a bounded scrolling choice list with a visible Run control.

Final dedicated command, from `frontend/`:

```sh
node scripts/check-hunt-workspace.mjs
```

Observed GREEN (exit 0):

```text
PASS mode and draft retention, hidden destination retention, one mode selector
PASS scope forwarding, saved cross-mode routing, exact copied filters, no autorun, result retention
PASS retained rule results and suite inspection without rerunning
PASS shared result inspector, sequence step selection, exact raw text and snapshot-bound sources
PASS compact author/results/inspector layout at 1440×960 and 1280×800
PASS readable rule cells and keyboard mode navigation
PASS hunt cancellation, cross-mode load cancellation races, engine failure and stale-evidence retry
PASS rule diagnostics/errors, local saved rules, rule/suite cancellation and late-response rejection
PASS five-step saved routing and snapshots; unmocked browser honestly requires desktop engines
```

The runner owns loopback port **5194**, uses `node_modules/.vite-vector-hunt` for its Vite cache, and closes its browser/server. It writes screenshots, measurements and browser errors under `frontend/test-results/hunt-workspace/` (ignored). All eight mode/suite screenshots at 1440×960 and 1280×800 were visually inspected. The initial column-concatenation and offscreen suite-run findings were fixed and rerendered. Empty browser error array on the final run.

## Other checks actually run

Exit 0:

```sh
# frontend/
npm run build
npm run check:search
npm run check:inspector
npm run check:labels
npm run check:saved-hunts

# repository root
go test -p 1 -tags webkit2_41 ./internal/store -run 'Hunt|Sequence|Sigma' -count=1
git diff --check
```

Native output: `ok cloudmon/internal/store 1.596s`. These run actual local Go/DuckDB matching/snapshot tests. Browser bridge fixtures test UI routing and adapter arguments, not native matching. The additional unmocked browser case confirms that the preview honestly reports the desktop-only engines rather than presenting fixture results. No AWS/cloud calls or new dependencies.

Build retains the baseline warning about a minified chunk larger than 500 kB. App is intentionally not changed here, so its production bundle does not yet mount HuntWorkspace; the dedicated Vite fixture renders it and TypeScript checks the component.

## Parent integration / limits

- Parent still must mount the named HuntWorkspace export in its retained destination shell and independently review/test the patch before committing.
- This branch uses the existing shared EventInspector API and scopes its dock CSS under `.hunt-workspace`; it does not depend on the inspector worker's not-yet-integrated `layout="dock"` prop. Reconcile this scoped styling with that worker's dock implementation during integration; do not edit inspector source from this patch.
- Legacy general capture UI assertions referencing `Sigma mode`, `Single rule`, inline rule-row expansion, old top-level destinations or Hunt type dropdown need parent-owned integration updates. The general capture/performance browser checks were not rerun by this worker; the parent supplied their passing baseline.
- No native desktop GUI/Wails WebView end-to-end run, Windows/macOS build, or remote CI was performed. Browser layout verification is Chromium with explicit synthetic bridge fixtures.
- Rule/suite Workbench-filter support is unavailable in the existing engine contract, as disclosed above. This patch does not claim it.
