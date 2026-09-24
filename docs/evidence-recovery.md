# Evidence integrity and recovery

CloudMon now saves the current dataset across desktop restarts. The launch screen offers **Open saved evidence** without AWS access. If a capture was configured, its profile, caller account, region, and resource identifiers are shown separately, with explicit resume and cleanup actions.

## Evidence storage and imports

The desktop database is `cloudmon/evidence/events.duckdb` under Go's platform-specific user configuration directory (`%AppData%` on Windows, `~/Library/Application Support` on macOS, and `$XDG_CONFIG_HOME` or `~/.config` on Linux). An OS file lock protects it for the process lifetime, even if desktop single-instance messaging is unavailable. The directory and database request owner-only Unix permissions. This is local persistence, not encrypted storage or a backup service. Close CloudMon before copying the evidence directory for backup.

An import streams supported source formats into a private staging file, validates every record, then replaces the event and observation tables in one transaction. The old dataset survives parsing errors, truncated gzip input, staging errors, and SQL transaction failures. The capture journal is independent of dataset replacement. Import pauses capture first; it does not delete AWS infrastructure.

Supported inputs are CloudTrail `Records` objects, JSON arrays, individual JSON objects, NDJSON, `lookup-events` `Events[].CloudTrailEvent` exports, Event History CSV, and gzip-compressed versions. The backend also accepts directories or globs of supported files, sorted by path; the native picker selects individual files. Unsupported or malformed records fail the import rather than silently disappearing. This validates the supported event shape and requires an event name; it is not full CloudTrail schema or authenticity validation.

New live captures append to the saved dataset. Successful imports intentionally replace that dataset, including its source observations. Previous releases used process-specific temporary databases: they are not automatically discovered or migrated. Unknown database versions and incomplete schemas are reported without resetting the saved evidence.

## Event identity and source observations

Each source observation retains its location, record ordinal, format, observation time, source bytes, and SHA-256. For JSON, the retained evidence is the event object, including unknown fields, numeric tokens, nulls, and whitespace inside the object. It excludes enclosing Records arrays, Event History wrappers, EventBridge/SNS/SQS envelopes, and compressed-file bytes. For CSV, the original header and row are retained alongside a deliberately lossy JSON projection. Unknown or absent CSV fields are not reconstructed.

The searchable event identity is `(recipientAccountId, eventID)` when both are available. If either is missing, identity falls back to the source hash. The recipient account is not replaced by the actor's account or the profile's current account. `sharedEventID` and addendum references are preserved for future correlation work, not used to collapse events.

The first observation supplies the displayed event. Every later observation is retained, including repeated deliveries and different bytes for the same identity. **Sources & hashes** loads observation metadata in pages of 25; record bodies load only when requested. Distinct hashes can result from formatting differences as well as content changes. They do not automatically establish a semantic conflict. For live capture, the source location is the queue URL and the ordinal is within a committed batch, not a global queue position. Observation counts may include local commit retries as well as SQS redeliveries.

Raw JSON views and JSON selection exports use the stored record strings without JavaScript parse-and-reserialize, preserving large numeric values. Export fails if any requested record is unavailable. CSV exports still contain only a projection; inspect the saved CSV source for its original columns. The structured field tree and summary columns are derived views; use the original source for exact numeric tokens and missing-field semantics. Export scope remains the currently loaded event window; stable query snapshots and full-filter exports are a separate change.

Hashes identify the locally saved bytes; they do not verify AWS CloudTrail digest signatures or authenticate a source. Keep original export files if whole-file chain of custody is needed.

## Capture recovery

Before creating a queue or rule, CloudMon saves their planned unique names. It checkpoints returned handles as setup proceeds and records readiness before polling. Interrupted setup can be cleaned up by looking up the queue using its saved name and account, even if the CreateQueue response never reached the application. An interrupted setup is not offered for resume because its wiring may be incomplete.

Closing CloudMon joins the poller and retains the database and capture journal. It does **not** delete AWS infrastructure. The retained pipeline can incur charges, and queued messages still expire according to SQS retention (four days by default). No messages are consumed automatically on restart. Choose **Resume capture** to use the same queue, with the original profile and region. CloudMon rechecks the profile's current STS account and queue accessibility before consuming messages; it does not claim to reverify all EventBridge wiring or CloudTrail coverage on resume.

Choose **Remove infrastructure** to stop capture and remove the CloudMon-created rule, target, and queue. The confirmation explains that unread queued messages will be lost. Cleanup intent is saved before deletion; denied permissions, timeouts, and partial target-removal failures keep the journal for retry. Already-missing resources are accepted when retrying cleanup. Existing customer queues offer **Disconnect queue** and are never deleted. Saved local evidence survives either action.

A damaged or newer capture journal is reported and blocks a replacement capture; it is not silently discarded. Locally saved evidence can still be opened if its database is readable.

AWS semantics and source links are recorded in [AWS capture behavior](aws-behavior.md).

## Validation

Focused tests exercise record-byte preservation, long NDJSON streams, lossy CSV provenance, malformed/truncated input, transactional import rollback, account-scoped deduplication, conflicting observations, restart recovery, damaged journals, and exclusive session locks. AWS client tests use controlled responses to check checkpoints before mutations, partial setup cleanup, repeated deletion, and changed-account rejection; they do not deploy live AWS resources.

CI builds the frontend before application tests (the desktop embeds those assets), runs real DuckDB tests on Linux, Windows, and macOS, then builds all three desktop targets and verifies both macOS executable architectures. The browser check covers the saved-session screen, explicit resume, retryable cleanup, source inspection, exact-number export, and export failure. It also saves screenshots for visual review.

The persistent engine and ingestion changes are documented in [database performance](database-performance.md). Responsive inspectors, query snapshots across UI requests, and expanded correlation remain separate PR groups. Investigation workspaces and case management are excluded.
