# CloudMon: analyst-review visual mock

Open `cloudmon-review.html` directly in a browser. No server, installation, external fonts or network access is required. Production CloudMon files were not changed.

## Proposed composition

- Goal-free log browsing: no predefined IOC, hunt, incident or risk verdict.
- Compact facets with per-value distribution and counts computed from the matching sample, include/exclude actions and optional fields.
- Dense event table with target/resource, actor/session and an optional activity histogram.
- Right inspector ordered by event meaning, recorded actor, requested target, origin, related activity and evidence.
- Related-activity and surrounding-event pivots replace the current grid scope explicitly and offer return to the prior view.
- Lineage is an on-demand popup, never a permanent panel.

## Clickable paths

Search, facet includes/excludes, optional facets, event selection, next/previous event, histogram minute selection, related-event pivots, Around this event and return, Fields search, Original sample JSON, inspector close/reopen, graph popup and supporting issuance record. Hunt and real source lifecycle operations are outside scope.

## Evidence boundaries

All 85 records are synthetic, generated within the HTML. Counts describe that sample only. The graph is an illustrative fixture backed by a synthetic credential issuance record, not a native resolver result. Upstream origin is explicitly unobserved; no human identity is inferred. No real cloud evidence, risk score, live TI enrichment, capture or importer is included. `sampleTarget` on generic sample requests is a mock placeholder, not a claimed CloudTrail schema field.

## Verification

Playwright checks passed at 1440×960 and 1280×800. See `verification.json` for measured pane sizes and checked behaviors. No JavaScript errors or HTTP requests occurred. The four default facets fit at both sizes, as does the Around this event action. The Evidence disclosure is below the initial inspector fold at the smaller size and remains reachable by scrolling.

Screenshots:
- `review-1440.png`
- `review-1280.png`
- `lineage-1440.png`

## Bounded adversarial visual review

A separate screenshot review found the initial compact layout pushed Result facet values and the surrounding-event action below the fold. Reduced vertical padding at short heights, without shrinking type; rerendered and verified both controls fit. Table targets, IPs and event names remained readable. Missing-lineage handling and contextual scope were checked explicitly.

Slop diagnostic: 0/10 tells flagged. Existing Vector steel/blue and source typography were retained deliberately. No gradients, hero, equal-weight feature cards, decorative scores or persistent graph. Remaining limitations are prototype scope, fixed inspector width and native desktop-oriented sizing—not production acceptance.
