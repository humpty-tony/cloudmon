# Database and ingestion performance

CloudMon now keeps one embedded DuckDB 1.5.5 engine open for the saved evidence
session. The Go driver is pinned to `v2.10505.0`, with platform-specific static
libraries resolved by Go modules. The former CLI extraction and per-operation
process creation are removed.

## Execution and durability

- Four read connections and a separate one-connection write pool share the same
  native database. A busy set of readers cannot exhaust the writer's pool.
- Writes are serialized and transactional. The capture sink returns success only
  after COMMIT; no acknowledged records wait in a memory-only buffer.
- Exact event/source strings, observation hashes, the first-observation policy,
  the existing schema version, and the capture journal are preserved.
- Event counts and the next event/observation IDs are reconstructed from durable
  tables at open, then updated per successful transaction. A failure invalidates
  the cached counters; they are reconstructed before the next append. Batches no
  longer rescan existing IDs or repeat index creation. Deduplication uses the
  existing unique index instead of an anti-join over all saved events. Event IDs
  remain stable and increasing, but skipped duplicates can leave gaps. New-event insertion uses
  the event-key unique index to ignore existing identities, replacing an
  anti-join that otherwise scanned the old event table for every batch. Mixed
  duplicate/new batches can leave sequence gaps; stored event IDs remain stable.
- Imports still validate into a private staging file before atomically replacing
  the dataset. Live batches continue using bounded staging and durable commits.
- Capture cancellation interrupts SQL work. Errors roll back before another
  transaction uses the connection. Shutdown joins capture, cancels reads, and
  finishes rollback before releasing the native engine. COMMIT/ROLLBACK finish
  synchronously rather than being abandoned halfway through shutdown.
- Operations retain the two-minute deadline, including waiting for a pool or the
  writer. DuckDB uses at most four worker threads (fewer on a smaller CPU).

## Query and refresh work

Each aggregate response uses one read transaction, so its facets, statistics, and
histogram describe the same committed state while capture continues. Facets use
one GROUPING SETS query instead of seven UNION branches; the histogram reuses the
time span already calculated for the statistics.

Live refreshes run only after searchable events change. Idle capture and duplicate
source deliveries do not trigger rescans. At most one background aggregate refresh
and one live-tail request run at a time. Arrivals during a pending request are
coalesced into a later refresh; selecting an event keeps the visible window
anchored while the capture counter continues to update.

## Measurements

Measured locally on Linux against 10,000 synthetic records, 25 samples per
operation, and 25 live batches of 10 events. The baseline is the old CLI 1.5.5
implementation; the new engine uses the same DuckDB version and workload.

| Store operation | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| Fetch one raw event | 14.17 / 18.19 ms | 0.41 / 0.58 ms |
| Fetch 200 event rows | 20.41 / 22.53 ms | 5.87 / 10.00 ms |
| Facets, statistics, and histogram | 61.01 / 69.96 ms | 8.67 / 9.94 ms |
| Fetch raw event with concurrent ingestion | 135.05 / 267.48 ms | 0.50 / 0.63 ms |
| Commit 10 events with concurrent UI queries | 159.15 / 173.60 ms | 9.51 / 14.79 ms |

These timings cover store calls, not WebView rendering. They are a comparison on
one machine with a small synthetic dataset, not a guarantee for large datasets,
complex filters, high-cardinality facets, or every operating system. The opt-in
workload is available without timing thresholds in normal CI:

```sh
CLOUDMON_PERF=1 go test ./internal/store -run '^TestStorePerformance$' -count=1 -v
```

The baseline harness was committed as `6cc7648`, before the engine change; that
version also needs `DUCKDB_BIN` pointing to the old DuckDB CLI. The two harnesses
differ only in opening/closing the engine.

## Validation

- All existing store tests now run against the bundled real engine; they no longer
  silently skip when an external CLI is absent.
- Targeted tests cover committed snapshots during writes, writer access when all
  reader connections are busy, cancellation/rollback followed by a successful
  append, shutdown interruption, and persistence after abrupt process exit
  without `Close` or a normal checkpoint.
- Existing evidence/import, filter, lineage, Sigma, and capture tests cover the
  preserved behavior. The Go race detector checks the store's concurrent paths.
- A database created by the actual merged PR #3 code was opened locally with the
  new engine: exact large integer tokens, variants, capture state, and subsequent
  event IDs survived the upgrade.
- Browser checks exercise slow tail and aggregate responses, arrivals while a
  refresh is pending, idle/duplicate delivery, and inspection during capture.
  Native APIs are mocked in that check; screenshots cover desktop layouts.
- CI builds Linux/amd64, Windows/amd64, and macOS universal. Windows checks for
  unexpected compiler-runtime DLL dependencies; macOS verifies both architectures.

No AWS provisioning, selector, message-lease, or queue-cleanup behavior changes in
this PR. The durability boundary established in PR #2 remains in place. See
[AWS behavior](aws-behavior.md) for the previously checked AWS documentation.

## Build and operational limits

Building now requires CGO and a compatible native C/C++ toolchain on each target
OS. Windows CI uses the runner's MinGW-w64 GCC toolchain, matching the driver's CI. The application includes DuckDB's static library;
end users do not need to install a database engine. See the README for build steps.

A native engine failure now shares the application's process. Transactional
storage and WAL recovery protect committed evidence, but process isolation from
DuckDB failures is no longer provided by the CLI subprocess. Keep normal evidence
backups; this change does not introduce a new backup or recovery format.

The reader pool bounds concurrent work, not the cost of a query or all native
memory allocation. Broad investigations still scan the dataset. Consistent
snapshots across multiple UI requests, user-triggered query cancellation,
full-filter export, and the event-inspector rendering redesign remain separate
PRs. An individual aggregate response is consistent; a page and a separate
aggregate response can still observe different commits during capture.

## Primary references

- [DuckDB Go client and static library support](https://duckdb.org/docs/current/clients/go/overview)
- [Connection lifetime and concurrency](https://duckdb.org/docs/current/clients/go/connecting)
- [DuckDB concurrency model](https://duckdb.org/docs/current/connect/concurrency)
- [Native toolchains, including Windows UCRT64](https://duckdb.org/docs/current/clients/go/troubleshoot)
- [Conflict handling and inserted-row IDs](https://duckdb.org/docs/current/sql/statements/insert)
- [Conflict handling and inserted-row IDs](https://duckdb.org/docs/current/sql/statements/insert)
- [Pinned driver source](https://github.com/duckdb/duckdb-go/tree/v2.10505.0)
