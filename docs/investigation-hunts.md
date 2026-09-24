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

Write two to five ordinary CloudMon search expressions, one for each step A–E. Use **Add step** or **Remove** to edit the sequence. Every active step must pass the console's field/operator validation. Choose a 1–1440 minute **Complete sequence within** interval and group by either the same recorded principal ARN or the same access-key ID **and** principal ARN. Empty grouping identifiers cannot link unrelated events.

Each final event returns at most one completed sequence. At each stage, choose the closest strictly earlier **completed prefix**, retaining its original start time. The interval applies to **last time minus first time**, inclusively; it does not reset at each step. A recent intermediate event without a valid earlier prefix cannot hide a valid completed prefix. This avoids enumerating every possible combination. Counts describe this representative-sequence rule, not arbitrary combinations. Native [ASOF joins](https://duckdb.org/docs/current/guides/sql_features/asof_join) carry compact sequence IDs; full event summaries are loaded after the 500-result cap.

Sequence ordering uses event timestamps at millisecond resolution, never ingestion order. Equal adjacent timestamps do not establish order and are excluded, even if expressions overlap. If several initial or intermediate records share the selected timestamp, the result reports that step's candidate count and displays the highest-sequence representative. That tie-break does not imply a causal order. Final events remain separate results even when their timestamps tie. Invalid timestamps and missing grouping identifiers are excluded, with their scoped counts shown.

AWS defines `eventTime` as request completion time from the service endpoint's clock, and CloudTrail delivery is not an ordered activity trace. A recorded access key can be absent or empty. These hunts use only observed grouping values: they do not infer credential issuance from an AssumeRole caller or prove causation, verified session membership or malicious intent.

Inspect every step in the details pane using **Original A–E** or **Investigate A–E**. [Saved hunts](saved-hunts.md) retain all two to five expressions without a schema migration. See [ordered sequence examples and limits](ordered-sequences.md).

## Snapshot and display limits

Counts, indicator summaries and returned events use one read snapshot. Results cap at 500 with full totals, and the list is virtualized. Original-record viewing and subsequent investigation carry the same snapshot; a replaced dataset is rejected. Notes identify extraction limits and gaps that can hide matches. Ordered sequences do not implement Sigma correlation YAML or per-step gap constraints.

AWS references: [CloudTrail event ordering and coverage](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-events.html), [record fields and resource ARNs](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html), and [recorded identity fields](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html).

Focused real-DuckDB checks cover IPv4/IPv6 networks, invalid addresses, duplicate indicators, multi-resource ARNs, whole-input rejection, time ordering, nearest eligible predecessors, empty/mismatched identities, timestamp ties, caps, cancellation and snapshot replacement. The store suite also checks the new callback's integration with the connection lifecycle. Browser checks cover virtualized results, snapshot-bound sources/investigations, stale inputs, both hunt modes, cancellation, errors and layout. CI builds Linux amd64, Windows amd64 and macOS universal.
