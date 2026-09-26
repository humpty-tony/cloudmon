# Vector Workbench — bounded integration review

## Scope and verdict

Reviewed patch: the implementation commit containing this report, parent `8cb90ca`, on `feat/vector-workbench`. This is a **solo, separate critical pass** under the user's no-new-agent/usage constraint. It is not an independent reviewer verdict or final product acceptance.

**Workbench visual/context slice: locally verified.** The production App now uses the selected Vector composition: full-height facets, a wide dense event grid, compact chrome and a lower event-context/credential dock. The remaining Hunt/summary/around/source composition has not been accepted.

The browser imported synthetic CloudTrail events through the real preview backend. The screenshot lineage response is explicitly synthetic; it verifies rendering and selection contracts, **not native identity resolution or AWS behavior**. No live cloud actions were taken.

## Critical findings and repairs

- **Pane allocation/readability:** the side inspector and stacked action/principal rows left too little usable log area. The real-App layout regression started RED; the dock, separate Principal column and compact chrome now pass at both sizes. Full ARNs remain accessible through hover, context and exact source evidence; the grid does not present abbreviated names as verified people.
- **Short-dock disclosure:** a focused credential must reveal its heading and issuance actions inside the short local panel, without scrolling the event list. The dedicated short-dock checks and keyboard disclosure/return checks pass.
- **Stale evidence ownership:** delayed issuance could outlive a workspace transition. The parent regression failed before integrating workspace activity into issuance ownership. Leave-and-return, detail-tab changes, competing dialogs and delegated views now retire obsolete requests while preserving caller disclosure.
- **Browsing continuity:** changing the selected event reset Fields/Original back to Context. A dedicated regression failed before moving mode state above the record-keyed evidence subtree and removing the App's outer sequence key. The chosen mode now persists; evidence, dialogs and workers still reset for a different record/snapshot.
- **Personal-label regression:** the compact chain omitted the existing ARN alias badge. The capture check failed on the selected-node badge before repair. Alias presentation now survives without substituting label text into raw evidence or filter identifiers.

## Visual and interaction observations

Both screenshots were opened and inspected after the final render. Default facet groups, count-scope/missing labels, selected row, dock actions and lineage disclaimer fit. Event/service/result in the dock agree with the selected grid row. The empty query remains optional; no hunt is required to browse.

Measured in `frontend/test-results/vector-layout/layout.json`:

- 1280×800: grid width 1056 px, grid region starts at y=155, dock 1056×264 px, row height 36 px, full-height rail 224×682 px; no viewport overflow.
- 1440×960: grid width 1216 px, grid region starts at y=155, dock 1216×300 px, row height 36 px, full-height rail 224×842 px; no viewport overflow.

Long service names are intentionally ellipsized in the grid and available in the context/source. Credential disclosures scroll locally. The dock has a fixed responsive allocation, not a user-drag splitter. These are visible tradeoffs, not claims of pixel-identical POC rendering.

Keyboard/source-modal checks include focus from programmatically focused source text, Escape return, inactive-workspace portals and row navigation. Facet checks retain literal exclusions, applied-filter counts, collapsed-rail choices and source/selection agreement.

## Executed checks — exit 0

From `frontend/` on this integration:

- `npm run check:inspector-dock` — 28 reported checks.
- `npm run check:vector-layout` — real App at 1440×960 and 1280×800, exact selected source, compact grid, bottom dock, keyboard-reachable disclosure.
- `npm run check:workbench` — repeated returns at both sizes and both dwell timings, exact visible sequences/source/draft, replacement reset.
- `npm run check:workspace-overlays` — both target sizes, ownership and source focus.
- `npm run check:capture-ui` — reported 20 scenario groups, `errors: []`; existing detailed snapshot, provenance, aliases and original-text assertions retained with updated UI entry points.
- `npm run check:ui-performance` — bounded work for 20,000 rows; timings are observations, not speed claims.
- `node scripts/check-facets-workbench.mjs` — real import/aggregate/filter/rail/inspection at both sizes.
- `npm run check:inspector` — existing source/field/comparison checks.
- `npm run build` — TypeScript and production build pass. Existing Vite bundle-size warning remains.

The native full suite/store vet passed for the preceding facet integration. No backend behavior changed in this dock slice; native/platform/remote CI validation has not been rerun or claimed here. The final integrated pass still includes native regressions.

## Reproducible artifacts

- `frontend/test-results/vector-layout/workbench-1280.png`
- `frontend/test-results/vector-layout/workbench-1440.png`
- `frontend/test-results/vector-layout/layout.json`
- `frontend/test-results/inspector-dock/`

Regenerate with the committed `check:vector-layout` and `check:inspector-dock` scripts. The CI configuration runs them on Linux and preserves artifacts; remote execution remains unverified.

## Remaining acceptance work

- Consolidate Hunt modes, activity ownership and saved-definition targeting; reconcile shared inspector APIs.
- Move summary above the same event grid and surrounding activity into a clearly anchored temporary context. The current Summarize view and Around investigation dialog still use the existing separate presentations.
- Unify import/recovery/capture controls without changing consent, cleanup, offline behavior or provenance.
- Run the final integrated browser/native checks and critical UX review, fix findings and deliver final screenshots. Earlier tests and this intermediate review do not satisfy that final gate.
