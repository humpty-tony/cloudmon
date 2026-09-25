# Vector UI implementation — progress and resume checklist

**Start here after a session reset.** Product decisions and acceptance criteria live in `ui-roadmap.md`; visual references live in `ui-reference/`. This file records execution state, not new product requirements.

## Current checkpoint

- Main checkout: `/home/humpty/projects/cloudmon`
- Active implementation branch: `feat/vector-workbench`
- Verified baseline/design commit: `d6953e5` — `docs(ui): preserve Vector roadmap and visual reference`
- Original production baseline: `a4afbf3`
- User authorized real implementation and incremental commits. No push or merge has been requested.
- **Navigation repair is applied to the parent checkout and targeted checks pass.** Repeated scroll/visible-row retention, portal/request deactivation and Source evidence focus containment have regressions. This is a tested local progress checkpoint, **not final UX acceptance**. Facets, lower dock, consolidated Hunt, summary/around and source-control integration remain unfinished.
- Uncommitted implementation files: `frontend/src/App.tsx`, `frontend/src/components/TitleBar.tsx`, `frontend/src/components/EventTable.tsx`, and `frontend/src/workbench.css`. Test/CI wiring also changes `frontend/package.json`, `frontend/scripts/check-capture-ui.cjs`, and `.github/workflows/build.yml`.
- New test currently on disk but not committed: `frontend/scripts/check-vector-workbench.cjs`.
- Do not discard, reset, or overwrite this work when resuming. Inspect `git status` and the diff first.

## Checklist rules

- `[x]` means the specific item was completed and verified. An unchecked parent/slice is not complete just because a child item is checked.
- Leave written-but-unverified changes unchecked and explain their current state.
- Record test commands and outcomes, commit IDs, review findings, and the next concrete action at each handoff/commit.
- Read back the branch/commit state before recording it. Do not prefill expected hashes or mark delegated work done from intent.
- Commit only the relevant verified slice; preserve unrelated work. Keep this checklist in sync in the same commit where practical.

## Recurring adversarial UX checkpoints

Run these during implementation, not only in Phase 7. The user explicitly requested periodic adversarial UX reviews. Use a separate critical pass after smaller visible changes and an independent reviewer at the meaningful integration checkpoints below. Test the actual goal-free review → select → understand → pivot → return journey, not just rendering or happy-path assertions.

- [ ] **UX-1 — navigation/state retention:** independently attack draft/applied-query coherence, selection/scroll/inspector retention, hidden-view focus, source replacement, and secondary-control discoverability. Completed by `sa-1-58e7c95f` / `deleg_afac83f6`: **REJECT** pre-fix UX-1. Report `frontend/test-results/vector-navigation-ux-audit/report.md` reproduces repeated-scroll loss, portal leakage and Source evidence focus escape. Fixes and fresh retests remain pending.
- [ ] **UX-2 — integrated facets and lower inspector:** verify count scope, literal filtering, selected-event/evidence agreement, identity uncertainty, reachable groups, and usable grid/dock space.
- [ ] **UX-3 — contextual journeys:** challenge summary drill-down, surrounding-activity anchor, evidence/comparison target labels, and exact return scope/selection/scroll.
- [ ] **UX-4 — consolidated Hunt:** try cross-mode draft/result loss, ambiguous inherited scope, result-to-evidence pivots, and return to browsing.
- [ ] **UX-5 — unified source controls:** challenge offline recovery, replacement/error/cancellation states, stale context, and deliberate capture/cleanup consent using fixtures only.
- [ ] **UX-6 — integrated acceptance:** repeat the complete journey after integration; earlier component reviews do not establish final acceptance.

For each checkpoint, exercise 1440×960 and 1280×800, keyboard/focus and long identifiers, plus relevant empty/error states and rapid pivots. Record the exact reviewed revision/diff, reproducible steps, expected/actual outcomes, severity, screenshots, successful scenarios, and browser/native limitations. Distinguish current-slice regressions from intentionally deferred design work. Keep this checklist unchecked until the parent verifies the report and any required fixes/retests. Do not call a slice UX-approved solely because its code review or automated tests passed.

## Phase 0 — branch, design record, baseline

- [x] Create and switch to `feat/vector-workbench`.
- [x] Commit the roadmap and ten reference screenshots: `d6953e5`.
- [x] Record implementation authorization and conservative initial choices in the roadmap: applied-filter facet counts; existing recorded `userName` grouping.
- [x] Run the complete existing frontend baseline chain successfully (commands below).
- [x] Run the native Go/DuckDB baseline successfully on this Linux host (command below).
- [x] Isolate parallel work into dedicated worktrees with non-overlapping ownership.
- [x] Verify the initial transition contract: retain review/authoring state within a dataset session; reset it deliberately when replacing the source.

### Verified baseline commands

From `frontend/`, exit 0:

```sh
npm run build && npm run check:search && npm run check:inspector && npm run check:labels && npm run check:saved-hunts && npm run check:ui-performance && npm run check:capture-ui
```

From the repository root, exit 0:

```sh
go test -p 1 -tags webkit2_41 ./...
```

The browser baseline includes capture bridge fixtures, not real AWS provisioning. Native tests exercised the local Go/DuckDB code. Windows/macOS builds and remote CI have **not** been run for this branch.

## Phase 1 — shell and stable review state (parent, in progress)

- [x] Add a browser test that imports synthetic CloudTrail through the real browser import/search path.
- [x] Observe RED for four primary destinations; implement two primary buttons and observe GREEN for that navigation assertion.
- [x] Keep existing Rules and Analysis entry points reachable while consolidation is in progress.
- [x] Add the next regression: preserve unapplied query draft, selection, inspector mode, scroll, and Hunt draft across destination switches.
- [x] Observe the expected RED failure: the unapplied query draft is lost when returning to Workbench.
- [x] Fix same-dataset state retention with lazy-mounted retained views, without replacing the applied search or selection.
- [x] Re-run retention to GREEN at 1440×960 and 1280×800, including scroll and inspector mode.
- [x] Add and observe RED→GREEN for source replacement from Hunt: return to Workbench and clear the old dataset session.
- [x] Add `npm run check:workbench` and wire it into the Linux CI job (local execution verified; remote CI not yet run).
- [ ] Integrate the lower-dock inspector and compact Vector layout.
- [x] Adapt existing capture UI navigation selectors and restrict the analysis layout assertion to the visible retained view; original assertions remain in place.
- [x] Run the production build and existing capture, performance, search, inspector, labels, and saved-hunt checks successfully for the navigation slice.
- [x] Apply and parent-verify the overlay/request fix: inactive popovers/dialogs unmount, late Hunt/Analysis requests are invalidated across leave/return, and drafts/results remain retained.
- [x] Parent-verify repeated navigation at both sizes/dwell timings: ten cycles retain scrollTop 1040 and exact visible event sequences, source identity and draft.
- [x] Reproduce Source evidence focus escape (Tab 2, both sizes), then fix and verify forward/backward containment from the loaded source, background inertness, Escape focus return and cleanup.
- [x] Re-run overlay checks, inspector checks, capture UI and build successfully on the parent checkout; add overlay command to CI.
- [ ] Perform the next bounded independent integrated review; the initial pre-fix reviews remain historical failures, not approval of this revised tree.
- [ ] Commit the verified shell/retention slice and record its hash here.

### Exact next action

**Latest checkpoint:** navigation repairs and Source evidence focus fix are now in the parent tree and tested. Extra fix workers were stopped for usage efficiency; no worker remains active. Continue serially from preserved component deltas—do not restart a fan-out. Reconcile facet labels/search first, then dock/Hunt activation and saved-target fixes. The paragraph below records the earlier dispatch rather than live ownership.

The interrupted fix/audit/reviews resumed in batch `deleg_afac83f6` (worker IDs below). Verify their current status after any reset rather than assuming they remain live. On delivery, inspect/apply only the overlay fix delta, rerun its regressions and navigation/build checks, resolve UX findings, and obtain fresh code review before committing implementation. The three component patches are complete in isolated worktrees and parent-rerun checks pass, but independent reviewers rejected uncovered edge cases. Targeted fixes and integration are pending; current ownership/findings are recorded in `ui-reviews/component-verification.md`. Do not reimplement the old query-draft fix or restart finished component implementation.

The regression command from `frontend/` is:

```sh
npm run check:workbench
```

Verified at both desktop sizes: two primary destinations; retained unapplied query, selected event, inspector mode, table scroll and Hunt draft; replacing the source starts a clean Workbench session. Query draft loss was fixed by retaining visited views rather than unmounting them. The next RED failure was scroll `0 !== 700`: an empty hidden virtual range removed both spacers and clamped the scroll offset. Preserving the full-size spacer in `EventTable` fixed it without mounting the entire dataset. The existing 20k-row performance check still passes.

Only visited secondary views mount. Replacing a dataset resets visited views, selected lineage overlay and the Workbench session key, preventing hidden old-dataset state from appearing current. Saved configurations remain in their existing persistence layer.

The earlier spacer fix alone was insufficient after repeated returns. EventTable now preserves cached row measurements while its workspace is inactive. `check:workspace-overlays` covers parent and standalone overlay lifetimes, hidden keyboard handlers, delayed requests, and source-modal containment. The parent observed the focus regression RED at both sizes before fixing it; all focused checks, `check:inspector`, `check:capture-ui`, and `build` now pass. Existing chunk-size warnings remain. Full integrated component/native/platform acceptance is still pending.

The current secondary Hunt bar and contextual Analysis return control are transitional. Do not mistake them for completion of the final consolidated Hunt or in-grid summary designs.

## Phase 2 — truthful facets (isolated checks verified; not integrated)

- [x] Implement/test native field presence, missing counts, distinct counts, and top-value truncation in the isolated facet worktree.
- [x] Verify browser/native parity across nine shared cases and unavailable totals for legacy metadata in the isolated worktree.
- [x] Implement/test default groups, Add facet, collapse, explicit count scope, and literal include/exclude actions in the isolated worktree.
- [x] Parent rerun: sparse/high-cardinality/missing/full-snapshot filter cases, facet browser UI, build, full native suite and store vet pass in the isolated worktree.
- [ ] Review the delivered diff independently, integrate, run native/frontend regressions, and commit.

## Phase 3 — contextual lower inspector (isolated checks verified; not integrated)

- [x] Implement/test optional `layout="dock"` with backwards-compatible side mode in the isolated inspector worktree.
- [x] Test lineage-response rendering and explicit missing/ambiguous/error states with synthetic bridge fixtures; no native GUI claim.
- [x] Verify Fields, Original, Sources/versions, comparison, and local expansion in isolated component checks.
- [x] Add/test optional `onInvestigate(event, snapshot)` callback with exact arguments and existing fallback behavior.
- [x] Parent rerun: 11 short-dock checks, keyboard/focus, exact evidence/snapshots and both target sizes pass; isolated production build passes.
- [ ] Review, integrate into the parent shell, run regressions, and commit.

## Phase 4 — summary and surrounding activity (not started)

- [ ] Add compact optional summary above the same grid using the existing analysis engine.
- [ ] Keep summary scope, snapshot, drill-down, and advanced capabilities explicit.
- [ ] Present surrounding activity in Workbench with a stable anchor and clear return.
- [ ] Keep neighbor inspection and temporary original-evidence previews separate from the anchor.
- [ ] Verify return scope, draft, selection, and scroll; review and commit.

## Phase 5 — consolidated Hunt (isolated checks verified; not integrated)

- [x] Implement/test one HuntWorkspace with Indicators, Rules, and Sequences in the isolated Hunt worktree.
- [x] Parent rerun verifies draft/result retention across modes and hidden destination switches in the isolated fixture; activation/portal integration remains pending.
- [x] Parent rerun: nine Hunt check groups cover saved routing/scope, cancellation/snapshots, diagnostics, suites, shared inspection and layout; isolated build passes.
- [ ] Integrate with the parent using existing SigmaView props plus the current review filter.
- [ ] Review, run relevant existing/new checks, and commit.

## Phase 6 — source control and utilities (not started)

- [ ] Combine open/import/recovery and capture configuration under the source control.
- [ ] Retain explicit verification, preflight, pause/resume, owned-resource cleanup, and existing-queue disconnect semantics.
- [ ] Keep source replacement and stale-generation behavior safe.
- [ ] Preserve scoped exports/reports, settings, labels, help, and command access.
- [ ] Verify with native/bridge checks as appropriate; no live AWS actions for UI validation.
- [ ] Review and commit.

## Phase 7 — integrated acceptance (not started)

- [ ] Run all new and existing frontend checks plus the production build on the integrated tree.
- [ ] Run native Go/DuckDB regressions for the integrated changes.
- [ ] Independently review code/security and the actual goal-free browsing journey.
- [ ] Verify performance bounds, long identifiers, keyboard/focus, resizing, density, and both desktop viewports.
- [ ] Fix findings with regressions; retain screenshots and exact results.
- [ ] Update docs/help and remove superseded UI only after capability parity is verified.
- [ ] Commit the verified result and report remaining native/platform limitations honestly.

## Parallel-work handoff

The three implementation workers completed in `deleg_0274768f`. The parent verified each patch equals its worktree index, contains only owned files, and applies cleanly to the main checkout; checks were rerun independently. No component is integrated or committed yet. Patch digests, parent-run commands and evidence boundaries are recorded in `ui-reviews/component-verification.md`. **Do not restart completed implementation after a reset.** Independent reviews were interrupted by provider limits, resumed, and returned rejection findings. Targeted fix workers now own unstaged deltas in the preserved worktrees; see `ui-reviews/component-verification.md`.

### Facets

- Worker: `sa-0-f96b71d6` in batch `deleg_0274768f`.
- Worktree: `/home/humpty/projects/cloudmon-worktrees/vector-facets`
- Branch: `work/vector-facets`
- Owns `internal/store/query.go`, dedicated facet tests, `frontend/src/api/{facets,backend,types}.ts` for the count contract, `FacetSidebar.tsx`, new facet CSS, and dedicated test fixtures/scripts.
- Must not edit parent `App.tsx`, `TitleBar.tsx`, `workbench.css`, package scripts, general capture tests, or roadmap.
- Expected patch: `/home/humpty/.hermes/cache/scratch/cloudmon-vector-facets.patch`
- Browser-test port: 5192.

### Inspector

- Worker: `sa-1-bc72238a` in batch `deleg_0274768f`.
- Worktree: `/home/humpty/projects/cloudmon-worktrees/vector-inspector`
- Branch: `work/vector-inspector`
- Owns `EventInspector.tsx`, `event-inspector.css`, optional focused lineage-summary component, and dedicated dock tests/fixtures.
- Must not edit `App.tsx`, `workbench.css`, `InlineDetail.tsx`, shared API/types/backend, general capture tests, or roadmap.
- Expected patch: `/home/humpty/.hermes/cache/scratch/cloudmon-vector-inspector.patch`
- Browser-test port: 5193.

### Hunt

- Worker: `sa-2-b4688ca2` in batch `deleg_0274768f`.
- Worktree: `/home/humpty/projects/cloudmon-worktrees/vector-hunt`
- Branch: `work/vector-hunt`
- Owns new `HuntWorkspace.tsx` / `hunt-workspace.css`, existing `HuntView.tsx` / `SigmaView.tsx` as needed, and dedicated workspace tests/fixtures.
- Must not edit parent shell/layout, shared API/backend/types, package scripts, general capture tests, or roadmap.
- Expected patch: `/home/humpty/.hermes/cache/scratch/cloudmon-vector-hunt.patch`
- Browser-test port: 5194.

### Independent review result and fix handoff

Navigation/state code review: worker `sa-0-c9cc076f`, batch `deleg_90cad787`, **completed with `passed=false`**, no security concerns. Reviewed snapshot: `/home/humpty/.hermes/cache/scratch/cloudmon-navigation-review.diff`.

- Reported P2 blocker at `App.tsx:792-809`: retained hidden workspaces do not own body-portaled transient UI. Repro: open Workbench Columns, Shift+Tab to Hunt, Enter; the old popover and backdrop remain above Hunt. Reviewer reproduced this in a browser probe; parent integration regression remains pending.
- Related gap: Hunt/Analysis original-record requests can finish after navigation and open a dialog over the wrong workspace. Invalidate obsolete requests even when the user leaves and returns before completion; do not sacrifice draft/result retention.
- Reviewer suggestions: use unique event identity in retention assertions, check nonzero/restored scroll after the virtualizer settles, cover Rules/Analysis retention and reset. Assigned to the fix worker alongside the focused regressions.
- CI screenshot suggestion addressed locally: the upload paths now include `frontend/test-results/vector-workbench/*.png`. This is configuration only; no remote CI run claimed.

Overlay fix: original worker `sa-0-a44ef3e6` / `deleg_4dab976b` was interrupted by HTTP 429. Resumed worker `sa-0-8d7493ae` in `deleg_afac83f6` owns the preserved worktree `/home/humpty/projects/cloudmon-worktrees/vector-overlays`, branch `work/vector-overlays`. The index contains a snapshot of the parent's pre-fix navigation changes; **only its unstaged delta** is the fix, not the entire `HEAD` diff. Expected patch `/home/humpty/.hermes/cache/scratch/cloudmon-vector-overlays.patch`; expected handoff `/home/humpty/.hermes/cache/scratch/cloudmon-vector-overlays-review.md`. These are requested artifacts, not verified completions. Partial App/Toolbar edits, WorkspaceActivity and overlay-test fixtures survived; the new worker must resume them rather than overwrite. Browser regression port 5196, unique Vite cache. Never stage its untracked `frontend/node_modules` symlink.

Independent UX-1 audit: original `sa-0-b2052db9` / `deleg_8cd92f40` was interrupted by HTTP 429 and its server was terminated. Resumed `sa-1-58e7c95f` / `deleg_afac83f6`, port 5195, recovers saved observations/scripts/screenshots and reviews the unchanged parent UI while the fix runs in isolation. The completed audit rejects pre-fix UX-1; see the report and `ui-reviews/component-verification.md`.

Component review retries in batch `deleg_afac83f6`: facets `sa-2-39dd3166`; inspector `sa-3-539d337c`; Hunt `sa-4-f8fa2457`. Earlier `deleg_d75845d5` reviewers all hit HTTP 429. Resumed component reviewers have now returned `passed=false`; targeted facet/inspector/Hunt fixes are assigned in `ui-reviews/component-verification.md`. No accepted verdict exists; component test success is not acceptance.

Hunt integration precaution: the delivered Hunt patch and overlay fix may both touch `HuntView.tsx`; reconcile both and test nested Hunt mode deactivation as well as top-level switches. Reconcile Hunt-scoped inspector CSS with `layout="dock"`. Rules/suites intentionally disclose all-evidence scope because the native Sigma contract does not accept QueryFilter; do not fake filtering.

### Integration precautions

- The parent Workbench test uses port 5191. Existing capture/performance checks use 5181/5182 and create their own servers.
- Dependencies are symlinked from the parent checkout into worker worktrees. Use distinct Vite cache directories for concurrent fixture servers; do not mutate shared dependencies.
- Read each patch and verify its reported tests yourself before marking the slice complete. Check patch applicability before applying; preserve parent work.
- Worktrees persist outside Hermes scratch cleanup. Scratch patches/transcripts are supporting artifacts, not the only copy of the code.
- If a worker has stopped, resume from its real diff/staged files rather than respawning an overlapping implementation blindly.
