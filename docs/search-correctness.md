# Search correctness

This change group addresses searches that can silently return misleading results:

- Invalid syntax must not remove the expression filter or widen the results.
- Query execution errors must be visible, with previously displayed results clearly identified.
- Missing/empty values, negation, presence checks, quoted escapes, and regex matching need explicit, consistent semantics.
- Every supported field pivot must reach the engine, including event IDs and derived fields.
- Browser preview and native search need shared examples with expected matching event IDs.

Implementation and validation are in progress. The completed document will describe the supported search contract and its limits.
