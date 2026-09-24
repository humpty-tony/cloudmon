# Saved hunt configurations

Open **Hunts → Saved hunts** to keep up to 50 named configurations on this device. Enter a name and choose **Save new hunt**. Configurations contain typed indicators or sequence search expressions, the grouping and interval, and a copy of the resolved filter scope. They do not contain evidence or results.

Selecting a saved configuration only selects it for management. **Load hunt** fills the controls, clears previous results and cancels any running hunt. Press **Run hunt** to search the currently loaded evidence. Loading never starts a query automatically. If an old native request finishes after loading, its results are ignored.

**Update saved hunt** replaces the selected configuration with the current inputs and scope. **Rename hunt** changes only its name. **Delete hunt** removes the saved configuration after confirmation; current controls and imported evidence are retained.

## Scope is explicit

Console filters are copied when saving, including exact include/exclude values, existence constraints, error/read-only flags, the query expression, literal text and absolute time bounds. Text and expression constraints are retained independently. Account IDs, ARN partitions, case and leading zeros are preserved. A saved configuration is not linked to future console-filter changes.

After loading, the scope banner identifies saved filters. Expand **Saved filter scope** to inspect them. Choose **Use current console filters** to deliberately replace that scope, or **Clear saved scope** to search all loaded evidence. Save or update again if you want that change to persist. Absolute dates remain absolute; loading a hunt does not advance its time window.

Edited inputs make existing results stale until the next run. Original-record and investigation actions stay tied to the successful result snapshot.

## Storage and recovery

Configurations use this app's local preferences storage and are not synced between devices. The collection is bounded at 50 hunts and 4 MiB, with 80-character names. Indicator and sequence input limits match the hunt controls; actual indicator matching remains validated by the backend when run.

Storage failures are displayed and do not publish a successful save. Unreadable data or unknown schemas remain untouched; editing is blocked until storage recovers or you explicitly choose **Reset saved hunts**. Other-window storage changes refresh the list. Settings → General → **Reset all preferences** also removes saved hunts, after confirmation.

Saved hunts are configurations, not schedules: they run only when requested. Two to five ordered step expressions are retained and executed without changing the saved collection schema.

## Validation

The focused storage check covers exact scope/AST round trips, mutation isolation, CRUD, cache behavior, bounds, corrupt data and storage failures. The browser check covers reload/load/manual-run behavior, copied scope despite console changes, management, cancellation races and minimum-width layout. Desktop CI builds and checks Linux, Windows and macOS.
