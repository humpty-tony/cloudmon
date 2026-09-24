# Evidence integrity and recovery

Implementation in progress for PR #3. This document records the scope before code changes so the draft PR is recoverable from GitHub.

- Store the current dataset in the application data directory and offer it again after restart.
- Preserve source records, source locations, content hashes, and conflicting observations rather than silently rewriting or discarding evidence.
- Scope event deduplication to the recipient account and event ID; keep records without a reliable identity distinct by content.
- Stream supported imports into staging and replace the active dataset only after a successful import.
- Persist capture resource identifiers and their account/profile association; stop polling on exit and require an explicit action to resume or remove retained infrastructure.
- Test the storage/recovery boundaries with real DuckDB, check AWS behavior against official documentation, and review the recovery UI and native builds before marking the draft ready.

This change does not add investigation workspaces or case management. Embedded-engine performance and query lifecycle changes remain separate PRs.
