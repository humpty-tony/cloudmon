# Sigma investigation

Draft scope: correct precision-sensitive matching and resource arrays, preserve missing fields, reject unsupported/ambiguous rules, add cancellable snapshot-consistent runs, named-selection explanations and bounded rule suites. Editing a rule clears stale validity; errors remain visible.

The supported subset is checked against the [Sigma rule specification](https://github.com/SigmaHQ/sigma-specification/blob/main/specification/sigma-rules-specification.md) and [modifier definitions](https://github.com/SigmaHQ/sigma-specification/blob/main/specification/sigma-appendix-modifiers.md). Bundled examples are checked against AWS [console sign-in records](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-aws-console-sign-in-events.html), [userIdentity](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html) and [IAM/STS logging](https://docs.aws.amazon.com/IAM/latest/UserGuide/cloudtrail-integration.html).

Validation gates: focused real-DuckDB semantics, suite/snapshot lifecycle, browser error/cancellation/explanation flows and screenshot review, plus Linux amd64, Windows amd64 and macOS universal CI builds.
