# Desktop UI/UX notes for CloudMon

Research date: September 26, 2026. Scope: visual quality and interaction ergonomics of this compact, cross-platform desktop evidence tool. Sources were read directly from GNOME HIG, Microsoft Windows design guidance and W3C. These are design inputs, not a claim that a webview app conforms to a native toolkit or that a limited audit certifies accessibility.

## 1. Readable typography, not a fashionable replacement font

GNOME recommends the system font, a small set of sizes/weights, and avoiding all-capitals UI prose; relative sizing avoids interfering with accessibility preferences.[1] Microsoft likewise emphasizes hierarchy and readability, regular/semibold weight, and left alignment. Its Windows guidance identifies 12px regular text as a minimum and uses 14px for normal text.[9]

**CloudMon decision:** retain the platform sans-serif for controls and locally bundled Fira Code for literal evidence, identifiers and queries. A monospace technical value is not a reason to render every control in monospace. Prefer 12–13px supporting/interactive text and 13–14px data/body text; remove 9–10px critical context labels rather than replacing the entire font family. Those sizes are our compact-tool choices, not universal accessibility thresholds. Keep the query and syntax overlay metrically identical.

## 2. Contrast must be measured against the actual surface

WCAG's normal-text contrast threshold is 4.5:1; its large-text threshold is 3:1. Placeholder and hover text also count; disabled controls and purely decorative content are exceptions. Calculated values must not be rounded up to claim a pass.[6]

**CloudMon decision:** measure rendered tokens, not just the first CSS declaration or a comment claiming compliance. Check secondary captions/counts on each actual panel background, and text on primary-action fills in normal/hover states. Preserve a visible hierarchy without making supporting investigation context too faint. Do not turn every decorative panel divider into a high-contrast border.

## 3. Corners form a hierarchy; neither sharp nor round is inherently best

Windows uses a coherent 0/4/8px geometry: touching edges remain square, ordinary controls use 4px, and floating containers use 8px. It avoids rounding edges where components meet.[3] GNOME reserves pill-like suggested actions for particular open-space contexts rather than requiring them everywhere.[2]

**CloudMon decision:** keep the rectangular grid/pane structure. Use the existing restrained 4px control vocabulary consistently and a slightly larger radius for dialogs/popovers. Do not round every row, add card stacks, or introduce oversized pill controls. Any radius adjustment is a consistency choice, not a proven productivity boost.

## 4. Controls should be easy to acquire and clearly actionable

WCAG 2.2's pointer-target minimum is 24×24 CSS pixels, with defined spacing, inline, equivalent-control and other exceptions. Larger important targets remain useful even when a small target could pass by spacing.[4] GNOME recommends concise action verbs, predictable behavior and disabling unavailable actions instead of offering an avoidable error.[2]

**CloudMon decision:** aim for at least 24px hit regions for standalone dense-grid controls and approximately 28–32px toolbar actions. Expand the hit box without enlarging every glyph or row. Keep dangerous/exclude actions visually distinct and keep disabled states honest. Assess actual adjacency before declaring a standards failure; a small bounding box alone does not establish one.

## 5. Button location should follow the object it operates on

GNOME's header guidance calls for a small number of relevant actions, clear alignment and spacing between related groups.[7] Its utility-pane guidance places controls that affect the main view on the left and information subordinate to the main view on the right.[8]

**CloudMon decision:** retain left filters, the central event list and the right selected-event inspector. This already fits the task hierarchy. Dataset actions stay in source/navigation controls; query actions stay beside the query; record actions stay in the inspector; comparison controls stay with pinned records. Improve grouping/alignment before relocating familiar actions. Preserve goal-free browsing and visible temporary-view return paths.

## 6. Focus, feedback and states are part of visual polish

Every keyboard-operable UI needs a persistent visible focus indicator in its keyboard mode. W3C also relates authored focus indicators to non-text contrast requirements.[5] GNOME distinguishes suggested versus destructive actions and recommends restrained emphasis rather than multiple competing strongly styled actions.[2]

**CloudMon decision:** use a consistent visible focus treatment for buttons, fields and custom grids; inspect it after keyboard navigation, not merely in CSS. Distinguish selection, keyboard focus, hover, disabled and destructive states without relying only on color. Do not let subtle styling hide the current target or change the meaning of evidence.

## Audit and implementation method

This is an **Explore** surface with secondary **Command/Inspect** behavior, not a landing page. Review the actual rendered Workbench, selected record, original evidence, Hunt/Rules, comparison and Sources at 1280×800 and 1440×960. Record computed font metrics, target bounds, contrast and screenshots. Use the same synthetic records before/after.

Preserve useful row density, pane allocation, exact source text, user scope/drafts/selection and on-demand lineage. Keep what already works. List specific discrepancies before coding; implement only justified improvements in small slices with focused checks. A short separate visual critique follows implementation; no open-ended test/review campaign.

## Sources

[1] https://developer.gnome.org/hig/guidelines/typography.html
[2] https://developer.gnome.org/hig/patterns/controls/buttons.html
[3] https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry
[4] https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
[5] https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
[6] https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
[7] https://developer.gnome.org/hig/patterns/containers/header-bars.html
[8] https://developer.gnome.org/hig/patterns/containers/utility-panes.html
[9] https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography
