# Hunt and inspector hierarchy cleanup

September 26, 2026. Branch `feat/vector-workbench`, baseline `a73a089`. User approved the concrete review findings; no backend/query/evidence/AWS/dependency changes, push or release.

## Completed presentation changes

- Indicators default to type/value entry and a removable list. Bulk editing is an explicit alternative over the same canonical text, not a second draft. Changing modes or disclosure retains inputs. Contextual examples follow the selected type; nothing runs automatically. List rendering stops at 100; excessive/malformed bulk input remains visible as a validation error and cannot run.
- Scope is left and execution right in the same full-width command row for Indicators, Sequences and Rules. Rules still explicitly says that Events filters do not apply. Existing rule choice, optional YAML, suite access, diagnostics, cancellation, snapshot identity and retained results are preserved.
- Removed redundant Rules scope/disclaimer strips. Results carry the investigative-lead caution; sequence examples and detailed matching instructions are explicit disclosures. Hunt tabs retain descriptive tooltips without a repeated purpose sentence.
- Selected-event actions remain visible across tabs as content-sized, single-line controls rather than equal-width boxes. Headline/evidence retain hierarchy. Facet copy is shorter but still identifies returned-value search and matching-event counts; detailed scope remains in the existing title.

## Verification executed

- `node scripts/check-hunt-discovery.mjs`: RED on old always-visible bulk editor, GREEN on list/bulk round trips, literal-preserving removal, contextual example, invalid hidden-bulk state, no autorun, explicit sequence starter, compact rule controls, retained YAML and suite access. Actual React/browser preview, zero page errors; two explicit executions honestly report the desktop-engine limitation rather than fabricated matches.
- `node scripts/check-discovery-flow.mjs all`: RED on old wrapped/equal-width inspector actions; GREEN for compact actions and the existing browse/related/return/comparison flows at 1280×800 and 1440×960.
- `POLISH_LABEL=hierarchy-final node scripts/check-desktop-polish.mjs all`: typography, targets, keyboard focus, eight theme token-pair checks and both desktop viewports pass, zero page errors.
- `node scripts/check-hunt-workspace.mjs`: existing synthetic-bridge checks pass for scopes, retained modes/drafts/results, saved routing, source identity, cancellation/late responses, diagnostics, suites and two-size layout.
- `node scripts/check-hunt-saved-selection.mjs`: saved update/rename/delete target isolation, exact scope and unrelated draft/result retention pass.
- `node scripts/check-rule-keyboard.mjs`: Rules navigation and snapshot-bound original/focus checks pass.
- `npm run build` and `/home/humpty/go/bin/wails build -tags webkit2_41 -skipbindings`: frontend and production native executable built successfully. Existing large-bundle warning only.
- `git diff --check` and added-line security scan: no findings.

Existing authoring tests now explicitly open bulk editing; their state/source assertions were not weakened. Other adjusted scripts were not all rerun: no full capture suite, new native-engine integration run or cloud access was performed.

## Visual / independent review

Parent inspected current actual-App 1280 screenshots of Indicators, Rules and selected event: no new blocking clipping or task ambiguity. Full inspector labels fit without wrapping; scope/Run placement is consistent; default indicator list and bulk alternative are distinct. Screenshots use synthetic evidence, not live cloud activity.

- `frontend/test-results/desktop-polish/hierarchy-final/`: both desktop viewport captures and measurements.
- `frontend/test-results/hunt-discovery/`: list, sequence, Rules and YAML states.
- `frontend/test-results/discovery-flow/`: selected event, related return and comparison states.

Bounded independent review `deleg_148759f5`: **passed**, with no security concerns, logic errors, suggestions or visual blockers. Reviewed production diff, static scan, targeted source and three supplied screenshots; did not repeat tests or modify files. Parent verified the current production diff exactly matched the approved snapshot before committing.

Local implementation commits: `4a6d2aa` (Hunt hierarchy and authoring checks), `25481d4` (inspector/facet hierarchy). This checked handoff is committed separately. No push or release. Native compilation and browser fixtures are not native-window import/capture E2E acceptance.
