# Credential lineage

CloudMon follows observed credential issuance instead of guessing from role names, source IPs, or session names. A link requires an exact access-key match to a successful `sts.amazonaws.com` event for AssumeRole, AssumeRoleWithSAML, AssumeRoleWithWebIdentity, GetSessionToken, GetFederationToken, or AssumeRoot. Failed calls and unrelated response fields cannot create links.

The issuing event must precede the inspected use by event time, regardless of ingestion order. Recorded expiration must be valid and contain the use; missing expiration is allowed and explicitly labelled. RFC3339 and the documented CloudTrail month-name expiration formats are read as UTC. Available issued identity/target fields must agree with the credential user. Matching a credential does not establish who physically operated it.

The walk returns a reason when an access key is absent, issuance is absent, timestamps/identities conflict, an account-only caller is recorded, multiple issuances match, a cycle appears, or the 12-link limit is reached. Different source versions of a selected event stop the walk conservatively; inspect Sources & hashes to compare them. Alternate source versions are never silently chosen to complete a chain.

Cross-account observations are collapsed only when their nonempty `sharedEventID` agrees and their available issuance/caller fields do not conflict. The most informative whole observation supplies the caller, while every linked event sequence remains available from the graph. Independent matching events stay ambiguous. Candidate lookup is capped at 64 observations per key and reports excess as ambiguity.

**Principal observed** means the chain reaches a recorded IAM/root long-term credential, AWS service, or external SAML/web principal. It does not verify a human identity. A sourceIdentity is displayed as a recorded session attribute whose assurance depends on the policy and identity provider. Identity Center and service-linked badges require an observed reserved role path; a similar name does not prove an origin.

## Graph and investigation behavior

- Graph nodes, links, counts, and role rollups are read within one database transaction. Expansion and opening an issuance record retain the event cutoff and dataset generation. New events do not silently enter that graph; replacing the dataset causes an explicit reload error. Additional source observations can reveal uncertainty on a later request.
- Sibling/child identities come from one intact activity row. Conflicting observed identity fields are labelled and fall back to issuance evidence. IAM role ARNs are never reconstructed from STS session ARNs: partitions and role paths are preserved only when recorded.
- Child expansion considers up to 40 distinct issued keys, omits ambiguous/invalid links with notes, and prevents cycles or reparenting. The issued-key count is a candidate count; some candidates may be omitted after qualification. Activity expansion shows the newest 60 events. The UI keeps its 600-node rendering limit explicit.
- Graph failures and expansion failures are visible and retryable. Issuance links include their evidence basis and buttons for linked observations. Raw evidence opens from the graph snapshot. Pan/zoom keeps node rendering memoized.

The inline inspector supports temporary IAM-user/root credentials and federated credentials as well as assumed roles. Native query errors are propagated instead of appearing as zero activity. Browser preview has no lineage engine; native behavior is tested with DuckDB and the bridge UI uses representative fixtures.

## AWS documentation checked

- [STS events recorded by CloudTrail](https://docs.aws.amazon.com/IAM/latest/UserGuide/cloudtrail-integration.html): supported issuance operations and response fields; cross-account examples.
- [CloudTrail userIdentity](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html): identity types, optional/omitted access keys, session issuer, source identity.
- [Source identity](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_control-access_monitor.html): session persistence and policy-controlled values.
- [Tracking AssumeRoot tasks](https://docs.aws.amazon.com/IAM/latest/UserGuide/cloudtrail-track-privileged-tasks.html): target account, returned key, and subsequent root activity.
- [CloudTrail record contents](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html): sharedEventID joins observations of one AWS action across accounts.
- [GetAccessKeyInfo](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetAccessKeyInfo.html): AKIA/ASIA credential prefixes.
- [Identity Center permission-set ARNs](https://docs.aws.amazon.com/singlesignon/latest/userguide/referencingpermissionsets.html) and [IAM identifiers](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html): reserved paths, ARN paths/partitions, and limits of identifier uniqueness.

## Validation

Focused real-DuckDB cases cover all six APIs, wrong services/operations, failed calls, later issuance, expiration, mismatched identities, missing keys, shared/conflicting observations, alternate source versions, cycles/depth, late arrival, preserved GovCloud/path ARNs, and stale graph/raw requests. Existing graph/role-rollup tests remain in place. Browser checks exercise temporary-user lineage, graph failure/reload, linked raw evidence, snapshot propagation, and failed expansion/retry. Linux amd64, Windows amd64, and macOS universal builds are required before this PR is marked ready.
