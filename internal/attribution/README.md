# Attribution adapter contract

`Resolve(ctx, seed, local, cfg)` is an explicit read-only enrichment operation.
`seed` and `local` are complete CloudTrail event objects, not lookup-result wrappers.
Pass only investigation-relevant local records: every supplied local identity key
is an additional ancestry root. The package does not load or mutate a store.

Sources are `cloudtrail`, `identity-center`, `entra`, and `vault`. Status values:

- `candidate`: evidence found, not proof of a valid lineage edge or human operator.
- `complete`: bounded source scan/lookup completed without an observed truncation.
- `partial`: useful evidence may exist, but limits, withheld records, or failures
  mean coverage is incomplete.
- `unavailable`: prerequisite, credentials, history, directory record, or access
  unavailable; see the static safe detail.
- `error`: source request/configuration failed.
- `skipped`: optional source has no applicable configuration/attestation.

CloudTrail contributes one status per configured Region. Account scope comes from
GetCallerIdentity with the selected profile/default credential chain. Only one
account is queried; there is no organization or implicit cross-account search.
CloudTrail `events` counts scanned lookup entries and `pages` counts LookupEvents
attempts, excluding GetCallerIdentity. Directory counts are enriched nodes/API
attempts; Vault counts parsed audit entries/hash attempts.

## Evidence and source preservation

`records` contains only newly fetched, exact-issued-key STS candidate ancestors;
`raw` is never reformatted. Competing candidates and raw variants are retained.
The parent MUST validate ordering, expiration, identity consistency, shared-event
observations, and ambiguity in its strict isolated lineage resolver before
presenting an ancestry link. Directory and broker evidence do not replace that
validation. `nodeKey` is the recorded access-key ID, falling back to `event:<id>`
(or `record:<raw hash>`) for keyless directory subjects.

**Sensitive original evidence:** Authorized CloudTrail records are preserved exactly,
including any session-token fields already logged by AWS. Do not discard issuance
records or silently redact/rewrite them: this would defeat correlation or evidence
fidelity. The parent stores originals only in its private local cache (0700 directory,
0600 files), discloses sensitive retention before lookup, and opens them only as
original evidence. They are never sent to directory/broker endpoints or copied into
attribution summaries. This is distinct from connector authentication secrets.
Vault audit lines are never returned. Only the known access-key ID is sent to
Vault's audit-hash API. Provider tokens come from environment variables at request
time and are neither configuration fields nor returned error content.

Entra requires an exact role ARN and a half-open event-time interval
`[validFrom, validTo)`, a parseable non-future `verifiedAt`, and a configured tenant.
If recorded, session creation time must also fall inside that interval. A decoded
token `tid` is accepted only alongside Graph accepting the same token; opaque
tokens require a matching Graph organization lookup. Mapping remains **operator
attestation**, never automatic verification of federation trust. Current directory
names are not historical snapshots. Freeform mapping notes are not echoed.

Vault accepts successful response records with an AWS mount type, an AWS
`sts/<role>` or `creds/<role>` request, request ID, authenticated `auth.entity_id`,
and exact `response.data.access_key` (plaintext or audit-device HMAC). Audit
records lacking mount type are not inferred from path names. Local audit files
are trusted as operator-supplied evidence, not cryptographically verified logs.

## Bounds and operational limitations

- 60-second shared resolution deadline, at most 8 Regions, 20 pages/Region,
  2 LookupEvents calls/second/account/Region across concurrent resolutions.
- Window: now minus 90 days through min(seed event time, now). Older seeds are
  explicitly unavailable for CloudTrail, while other sources can still run.
- At most 512 selected candidates, 12 ancestry hops, 32 MiB scanned history,
  2,048 local records/8 MiB input, and 1 MiB per event/audit line.
- At most 32 unique lookups per directory and 32 Vault audit hashes per resolution.
  Directory/hash results are deduplicated only within that resolution. There is
  no persistent history cache or cross-request directory cache.
- Vault audit: configured regular local file, at most 64 MiB; JSONL only.
- HTTPS with certificate verification, redirect rejection, 12-second HTTP timeout,
  and bounded response bodies. Loopback HTTP exists only in private test injection.
- No AWS/IdP/Vault provisioning, organization traversal, live integration tests,
  credential inspection, or native launch was performed.

Focused verification: `go test -race ./internal/attribution` and
`go vet ./internal/attribution`. Tests use fake AWS interfaces and synthetic
httptest responses/audit files only. Identity Store SDK v1.39.0 matches the
repository's existing AWS core/Smithy versions; no other SDK upgrade is required.
