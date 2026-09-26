# AWS role-session attribution: API research

Status: research and proposed design only. No authenticated AWS calls, capture changes, infrastructure changes, or application implementation were performed. Sources are official AWS documentation and an AWS Security Blog example; source URLs are collected below.

## Bottom line

The documented STS API catalog does not expose a universal session-owner lookup.[1] AWS nevertheless supports useful attribution. `GetAccessKeyInfo` returns an account ID and explicitly directs investigators of temporary credentials to STS CloudTrail events. `GetCallerIdentity` identifies the credentials signing that call; it does not resolve an arbitrary historical session back to a person.[2][3]

Use two complementary mechanisms: exact credential-issuance correlation, and direct Identity Center user-ID enrichment. Treat the resulting identity as the recorded credential principal, not proof of who physically operated or stole the credentials. This is the proposed product assurance boundary.

## 1. Ordinary STS sessions: recover the issuance event

AWS documents matching a subsequent event's `userIdentity.accessKeyId` to the temporary key returned in an earlier AssumeRole event's `responseElements.credentials.accessKeyId`. The issuing event records the caller. Cross-account observations of that issuance can be joined using `sharedEventID` to obtain the richer caller-account record.[5]

Proposed resolver sequence:

1. Retain the selected event and its original identity.
2. Locate successful supported STS issuance records with the exact issued key.
3. Validate event ordering, credential expiration where recorded, and recorded target/caller consistency.
4. Read the issuer's `userIdentity`; recurse when it is another temporary session.
5. Stop explicitly on missing, conflicting, or ambiguous evidence. Never substitute IP address, role name, or a similar timestamp for an exact credential link.

`AssumeRole`, `AssumeRoleWithSAML`, and `AssumeRoleWithWebIdentity` log issuance response elements despite being read-only events; the secret access key is omitted. Ensure any future collection strategy does not discard these read-only events.[4]

### API backfill

Use `cloudtrail:LookupEvents` with `EventSource=sts.amazonaws.com` and bounded start/end times, follow pagination, parse each returned `CloudTrailEvent`, then perform the issued-key match locally. It supports one lookup attribute per request, up to 50 results per page, recent management-event history within 90 days, and two requests per second per account per Region.[6]

**Important distinction:** the lookup response's `AccessKeyId` is the key that signed the request, not a newly issued response key. Thus looking up the child key is useful for activity, but is not the reverse-issuance lookup. Filter STS issuance candidates and inspect their response credentials instead.[16][5]

Search authorized accounts and relevant Regions, not only the resource event's Region. STS global-endpoint requests are logged in `us-east-1`; Regional endpoints log in their respective Regions. Cross-account caller details may require the other account's logs.[4][5]

Proposed efficiency controls: cache downloaded STS windows and index issued keys locally; share requests across unresolved sessions; cap pages, accounts and Regions; show incomplete coverage rather than claiming no issuer exists. Older evidence needs retained logs outside this 90-day lookup path.[6]

## 2. Identity Center: a direct directory lookup

When present, retain both:

- `userIdentity.onBehalfOf.userId`
- `userIdentity.onBehalfOf.identityStoreArn`

AWS recommends this immutable user ID plus its store for Identity Center attribution. Extract the store ID from the ARN and call `identitystore:DescribeUser` in the appropriate configured Identity Center Region. Do not hard-code only `type=IdentityCenterUser`: AWS documents these fields for `Unknown` Identity Center events too.[8]

Identity-enhanced role sessions can also carry `onBehalfOf` while their type remains `AssumedRole`. AWS explicitly warns that not all services log this field. Merely seeing an `AWSReservedSSO_` role is not sufficient to assume this context exists.[7]

Illustrative read-only command; not executed against an AWS account:

```sh
aws identitystore describe-user \
  --identity-store-id "$IDENTITY_STORE_ID" \
  --user-id "$USER_ID" \
  --region "$IDENTITY_CENTER_REGION"
```

The API returns user metadata including `UserName`, `DisplayName`, `Name`, `Emails`, and `ExternalIds`. Attributes can be absent. External IDs can support later IdP integration. Member-account invocation is documented, subject to the relevant authorization configuration; do not assume management-account credentials are always necessary.[9]

Proposed cache key: identity-store ARN plus immutable user ID. Store retrieval time and only the attributes needed for investigation. Keep directory metadata separate from original event evidence, especially for renamed/deleted users. Directory names are enrichment, not an event-time identity snapshot.

### Do not conflate session identifiers

Identity Center's CloudTrail event catalog includes `GetRoleCredentials`.[13] Proposed handling: ingest it as additional portal evidence, without assuming its presence alone establishes an STS issued-key link.

Identity Center `credentialId` can group access-portal activity within its documented scope. AWS specifically says not to use sign-in `credentialId` to join sign-in events to subsequent portal activity. `AuthWorkflowID` serves the sign-in workflow. Neither is a substitute for an STS access-key issuance match.[8]

## 3. Source identity: useful context, conditional assurance

`userIdentity.sessionContext.sourceIdentity` can carry an original identity attribute. It persists through role chaining and cannot change within the session after being set. AWS does not control the supplied value: the IdP and policy configuration must constrain it. AWS also documents service-mediated cases where source identity is not captured.[10]

Proposed presentation: “Recorded source identity” unless the corresponding trust controls have actually been established. For future coverage, administrators can configure controlled source identity, but CloudMon's read-only resolver should not modify role policies or federation settings.

Identity-enhanced role sessions use STS `AssumeRole` with `ProvidedContexts` obtained through the appropriate Identity Center flow. This is a producer-side integration, not a retrospective repair API.[7]

Do not recommend the similarly named identity-enhanced **console** setting as a universal CloudTrail attribution switch: the documentation describes a specific console/Amazon Q integration.[14]

## 4. Workloads and unresolved cases

CloudTrail can provide `inScopeOf.credentialsIssuedTo`, `issuerType`, `sourceArn`, and `invokedBy` for applicable service/workload requests. Use those as evidence of the workload or service context instead of inventing a human owner. SAML/OIDC issuance can identify an external subject without supplying a human-readable directory profile.[11]

Proposed unresolved reasons: issuance outside available history; missing account/Region coverage; missing identifier; insufficient directory permission; deleted user; conflicting issuance; workload origin; external IdP subject not enriched. A user's ability to assume a role is not evidence that they assumed this particular session.

## Alternative sources: reliable fallbacks beyond STS history

The proposed feature should be a multi-source attribution resolver, not just a CloudTrail downloader. The following paths have different prerequisites; none should silently upgrade a name resemblance into an identity match.

### Automatic AWS history is available independently of CloudMon

AWS enables CloudTrail event history by default. It retains the previous 90 days of management events per Region, independently of configured trails or event data stores. Starting CloudMon after a role was assumed therefore does not, by itself, mean the issuance record is unavailable. Account access, Region coverage and the relevant event's availability still matter.[17]

### Provider-controlled SAML session names and directory APIs

AWS explicitly defines SAML `RoleSessionName` as an identifier that can associate temporary credentials with the application user.[18] Microsoft's documented AWS Single-Account Access integration maps that claim to `user.userprincipalname`.[19] Microsoft Graph can retrieve a user by ID or user principal name.[20]

Proposed conditional resolver: read the recorded session name; establish the trusted federation provider, the actual claim mapping and all allowed role-entry paths; then resolve that provider-scoped identifier in the corresponding directory. Return the immutable directory object ID and retain the mapping evidence.

Reliability requirements: the mapping must have applied at session creation; users must not be able to choose another person's mapped attribute; alternative AssumeRole paths must not allow impersonating that session name. Renames, reused names, B2B identity transformations and missing historical configuration require caution. A current directory lookup alone does not establish historical ownership. Unverified matches remain candidates. A session name also does not provide automatic attribution through later role hops that change it.

Identity Store also provides `GetUserId` for a known username or external identifier, followed by `DescribeUser`; that API solves the directory lookup, not the trustworthiness of a role-session suffix.[27][9] Prefer event-recorded immutable Identity Center IDs where available.

### Credential-broker audit records: a concrete Vault integration

Vault's AWS secrets engine supports `assumed_role` credentials and returns the STS access key to the caller.[21] Vault audit entries contain the authenticated entity when one is associated with the calling token and record request/response data.[23] Its `POST /sys/audit-hash/:path` API computes the audit-device-specific hash for a known value, specifically to search obfuscated audit logs.[22]

Proposed connector, inferred from these documented interfaces and not yet end-to-end tested:

1. Take the access-key ID from the AWS activity event; no secret key is needed.
2. If broker audit responses hash the returned `access_key`, obtain the comparison HMAC for that ID using the correct audit device.
3. Match the exact issued-key field in a successful AWS credential response, not an arbitrary occurrence of the value in any log entry.
4. Read the corresponding authenticated Vault entity, request ID and AWS credential role. Preserve these as the attribution evidence.

Prerequisites: Vault actually issued the credentials; the response audit record is retained and includes the necessary fields; audit-device hashing context is still available; the caller has audit access and permission for the restricted hashing endpoint. A shared/service Vault identity resolves to that identity, not automatically to a human. This is an independent issuance record, so it does not require CloudMon to have captured the STS event.

### Workload-specific identity inventory

IAM Roles Anywhere uses the authenticating certificate serial number as the default session name, but explicitly supports custom session names when allowed by the profile.[25] Its `GetSubject` API exposes certificate identity and authentication-audit information.[26]

Proposed use: resolve a known Roles Anywhere subject/certificate to workload context when the identifiers and provenance genuinely match. Do not assume a hex-looking suffix is a certificate serial, that a serial is unique across issuers, or that every session uses the default. Certificate ownership is not inherently human attribution. This is a secondary connector, not the first general workforce solution.

### Shortcuts not established as reliable

- `GetAccessKeyLastUsed` documents an IAM-user owner and usage metadata. The reference does not establish it as a temporary-role-session-to-original-human resolver; that shortcut remains unproven and should not be advertised as a solution.[24]
- `GetAccessKeyInfo` gives the owning account, not the original human; `GetCallerIdentity` identifies the signing credentials, not arbitrary historical ancestry.[2][3]
- Proposed policy: reject IP-plus-time proximity, role membership and unrestricted session-name guesses as automatic attribution. They can identify leads, not prove issuance.

Implementation order recommendation: automatic historical STS recovery plus immutable Identity Center enrichment first; provider-bound directory mapping and broker audit connectors where configured. Require a real session test and an impersonation/ambiguity test for each connector before calling it reliable.

## CloudMon delta, verified by repository inspection

The project already implements exact-key lineage over loaded evidence, with success/time/expiration/identity checks, conservative cross-account observation handling, and explicit ambiguity. See `internal/store/lineage_evidence.go`, `internal/store/lineage.go`, and `docs/credential-lineage.md`.

The inspected code does not implement `LookupEvents` retrieval or Identity Store enrichment. `go.mod` already includes the CloudTrail SDK, but not Identity Store. Therefore the next feature should extend evidence acquisition and identity enrichment rather than replace the existing correlation algorithm.

## Proposed first increment

- Add explicit, opt-in AWS enrichment scoped to selected connections/accounts/Regions.
- Extract Identity Center context without depending on one identity-type label.
- Resolve immutable IDs with `DescribeUser`; cache limited metadata with retrieval provenance.
- Backfill missing STS issuance through bounded `LookupEvents` calls and ingest exact returned evidence into the existing lineage engine.
- Resolve newly available evidence on an explicit refreshed snapshot; do not mutate an open historical investigation silently.
- Show the observed role alongside the attributed principal, the resolution method, linked evidence, and any missing coverage.

Suggested explicit labels: “Identity Center user ID resolved”, “STS issuance matched”, “Recorded source identity only”, and “Unresolved”. Do not collapse these into an unexplained confidence percentage or “verified person”.

Core read permissions are `cloudtrail:LookupEvents` and `identitystore:DescribeUser`; permissions to reach chosen accounts and any archive sources are separate. Identity Store supports resource-scoped authorization, whose exact policies should be designed and tested against the deployment rather than replaced with blanket administrator access.[6][15]

Architecture caution: AWS closed CloudTrail Lake to new customers starting May 31, 2026. Existing customers can continue using it. Do not make a new CloudMon feature depend on new Lake enrollment.[12]

## Validation required before implementation acceptance

- A real IAM-user-to-role event pair and a chained/cross-account pair resolve by issued key.
- A real Identity Center event with `onBehalfOf` resolves in the intended customer's directory; legacy events without it remain honest.
- Identical session names belonging to different callers never merge.
- Denied directory access, deleted users, throttling, missing Regions and log gaps produce explicit states.
- Workload sessions are not displayed as human identities without additional evidence.
- Cached enrichment survives offline viewing without altering the original JSON or silently widening a snapshot.

This research establishes documented feasibility, not live coverage in the user's AWS environment. No coverage percentage is claimed.

## Sources

[1] https://docs.aws.amazon.com/STS/latest/APIReference/API_Operations.html
[2] https://docs.aws.amazon.com/STS/latest/APIReference/API_GetAccessKeyInfo.html
[3] https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html
[4] https://docs.aws.amazon.com/IAM/latest/UserGuide/cloudtrail-integration.html
[5] https://aws.amazon.com/blogs/security/aws-cloudtrail-now-tracks-cross-account-activity-to-its-origin
[6] https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_LookupEvents.html
[7] https://docs.aws.amazon.com/singlesignon/latest/userguide/trustedidentitypropagation-identity-enhanced-iam-role-sessions.html
[8] https://docs.aws.amazon.com/singlesignon/latest/userguide/sso-cloudtrail-use-cases.html
[9] https://docs.aws.amazon.com/singlesignon/latest/IdentityStoreAPIReference/API_DescribeUser.html
[10] https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_control-access_monitor.html
[11] https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html
[12] https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-lake-service-availability-change.html
[13] https://docs.aws.amazon.com/singlesignon/latest/userguide/sso-info-in-cloudtrail.html
[14] https://docs.aws.amazon.com/singlesignon/latest/userguide/identity-enhanced-sessions.html
[15] https://docs.aws.amazon.com/service-authorization/latest/reference/list_identitystore.html
[16] https://docs.aws.amazon.com/cli/latest/reference/cloudtrail/lookup-events.html
[17] https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html
[18] https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_saml_assertions.html
[19] https://learn.microsoft.com/en-us/entra/identity/saas-apps/amazon-web-service-tutorial
[20] https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0
[21] https://developer.hashicorp.com/vault/docs/secrets/aws
[22] https://developer.hashicorp.com/vault/api-docs/system/audit-hash
[23] https://developer.hashicorp.com/vault/docs/audit/schema
[24] https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetAccessKeyLastUsed.html
[25] https://docs.aws.amazon.com/rolesanywhere/latest/userguide/authentication-create-session.html
[26] https://docs.aws.amazon.com/rolesanywhere/latest/APIReference/API_GetSubject.html
[27] https://docs.aws.amazon.com/singlesignon/latest/IdentityStoreAPIReference/API_GetUserId.html
