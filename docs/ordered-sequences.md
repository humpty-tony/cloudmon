# Ordered event sequences

Implementation scope: two to five search expressions, strict event-time order, exact principal or credential grouping, and one bounded interval from first to final event. The closest completed preceding sequence is shown for each final event. Keep ties and missing fields explicit, snapshot consistency and cancellation, and source-record access for each step.

This extends the saved hunt step-array format without changing its storage schema. Temporal matches are investigative context and do not prove causation or session identity.
