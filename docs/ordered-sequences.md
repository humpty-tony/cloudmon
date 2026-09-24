# Ordered event sequences

Use **Hunts → Ordered events (2–5 steps)** to search a sequence of recorded activity. For example:

1. `eventName="PutBucketPolicy"`
2. `eventName="ListObjectsV2"`
3. `eventName="GetObject"`

These are illustrative operation names, not a detection rule or a claim that one operation caused another. Matching requires the events to be present in the loaded evidence; data events such as object reads depend on capture/import coverage.

Choose **Same principal ARN** or **Same access key and principal ARN**, then set **Complete sequence within**. With a 15-minute interval, A at 10:00, B at 10:10 and C at 10:20 do not match even though each adjacent gap is ten minutes. A at 10:00 and C at 10:15 can match when B is strictly between them. The complete first-to-last window is inclusive; each adjacent timestamp must strictly increase.

Each final event has at most one representative sequence: the closest completed prefix is selected at each stage. This intentionally avoids an explosive list of every possible combination. Tied timestamps on initial/intermediate steps show a candidate count and a deterministic representative. Equal-timestamp final events remain distinct results. See [full matching semantics](investigation-hunts.md).

The editor accepts two to five expressions. Removing a step shifts the later letters while retaining their expressions. Save/load preserves the full array of steps. Inputs remain editable after a run; a stale-results notice identifies when another run is needed. Source-record and investigation actions always use the successful result's evidence snapshot.

## Compatibility and limits

The backend accepts either the new `steps` array or legacy `first`/`second`, never both. Empty or invalid definitions fail closed. Two-step results still include legacy pairs. Results cap at 500, with the full matched-sequence total; each displayed sequence contains every step. Grouping is exact and requires recorded identifiers; principal names and inferred session relationships do not substitute for missing ARNs or keys.

No AWS calls or extra permissions are added. Temporal matching is investigative context, not proof of causation. This feature does not add scheduled hunts, Sigma correlation YAML, branching sequences or per-step time windows.

## Validation

Focused real-DuckDB tests cover legacy compatibility, 3/5-step matching, out-of-order ingestion, overlapping expressions, timestamp ties, full-window boundaries, missing/mismatched grouping fields, snapshot/filters, cancellation and display caps. A moderate broad-expression benchmark exercises the bounded query strategy without a brittle timing gate. Browser checks cover ordered requests, add/remove controls, five-step persistence and snapshot-bound original/investigation actions for every step. Native CI builds Linux amd64, Windows amd64 and macOS universal.

AWS sources: [record contents and eventTime](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html), [identity field availability](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html), and [event ordering and coverage](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-events.html).
