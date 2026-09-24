# Investigation hunts

Open **Hunts**, choose bulk indicators or ordered events, then press **Run hunt**. Runs are manual and cancellable. The default scope is all loaded evidence; **Use console filters** retains every filter, including time bounds, in every step. Changing inputs labels the existing results as stale until you run again. No AWS calls or additional permissions are needed.

## Bulk indicators

Enter one type, a space, then a value per line:

```
ip 192.0.2.1
cidr 2001:db8::/32
key ASIAEXAMPLE
event recorded-event-id
arn arn:aws:s3:::example-bucket/object
```

The entire list validates before any query runs. A bad line never becomes a broad search. At most 100 entries are accepted; equivalent IP spellings and identical entries are deduplicated. IP/CIDR matching uses Go's `net/netip` through a local DuckDB function, with no downloaded extension. Both IPv4 and IPv6 work. Malformed addresses, service names and IPv6 zone identifiers never match. IPv4-mapped IPv6 retains its IPv6 family.

Key IDs and event IDs match the recorded string exactly; accepting an identifier does not verify that AWS issued it. ARN matches are case-sensitive and retain their partition and path. Supported locations are principal/session issuer ARNs, every `resources[].ARN`, and complete ARN strings directly in request parameters. Nested request values, response-only ARNs and resource-name guesses are outside this extractor. Indicator counts can overlap; the matched-event total deduplicates events across indicators.

## Ordered events

Write an ordinary CloudMon search expression for A and B. Both are required and use the console's field/operator validation. Choose a 1–1440 minute interval and group by either the same recorded principal ARN or the same access-key ID **and** principal ARN. Empty grouping identifiers cannot link unrelated events.

Each B returns at most one pair: its closest strictly earlier matching A inside the interval. This avoids a quadratic list of every possible pair. All counts describe that pairing rule, not arbitrary combinations. The query uses a native [ASOF join](https://duckdb.org/docs/current/sql/query_syntax/from#as-of-joins).

Sequence ordering uses event timestamps at millisecond resolution, never ingestion order. Equal A/B timestamps do not establish order and are excluded. If several A records share the chosen timestamp, the result reports the candidate count and displays the highest-sequence representative; that tie-break does not imply a causal order. Invalid timestamps and missing grouping identifiers are excluded. Relationships are investigative context, not proof of causation, a verified session or malicious intent.

## Snapshot and display limits

Counts, indicator summaries and returned events use one read snapshot. Results cap at 500 with full totals, and the list is virtualized. Original-record viewing and subsequent investigation carry the same snapshot; a replaced dataset is rejected. Notes identify extraction limits and gaps that can hide matches. This two-step search is not an implementation of Sigma correlation YAML.

AWS references: [CloudTrail event ordering and coverage](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-events.html), [record fields and resource ARNs](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html), and [recorded identity fields](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html).

Focused real-DuckDB checks cover IPv4/IPv6 networks, invalid addresses, duplicate indicators, multi-resource ARNs, whole-input rejection, time ordering, nearest eligible predecessors, empty/mismatched identities, timestamp ties, caps, cancellation and snapshot replacement. The store suite also checks the new callback's integration with the connection lifecycle. Browser checks cover virtualized results, snapshot-bound sources/investigations, stale inputs, both hunt modes, cancellation, errors and layout. CI builds Linux amd64, Windows amd64 and macOS universal.
