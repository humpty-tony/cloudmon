# Native build and launch check — 2026-09-25

## Verified

- [x] Production Wails build completed for Linux/amd64 with the `webkit2_41` tag. Frontend assets and the Go backend are in the real native executable, not Vite.
- [x] `build/bin/cloudmon` is a stripped, dynamically linked x86-64 ELF executable.
- [x] Native startup initialized the database and rendered CloudMon in a GTK/WebKit window. Native logs report `wails.io/605.1.15`.
- [x] Selecting **Import a dump** displayed the offline import form.
- [ ] End-to-end native offline import: blocked when the native file chooser aborted in GTK's image loader.
- [ ] Native Workbench/event/lineage acceptance: not reached in this run. Earlier browser screenshots/checks remain browser evidence only.

Executable SHA-256: `67c26cad544b02725dc39fbb359ed5ff45b07e8b033376f631efb9b1e0726b54`.

Screenshot of the native import screen: `frontend/test-results/native-build/native-import.png` (local, ignored test artifact). It shows the executable before the chooser crash, not an imported dataset.

## Environment and bounded workaround

The Wails CLI was installed in the user's Go bin directory. This host lacked WebKitGTK 4.1. The matching Arch `webkit2gtk-4.1-2.52.6-1-x86_64.pkg.tar.zst` was downloaded/extracted under `/home/humpty/.hermes/cache/scratch/cloudmon-native/sysroot`; no system packages were installed or replaced. Only extracted pkg-config files were relocated for compilation.

Library search paths alone were insufficient for launch: WebKit expects subprocess helpers at `/usr/lib/webkit2gtk-4.1`. A read-only bubblewrap `/usr/lib` overlay supplied that path. The native app then started successfully with an isolated HOME/config/data/cache and X11 backend. Cloud capture was never started; no AWS infrastructure was provisioned, and no real credentials or evidence were imported.

The scratch fixture contains synthetic CloudTrail records, but it was **not imported successfully**. Do not treat its existence as runtime validation.

## Unresolved chooser failure

Clicking **Choose export file** aborted the process inside Wails' native `Opendialog` call:

```text
Gtk:ERROR:../gtk/gtk/gtkiconhelper.c:495:ensure_surface_for_gicon
Failed to load /usr/share/icons/Adwaita/scalable/status/image-missing.svg:
Loader process exited early with status '1'
/usr/lib/glycin-loaders/2+/glycin-svg
SIGABRT: abort
```

The failure location is GTK/glycin in the isolated launch environment. It has not been established whether the same problem occurs in a normal host launch. Do not label this an application-code regression or claim a proven host fix.

Next action: provide WebKitGTK 4.1 through the normal host package installation (requires appropriate user/admin authorization), then retry the real native chooser/import. If the image-loader crash persists outside the overlay, investigate the host GTK/glycin stack with the minimal chooser reproduction before changing CloudMon.

The successful native build regenerated the checked-in Wails bridge/models and package fingerprint. Those generated changes are retained; there are no handwritten application behavior changes in this verification slice. No push, merge, full-suite or live AWS acceptance is claimed.
