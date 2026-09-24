# Activity analysis

Implementation scope for this draft:

- Add a manual, cancellable Analysis view over a stable evidence snapshot.
- Rank services, operations, recorded principal/session ARNs, roles, accounts, regions and source addresses. Keep absent values explicit.
- Drill into an exact entity with service/operation/address breakdowns and original records.
- Compare equal adjacent windows ending at the latest usable event time in the selected scope. Show counts, differences, dates and coverage limitations.
- Count writes only when the source records boolean `readOnly: false`; report unknown values separately. Error counts cover top-level error code/message fields.
- Verify snapshot consistency, window boundaries, optional fields, cancellation, cross-platform builds and browser layout.

AWS field semantics are checked against [CloudTrail record contents](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html) and [userIdentity](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html). These are descriptive summaries of loaded evidence, not CloudTrail Insights or proof of a human operator.
