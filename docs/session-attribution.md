# Session attribution in lineage

Open an event → **View lineage**. Local and saved evidence loads automatically. If
credential ancestry is incomplete, click **Resolve lineage dynamically**. There is no
per-lineage settings panel or separate source-run button. Completed lineages do not
offer the fallback action; partial results preserve supported evidence and explain gaps.
Optional **Show lookup details** reveals source coverage and failures.

The graph labels each connection by its evidence: `onBehalfOf` (recorded Identity
Store/user ID, enriched with DescribeUser), `accessKeyId` or `userIdentity` (recorded
on the activity), or the actual STS method plus **Issued accessKeyId match**.
Directory association is not a recovered issuance. Click nodes/connections for
the precise field paths, original evidence, request metadata and unresolved gaps.

Opening lineage itself stays local. Remote lookup is explicit, cancellable, and does not
append historical events to the browsing dataset, change its filters, or stop capture.

## Sources

- **CloudTrail (primary):** reuses the normal AWS connection (or saved capture profile
  on startup), otherwise saved advanced config/default credentials, and configured Regions;
  defaults to the event Region plus `us-east-1`. Shows the account established by
  GetCallerIdentity, queried window and coverage outcome. Searches STS event history
  for exact returned access-key IDs, not just requests signed with that key.
  Prioritizes ±5-minute windows around recorded session creation, including newly
  discovered parents. Falls back to separately paginated `EventName` searches for
  `AssumeRole`, `AssumeRoleWithSAML`, `AssumeRoleWithWebIdentity`, `AssumeRoot`,
  `GetSessionToken`, and `GetFederationToken`. Pagination is round-robin so noisy
  ordinary role assumptions cannot starve the other methods. Source details show
  the calls and coverage for each method. A role label never excludes other APIs.
  `ResourceName` is not a required filter: live SAML records had no indexed resources.
- **Identity Center:** infers the home Region from the selected profile's local SSO
  configuration, including source-profile chains, unless explicitly configured.
  Uses recorded `onBehalfOf` store/user
  identifiers with DescribeUser; does not infer identity from an SSO role name.
- **Entra ID (optional):** tenant, Graph token environment-variable name, and explicitly
  attested exact role ARN/time-interval mappings. Verify the provider controls the
  session-name claim and alternative assumption paths cannot impersonate it. Mapping
  is operator attestation, not an automatic trust-policy audit.
- **Vault (optional):** local audit JSONL path; HTTPS address, audit device and token
  environment-variable name when HMAC comparison is needed. Matches successful AWS
  credential responses to the exact access-key identifier and authenticated broker
  entity. Raw audit lines and broker credential secrets are not returned.

Names returned by directories reflect retrieval time, not a historical directory
snapshot. Recorded source identity, directory identity, validated issuance and
broker identity stay separate. None proves the physical person operating credentials.

## Evidence and limits

The same strict native resolver validates time ordering, credential expiration,
identity consistency, competing observations and ambiguity in an isolated temporary
database. The UI exposes the earliest supported request's IP, user agent, timestamp,
Region, event ID and recorded MFA attribute. Unknown initiation metadata is not filled
from the later activity event. Original issuance JSON is available directly.

Coverage is bounded: a 90-day window, 20 pages per Region, at most 8 Regions, a 60-second
adapter deadline, 2 CloudTrail requests/second/account/Region, 512 retained candidates
and 32 MiB scanned history. A busy account can hit these limits before the complete
window is covered; **partial** is not proof that no older issuer exists. Only the
selected account is searched, not the whole organization. Upstream gaps remain visible.
The 20-call budget is shared across creation-window and method-specific queries;
it is not 20 calls per API. Complete pagination of one method does not make the
other methods, Regions, or accounts complete.

Settings contain no connector tokens: native requests read named environment variables.
Recovered original CloudTrail records may contain sensitive fields AWS logged; they
are preserved exactly, not discarded or silently redacted. Settings and cached source
evidence live under the OS config directory at `cloudmon/attribution/` with private
0700 directories and 0600 files. Cache entries bind configuration, selected raw evidence,
local competing observations and snapshot. The 0700/0600 modes apply on POSIX systems;
Windows access is governed by the user config directory's inherited ACLs, not Unix
mode bits. The cross-platform cache tests do not certify those ACLs. Cached results reopen offline; refresh is
explicit. Retention is capped at 32 result files / 256 MiB. Cache is not encrypted.

## Verification boundary

App/store/adapter tests exercise native correlation, source errors, exact raw retention,
configuration, cancellation, stale snapshots and private offline caching. Source tests
use fake AWS interfaces and HTTP/audit fixtures. The screenshot uses actual frontend
components and output generated by the real Go adapters plus strict store resolver,
with explicitly synthetic AWS and Identity Store responses. It is not live-account
acceptance or a native desktop import/capture test. Existing capture is not restarted.

Additional live validation used the authorized `ircc` profile with isolated App
databases: original and freshly generated S3 ListBuckets events, plus a real service
AssumeRole positive control, before/after query-planner changes. The service issuance
resolved in both versions. Both SSO samples still lacked an exact issued-key match;
nearby SAML events had the same role-session ARN but different returned keys. A
separate original-session scan covered all 17 enabled Regions within ±5 minutes;
90-day SAML pagination in us-east-1 also completed without that exact key. This is
not proof of universal absence: ordinary AssumeRole history remained partial.
All six issuance methods and negative/conflict cases are covered by deterministic
adapter/store fixtures, not by six newly executed live federation/authentication flows.

Focused commands:

```sh
go test -p 1 -tags webkit2_41 . ./internal/attribution ./internal/store -count=1
cd frontend && node scripts/check-attribution.mjs
# From repository root; generate real native results from the synthetic UI fixture:
CLOUDMON_ATTRIBUTION_FIXTURE_DIR="$PWD/frontend/test-results/attribution" go test -p 1 -tags webkit2_41 ./internal/attribution -run TestAttributionUIFixture -count=1
# From frontend/:
CLOUDMON_NATIVE_ATTRIBUTION=1 node scripts/check-attribution.mjs
```
