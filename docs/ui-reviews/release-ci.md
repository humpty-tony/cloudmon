# Release CI test maintenance — September 26, 2026

## Scope

The production implementation and Linux native E2E were already verified. Before pushing, the actual browser commands in `.github/workflows/build.yml` exposed stale integration-test assumptions left behind by the intentional UI redesign. These corrections change **test scripts only**, not application code or workflow gates.

## Corrections

- Navigation now asserts **Events / Hunt**, current event-count labels and the right-hand inspector heading. Repeated returns still compare exact visible event sequences, nonzero scroll, selection, source and unapplied drafts.
- The graph layout check expects three credential nodes **plus the selected activity**, explicitly distinguishes them, and uses the current Related events → relationship rail path.
- Facet checks verify the compact visible count label and its full applied-query/time/snapshot explanation.
- Standalone inspector tests require a pinned snapshot for investigation and use current comparison action names. Original issuance, exact numeric evidence, stale async results and focus checks remain.
- Overlay checks follow the current evidence disclosure, persistent Credential chain and embedded Analysis view. The retired contextual dialog is replaced with contextual-grid scope/return assertions; standalone overlay and delayed-original coverage remains, with added current Hunt inspector coverage.
- Capture integration checks follow the current disclosures, selected-event layout, on-demand graph, comparison controls and retained-view scoping. Fixture metadata and saved-hunt synchronization match the existing contracts. Capture consent, infrastructure recovery/cleanup, pinned snapshots, original source, cancellation/late results, comparison and report export checks remain.

## Parent verification

- [x] `go test -p 1 -tags webkit2_41 ./...`.
- [x] `python3 -m unittest discover -s scripts -p 'test_*.py' -q` — 13 release/startup helper tests.
- [x] `npm run check:search`, `check:inspector`, `check:labels`, `check:saved-hunts`.
- [x] `npm run check:workbench` — both desktop sizes, including repeated retained-navigation cycles.
- [x] `npm run check:vector-layout` — both desktop sizes.
- [x] `npm run check:inspector-dock` — 28 checks.
- [x] `npm run check:facets` — shared semantics, standalone UI and actual-App integration at both sizes.
- [x] `npm run check:workspace-overlays` — 36 passing cases across both desktop sizes, independently rerun after worker handoff.
- [x] `npm run check:ui-performance` — bounded-work assertions for the synthetic 20,000-row fixture; timings are observations, not latency guarantees.
- [x] Generate `TestInvestigationReportFixture` through Go, then `CLOUDMON_REPORT_FIXTURE=<generated report> npm run check:capture-ui` — completed with `errors: []`, independently rerun after worker handoff.
- [x] Added-line static scan found no matches for the reviewed secret/injection/unsafe-execution patterns.
- [x] Independent test-diff review passed (`deleg_2c0928b0`): no security, logic or assertion-coverage blockers. The reviewed diff is verified unchanged before the accompanying commit.
- [ ] Exact-head GitHub platform matrix and tagged publication; local checks do not substitute for those results.

The earlier native evidence is documented separately in [native-e2e.md](native-e2e.md). Browser fixtures remain synthetic and must not be represented as live AWS or native-window behavior.
