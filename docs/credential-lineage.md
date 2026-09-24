# Credential lineage — implementation plan

Replace heuristic ancestry with an evidence-qualified credential chain. Follow exact issued access-key matches only through successful, documented STS credential operations. Validate event ordering, report missing or contradictory evidence, collapse linked cross-account observations, and stop at ambiguity or cycles.

Support assumed roles and the temporary credentials returned by GetSessionToken, GetFederationToken, and AssumeRoot. Preserve observed ARN partitions/paths and distinguish an observed principal from a verified human identity. Source identity remains a recorded session attribute.

Read the graph and counts consistently, preserve the snapshot during expansion, and expose query failures with retry. Validate representative chains and malformed evidence with real DuckDB and inspect the lineage UI in the existing browser check.

AWS references checked before implementation:

- https://docs.aws.amazon.com/IAM/latest/UserGuide/cloudtrail-integration.html
- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_control-access_monitor.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/cloudtrail-track-privileged-tasks.html
- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html

This document will be updated with the delivered behavior, validation, and limitations before the draft is marked ready.
