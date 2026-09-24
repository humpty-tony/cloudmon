# Query snapshots and complete export

The initial event page and its counts, facets, and histogram come from one committed database read. Its snapshot carries the current dataset generation, an event-sequence cutoff, and a display timestamp. Imported dataset replacements change the generation, so a previously selected snapshot cannot silently query or export a different dataset that reused sequence numbers.

Subsequent pages use an exclusive `before` sequence cursor within that snapshot. New arrivals cannot shift offsets or create pagination gaps. The app tracks how many rows remain in the original snapshot independently of live aggregate counts. Live tailing starts above the initial snapshot cutoff; ongoing summaries carry newer snapshots while Follow is active. Paused inspection keeps its displayed summaries and export snapshot frozen.

Each first-page search has a cancellable native request ID. Replacing it cancels the old database context, including connection-pool waits. The UI waits for obsolete work to finish releasing resources and skips superseded queued requests. A bounded request history also handles a cancellation that reaches the bridge before the query starts. Background aggregate refreshes are cancelled when the filter changes.

## Export choices

- **Export loaded events** writes the rows currently loaded in the console, preserving their original JSON. Its label makes the UI row cap explicit.
- **Export all matching events** writes every match in the latest successful displayed search snapshot, independently of the 2,000-row page and 20,000-row UI cap. The status message identifies the snapshot time and reports the saved count/path. It is disabled while a new search is pending or failed, and in Sigma view where the console filter would be the wrong scope.

The native exporter streams source records into a temporary file beside the selected destination, checks completion, syncs/closes the file, and only then renames it into place. Cancellation, query errors, or write errors leave an existing destination intact and remove incomplete temporary output. The output is a re-importable `Records` array with numeric source text preserved. It includes one displayed source record per searchable event; observation history and alternate source hashes remain available in Sources & hashes.

An import that happens before the export read starts makes an old snapshot fail explicitly. An export already reading its committed snapshot can finish consistently while other work proceeds. Native operations retain the existing two-minute query timeout. The browser preview implements the same snapshot filtering but downloads through browser memory; the bounded streaming exporter is a desktop feature.

## Validation

Real DuckDB checks cover arrivals between pages, dataset replacement, export beyond 20,000 events, exact numeric evidence, preservation of an existing destination on failure, writer failures, and cancellation while waiting for a connection. Request-registry checks cover cancellation before and during a request. Browser checks cover one active search at a time, ignoring obsolete results, complete export beyond the loaded first page, and export cancellation. All three native build jobs remain required.

The native `userName` facet now pivots on `userName`, matching its counted column rather than the displayed `user` fallback. No AWS API, selector, or event-field extraction behavior changes.
