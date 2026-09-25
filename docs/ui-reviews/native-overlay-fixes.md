# Native overlay sizing fixes — 2026-09-25

Two user-reported defects were reproduced before changing production CSS in the installed WebKitGTK 4.1 renderer using real React components and a synthetic recovery fixture. No live capture, credentials or saved evidence were touched.

## Root cause and fix

- **Sources collapsed body:** the embedded ConnectionScreen inherited `.connect { flex: 1 }`, giving it a zero flex basis inside an intrinsic-height dialog. Native WebKit rendered only 32px of body at 1280×800. Scoped `flex: 1 1 auto` restores content-based sizing; the existing 90vh modal cap and body scroll remain. The same fixture now gives a 601px body inside a 720px centered dialog.
- **Identifier selector oversized:** GTK/WebKit native select appearance made it taller than the neighboring text field. Both controls now use 34px height, 18px line-height and matching padding; the select keeps native HTML selection/keyboard behavior with a local CSS chevron and normalized appearance. Both measure exactly 34px after the entrance animation.

## Verified

- [x] Both native layout assertions failed before the CSS fix, then passed after it.
- [x] Chromium and system WebKitGTK: Sources with running capture at 1280×800, retained capture at 1180×680, saved evidence without capture at 1440×960; identifier fields at 1280×800.
- [x] Chromium action reachability by scrolling, Sources Tab containment/Escape, and identifier dropdown keyboard selection.
- [x] Existing actual-App `npm run check:vector-layout` at 1440×960 and 1280×800, including unchanged Sources recovery/import/browsing preservation checks.
- [x] Normal production `/home/humpty/go/bin/wails build -tags webkit2_41` completed, including frontend compilation. Updated executable: `build/bin/cloudmon`. No temporary library overlay was needed for this build; the host now has the dependency.
- [x] Fixed screenshots inspected: visible recovery actions, no sideways overflow, scrolling source form, aligned selector/input.

## Reproduce

From `frontend`:

```sh
node scripts/check-overlay-layout.mjs --webkit
```

Without `--webkit`, runs only Chromium. Native checks require system Python with PyGObject/cairo plus GTK3/WebKit2 4.1 and an X11 display; `GI_PYTHON` can select that interpreter. The runner uses ephemeral WebKit storage and an offscreen GTK window, so it does not take focus or interact with the running CloudMon process. Vite fixtures reject a native Go bridge and return explicitly synthetic recovery data.

Evidence: `frontend/test-results/overlay-layout/`, including preserved `before-webkit-*` failures and fixed WebKit/Chromium screenshots/geometry. These are real components in the native renderer, not screenshots of the rebuilt Wails executable. This check does not resolve or claim the earlier native file-chooser/import acceptance. The existing running app was not restarted; it needs a user-controlled restart to load the new embedded assets.
