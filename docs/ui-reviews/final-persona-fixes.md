# Final persona-review corrections

Scope: five findings from the September 26, 2026 review of `818b5cb`; no AWS operations, capture changes, dependency upgrades, push or release.

## Verified behavior

- **SOC-01:** actor include/exclude falls back to the recorded ARN when principal ID is missing; with neither identifier, the actor cell offers no pivot. Distinct actors no longer share an empty-ID filter.
- **IR-01:** Hunt pivots navigate to temporary Workbench results with an explicit field/value, full-loaded-evidence scope and fixed snapshot. Back to Hunt and Back to browsing are visible. The original Workbench's applied query, unapplied draft, selection and nonzero scroll survive.
- **IR-02:** Rules results support arrows, Home/End and Enter, display the shortcuts, reset the cursor per run and return focus to the grid on inspector close.
- **RESEARCH-01:** either source's changed value can be inspected at its JSON pointer. Worker-side serialization preserves numeric lexemes and types; source-controlled numeric-wrapper lookalikes remain ordinary objects. Work/time bounds, keyboard focus, swap orientation and unchanged originals are retained. Formatting/string escapes may differ in the value preview and are disclosed; full originals are untouched.
- **RESEARCH-02:** the single Pin A/B/Replace control is in the selected-event header, outside collapsed provenance, across Overview/Fields/Original. Loading, missing or failed raw sources remain unpinnable.

## Checks

Each workflow has a recorded focused failure before its correction and a passing regression afterward. Parent reran the comparison/pinning checks independently of their implementation worker.

From `frontend/`:

```sh
node scripts/check-review-navigation.mjs
node scripts/check-rule-keyboard.mjs
node scripts/check-hunt-pivot-source.mjs
node scripts/check-comparison-pinning.mjs
npm run check:inspector
npm run build
```

The optional integration regression requires the isolated private Go review bridge and the original explicitly synthetic 108-record fixture; it is not a standalone mock server:

```sh
CLOUDMON_REVIEW_URL='http://127.0.0.1:5236/?persona=soc' node scripts/check-review-native.mjs
```

All five integrated workflows passed through real React/WailsBackend and Go App/DuckDB queries. Exact original text was compared before/after swapping; Workbench scroll/selection were compared for exact equality. The bridge substitutes host-only logging/window helpers, not evidence queries. No page errors were recorded.

Production native build, from repository root:

```sh
/home/humpty/go/bin/wails build -tags webkit2_41 -skipbindings
```

Frontend type checking, production frontend/native builds and `git diff --check` passed. Vite retains its large-chunk warning. No generated bindings changed.

## Evidence and boundaries

- Final actual-App screenshots and verification are in `~/.hermes/reports/cloudmon/2026-09-26-ux-fixes/`.
- Comparison/pinning fixtures also cover 1280×800 and 1440×960, unavailable sources, bounded parsing, exact integers, HTML-like source text and keyboard focus containment.
- Parent visually inspected the final 1280×800 native-backed comparison and pinning screenshots; no blocking layout issues remained.
- This verifies browser interaction against the native backend and compilation of the production executable. It does **not** close the separately documented native-window file-chooser/import acceptance gap.
- Independent source/UX review found one additional blocker: first committed Hunt-pivot event B could briefly receive event A's raw text. A separate worker reproduced the failure with `useLayoutEffect` prop observation and corrected source association to event sequence plus snapshot. Parent independently reran the regression, navigation/Rules workflows and final native build. This targeted test uses the real pivot component with synthetic backend/stubbed children; no new native-window or real-inspector pinning claim is made.
- The integration bridge exited PASS with all three isolated datasets at maxSeq 108; both bridge and frontend review server were stopped. The all-five native-backed integration run preceded the final source guard; the guard has the focused RED→GREEN verification described above.
- No additional broad review was run. Commit/checklist status is recorded in `../ui-implementation.md`.
