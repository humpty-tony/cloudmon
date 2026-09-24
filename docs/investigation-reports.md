# Investigation report export

Implementation scope: export the displayed investigation as a portable ZIP containing a printable escaped HTML report, a versioned manifest, exact stored event JSON, and retained source observations. Reconstruct the investigation against its successful snapshot and capture source observations in the same read transaction. Disclose capped results and source-observation timing separately.

Bound export size, support cancellation, and replace an existing destination only once the complete archive has been generated successfully. Hashes describe retained bytes, not CloudTrail signature validation.
