# Vector component verification checkpoint

These are **isolated component implementations, not integrated or accepted UI**. The parent reran the checks below and verified delivered patches against each worktree index. Independent review then found defects; passing the existing tests did not establish acceptance.

## Preserved implementation patches

- Facets: `/home/humpty/projects/cloudmon-worktrees/vector-facets`, branch `work/vector-facets`, 11 staged files. Patch `/home/humpty/.hermes/cache/scratch/cloudmon-vector-facets.patch`, 81,309 bytes, SHA-256 `2cbfb9fb83006bc70474dc6de0513696f595f8045d91a30eda3001f26a7b0fef`.
- Inspector: `/home/humpty/projects/cloudmon-worktrees/vector-inspector`, branch `work/vector-inspector`, seven staged files. Patch `/home/humpty/.hermes/cache/scratch/cloudmon-vector-inspector.patch`, 58,155 bytes, SHA-256 `4d980d873dfa6a51797c4a170c3d47d08f4766e9e8f08407c0d4c5bb48c10742`.
- Hunt: `/home/humpty/projects/cloudmon-worktrees/vector-hunt`, branch `work/vector-hunt`, eight staged files. Patch `/home/humpty/.hermes/cache/scratch/cloudmon-vector-hunt.patch`, 69,635 bytes, SHA-256 `49971dc88a20cdce34e398c0378ff5f4628dbc164cb6d624b90ba75718f99e71`.

All three worktrees are based on `d6953e5`. The parent checkout is `feat/vector-workbench`, with navigation changes on top of `0f5b830`. The parent verified each patch exactly equals `git diff --cached --binary`, excludes dependency symlinks, and passes `git apply --check` against the parent. Preserve these original staged snapshots while fix workers produce **unstaged deltas**. Do not export `git diff HEAD` as a fix-only patch.

## Parent-run checks: actual exit 0

### Facets

From the facet worktree root:

```sh
CLOUDMON_FACETS_OUTPUT=/home/humpty/.hermes/cache/scratch/cloudmon-parent-facet-parity.json go test -p 1 ./internal/store -run TestFacet -count=1
CLOUDMON_FACETS_OUTPUT=/home/humpty/.hermes/cache/scratch/cloudmon-parent-facet-parity.json node frontend/scripts/check-facets.mjs
go test -p 1 -tags webkit2_41 ./...
go vet ./internal/store
```

The shared comparison reported nine cases with real DuckDB/browser metadata and values matching. The full native run reused cached package results; the focused `TestFacet` run was uncached. From `frontend/`, the parent started `check-facets-server.mjs`, verified loopback HTTP readiness, ran `node scripts/check-facets-ui.mjs` and `npm run build`, then stopped the owned server. UI checks covered defaults/counts, exact include/exclude/missing, clearing, active omitted values, limited search, identifiers, legacy metadata and both target sizes.

### Inspector

From the inspector worktree's `frontend/`:

```sh
node scripts/check-inspector-dock.mjs
npm run build
```

All 11 existing dock checks passed, including short-dock geometry, callback arguments, evidence targets/snapshots, lazy fields, pins, stale selection/generation requests, side compatibility and focus. Later review exposed additional mode-change/competing-modal cases not covered by those checks.

### Hunt

From the Hunt worktree's `frontend/`:

```sh
node scripts/check-hunt-workspace.mjs
npm run build
```

All nine existing groups passed: mode/draft retention, saved routing/scope, rules/suites, shared inspection, both viewport layouts, keyboard mode navigation, cancellation/errors, snapshots, and honest browser engine limitations. Later review exposed hidden-modal and saved-target cases outside this coverage.

All three builds retained the existing large-chunk warning. Browser bridge fixtures prove UI behavior, not native engine execution. No live AWS actions, native GUI, Windows/macOS build or remote CI are claimed.

## Review findings: acceptance remains blocked

The resumed UX audit and component reviewers finished; the overall batch `deleg_afac83f6` still awaits the navigation fix worker. The parent read the finished UX report and completed reviewer outputs, without treating incomplete/truncated output as a full final verdict.

- **UX/navigation:** `frontend/test-results/vector-navigation-ux-audit/report.md` rejects UX-1. Repeated returns lose scroll after several cycles even though a first return passes. Workbench portals leak over Hunt. Source-evidence Tab focus escapes into background navigation. Dirty-query applied-scope disclosure needs an integration follow-up.
- **Facets:** review rejects the recorded-identity wording: the existing normalized `userName` can fall back to session-issuer name. Preserve the engine contract but disclose it honestly and add issuer-fallback coverage. An active returned-value search can become concealed after collapsing/reopening the rail.
- **Inspector:** review rejects issuance requests surviving Context-to-Fields/Original transitions and competing evidence dialogs. Effect-unmount guards alone do not handle retained hidden panels.
- **Hunt:** review rejects portals/late requests surviving inner-mode and destination changes. It also reproduced saved-definition target mismatch after cross-mode loading; the destination's panel selection can remain associated with another saved definition. Preserve exact selected update/rename/delete targets.

These are review reports requiring regression/fix verification, not claims that fixes have landed. Read the consolidated final review summaries when delivered for any additional suggestions or qualifications.

## Current fix ownership

- Navigation/portal/request and repeated-scroll work: `sa-0-8d7493ae`, `deleg_afac83f6`, worktree `vector-overlays`; expected fix-only patch `cloudmon-vector-overlays.patch` and handoff `cloudmon-vector-overlays-review.md` in Hermes scratch.
- Facet truthfulness and hidden search: `sa-0-b1e11917`, `deleg_22f6499f`, worktree `vector-facets`; expected `cloudmon-vector-facets-fix.patch` and `cloudmon-vector-facets-fix-handoff.md`.
- Inspector-local issuance/modal ownership: `sa-1-0f53f68b`, `deleg_22f6499f`, worktree `vector-inspector`; expected `cloudmon-vector-inspector-fix.patch` and `cloudmon-vector-inspector-fix-handoff.md`.
- Hunt saved-definition target: `sa-0-bb71aa19`, `deleg_48591e71`, worktree `vector-hunt`; expected `cloudmon-vector-hunt-saved-fix.patch` and `cloudmon-vector-hunt-saved-fix-handoff.md`. Owns the minimal SavedHuntsPanel synchronization as well as HuntView/tests.

Expected artifact names are requests, not evidence of completion. Check live status and real diffs after resets. Hunt nested-mode portal activation still requires parent integration with the navigation activation contract; the saved-target fixer does not own that separate defect.

## Integration gates

- [ ] Verify each fix-only delta and its RED/GREEN evidence, then obtain fresh independent review.
- [ ] Re-run navigation repeatedly, checking settled first-visible identity and offset, not only nonzero scroll or selected event name.
- [ ] Resolve overlapping HuntView changes without discarding either saved-target or activation fixes.
- [ ] Wire facet exclusions/clearing and retain rail state on collapse.
- [ ] Allocate actual lower dock and reconcile Hunt-specific inspector CSS with its optional dock API.
- [ ] Test parent/inner-mode activation, competing dialogs, late requests and modal focus together.
- [ ] Preserve Sigma's explicit all-evidence scope; its existing API does not accept QueryFilter.
- [ ] Commit only reviewed, verified implementation slices. No push or merge is authorized.
