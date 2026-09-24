# Investigation context — implementation plan

Add an event-centered investigation view with a default five-minute window, explicit correlation reasons, all observed resource ARNs, and links back to intact source evidence. Distinguish shared AWS actions and exact resource/credential identifiers from weaker same-principal/IP context. Empty values must never create links, and generic resource names must not merge unrelated accounts or services.

Use bounded database queries, cancellation, and a stable dataset snapshot; report truncation and errors. Inspect narrow/wide layouts and validate the relationship rules against AWS CloudTrail documentation and focused DuckDB cases.

Official AWS references:

- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html
- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html

This scope checkpoint precedes implementation. Delivered behavior and limits will replace it before review.
