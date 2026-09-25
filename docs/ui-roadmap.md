# CloudMon: review-first UI implementation roadmap

**Execution status and reset handoff:** see [ui-implementation.md](ui-implementation.md) for verified checkboxes, current test failures, worktree ownership, and the exact next action.

Status: **implementation authorized; work is proceeding in tested, separately committed slices.**

The user approved implementation and requested a feature branch with incremental commits. Initial conservative choices: retain applied-filter facet counts and the existing normalized `userName` grouping (direct user name with session-issuer fallback, not a resolved person); label both explicitly. These choices do not introduce self-excluding counts or a new identity-resolution model.
Recorded: 2026-09-24 (local EDT). Repository inspected at `a4afbf3`.

This is the durable handoff for the UI discussions and visual POCs. Preserve the product decisions below; treat the proposed technical decomposition and open questions as a plan to review, not as additional user-approved requirements. Update this document as decisions change.

## Latest direction — supersedes the bottom-dock reference

Selected events now expand vertically on the **right**, for SOC/IR log review. Default to useful event facts: outcome/errors, recorded targets, actor/session, source and evidence. Lineage is a toggleable **on-demand graph popup** using the existing snapshot-bound resolver, not an always-visible chain. Do not resolve lineage just because a row is selected. Earlier bottom-dock screenshots below remain historical reference only. This correction is implementation-authorized; shipping-first and bounded validation remain in force.

## 1. Product and design contract

- Build a local, cloud-centric SIEM/log-review tool: understand cloud events, follow observed credential relationships, and optionally hunt indicators, rules, and sequences.
- **Primary journey:** open cloud logs → browse without a hypothesis → select an interesting event → understand its context → follow useful evidence → return to browsing.
- Start with all imported activity and an empty optional query. Do not require a case, IOC, alert, selected identity, or assumed malicious activity.
- Use the selected **Vector** direction: dark steel/blue, compact desktop chrome, horizontal navigation, readable dense rows, useful persistent controls, and a vertical right-hand event inspector. It must look like a tool, not a website or dashboard presentation.
- **Two primary destinations:** Workbench and optional Hunt. Capabilities do not each earn another top-level tab.
- Identity lineage belongs to the selected event. Open the evidence-backed lineage graph as a popup; do not reserve inline space or require a separate Identities workspace.
- Analysis is an optional summary over the same log list. Surrounding activity is a clearly scoped temporary view of that list. Original evidence belongs in the inspector; comparison is temporary and contextual.
- Import and capture share one data-source entry point. Settings, help, exports, saved configurations, and rule suites are controls, not permanent workspaces.
- Add a left facet selector with counts. Keep its groups and the whole rail collapsible, and allow additional fields without displaying every possible facet at once.
- Simplification means less simultaneous UI, not smaller type or removal of investigative capabilities.
- Always conduct an adversarial UX review against the actual workflow. Passing tests or filling a feature inventory is not enough.
- The visual POC remains a design reference, not production functionality. Implementation is now authorized; each migrated capability must pass real checks before being described as implemented.

### Visual reference

Current screenshots are preserved under `docs/ui-reference/` so the design is not available only in ignored test output:

- `workbench.png` and `workbench-1280.png`: full-height left facets, main grid, contextual lower inspector.
- `lineage.png`: expanded credential detail, not another workspace.
- `summary.png`: optional activity breakdown above the grid.
- `around.png`: temporary surrounding-activity scope.
- `hunt.png` and `rules.png`: optional authoring workspace and rule mode.
- `source.png`, `original.png`, `compare.png`: contextual source setup, evidence, and comparison.

The runnable visual POC is in `frontend/test-results/vector-simplified-poc/` (gitignored). Its HTML/JS demonstrates appearance, not production logic. The older 16-view mockup remains a capability inventory; **its navigation is superseded**. The newly requested facet treatment is a proposed visual realization, pending user review of the updated screenshot.

## 2. Capability placement: nothing silently disappears

- **Review** → Workbench, the default destination.
- **Identities** → selected-event lineage and on-demand node/graph expansion in context.
- **Analysis** → optional Workbench summary, with explicit scope and drill-down into the same grid.
- **Investigation** → Around this event; preserve its anchor and provide a clear return.
- **IOC hunts** → Hunt / Indicators.
- **Sequences** → Hunt / Sequences.
- **Saved hunts** → Open saved / Save controls within Hunt.
- **Detections** → Hunt / Rules; rule matches are not an alert lifecycle or proof of compromise.
- **Rule suites** → choose and run multiple rules from Rules, not another destination.
- **Sources / Import** → data-source control, including recovery and source replacement states.
- **Capture** → the same source control, with visible running/paused state and explicit cleanup actions.
- **Evidence** → Original and Sources/versions in the selected-event inspector.
- **Comparison** → temporary A/B overlay or panel, with explicit selected records and source scope.
- **Exports / Reports** → scoped actions from the current event, results, or context.
- **Settings** → utility control, retaining density, theme, time zone, aliases, and preferences.
- **Help** → utility control, retaining field/query help and keyboard discoverability.

### Workbench contents

Keep the source, time scope, optional query, active filters, count, event list, and selection legible. Columns, histogram, summary, detailed lineage, and original evidence should be discoverable without all being open simultaneously. Event inspection should answer: what happened, to which resource, with what result, under which recorded credential, in which account/region, and what evidence supports that interpretation.

Do not remove existing column selection/order/widths, useful presets, literal field pivots, keyboard navigation, time brushing, or live Follow behavior merely to obtain a cleaner screenshot. Relocate secondary controls and retain their semantics.

### Facet count contract

The visual POC currently shows **counts in the loaded synthetic source**, explicitly labelled. Its group header is events where the field is present / total events; each value row is the number of events with that value. For an added Error code facet, absent values are visibly separate rather than counted as successful recorded error codes.

For production, the following needs implementation and a final scope decision:

1. Counts must describe a named query/time/dataset scope, across the full eligible dataset, never only rendered or loaded rows.
2. Do not confuse **field presence**, **distinct values**, **returned top values**, and **per-value event counts**. Use separately named fields in the API/UI.
3. Preserve existing search semantics: same-field includes are ORed; different fields and exclusions are ANDed. A clicked value must be literal even when it contains wildcards, quotes, or an ARN.
4. Proposed starting point: preserve the existing applied-query count scope. Decide explicitly whether selecting a facet should instead show counts with that facet's own filter removed; that alternative is a behavior/API change, not a CSS change.
5. Show missing/empty values and truncated high-cardinality lists honestly. Provide searchable/additional values rather than pretending a top list is complete. Do not derive presence by summing a truncated top list.
6. Suggested default groups are Service, Identity, and Result; Account, Region, Source address, Event name, and Error code are available on demand. Confirm the production Identity field and the default set before implementing them.
7. Keep the field used for grouping identical to the field used for the resulting filter. Friendly aliases are presentation, not evidence or filter identifiers.

## 3. Existing implementation: reuse before rebuilding

Inspection shows that much of the underlying capability already exists. This is primarily a composition/state-contract project with targeted gaps, not a replacement SIEM engine.

- `frontend/src/App.tsx` already owns query, time/filter terms, event selection, snapshot, Follow, facets, view choice, and comparison state. It composes a Workbench plus separate analysis/investigation/hunt/Sigma views.
- `components/FacetSidebar.tsx`, `api/facets.ts`, and `api/backend.ts` already display and map per-value facets. **Important gap:** `FacetGroup.total` currently means distinct/returned values, not events with that field. Native mapping uses `vals.length`; the browser computation counts distinct values. Neither is a safe presence total.
- `internal/store/query.go` aggregates counts over the full filter in DuckDB. Its facet query currently returns at most 25 nonempty values per field. Field-presence totals and additional requested facet fields need an explicit backend contract; do not calculate them from that bounded result.
- `components/EventTable.tsx`, `QueryBar.tsx`, `HistogramStrip.tsx`, and `Toolbar.tsx` supply the browsing controls to preserve.
- `components/EventInspector.tsx` already has Overview, Fields, and Original modes, lineage, source evidence, comparison, and activity pivots. Recompose this into the lower dock rather than building a second inspector.
- `LineageView.tsx`, `LineageGraph.tsx`, and `LineageEventModal.tsx` provide deeper lineage/evidence affordances. Keep their evidence constraints while changing their presentation and entry points.
- `AnalysisView.tsx` and `backend.analyze` can supply the optional summary; `InvestigationView.tsx` and `backend.investigate` can supply surrounding activity. Keep the engines and separate result semantics.
- `HuntView.tsx`, `SavedHuntsPanel.tsx`, `SigmaView.tsx`, `SigmaSuite.tsx`, and the existing hunt/rule APIs provide the optional Hunt workspace's foundations.
- `EvidenceModal.tsx`, `EvidenceComparison.tsx`, `SourceText.tsx`, and `FieldTree.tsx` provide evidence rendering and comparison. Preserve exact source text and bounded field processing.
- `ConnectionScreen.tsx`, `RecoveryCard.tsx`, and the existing capture/recovery APIs should be reused behind the source entry point. Moving controls must not change lifecycle or consent semantics.

Relevant existing contracts live in `docs/workbench.md`, `search-correctness.md`, `query-snapshots.md`, `credential-lineage.md`, `activity-analysis.md`, `investigation-context.md`, `investigation-hunts.md`, `saved-hunts.md`, `sigma-investigation.md`, `evidence-recovery.md`, `event-comparison.md`, `investigation-reports.md`, `local-aliases.md`, and `database-performance.md`. Preserve their guarantees unless a separately reviewed change explicitly supersedes them.

## 4. Proposed implementation structure

### One review session, explicit contextual modes

Retain one authoritative review state rather than letting each panel maintain another filter/result/selection universe. Small typed components/hooks can be extracted from `App.tsx` incrementally; no new state-management library or application rewrite is required by this plan.

Keep these concepts distinct:

- query draft versus last successfully applied query;
- applied filters/time scope versus a proposed pivot;
- the displayed result snapshot versus live incoming events;
- selected event versus investigation anchor versus a temporary evidence preview;
- selected event versus focused credential node;
- Workbench review state versus Hunt drafts/results/scope;
- the two primary destinations versus contextual inspector/summary/dialog modes.

A contextual transition should carry the selected record and evidence snapshot and retain a return state including query, filters, time window, selection, scroll anchor, and inspector mode. Opening an issuance record must not silently replace the surrounding-activity anchor. Closing a modal must not rebuild the browsing session.

Use the existing `Backend` interface. Add only the missing facet/count capabilities or adapters that verified acceptance criteria require. Keep browser-preview and native behavior explicitly distinguished.

### Evidence and performance invariants

- Keep dataset generation and sequence cutoff attached to selections, lineage, context, original evidence, comparison, and export. A dataset replacement must invalidate old context explicitly.
- Preserve cancellation, stale-response rejection, visible pending/failed states, frozen inspection, cursor pagination, virtualization, and bounded data/field processing.
- Read aggregate counts from the query engine, not from the visible page. Do not load every event into React to create summaries or facets.
- Recorded principal, observed issuance correlation, unresolved/ambiguous lineage, and verified human identity are different things. Never manufacture links from matching names or source IPs.
- Preserve raw bytes/hashes, source versions, large numeric text, lineage limits, and explicit missing-evidence reasons. Never silently select a convenient conflicting source version.
- Keep exports clear about selected/loaded/all-matching/context scope and snapshot. Preserve complete native export and cancellation behavior.
- Capture remains separate from Follow. Creating infrastructure, stopping polling, removing owned infrastructure, and disconnecting an existing queue are distinct actions with deliberate consent.

## 5. Ordered implementation slices

Each slice should land as a small, reviewed change with relevant regression tests and screenshots. Do not start a later feature simply because an earlier screenshot looks complete. No duration estimates or release dates are agreed.

### Phase 0 — confirm the contract and baseline

- Review this roadmap and the current facet mockup; resolve the count-scope/default-field questions below.
- Record the current frontend/native checks and known failures before changing production UI.
- Preserve the visual reference and the old-to-new capability map.
- Define the review-session/state transition contract and a regression checklist.

**Exit:** agreed design scope, reproducible baseline, and no ambiguity about which work is visual versus functional.

### Phase 1 — review-first shell, grid, and lower inspector

- Introduce the Workbench/Hunt navigation model and compact Vector shell.
- Recompose existing table and inspector into the bottom-docked layout; preserve virtualized rows and current query/selection behavior.
- Keep essential query/time/source controls visible and secondary controls progressively disclosed.
- Preserve a reachable home for every existing capability during migration; remove superseded entry points only when their replacement is usable.

**Exit:** import/open existing evidence → browse → select → inspect → continue browsing works at 1440×960 and 1280×800, without requiring a hunt or losing the selected row.

### Phase 2 — left facets and reliable scope/counts

- Reuse `FacetSidebar` with collapsible groups/rail, Add facet, active selections, clear/reset, long-value access, and visible count scope.
- Extend native aggregate types/queries and browser-preview mapping for real presence totals, missing values, truncation, and approved additional fields.
- Preserve exact literal pivots and OR-within/AND-across field semantics.
- Add shared fixtures for sparse fields, empty values, high cardinality, aliases, wildcard-looking values, time filters, and dataset replacement.

**Exit:** all displayed counts can be reconciled to the stated scope, including beyond a loaded page; selecting/clearing facets yields the correct query and coherent selected-event context.

### Phase 3 — contextual lineage, evidence, and comparison

- Put the compact observed credential chain in the inspector, with local node expansion and explicit uncertainty/gap states.
- Reuse full graph/evidence capabilities as contextual expansion rather than a primary workspace.
- Expose Fields, Original, Sources/versions, and A/B comparison without losing review state.
- Make every action's target explicit: selected event, focused credential, issuance record, or compared observation.

**Exit:** trace a recorded session to its observed issuance, inspect original evidence, compare records, and return to the exact browsing context; missing/ambiguous evidence never becomes a fabricated chain.

### Phase 4 — summary and surrounding activity

- Adapt analysis results into an optional compact summary above the same grid, with explicit query/time/snapshot scope.
- Drill down into the existing list rather than introducing another results workspace.
- Adapt investigation results into Around this event with a stable anchor, visible temporary scope, and a clear return.
- Distinguish anchor, inspected neighbor, and any temporary source preview.

**Exit:** browse → summarize → inspect → explore around an event → return retains scope, selection, and scroll; every visible summary/source refers to the correct result context.

### Phase 5 — consolidated Hunt

- Consolidate Indicators, Rules, and Sequences under Hunt while preserving each engine's actual supported semantics and diagnostics.
- Integrate saved definitions and multi-rule runs as local controls.
- Reuse the event inspector and evidence components for results; preserve authoring drafts/results when switching modes or returning to Workbench.
- Make all-imported/current-review/explicit hunt scope deliberate and visible; never silently inherit or discard a Workbench filter.

**Exit:** each hunt type can run, inspect a result, open its evidence, and return without losing its draft or confusing rule matches with proven malicious activity.

### Phase 6 — unified source workflow and scoped utilities

- Consolidate open/import/recovery and capture configuration under the source control; preserve native file/folder/format support and replacement/error states.
- Keep running/paused/retained-resource status visible without reinstating a Capture workspace.
- Preserve verification/preflight, owned-versus-existing infrastructure distinctions, cleanup confirmation, and failure recovery.
- Place export/report choices, settings, aliases, help, and keyboard commands in coherent utility controls.

**Exit:** source changes invalidate stale context safely, existing import/capture/recovery guarantees remain intact, and export targets/scopes are explicit. No live cloud action is performed merely to demonstrate the UI.

### Phase 7 — adversarial acceptance and cleanup

- Run the critical journeys below in both browser fixtures and the native app where required.
- Review screenshots at both target sizes; check keyboard access, focus return, resizing, density settings, long identifiers, and hidden/expanded panels.
- Measure against the existing large-data/performance baseline; keep expensive aggregation and evidence processing off the rendering path.
- Remove obsolete navigation/CSS only after feature parity is verified, and update affected docs/help.

**Exit:** verified end-to-end workflows, explicit remaining limitations, and no regression hidden behind a successful build or a convincing screenshot.

## 6. Verification and adversarial review

Existing frontend commands, verified against `frontend/package.json` during planning:

```sh
npm run build
npm run check:search
npm run check:inspector
npm run check:labels
npm run check:saved-hunts
npm run check:ui-performance
npm run check:capture-ui
```

Run from `frontend/` using the scripts' documented prerequisites; browser checks may require the local dev server. Use the repository's native DuckDB/bridge tests and required platform build matrix for affected native behavior. These commands are the **future implementation gate**, not a claim that the full suite was rerun for this documentation change.

Add regressions specifically for:

- Goal-free startup with no accidental IOC, hidden filter, or case requirement.
- Count scope, sparse field presence, top-value truncation, and full-dataset versus loaded-page counts.
- Filter/query draft/applied state coherence; failed or obsolete searches never present fresh-looking unrelated results.
- Selected row, inspector, raw evidence, and lineage agreeing on record and snapshot.
- A credential pivot changing visible scope explicitly, not leaving a blank query with unexplained filtered results.
- Inspecting contextual evidence without changing the investigation anchor or clearing return history.
- Opening older rows without resetting scroll; returning from Hunt/dialogs without losing review state.
- No hard-coded chain for unrelated identities and no unsupported expression produced by a facet pivot.
- Correct outcome/source display under narrowed summaries and correct target labels on adjacent actions.
- Capture/Follow independence, source replacement, stale generations, cancellation, and export beyond the UI row cap.

Some of these failures occurred in the superseded expanded mockup. They are regression scenarios to prevent, **not claims that the current production application has those bugs**.

Perform a separate critical UX pass after each visible slice: can someone start with no hypothesis, understand what they are looking at, follow evidence, and get back? Record concrete findings and repairs. For a visual-only milestone, keep this review about composition and coherent states; do not turn it into an unrequested implementation project.

## 7. Open decisions before implementation

- **Facet count scope:** existing applied-filter scope or self-excluding/disjunctive counts? Label whichever is chosen.
- **Facet identity/defaults:** which recorded/normalized identity field is grouped, and which groups are open initially? The mock defaults are a proposal, not a global identity-resolution specification.
- **Pane behavior:** confirm default inspector height, resizable/collapsed behavior, and which presentation preferences persist.
- **Hunt scope:** decide the default when entering Hunt and the exact interaction for carrying current review scope across.
- **Summary/context detail:** decide which breakdowns appear first and how deeper existing analysis/investigation controls are disclosed without new top-level tabs.

Keep these as explicit decisions, not reasons to add more permanent menus. Multi-cloud expansion, an always-on alert lifecycle, case management, collaboration, and automated response are **not** part of this agreed UI scope.

## 8. Handoff rules

- Read this document and the visual reference before implementation; reconcile later user decisions here instead of accumulating contradictory mockups.
- Work slice by slice, add targeted failing regressions for real behavior changes, then implement and verify.
- Preserve existing engine/evidence contracts unless a specific gap requires a separately justified change.
- Share visible milestone screenshots and concise status updates; do not leave the user waiting through hidden engineering.
- Implementation is authorized by the subsequent user request. Work on the feature branch and commit verified slices; do not expand beyond the recorded product scope or push/merge without an appropriate request.
