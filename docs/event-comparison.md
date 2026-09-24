# Original-record comparison — implementation plan

Pin two original event records from the console or Sigma inspector and compare their fields. Preserve exact numeric source text, distinguish missing fields from null, use JSON Pointer paths, and keep array order meaningful. Run parsing/comparison in a worker, cap visited nodes and displayed changes, and make incomplete results explicit.

Pinned records are source copies retained only for the current app session; capture arrivals or dataset imports cannot replace their contents. This introduces no workspace/case-management feature and changes no AWS behavior.

Validate precision, structural changes, parser safety, bounds, pin/clear/swap interactions, and narrow/wide layouts before marking ready. All native CI builds remain required.
