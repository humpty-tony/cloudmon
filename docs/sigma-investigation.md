# Sigma investigation

Run a rule explicitly with **Run** or Ctrl/Cmd+Enter. Editing or loading another rule clears its previous result and cancels any obsolete request. A failed database read stays visible; it never appears as a successful run with zero matches. **Cancel rule** and **Cancel suite** interrupt the native query.

**Rule suite** runs 1–25 selected examples or locally saved rules in one read transaction. Unsupported rules retain individual diagnostics. A database/query failure fails the suite rather than publishing incomplete results. Inspecting a suite result opens the captured result and its original rule without rerunning it. Rules can overlap; their match counts are not additive.

Each successful run returns a dataset generation and event cutoff. Counts cover all events at that cutoff; the result table is capped at 500 rows for a single rule or 100 rows per suite rule. New arrivals cannot change those results. Expanding a row shows each named selection's true/false outcome, including filters negated by the condition. These explain selection membership, not causation or an attack verdict. Legacy count thresholds apply to the full snapshot.

Original records, inline/full credential lineage, and surrounding-event investigations retain the result snapshot. Replacing the dataset makes these actions fail explicitly instead of opening reused sequence numbers. Source observations added later for an existing event are still inspectable; the source list is not an historical observation cutoff. Original bytes and hashes remain unchanged.

## Supported matching

- CloudTrail field names use dotted paths. `resources.<field>` paths match any array element; arbitrary nested-array traversal and array-valued field references/aggregations are unsupported.
- String matching is case-insensitive by default, with Sigma `*`/`?` wildcards and escaped literal wildcards. `contains`, `startswith`, `endswith`, `all`, `cased`, supported field references, and RE2-compatible regexes are available. `not` treats a missing selection value as not matched.
- `exists` requires a boolean and checks field presence: an explicit JSON null or empty string is still present. Missing `readOnly` and `managementEvent` fields are read from the original record, without display defaults.
- Unquoted numeric YAML values and `gt/gte/lt/lte` use exact decimal/rational comparison of the original JSON number or numeric string. There is no floating-point conversion. Use these for numeric evidence; quoted strings use textual JSON extraction. Exact numeric evaluation is bounded to 4,096-character numbers, exponents of ±4,096, 8 MB records, 50,000 values and 64 JSON levels. Duplicate JSON members or exceeded bounds fail the run. Numeric predicates parse original records and cost more than projected string predicates.
- CIDR uses validated IPv4/IPv6 addresses. Invalid source strings, AWS service names and `AWS Internal` are not IP addresses. IPv4-mapped IPv6 remains an IPv6 address family.
- Base64 and base64-offset transforms are supported. UTF-16 transforms require a following base64/base64-offset transform; `utf16` includes its BOM. Unsupported transform order, encoded wildcards and `windash` are rejected. The former `windash` approximation did not generate all permutations.
- Legacy `count()` and scalar distinct-count aggregation are supported over the entire snapshot, with safe integer thresholds. Approximate sum/min/max/average translations are rejected. This is not full Sigma correlation support; use an explicit sequence hunt for observed order within a time window.

Rules are limited to 128 KiB, 10,000 YAML nodes, 32 levels, 64 named selections, 16 conditions, 256 terms per condition, eight modifiers and three encoding transforms. Duplicate YAML keys, aliases/merges, multiple documents, non-CloudTrail sources, custom source constraints/taxonomies, timeframe, correlation, action/filter rules and unknown modifiers fail explicitly. Compiled conditions are bounded to 1 MB. Saved rules stay local (up to 100); storage failures are visible.

## AWS example scope

Examples are investigation starting points, not automatic security findings:

- The direct-login example requires `ConsoleLogin` success, `IAMUser`/`Root`, and `MFAUsed: No`. It makes no claim about MFA at a federated identity provider.
- The secrets example selects activity without a recorded service identity or nonempty invoker. It does not prove human access or a successful response.
- CloudTrail changes include attempts and legitimate updates. A matching `UpdateTrail` or `PutEventSelectors` does not establish disabled logging.
- Differing caller/recipient accounts requires both account IDs. It is not a complete cross-account detector: caller-side records alone can miss the relationship.
- Network ranges are clearly labeled examples and must be replaced with your trusted egress ranges.

Checked against the [Sigma rule specification](https://github.com/SigmaHQ/sigma-specification/blob/main/specification/sigma-rules-specification.md), [modifier definitions](https://github.com/SigmaHQ/sigma-specification/blob/main/specification/sigma-appendix-modifiers.md), AWS [console sign-in records](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-aws-console-sign-in-events.html), [record contents](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html), [userIdentity](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html), [IAM/STS logging](https://docs.aws.amazon.com/IAM/latest/UserGuide/cloudtrail-integration.html), [UpdateTrail](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_UpdateTrail.html) and [PutEventSelectors](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_PutEventSelectors.html).

Validation: real-DuckDB precision/presence/network/resource regressions; rule rejection, suite snapshots, selection reasons, cancellation, dataset replacement, and numeric-limit failure; browser stale-result/error/cancellation/suite/source flows and screenshots; Linux amd64, Windows amd64 and macOS universal CI builds. Browser fixtures test interaction; Go fixtures test matching semantics.
