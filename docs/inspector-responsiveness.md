# Responsive event inspection

Expanded events no longer parse raw JSON during React rendering or mount every nested field at once. One worker owns the parsed document for the open event. It returns at most 50 short field summaries per request. The field view renders only visible rows, and nested sections open on demand. Progress updates retain the open tree without reparsing its source.

Numbers retain their original JSON text through the worker, including integers beyond JavaScript's safe range and high-precision decimals. Duplicate keys cause an explicit field-view error rather than silently choosing a value; the original source remains available. Field lookup uses own properties, and dotted literal keys cannot impersonate a nested pivot field.

The field view shortens long values to 512 code points and limits nesting to 64 levels. Previous/Next fields navigate large objects or arrays. Raw JSON and source observations render in 32 KiB text segments with surrogate-safe boundaries. Segments preserve source text exactly; Raw JSON Copy and exports still use the complete source. Syntax highlighting applies only to a single small source segment.

Changing or closing an event terminates its worker. Late raw/lineage responses cannot replace another selected event, including in Sigma results. Raw and lineage failures show explicit retry controls. A worker failure or 15-second timeout offers Retry fields; Raw JSON remains accessible. Escape closes the raw modal without collapsing the underlying event.

## Validation

- `npm run check:inspector`: a 20,000-item fixture, bounded summaries, exact integers/decimals, duplicate-key errors, own-property lookup, and reconstruction of source segments across Unicode boundaries.
- CI browser checks: real worker loading, virtualized DOM bounds, array paging, stable parse count during capture progress, raw paging, late responses, retry controls, and 960px layout screenshots.
- Production frontend and native desktop builds on Linux, Windows, and macOS universal. CI exercises Chromium; native WebView behavior still benefits from normal release smoke testing on each OS.

The worker uses pinned [lossless-json](https://github.com/josdejong/lossless-json) for numeric preservation. This change makes no AWS API or event-correlation changes.
