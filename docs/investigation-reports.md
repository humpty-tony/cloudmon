# Investigation report export

Open an event investigation, choose its window and relationship, and wait for the result. **Export investigation** opens a native save dialog for a ZIP file. Extract the archive and open `report.html` in a browser; it uses no scripts or external assets and supports printing. The desktop app is required to export.

The report follows the successful displayed anchor, relationship and time window. It is independent of console filters, as the investigation itself is. Editing controls makes export unavailable while the next investigation loads. Changing scope or closing the investigation cancels pending work and ignores its late UI completion. Refresh the investigation snapshot explicitly to include newer events.

## Archive contents

- `report.html`: printable context timeline, relationship reasons, source links, coverage notes and limits.
- `manifest.json`: versioned report metadata, query scope, evidence snapshot, included counts, source-observation cutoff, file hashes and provenance.
- `events/<seq>.json`: exact stored queryable event JSON, without decoding/re-encoding its numbers or other tokens.
- `sources/<observation-id>.txt`: each retained original source observation for the included events, including byte variants and CSV header/row originals.

Archive paths are generated from numeric local IDs. Imported text is escaped in HTML, and recorded source locations are displayed as text rather than clickable URLs. Personal labels are not exported.

## Evidence boundaries

The event snapshot fixes dataset generation and event sequence cutoff. The backend reconstructs the investigation and gathers records inside one read transaction; it does not trust event lists or reasons supplied by the browser. A replaced dataset is rejected.

Source observations are collected at **export time**, with their own captured timestamp and maximum observation ID. The event snapshot does not freeze duplicate/variant observation history: a later retained observation for an included event can therefore be included. The manifest and report distinguish these boundaries.

The investigation retains at most 500 closest matching events, then presents them chronologically. Exports retain the same events and disclose the full matching count. For example, a 500/520 report excludes 20 matches; it is not a full filtered dataset export. Use a narrower investigation or the console's full event export for another scope.

SHA-256 values identify the retained bytes, and source hashes are checked during generation. They do **not** validate CloudTrail signatures or authenticate origin. [AWS CloudTrail log integrity validation](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html) is a distinct digest/signature process. JSON source files retain record objects, not their surrounding delivery envelopes. CSV's queryable JSON is a lossy projection; its original header/row is included separately. Derived summary booleans do not prove that absent fields were present in a source.

Relationship reasons retain the investigation's qualifications. Shared identifiers or temporal proximity do not establish causation or a human operator. Missing telemetry can hide relationships. See [investigation semantics](investigation-context.md) and [CloudTrail record fields](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html).

## Limits and failures

An export allows at most 500 retained events, 10,000 source observations and 128 MiB of uncompressed archive entries, including metadata and HTML. Exceeding an export limit fails explicitly; source observations are never silently omitted to make an archive fit.

**Cancel export** requests cancellation. A native save dialog must still be dismissed manually if it remains open; cancellation is checked before and after that dialog. If a completed save wins the cancellation race, the UI reports its saved path accurately.

Generation writes to a temporary file beside the destination. The complete ZIP is closed, synced and closed before replacement. Errors or cancellation before publication preserve an existing destination and remove the temporary output. Rename/durability guarantees depend on the operating system and filesystem; this is not a cross-platform power-loss guarantee.

## Validation

Focused real-DuckDB tests verify scope/result equality, exact bytes and large numeric tokens, source variants/CSV, snapshot and observation timing, safe archive names/HTML escaping, count/size limits, cancellation, writer failure and preservation of existing destinations. Browser checks exercise scope-bound export, errors and cancellation races. CI renders a report produced by the real backend, checks offline links and layout, and builds Linux amd64, Windows amd64 and macOS universal applications.
