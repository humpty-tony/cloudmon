# Session attribution implementation

Scope: 90-day CloudTrail history is the primary remote source. Stack Identity Center, explicitly attested Entra mappings, and exact Vault broker-audit evidence; expose initiator request IP, user agent, time, region and MFA where recorded. No claim of verified physical operator.

## Ownership

- Parent: native store overlay and metadata, App bridge/settings/cache, frontend lineage and screenshot, integration/review/commits.
- One worker: `internal/attribution/`, `go.mod`, `go.sum` — real source adapters with focused tests.
- Branch: `feat/vector-workbench`, baseline `a46d2d3`. No push, merge, running-capture restart or live cloud operations.

## Decisions

- Remote lookup is explicit in the lineage modal; browsing and opening local lineage do not contact cloud providers.
- Search up to the AWS event-history retention window with visible account/Region scope, cancellation, page/time bounds and partial/denied/unavailable states.
- Validate recovered STS candidates through the existing strict credential-lineage engine in a separate temporary local store. Do not append historical lookups into the primary browsing dataset or silently change its snapshot.
- Preserve original recovered records and provenance separately. Cached attribution can be reopened offline; refreshing is explicit.
- Connector settings hold profile/Region, mapping attestations, file paths and environment-variable names only. Never pass provider tokens to the renderer or persist them in settings.
- Entra session-name mapping is operator-attested and time-bounded, not inferred merely from a matching email. Vault attribution requires a matching successful credential response and authenticated broker entity.

## Checklist

- [x] Inspect current store, bridge, UI, research and repo handoff; establish disjoint ownership and contracts.
- [x] Native initiator metadata and isolated lineage overlay; source-variant/snapshot safeguards. Focused native regression tests pass; browsing generation/count remain unchanged.
- [ ] Primary bounded CloudTrail adapter and Identity Store enrichment.
- [ ] Optional Entra mapping and Vault audit/HMAC adapters.
- [x] Explicit connector setup, cancellation, persisted offline overlay and evidence access. Native cache/config/isolation tests pass, including stale-snapshot rejection and private-file modes.
- [x] Integrated lineage UI with stacked findings, source coverage, and initiation metadata. Actual-App Chromium checks pass at 1440×960 and 1280×800; fixtures are explicitly synthetic.
- [ ] Focused native/API and actual-App UI checks, bounded adversarial review.
- [ ] Production native rebuild, incremental commits, inspected final screenshot delivered.

Research-backed feasibility is not live-account acceptance. Synthetic API fixtures and browser screenshots must be labelled separately from live/native execution.
