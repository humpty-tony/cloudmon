# Database and ingestion performance

PR scope (draft):

- Replace a new DuckDB process for every operation with a persistent engine.
- Let event inspection and page queries proceed while live batches commit.
- Remove avoidable scans and repeated work in the live ingestion/refresh path.
- Preserve atomic imports, exact source evidence, and acknowledgement only after
  a durable commit. Continue opening the existing evidence database in place.
- Measure the same representative workload before and after the change.
- Validate Linux, Windows, and macOS universal builds and browser behavior.

Search semantics, the event inspector redesign, and investigation features remain
separate change groups. This document will record the implementation decisions,
measurements, and remaining limitations before the PR is marked ready.
