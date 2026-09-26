# Desktop visual / ergonomic audit

Baseline: `31984f8`, September 26, 2026. Criteria: [cited desktop UI notes](../research/desktop-ui-guidelines.md). Actual App/browser preview, explicitly synthetic 72-event fixture; 1280×800 and 1440×960. This pass evaluates appearance and comfort, not backend detection correctness or native-window acceptance.

## Verdict

The layout is appropriate for a desktop evidence tool, but small supporting text, faint contrast and inconsistent control treatment make it more tiring to read than it needs to be. The right fix is a restrained readability/control pass, not a new layout or new font family.

Keep: left filters → central event grid → right record inspector, locally bundled Fira Code for data, system sans-serif for controls, dense 42px two-line rows, rectangular pane edges, contextual Pin and lineage actions, and separate Hunt authoring. No hero/cards/website-style whitespace. Existing upper-toolbar and selected-record action locations are sensible; no relocation is justified by this review.

## Improvements to implement

- [x] **DP-1 — Supporting text and filled-action contrast.** All eight theme palettes have muted-text pairs below the 4.5:1 project target on at least one panel surface. Default Graphite is 2.86:1 on the hover/floating surface. Graphite white-on-blue primary labels are 3.29:1 normally and 1.93:1 on hover; Tokyo Night, Dracula, Solarized and One Dark also fail primary-label checks. Correct the actual authoritative palette, retain hierarchy, and use theme-appropriate text on action fills. The measurements are token/surface coverage, not a full WCAG audit of all content.
- [x] **DP-2 — Tiny investigation context.** Time/header text is 10px; actor/origin headings are 9px; source IP/client context is 10.5px; inspector tab/action/context labels vary among many nearby fractional sizes. Raise meaningful context to a small coherent 12px scale, retain 13px primary data and readable heading hierarchy, and replace all-caps micro-headings with sentence-style labels. Preserve grid density and local inspector scrolling.
- [x] **DP-3 — Small and uneven hit regions/focus.** View lineage is 19px high; the pin control is about 23px high; facet exclude is 20px wide; comparison value actions are visually tiny. Increase standalone hit regions without inflating glyphs or rows. Apply a consistent keyboard-visible ring and verify in keyboard mode. Small targets may qualify for spacing exceptions; the finding is an ergonomic improvement, not an unqualified standards violation.
- [x] **DP-4 — Inconsistent action/shape vocabulary.** Search has 3px corners, pin 4px, general primary actions 6px, comparison 10px; Rules uses a green Run action while Hunt uses blue. Standardize ordinary controls around restrained 4px and floating containers around 8px; keep connected edges square. Use the accent action style consistently, reserving semantic green for result/status meaning. Keep actions beside the query/editor/record they affect.

## Baseline evidence

`frontend/test-results/desktop-polish/baseline/` holds measured `observations.json` and Workbench, Hunt, Rules, comparison and light-theme screenshots at the target sizes. These are the actual React components, not a mock design image. Primary records and field names are explicitly synthetic.

The initial scripted focus observation attempted to focus a disabled Search action after an empty query and therefore is **not** a product finding. The keyboard acceptance check must enter a draft and use keyboard modality before measuring focus.

## Acceptance

Use focused RED→GREEN checks for palette, typography and control geometry. Re-render identical sample/viewport screenshots; retain at least the existing useful event-grid height and 42px row density, no document overflow, usable selected-event controls, exact originals and comparison focus. Run a bounded separate visual/code critique, the existing relevant layout/comparison smoke checks and the frontend/native builds. Record the result here and in the implementation checklist; no repeated broad audit.


## Implemented result — September 26, 2026

Integrated with the approved discoverability work. `POLISH_LABEL=flow-final node scripts/check-desktop-polish.mjs all` passes at 1280×800 and 1440×960: measured palette pairs for all eight themes meet the project target; supporting type, compact rows, target geometry and keyboard focus pass. Actual-App synthetic screenshots/observations are in `frontend/test-results/desktop-polish/flow-final/`. Native production compilation passes; this is not native-window interaction acceptance or a complete accessibility audit. See [flow implementation verification](flow-implementation.md).
