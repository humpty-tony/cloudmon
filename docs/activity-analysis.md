# Activity analysis

Open **Analysis**, choose an entity dimension and click **Run analysis**. Queries run on request, can be cancelled, and retain an event cutoff for drilldowns. Importing a replacement dataset invalidates that cutoff instead of reusing sequence numbers from different evidence.

- Add a manual, cancellable Analysis view over a stable evidence snapshot.
- Rank services, operations, recorded principal/session ARNs, roles, accounts, regions and source addresses. Keep absent values explicit.
- Drill into an exact entity with service/operation/address breakdowns and original records.
- Compare equal adjacent windows ending at the latest usable event time in the selected scope. Show counts, differences, dates and coverage limitations.
- Count writes only when the source records boolean `readOnly: false`; report unknown values separately. Error counts cover top-level error code/message fields.
- Display the top 50 groups with the full group count, top 10 entity breakdowns, and 25 recent original records. Limits never change the aggregate counts.

Without comparison, summaries cover the whole selected scope, including records without usable timestamps. Comparison offers 1-hour, 24-hour and 7-day windows. The current exclusive endpoint is one millisecond after the latest event timestamp in the scope; the previous window ends at the current start. Invalid timestamps are counted and excluded from both windows. Rankings use absolute count change, including decreases and entities seen only in the previous window. “New in compared window” means a zero count in that one preceding window, not first-ever activity.

Entity drilldowns use exact, case-sensitive identifiers, including an explicit missing/empty bucket. Actor and recipient accounts are separate dimensions. Source address values can contain service names. Counts represent stored events; separate cross-account event IDs can describe one AWS action. Credential counts are distinct recorded key IDs, not verified sessions or people. Source variants use the displayed record; inspect Sources & hashes for alternate versions.

The default scope is all loaded evidence. Opting into the console search retains **every** filter, including time filters, in both windows. Changing controls leaves results labelled as using previous settings until Run is pressed. The UI does not claim statistical significance, learning, continuous coverage or CloudTrail Insights compatibility.

Focused store checks cover exact boundary membership, timezone offsets, missing booleans, absent identities, case-sensitive drilldowns, count/display caps, scope filters, stable snapshots, replacement rejection and cancellation. Browser checks cover manual execution, drilldown snapshot propagation, raw evidence, stale settings, cancellation, errors and narrow-window layout. The repository CI builds Linux amd64, Windows amd64 and macOS universal.

AWS field semantics are checked against [CloudTrail record contents](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html) and [userIdentity](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html). These are descriptive summaries of loaded evidence, not CloudTrail Insights or proof of a human operator.
