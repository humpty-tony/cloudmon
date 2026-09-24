# AWS capture behavior

The SQS poller holds one batch (at most 10 messages) and acknowledges valid receipts only after the local sink succeeds. Failed writes retry the same batch without receiving more messages. A heartbeat renews each receipt's 120-second visibility timeout while processing. Standard SQS remains at-least-once: even a successful delete can be followed by redelivery.

Unsupported payloads stay unacknowledged and are reported in the troubleshooting log. Supported payloads are individual CloudTrail records, EventBridge `detail`, and SNS Notification wrappers containing either. S3 object notifications contain a location, not the event records, and require an importer. Use a dedicated queue: consumers compete and successfully stored messages are deleted. Existing infrastructure is never torn down by CloudMon.

- [SQS visibility timeout and renewal limits](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
- [DeleteMessage receipt handles and redelivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html)
- [ChangeMessageVisibility](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ChangeMessageVisibility.html)

Provisioned rules select the Management category, including custom patterns, to prevent collector SQS data events feeding back into the queue. Read-only management events require `ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS`. Data-event imports and externally managed queues remain separate ingestion paths.

All-management capture includes API calls, console actions/sign-ins, and service events within that category. The CloudTrail guide spells the sign-in detail type `AWS Console Sign In via CloudTrail`, while the EventBridge guide lists `AWS Console Signin via CloudTrail`; both documented forms are accepted.

Custom filters must use nested JSON field names. EventBridge treats dotted and nested paths as equivalent, so dotted field keys are rejected to prevent collisions with injected capture restrictions. Dots in values remain supported.

- [CloudTrail events through EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-service-event-cloudtrail.html)
- [CloudTrail integration and sign-in detail type](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-aws-service-specific-topics.html)
- [Read-only management events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-service-event-cloudtrail-management.html)
- [Event categories](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html)
- [EventBridge pattern syntax and dotted fields](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-pattern.html)

Coverage checks inspect logging status and basic/advanced selectors in the trail's home region, including shadow trails. Missing permissions or selector information are shown as unknown coverage. Excluded sources and read/write restrictions cannot produce an unrestricted-coverage indicator. Verified selectors do not guarantee delivery: service events through CloudTrail have best-effort delivery, and a trail's global-service setting does not route global events into every regional bus. EventBridge documents IAM and Route 53 API events in US East (N. Virginia).

Cleanup checks `RemoveTargets.FailedEntryCount` even on HTTP success and uses the profile associated with the capture, with a bounded cleanup context. Caller-owned queues are left in place.

- [GetEventSelectors](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_GetEventSelectors.html)
- [Basic selectors](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_EventSelector.html)
- [Advanced field selectors](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_AdvancedFieldSelector.html)
- [RemoveTargets partial failures](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_RemoveTargets.html)
- [CloudTrail delivery for S3 events](https://docs.aws.amazon.com/eventbridge/latest/ref/events-ref-s3.html)
- [Global service events and regional rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-troubleshooting.html)

These references validate API semantics. Tests use fixtures and fake AWS responses; they do not imply a live AWS deployment test. Cross-session evidence persistence and capture recovery are separate follow-up work; this PR retains the existing session database and quit-time cleanup behavior.
