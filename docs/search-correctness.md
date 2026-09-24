# Search semantics

Search text applies on Enter. Invalid syntax stays in the editor and does not replace the applied query. If a desktop query fails, the app displays an error, retains the previous results, and stops appending or paging into them until a successful retry or new search. Capture can continue while displayed results remain frozen.

## Matching

- Field names and matches are case-insensitive. `=` is an exact match, with `*` and `?` acting as whole-value glob wildcards. `:` is a literal substring. Clicked facet/cell values are always literal, including wildcard characters.
- Missing and empty fields both behave as the empty string. `field=*` and bare `field=` mean nonempty; `field!=*` and bare `field!=` mean missing or empty. Explicit `field=""` matches missing or empty. Negation is the complement of its operand, including on missing fields.
- `and`, `or`, `not`, parentheses, and implicit AND compose predicates. Includes within one chip field are ORed; different fields and exclusions are ANDed. An empty intersection with the sensitive-event set matches nothing.
- Free text matches each supported field independently. A phrase cannot span unrelated fields. Nested request/response JSON is not searched.
- `~`, `!~`, and `/pattern/` use the RE2 syntax family, with case-insensitive partial matching. Backreferences, lookarounds, and suffix flags such as `/pattern/i` are rejected. Inline flags such as `(?s)` are supported; a dot normally excludes newlines. Globs include newlines.
- Quoted strings decode escaped matching quotes and backslashes. Other escapes are preserved, so `userAgent~"agent\d+"` and `userAgent:"C:\tools"` retain their intended meaning. Quote paths, ARNs, and literal slash-containing values.
- Search input is limited to 16,384 UTF-8 bytes; expressions to 512 nodes and depth 32; regex patterns to 4,096 bytes. Invalid expressions and unknown filter fields fail explicitly even on empty datasets.

## Fields

`eventTime`, `eventName`, `eventSource`, `user`, `userName`, `identityType`, `identityArn`, `roleArn`, `sessionName`, `principalId`, `accountId`, `awsRegion`, `sourceIPAddress`, `userAgent`, `result`, `errorCode`, `errorMessage`, `readOnly`, `managementEvent`, `recipientAccountId`, `eventID`.

`user` matches the displayed identity label: root, normalized user/issuer name, ARN suffix, identity type, or `-`. `userName` uses `userIdentity.userName` with a fallback to the session issuer's name. `roleArn` is the session issuer ARN; `sessionName` is the session suffix in the principal ID. These labels do not establish a person or credential lineage. `result` is the error code or `Success`; boolean fields use `true`/`false`.

The AWS identity normalization follows the [CloudTrail userIdentity reference](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html), including its assumed-role example and session issuer fields. This change does not alter capture selectors or AWS API calls.

Regex behavior follows [DuckDB's regex documentation](https://duckdb.org/docs/current/sql/functions/regular_expressions) and [RE2 syntax](https://github.com/google/re2/wiki/Syntax). The browser uses pinned [RE2JS](https://github.com/le0pard/re2js); the backend validates with Go's RE2-compatible parser and executes in DuckDB. The shared checks cover supported CloudTrail examples, not exhaustive Unicode equivalence across engines.

## Validation

`testdata/search.json` supplies the same evidence, expressions, and expected event IDs to `npm run check:search` and the real DuckDB Go tests. It covers presence/negation, quoted escapes, regex, literal pivots, identity normalization, and time boundaries. CI runs these plus the production frontend and native builds on Linux, Windows, and macOS universal. Browser checks verify invalid drafts do not reach the engine, failed searches remain visibly stale, retry recovers, and Clear discards unapplied text.
