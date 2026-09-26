# Analyst-review shipping verification

Scope: approved analyst-review mock, implemented on `feat/vector-workbench`. Local delivery only; no push, PR, remote CI, real AWS provisioning, or full-product acceptance claimed.

## Shipped slices

- `4b3d721` — compact Workbench composition and in-grid histogram/summary.
- `b24b36b` — compact facets and scoped distribution bars.
- `f9d6f57` — bounded recorded targets and previous/next browsing navigation.
- `cab3e96` — meaning-first right-hand inspector.
- `bc933ff` — snapshot-bound contextual grid and exact browsing return.
- `006bb77` — Sources import/recovery/capture entry point.

## Verified commands

- `npm run build` — passed (TypeScript and Vite). Existing large-bundle warning remains.
- `npm run check:vector-layout` — passed at 1440×960 and 1280×800: main pane geometry, recorded targets/errors/origin, exact Original evidence, no background lineage resolution, snapshot-bound graph popup and focus return, previous/next with tab retention, contextual scope and query failure/retry, exact selected event/nonzero scroll/applied-count/draft restoration, Sources focus containment/cancel/offline reopen, failed import retention and successful replacement reset.
- `npm run check:facets` — passed: shared filter/normalized-name contracts, component disclosure/literal filtering/unknown counts, and both actual-App viewport checks. Migrated legacy selectors to four default groups and explicit Details controls without removing semantic assertions.
- `go test -p 1 -tags webkit2_41 ./internal/store -run 'TestReviewTargetProjection|TestIngestAndPage' -count=1` — passed. Includes target projection through native search and investigation, malformed target exclusion and no raw record in row transport.
- `git diff --check` — passed.
- Reused worker evidence: event presentation tests, inspector tests, overview SSR safety checks and focused facet smoke. No further reviewer agents or full-suite runs.

## Bounded adversarial UX review

- Found exact-return scroll drift when contextual selection changed the hidden browse table cursor. Fixed by retaining the browse table's original selection/cursor for the entire contextual visit. Exact scroll/selection assertions now pass at both sizes.
- Found native-dialog Tab escape through the final Sources control. Added explicit first/last focus wrapping; containment and Escape focus return pass.
- Prevented contextual scope from offering browsing-result exports, repin actions or command-palette mutations. Browsing search controls stay disabled and scope replacement is named beside the contextual results.
- Around-event action stays disabled until its snapshot exists. Query failures retain a reachable return and retry action.
- Visually inspected main review at both sizes, the compact contextual results, and Sources. Default facets fit; event targets and the meaning-first inspector remain readable; Around this event is visible in the compact main review. Sources scrolls locally when needed.

## Screenshots and boundaries

`frontend/test-results/vector-layout/` contains `workbench-{1280,1440}.png`, `lineage-popup-{1280,1440}.png`, `context-{1280,1440}.png`, `sources-{1280,1440}.png`, and `layout.json`.

These are the real App with synthetic imported events and explicitly synthetic context/graph responses. Native target projection is separately tested; browser fixtures are not proof of native lineage correlation or live AWS lifecycle behavior. The plain browser preview still requires the desktop engine for real context queries.

The broader legacy capture/overlay/workbench harnesses were not rerun in this bounded pass; older selectors may still require migration. Hunt was not redesigned in this slice. No complete cross-platform/native-package/remote-CI acceptance is claimed. Capture consent, removal confirmations and retained-evidence engines were reused, not replaced.
