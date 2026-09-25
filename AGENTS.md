# Agent handoff

For the Vector UI implementation, read these before editing:

1. `docs/ui-implementation.md` — verified progress checkboxes, active worktrees, current test state, and the next concrete action.
2. `docs/ui-roadmap.md` — product/design decisions, scope, implementation phases, and acceptance criteria.
3. `docs/ui-reference/` — committed visual references, not production-functionality evidence.

Inspect the actual branch, working tree, and relevant tests before continuing. Preserve uncommitted work and check worker ownership before editing shared files. Do not assume background agents survived a session reset.

Keep `docs/ui-implementation.md` current: check off only verified tasks, record failing/passing checks and review outcomes, and document what remains. Commit verified implementation slices incrementally as requested by the user; do not push or merge without authorization.
