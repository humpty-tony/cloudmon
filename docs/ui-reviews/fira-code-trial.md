# Fira Code readability trial

User-requested trial on `feat/vector-workbench`, based on `089b83c`.

- Bundled unmodified Fira Code 6.2 variable WOFF2, with its OFL license and provenance/hash under `frontend/src/assets/fonts/`. No CDN, font install or package dependency.
- Fira Code precedes generic monospace for events, queries, JSON and existing monospace surfaces. Sans-serif controls remain unchanged.
- Workbench data/action names and both search input/highlight layers increase from 12px to 13px. Other spacing, colors and small metadata remain unchanged.
- Ligatures/contextual substitutions disabled; form controls explicitly inherit settings so their literal query glyphs agree with the highlight overlay.

## Validation

- [x] `npm run check:typography`: observed RED with zero loaded font faces before implementation; subsequent check exposed form-control ligature reset, fixed explicitly; now GREEN for weights 400/500/600, actual font selection, 13px row/search text, literal glyphs, retained original evidence, no external requests or viewport overflow.
- [x] `npm run check:vector-layout`: passed at 1440x960 and 1280x800, including existing retention/evidence/context/source checks.
- [x] `/home/humpty/go/bin/wails build -tags webkit2_41`: final production rebuild passed after all CSS changes.
- [x] Same synthetic AWS fixture captured before/after through the actual React app; no native backend fabricated. Four screens plus full-resolution cropped comparison under `frontend/test-results/fira-code/`; baseline under `frontend/test-results/current-ui-aws/`.
- [x] Bounded independent CSS/font review passed without blockers, based on supplied changes and test evidence; the reviewer did not independently run tools. The final native rebuild passed after dispatch, resolving its pending-build note.

Screenshots are browser captures, not a new native UI smoke. Existing native import/file-picker acceptance remains separate. Running capture was not restarted; no AWS, evidence/query or security logic changed. Prior adversarial workflow findings are not fixed by this typography trial.
