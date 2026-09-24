# Saved hunt configurations

Implementation scope for this PR:

- Save, load, rename, update and remove named indicator or ordered-event hunts on this device.
- Preserve the exact hunt inputs, grouping, interval and resolved filter scope; rerun manually against the current evidence.
- Bound and validate the saved collection, preserve unreadable data, and surface storage failures.
- Keep loaded results separate from editable configuration, with explicit stale/cancel behavior.
- Check persistence and scope handling, inspect the UI, and build on all supported operating systems.
