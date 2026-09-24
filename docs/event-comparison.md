# Compare original event records

Use **Pin event A** and **Pin event B** in an expanded console or Sigma event, then choose **Compare events** from the pinned-evidence bar. Both slots retain the original record string. Later capture arrivals, imports, or source reloads cannot substitute different evidence into those copies.

The bar supports removing either pin, swapping A/B, and clearing both. With two records already pinned, the inspector explicitly offers **Replace event B**; A remains the reference. Pins exist only for the current app session and do not create a workspace or persist event contents to browser storage.

## Comparison semantics

The comparison reports added, removed, and changed fields by JSON Pointer path. Object member order is ignored; array positions remain significant. A missing field is distinct from a null value, and type changes are visible. Added or removed containers are reported as one change with a container summary; their contents remain in the original records.

Numbers retain their exact source spelling without conversion to JavaScript floating point. For example, 9007199254740993 remains distinct from 9007199254740992. Numerically equivalent spellings such as 1e3 and 1000 are also reported as different. This compares recorded fields; it does not normalize AWS policies, ARNs, or semantic equivalence.

**Open original A/B** displays the complete pinned source through the existing segmented raw viewer and copy action. Long comparison values and paths are previews, explicitly marked when truncated. JSON Pointer escaping distinguishes slashes and tildes in field names.

## Responsiveness and limits

Both records are parsed and compared in a worker. Closing, swapping, or replacing the inputs terminates obsolete work. A 15-second timeout and visible retry cover worker failures. The timeline of changes is virtualized, and main-thread rendering receives only bounded previews.

Each record is limited to eight million UTF-16 code units, checked before sending it to the worker and inside the worker. A comparison visits at most 50,000 nodes, descends at most 64 levels, and returns at most 500 changes. Reaching a bound is labelled **comparison incomplete**, even if the inspected portion contains no differences. Additional differences may exist.

The shared evidence parser rejects conflicting duplicate keys and prototype-setter keys that its JSON library could otherwise discard. Parse errors are visible; original source records remain accessible. No AWS API, ingestion, or lineage semantics change.

## Validation

Focused checks cover exact large/decimal numbers, missing versus null, type/array changes, object-order independence, pointer escaping, conflicting duplicate/prototype keys, oversized input, bounded traversal/change counts/depth, and preview limits. Existing inspector checks run against the shared parser.

Browser checks exercise pinning, unchanged pinned copies after source replacement, original-record viewing, Escape behavior, swapping, clearing, incomplete results, and virtualized change rendering. The comparison screenshot is inspected and the Linux/Windows/macOS builds must pass before review.
