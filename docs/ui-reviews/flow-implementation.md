# Discoverability / desktop polish — implementation verification

September 26, 2026. Branch: `feat/vector-workbench`. Implementation commit: `cedecb8`. Scope: the approved Events → selected event → optional related/credential/comparison workflow and approachable Hunt. No backend, dependency, AWS, capture or evidence-store changes; no push/release.

## Implemented

- Events and Hunt are the primary destinations; Data sources is a distinct utility. Quick filters and Column layout name their purposes, with search/filter versus display controls grouped separately.
- Related events, Credential chain and Add to comparison stay visible across review-inspector tabs. Original JSON is explicit. Value actions name their owner scope; contextual pivots state that they return to Events before filtering it.
- Related browsing identifies its anchor, relation, time window and full-snapshot scope, with Back to Events restoring browsing state. Relationship shortcuts remain secondary.
- Comparison explains its purpose before the A/B mechanics and shows one/two-record selection progress. Exact original source and lossless value inspection are unchanged.
- Indicators offer type/value entry plus retained bulk drafts and persistent format examples. Examples only append on an explicit click. Sequence starter refuses to replace nonempty steps. Rules lead with rule choice and Run; YAML is explicitly disclosed, retained and revealed for diagnostics. Rules still clearly use full evidence, not Events filters.
- Desktop palette/type/targets/focus are polished without expanding the dense event rows or introducing website cards.

## Executed verification

Final integrated passes:

- `node scripts/check-hunt-discovery.mjs` — actual App/browser preview, no automatic runs, two explicit backend calls, retained input/editor drafts, guarded starter, zero page errors. Real preview backend reports that engine execution requires desktop; no fabricated engine successes.
- `POLISH_LABEL=flow-final node scripts/check-desktop-polish.mjs all` — 1280×800 and 1440×960; eight theme palette pairs, typography, targets, shape, focus, dense geometry, no page errors.
- `node scripts/check-discovery-flow.mjs all` — shell purpose labels, selected-event actions across tabs, explicit related scope/return and comparison progress at both desktop sizes.
- `node scripts/check-hunt-workspace.mjs` — retained modes/drafts/results, exact scope, saved routing, raw/snapshot association, inspector geometry, keyboard mode navigation, cancellation, late-response rejection, diagnostics, saved rules, suites and explicit browser-engine limitations. Synthetic bridge fixture, not real native Hunt engine execution.
- `node scripts/check-hunt-saved-selection.mjs` — saved selection/name/update/rename/delete target isolation, exact scope, no autorun and unrelated state retention.
- `node scripts/check-rule-keyboard.mjs` — arrow/Home/End/Enter navigation, bounds, close-focus return and snapshot-bound originals.
- `node scripts/check-review-navigation.mjs` — actor identity isolation and explicit Hunt full-evidence pivot/return with prior query, draft, selection and nonzero scroll preserved.
- `/home/humpty/go/bin/wails build -tags webkit2_41 -skipbindings` — frontend compiled, native executable packaged at `build/bin/cloudmon`, rerun after the final pivot tooltip/ARIA correction.
- `git diff --check` — clean. Added-line static security patterns produced no findings.

Earlier in the same implementation: comparison/pinning and first-render Hunt-pivot source-association focused checks passed. They were not rerun as a broad suite here.

## Bounded adversarial review

Parent inspected the actual final selected-event, related-event, Hunt, Rules and comparison screenshots. Core actions are visible; return/scope remain distinct; editor disclosure leaves expert controls available; long grid values deliberately truncate while the inspector remains readable. No new layout blocker was found in these captures. The compact Hunt authoring rail scrolls independently; empty results are not filled with fabricated data.

The critical pass found two copy/affordance mismatches and repaired them: related-view value filtering needed to name its return to Events, and the legacy Hunt inspector needed to apply its owner-specific pivot scope to its tooltips/accessibility names. Targeted regressions now pass. Existing tests were updated to use renamed destinations/controls and explicitly open YAML before authoring-pane assertions; evidence/state assertions were retained.

Independent final production-diff/screenshot review passed (`deleg_56d5998c`): no security concerns, logic errors, suggestions or screenshot blockers. It did not repeat tests/builds or claim native-engine acceptance. The final two owner-specific context-button tooltip/ARIA strings were added after the saved review diff; the parent verified those with the passing navigation regression and final native rebuild, without another broad review.

## Evidence and boundaries

- `frontend/test-results/discovery-flow/`: browsing, selected event, related scope, comparison progress; actual React with synthetic data and bounded related-query fixture.
- `frontend/test-results/desktop-polish/flow-final/`: integrated screenshots and measured observations at both target sizes.
- `frontend/test-results/hunt-discovery/`: indicators, sequences, rules and YAML disclosure.
- Known pre-existing `check-vector-layout.mjs` lineage-node-count assertion was reproduced on the untouched baseline during desktop polish. It is not claimed green; no new broad legacy run was undertaken here.
- Browser/UI fixtures and native compilation are not native-window chooser/import/capture E2E. No new cloud work was performed.
