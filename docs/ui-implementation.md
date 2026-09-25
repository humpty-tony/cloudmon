# Vector UI implementation — progress and resume checklist

**Start here after a session reset.** Product decisions and acceptance criteria live in `ui-roadmap.md`; visual references live in `ui-reference/`. This file records execution state, not new product requirements.

## Current checkpoint

- Main checkout: `/home/humpty/projects/cloudmon`
- Active implementation branch: `feat/vector-workbench`
- Verified baseline/design commit: `d6953e5` — `docs(ui): preserve Vector roadmap and visual reference`
- Original production baseline: `a4afbf3`
- User authorized real implementation and incremental commits. No push or merge has been requested.
- **Current implementation is incomplete. The new Workbench regression is RED; do not describe this branch as fully passing.**
- Production edits currently on disk but not committed: `frontend/src/App.tsx`, `frontend/src/components/TitleBar.tsx`.
- New test currently on disk but not committed: `frontend/scripts/check-vector-workbench.cjs`.
- Do not discard, reset, or overwrite this work when resuming. Inspect `git status` and the diff first.

## Checklist rules

- `[x]` means the specific item was completed and verified. An unchecked parent/slice is not complete just because a child item is checked.
- Leave written-but-unverified changes unchecked and explain their current state.
- Record test commands and outcomes, commit IDs, review findings, and the next concrete action at each handoff/commit.
- Read back the branch/commit state before recording it. Do not prefill expected hashes or mark delegated work done from intent.
- Commit only the relevant verified slice; preserve unrelated work. Keep this checklist in sync in the same commit where practical.

## Phase 0 — branch, design record, baseline

- [x] Create and switch to `feat/vector-workbench`.
- [x] Commit the roadmap and ten reference screenshots: `d6953e5`.
- [x] Record implementation authorization and conservative initial choices in the roadmap: applied-filter facet counts; existing recorded `userName` grouping.
- [x] Run the complete existing frontend baseline chain successfully (commands below).
- [x] Run the native Go/DuckDB baseline successfully on this Linux host (command below).
- [x] Isolate parallel work into dedicated worktrees with non-overlapping ownership.
- [ ] Finalize and verify the shared review-state transition contract during the first implementation slice.

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
- [ ] Fix state retention without resetting the search snapshot or selection.
- [ ] Re-run the retention regression to GREEN, including scroll and inspector mode.
- [ ] Integrate the lower-dock inspector and compact Vector layout.
- [ ] Adapt the existing capture UI navigation selectors without weakening its assertions.
- [ ] Run relevant existing regressions and the production build.
- [ ] Perform independent code review and adversarial visual review at both target sizes.
- [ ] Commit the verified shell/retention slice and record its hash here.

### Exact next action

Run from `frontend/`:

```sh
node scripts/check-vector-workbench.cjs
```

Last observed failure:

```text
Leaving Workbench must retain an unapplied query draft
actual: ''
expected: 'eventName=GetSecretValue'
```

The current `App.tsx` switches views with conditional rendering, unmounting `QueryBar` and the inspector/table. The test also covers Hunt draft retention, which has not yet been reached because the earlier assertion fails. Implement stable/lazy-mounted workspace containers or equivalent explicit retained state; preserve keyboard ownership and avoid making hidden panes issue unintended operations. Then rerun the full test rather than checking only the first assertion.

The current secondary Hunt bar and contextual Analysis return control are transitional. Do not mistake them for completion of the final consolidated Hunt or in-grid summary designs.

## Phase 2 — truthful facets (delegated; not integrated)

- [ ] Implement/test native field presence, missing counts, distinct counts, and top-value truncation.
- [ ] Match the browser aggregate contract without inventing totals for legacy fixtures.
- [ ] Implement default groups, Add facet, collapse, explicit count scope, and literal include/exclude actions.
- [ ] Verify sparse fields, high cardinality, missing values, full-snapshot counts, and filter semantics.
- [ ] Review the delivered diff independently, integrate, run native/frontend regressions, and commit.

## Phase 3 — contextual lower inspector (delegated; not integrated)

- [ ] Implement/test optional `layout="dock"` with backwards-compatible side mode.
- [ ] Show real observed lineage and explicit missing/ambiguous/error states, never a hard-coded chain.
- [ ] Keep Fields, Original, Sources/versions, comparison, and local expansion accessible.
- [ ] Add optional `onInvestigate(event, snapshot)` integration callback while retaining existing fallback behavior.
- [ ] Verify layout, keyboard access, exact evidence and snapshots at both target sizes.
- [ ] Review, integrate into the parent shell, run regressions, and commit.

## Phase 4 — summary and surrounding activity (not started)

- [ ] Add compact optional summary above the same grid using the existing analysis engine.
- [ ] Keep summary scope, snapshot, drill-down, and advanced capabilities explicit.
- [ ] Present surrounding activity in Workbench with a stable anchor and clear return.
- [ ] Keep neighbor inspection and temporary original-evidence previews separate from the anchor.
- [ ] Verify return scope, draft, selection, and scroll; review and commit.

## Phase 5 — consolidated Hunt (delegated; not integrated)

- [ ] Implement/test one HuntWorkspace with Indicators, Rules, and Sequences modes.
- [ ] Retain drafts/results across modes and destination switches.
- [ ] Preserve saved-definition cross-mode loading, scope, cancellation, snapshots, diagnostics, and rule suites.
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

Last checked: all three workers were running. **Do not assume they survive a session reset.** Inspect their worktrees before restarting work. They were told to stage only owned files and deliver a binary patch, not commit, push, or touch the parent checkout. Expected patch destinations below are requests, not proof that the files already exist.

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

### Integration precautions

- The parent Workbench test uses port 5191. Existing capture/performance checks use 5181/5182 and create their own servers.
- Dependencies are symlinked from the parent checkout into worker worktrees. Use distinct Vite cache directories for concurrent fixture servers; do not mutate shared dependencies.
- Read each patch and verify its reported tests yourself before marking the slice complete. Check patch applicability before applying; preserve parent work.
- Worktrees persist outside Hermes scratch cleanup. Scratch patches/transcripts are supporting artifacts, not the only copy of the code.
- If a worker has stopped, resume from its real diff/staged files rather than respawning an overlapping implementation blindly.
