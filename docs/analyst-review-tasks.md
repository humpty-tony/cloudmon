# Approved analyst-review UI — shipping checklist

Approved reference: `docs/ui-reference/analyst-review/cloudmon-review.html` (synthetic visual mock). This supersedes earlier generic field-list/bottom-dock layouts. User authorized production implementation and economical parallelism. Continue on `feat/vector-workbench`, starting at `07b4f89`. Commit each unique slice locally; no push/merge authorization.

## Execution rules

Ship implementation first. Reuse existing engines and checks; perform a narrow typecheck/changed-path smoke per meaningful change and one final build/integration/visual pass. No full-suite loops, broad new test matrices or reviewer fan-out. Preserve raw evidence, snapshot scope, missing lineage, filter correctness and deliberate capture consent. Keep this checklist synchronized at commits and give brief milestone updates.

## Unique tasks, in integration order

- [ ] **AR-1 — Compact facets.** Four useful default groups; per-value distribution bars; one count-scope label; searchable returned values and exact literal filters; per-group metadata disclosure; selected missing/excluded values stay removable. Owned by facet worker: `FacetSidebar.tsx`, `facet-sidebar.css`, `api/facets.ts` only.
- [ ] **AR-2 — Workbench composition.** Tight search/source/scope chrome, full-height facet rail, event results and collapsible histogram above the grid (not above inspector), retained optional activity summary. Parent-owned App/workbench/toolbar composition.
- [ ] **AR-3 — Event grid and navigation.** Recorded target/resource summary in normal bounded row transport; useful default columns; previous/next inspector actions. Preserve row virtualization, custom columns and exact source retrieval. Parent-owned row projection/model/grid/presets; coordinate optional inspector navigation props with AR-4.
- [ ] **AR-4 — Meaning-first inspector.** Deterministic outcome headline, concise actor/session, recorded target, origin, contextual lineage action, evidence disclosure. Exact Fields/Original and existing safety/compatibility retained. Inspector worker owns `EventOverview.tsx`, `EventInspector.tsx`, `event-inspector.css`, optional new `api/eventPresentation.ts`.
- [ ] **AR-5 — Contextual review flow.** Snapshot-bound session/source/resource activity and surrounding-event results in the same Workbench area. Label replaced/inherited scope explicitly; support returning to prior filters, selection and scroll. Reuse native investigation/analysis engines; never invent counts from loaded rows.
- [ ] **AR-6 — Unified source controls.** One Sources entry point wraps existing offline import/recovery and capture setup/status/cleanup controls. Do not auto-provision or remove cloud infrastructure; preserve existing confirmations.
- [ ] **AR-7 — Bounded integration.** One frontend build, focused changed-flow/browser/native checks as warranted; update affected legacy selectors; inspect screenshots at 1440×960 and 1280×800; record remaining limitations honestly.

## Scope boundaries

- Existing consolidated Hunt stays functional; no new authoring workspace or detection engine.
- No invented risk score, first-seen verdict, external intelligence enrichment or verified human identity.
- Approved mock contains synthetic illustrative lineage. Production uses the existing snapshot-bound resolver.
- Historical `contextual-flows`, `sources`, `acceptance` tasks are covered by AR-2/5, AR-6, AR-7 respectively, not duplicate work.

## Progress log

- Planning: tasks separated; two non-overlapping workers (facets and inspector), parent owns shared integration. Production implementation underway; no task checked complete yet.
