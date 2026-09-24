# Event investigation and resource correlation

Click **Investigate** in an expanded event to explore surrounding activity. The default window is ±5 minutes; ±1, ±15, and ±60 minutes are also available. The view queries all loaded evidence in that window, independently of the console's current filters.

The timeline explains why each event appears. Relationship filters distinguish:

- **Shared AWS action:** equal nonempty sharedEventID, service, and operation.
- **Matching credential:** equal nonempty access key ID and principal ARN. A key ID alone is insufficient.
- **Shared resource ARN:** exact equality of complete recorded ARNs, including the partition and full resource path.
- **Same scoped request:** equal nonempty request ID, service, operation, recipient account, and region.
- **Principal/IP context:** matching full principal ARN or literal source IP. Service hostnames and AWS Internal values are not treated as IP addresses. These are context clues, not proof of a common operator.
- **Nearby in time:** events in the window with no identifier relationship to the anchor.

The selected event remains visible for orientation. Select a timeline row to see every reported reason, open its original record, or center the investigation on it. Back navigation retains the current evidence snapshot. **Refresh snapshot** includes newly committed events.

## Resources and evidence boundaries

Resource references include all complete ARNs in the CloudTrail `resources` array and complete ARN strings recorded directly in request parameters. Each reference shows its source field. Names and partial identifiers are not converted into invented ARNs or joined across accounts/services. Nested request values, response-only ARNs, and names without complete ARNs are outside this initial extractor.

Up to 100 anchor references are displayed, while correlation considers all references in the database window. An event row reports up to five matching resource ARNs. Exact string comparisons preserve case, encoding, and partition differences; no alias resolution or ARN equivalence is implied.

Counts, rows, and reference metadata are read in one database transaction. Follow-up requests preserve the dataset generation and event cutoff; replacement of the dataset rejects stale requests. Opening original records uses the same snapshot. Correlation uses the displayed source record; different anchor source versions produce a note directing the investigator to Sources & hashes.

A window returns at most 500 events, preferring the anchor and events closest in time, then displaying them chronologically. The full matching count and truncation remain visible. The timeline is virtualized. Replacing a query cancels it and skips obsolete queued work. Failures show a retry action. Queries retain the native engine's existing two-minute timeout.

Only ingested events with usable timestamps can appear. Missing telemetry and omitted resource fields can hide relationships; shared identifiers do not prove causation or a human identity. This is an offline investigation over loaded evidence, with no additional AWS permissions or API calls. Browser preview reports that the desktop query engine is required.

## AWS documentation verified

- [CloudTrail record contents](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html): resource lists, request IDs, recipient accounts, sharedEventID, and UTC event timestamps.
- [CloudTrail userIdentity](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html): optional credential identifiers and session/principal identity.
- [IAM identifiers](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html): ARN paths/partitions and credential identifier limits.

## Validation

Real-DuckDB checks cover a matching resource beyond the first array entry, explicit request ARN references, cross-account shared actions, scoped request-ID rejection, credential/principal mismatch, literal-IP context, absent fields, generic names, malformed resource shapes, snapshot preservation, dataset replacement, cancellation, and exact count/truncation at the 500-event cap.

Browser checks cover query failure/retry, timeline virtualization, source evidence, centering/back navigation, snapshot propagation, superseded-query cancellation, and 960px/1440px screenshots. Linux amd64, Windows amd64, and macOS universal builds are required before review.
