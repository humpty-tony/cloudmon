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

## Baseline

Measured locally against the pre-change DuckDB CLI 1.5.5 on Linux, using 10,000
synthetic records, 25 samples per operation, and 25 live batches of 10 events.
Timings include the store API call, not WebView rendering. They are a comparison
on one machine, not a latency guarantee.

| Operation | p50 | p95 |
| --- | ---: | ---: |
| Fetch one raw event | 14.17 ms | 18.19 ms |
| Fetch 200 event rows | 20.41 ms | 22.53 ms |
| Facets, statistics, and histogram | 61.01 ms | 69.96 ms |
| Fetch raw event with concurrent ingestion | 135.05 ms | 267.48 ms |
| Commit 10 events with concurrent UI queries | 159.15 ms | 173.60 ms |

The opt-in `TestStorePerformance` workload provides a reproducible comparison;
normal CI does not enforce machine-dependent timing thresholds.
