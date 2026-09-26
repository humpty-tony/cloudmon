# CloudMon — discoverability and investigation flow review

Date: September 26, 2026.

**Subsequent approval:** The user approved direct implementation ("Ship it! Lets make it pretty"). The review below records the pre-implementation findings; current verified progress is tracked in `../ui-implementation.md`.

## Scope and status

User concern: functions are hard to identify and the app lacks an intuitive flow. This is a **review and proposal**, not authorization to implement a new navigation model. No production code was changed for this review. The prior desktop readability/control polish remains uncommitted at this checkpoint.

Reviewed CloudMon at HEAD `31984f8` plus the existing desktop-polish working diff. Evidence: actual-App synthetic screenshots in `frontend/test-results/desktop-polish/after/` (Workbench, Hunt, Rules, comparison), plus current component source. This is a heuristic assessment, not a fresh usability study or native-window acceptance. Existing flow correctness checks do not establish first-time discoverability.

External material: `nextlevelbuilder/ui-ux-pro-max-skill`, pinned revision `823b0a14d3539b5d78c0efb614426a4fab5983ec`. Read its main UI/UX skill, full Quick Reference and professional-UI scope notes; inspected relevant UX/app-interface data and product reasoning, and the design/design-system entry points. The latter mostly concern visual systems, branding and slides rather than this interaction problem.[2][3] No package installation or repository scripts were executed.

## Diagnosis

**The interface communicates available mechanisms better than it communicates analyst tasks.** Readability improved, but navigation, action naming and transitions still require knowledge of how CloudMon was built.

The desired mental model is already sound: **open logs → browse freely → inspect an interesting event → optionally follow evidence → return**. Do not replace this with an investigation wizard, mandatory IOC entry, a cases workflow, or more top-level feature tabs. The missing part is a visible, consistent way to discover and follow those optional branches.

## What to take from the supplied skill

- Distinguish primary navigation from secondary controls; keep locations and return behavior consistent. These are explicit Quick Reference navigation recommendations.[8]
- Establish hierarchy with placement, spacing and emphasis, not just color. Group related fields and reveal complex options progressively.[8]
- Make important actions visibly identifiable rather than dependent on hover discovery. Empty states should provide a useful action, not just explanatory text.[4][8]
- Name and expose state: selected, disabled, loading, completed and failed. Preserve inputs and prior view state when returning.[4][8]
- Apply recommendations to the product/platform instead of accepting a generic design-system output. The skill itself requires checking result fit and treating recommendations as subordinate to the user's requirements.[1]

### What not to copy

The product-reasoning row for “Cybersecurity Platform” recommends cyberpunk styling, matrix green and alert animation, and treats light mode as an anti-pattern. That is a preset opinion, not evidence that this would improve CloudMon; it conflicts with the chosen compact evidence-tool direction.[6] Its professional-UI checklist explicitly targets native/mobile interaction and directs desktop readers to the Quick Reference.[7] The app-interface catalog labels its entries iOS/Android/React Native, rather than this Wails desktop surface.[5] Do not import mobile navigation, touch sizing or animation prescriptions indiscriminately. Do not add motion or a command palette as a substitute for visible, understandable actions.

## Findings and proposed changes

### FLOW-1 — Task names are obscured by feature vocabulary — high impact

**Observed:** The current toolbar uses `Lenses` for Errors only / Hide read-only / Sensitive only and `Preset` for column arrangements. `Sources` opens import, saved evidence and capture management. `Pin event A` starts comparison. These labels are accurate internally but do not consistently explain the user's goal.

**Proposal:** Use explicit terms: `Quick filters`, `Column layout`, `Data sources…`, `Add to comparison`, `Credential chain`, `Original JSON`. Consider `Events` in place of `Workbench` as part of the proposed navigation preview—not as a claim that renaming alone solves flow. Retain precise scope and identity wording in details.

**Why this helps:** An analyst should be able to predict what an unfamiliar control does before clicking. The skill's visible-label, navigation-hierarchy and action-affordance recommendations support this direction; the particular names are our product judgment.[8]

**Acceptance:** In a task-based walkthrough, a reviewer can locate error filtering, import/capture, credential ancestry and comparison without being told the current feature names.

### FLOW-2 — Workspace navigation and utility controls lack a strong hierarchy — high impact

**Observed:** Workbench/Hunt and Sources share the title-bar neighborhood although Sources is a dialog, not a peer workspace. The browsing toolbar combines filtering, time, column presets, columns, settings, help, commands and counts. Activity/Summarize controls appear in another heading. The groups are individually usable, but the overall arrangement offers weak cues about “where I am,” “what evidence I am looking at,” and “how I change the display.”

**Proposal:** Keep two destinations: Events and Hunt. Make the active dataset/import/capture entry a distinct utility area. Give the event workspace three clear layers:

1. **Scope and search:** query, time range, active filters.
2. **Results:** count, optional activity timeline and summary, event grid.
3. **Presentation:** column layout, columns and density grouped together, subordinate to investigation controls.

Keep Help and preferences in stable utilities. Do not add a large sidebar or hide core investigation actions in a generic More menu merely to reduce button count.

**Acceptance:** A reviewer can distinguish switching workspace, changing evidence, changing result scope and changing presentation from the resting screen.

### FLOW-3 — Following an event has multiple interaction meanings — highest impact

**Observed:** Clicking a principal/IP in the Overview adds an include filter to browsing. `Around this event` instead opens a temporary, time-bounded snapshot view that ignores the browsing filters and has an explicit Back to browsing action. Hunt pivots use a further explicit full-evidence result view. Scope correctness and returns have been improved, but these different meanings are not obvious at the initial action.

**Proposal:** Expose optional selected-event actions in one stable compact area: **Related events**, **Credential chain**, **Compare**. Keep the chain graph and its evidence labels as they are; do not add an always-open identity workspace.

For value-level actions, distinguish **Filter current results** from **Find related events**. In related results, consistently show the anchor, relationship, time window and scope immediately above the grid, with a stable Back to Events control. Reuse existing state restoration rather than inventing new query behavior. Keep scope differences truthful: “all snapshot evidence” must never look like “current filtered results.”

**Acceptance:** Before clicking, a reviewer can tell whether the action narrows their existing browse view or opens a temporary related-event view. After clicking, they can identify the anchor and return without losing the original query, selection or scroll.

### FLOW-4 — Comparison explains itself only after the first step — high impact, small scope

**Observed:** The selected-event header now visibly exposes `Pin event A`; this is better than the former buried control. However, comparison purpose is absent from that initial label. The comparison bar only appears after the first pin. It then correctly says to pin another event and provides Compare events.

**Proposal:** Start with **Add to comparison**. After selecting the first record, show a compact tray such as **Compare events · 1 of 2 selected · Select another event**. On another selection offer **Add as second event**; with two records offer **Compare**. Keep removal, replacement, exact source copies and snapshot/source association safeguards. Do not repurpose this as persistent bookmarking or a case notebook.

**Acceptance:** A reviewer can compare two records without already knowing what A/B pinning means. Opening comparison must remain deliberate rather than surprising the user during routine selection.

### FLOW-5 — Hunt makes authoring more prominent than using existing capability — high impact

**Observed:** Indicators opens with a typed-format textarea and a mostly empty result pane. Format examples exist in the placeholder, but disappear once typing begins. Rules defaults to an editable starter YAML rule; rule selection and suite execution are separate controls. The modes are present, but their capabilities require learning several distinct entry patterns.

**Proposal:** Keep **Indicators / Rules / Event sequences**, with a short purpose description and the same visual order: choose inputs → confirm scope → run → inspect results.

- Indicators: show supported types and a persistent example; offer a basic type/value entry path while retaining bulk text for power users. Do not silently guess ambiguous types.
- Rules: lead with **Choose a rule** / **Run selected rules** from the existing library. Keep **Edit YAML** directly available but not the only apparent starting point.
- Sequences: use a small realistic starter example that explains grouping/window semantics, with explicit user choice; never run it automatically.
- Keep Run and scope controls in consistent positions across modes. Rules must continue to disclose its full-snapshot engine limitation; do not offer unsupported Workbench-filter scope.

**Acceptance:** An analyst who knows CloudTrail but not CloudMon can run a known indicator or bundled rule without first learning an editor format. Expert text/YAML paths remain fast and available.

### FLOW-6 — Empty space and repeated cautions do little to teach the next action — medium impact

**Observed:** Hunt's empty result pane explains how to run a search but provides no direct action/example there. Rules exposes scope and investigation caveats across separate strips above the editor. The caveats are accurate; their repetition competes with operational orientation. Selected-event and temporary-result contexts already have useful explanations and returns, so this is consolidation, not a claim that feedback is absent.

**Proposal:** Replace passive empty-state instructions with a relevant **Load example** or **Choose rule** action. Present a compact, stable scope/status line near Run and results. Keep essential truthfulness visible; put long matching limitations behind an explicit details control. Do not remove distinctions between a match, an incident, recorded credentials and a verified human. Avoid a forced onboarding tour or adding paragraphs to every section.

**Acceptance:** Empty, not-run, running, completed, zero-match and failed states each provide an obvious next action. The screen states what was searched without making the analyst reread repeated caveats.

## Proposed flow to preview — not a wizard

```text
Data sources…  [active evidence and capture state]
Events | Hunt

Events
  Search + time + current filters
  Facets | Event results | Selected event facts
                          Related events
                          Credential chain
                          Add to comparison

Related events (temporary view of the event grid)
  Anchor + relationship + time window + explicit scope
  Back to Events → prior query, selection and scroll

Hunt
  Indicators | Rules | Event sequences
  Inputs → visible scope → Run → matching events → same inspector
```

The arrows describe optional user journeys, not an enforced stepper. Browsing stays the default and does not require a hypothesis. Do not turn the action group into large feature cards or additional explanatory banners.

## Suggested order

1. **Preview the information architecture:** one compact concept with browsing, event-selected and related-result states. Judge recognition and continuation before CSS details.
2. **Clarify labels and control groups:** navigation, scope/search vs display controls, comparison entry point.
3. **Unify selected-event follow-up:** consistent task actions, explicit filter-vs-related distinction and return orientation, preserving existing engines.
4. **Make Hunt approachable:** existing-rule selection and visible input examples, then progressively disclose authoring.

No need for another theme/font pass, new backend, forced cases, alert lifecycle, extra top-level tabs or wide testing campaign. These are proposals, not completed or approved implementation tasks.

## Evidence map

- `frontend/src/components/TitleBar.tsx:98–106`: workspace buttons and Sources dialog entry.
- `frontend/src/components/Toolbar.tsx:282–355`: Lenses, preset/columns and utilities.
- `frontend/src/App.tsx:869–923`: search/toolbar, contextual facets, results summary controls.
- `frontend/src/components/EventOverview.tsx:71–94,113–131`: value pivots, recorded identity and evidence disclosure.
- `frontend/src/components/EventInspector.tsx:138–175`: around, lineage and initial pin actions.
- `frontend/src/components/ReviewContext.tsx:42–55`: anchored scope, time bounds, return and feedback.
- `frontend/src/components/EvidenceComparison.tsx:28–43`: initial pin label and later comparison guidance.
- `frontend/src/components/HuntWorkspace.tsx:12–42`: mode names and mode placement.
- `frontend/src/components/HuntView.tsx:123–159`: input examples, scope, run, result and empty states.
- `frontend/src/components/SigmaView.tsx:153 onward`: scope, editor/suite switching and Rules presentation.

## Checklist

- [x] Read the supplied skill's applicable interaction/navigation guidance and inspect its product-fit limitations.
- [x] Compare against current CloudMon screenshots and supporting source; distinguish existing features from missing discoverability.
- [x] Record a prioritized proposal and preserve browse-first, evidence and scope constraints.
- [ ] Approve/validate a revised information-architecture concept.
- [ ] Implement approved flow changes. No implementation undertaken in this review.

## Sources

[1] https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/823b0a14d3539b5d78c0efb614426a4fab5983ec/.claude/skills/ui-ux-pro-max/SKILL.md — .claude/skills/ui-ux-pro-max/SKILL.md
[2] https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/823b0a14d3539b5d78c0efb614426a4fab5983ec/.claude/skills/design/SKILL.md — .claude/skills/design/SKILL.md
[3] https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/823b0a14d3539b5d78c0efb614426a4fab5983ec/.claude/skills/design-system/SKILL.md — .claude/skills/design-system/SKILL.md
[4] https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/823b0a14d3539b5d78c0efb614426a4fab5983ec/src/ui-ux-pro-max/data/ux-guidelines.csv — src/ui-ux-pro-max/data/ux-guidelines.csv
[5] https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/823b0a14d3539b5d78c0efb614426a4fab5983ec/src/ui-ux-pro-max/data/app-interface.csv — src/ui-ux-pro-max/data/app-interface.csv
[6] https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/823b0a14d3539b5d78c0efb614426a4fab5983ec/src/ui-ux-pro-max/data/ui-reasoning.csv — src/ui-ux-pro-max/data/ui-reasoning.csv
[7] https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/823b0a14d3539b5d78c0efb614426a4fab5983ec/.claude/skills/ui-ux-pro-max/references/pro-rules.md — .claude/skills/ui-ux-pro-max/references/pro-rules.md
[8] https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/823b0a14d3539b5d78c0efb614426a4fab5983ec/.claude/skills/ui-ux-pro-max/references/quick-reference.md — .claude/skills/ui-ux-pro-max/references/quick-reference.md
