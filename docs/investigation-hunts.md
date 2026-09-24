# Investigation hunts

Draft scope: bulk typed indicators (IP/CIDR, recorded access-key ID, event ID and complete ARN), plus ordered two-step searches grouped by principal or credential-plus-principal. Runs use stable snapshots, expose their scope and limits, can be cancelled, and open the original records behind each result.

Sequence ordering uses event timestamps, never ingestion order. Equal timestamps do not establish order. Relationships are investigative context, not proof of causation or malicious intent.

AWS references: [CloudTrail event ordering and coverage](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-events.html), [record fields and resource ARNs](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html), and [recorded identity fields](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html).

Validation gates: focused real-DuckDB matching and snapshot checks; browser cancellation, error, source-record and layout checks; Linux amd64, Windows amd64 and macOS universal CI builds.
