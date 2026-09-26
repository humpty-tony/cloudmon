# Native desktop E2E — September 26, 2026

## Scope

Passed against the Linux production executable built from `78d3ef2`, not a browser preview. The actual GTK/WebKit Wails window exercised the real Go/DuckDB backend. The binary was copied into an isolated test directory with separate HOME/config/cache/data paths; synthetic CloudTrail evidence was used. No AWS credentials, capture, provisioning or remote enrichment was needed.

Binary SHA-256: `48e25b8d60304b6066847fa892ef1742d54ca03b1af986ca27a16e0d057e528a`.

Synthetic input SHA-256: `59f3c491fb132ccd9f569acbd84c0e66c0db1618c4b9fc364379045fe77f7cf0`.

## Verified sequence

- [x] Open the production app and import **108 records through the native GTK file chooser**.
- [x] Browse Events, apply `eventName=GetObject`, and select the single matching event (`soc-object`).
- [x] Inspect the selected event and its **Original JSON**, including the correct event ID and recorded assumed-role identity.
- [x] Open **Credential chain**: the native result renders `alice-review → ReviewReader → GetObject`, with `AssumeRole` and recorded `accessKeyId` connections. No fabricated browser resolver response was used.
- [x] Close the graph and return to the same selected event and search.
- [x] In **Hunt → Indicators**, add `198.51.100.44`, run against **All loaded evidence**, and get **5 matching rows**. Independently count the fixture matches and compare with the actual native result rows.
- [x] Return to Events and retain `eventName=GetObject` plus the selected event.
- [x] Invoke **File → Export all matching events…**, enter a destination in the native GTK save dialog, and save the JSON.
- [x] Read the exported file from disk: exactly one record, `soc-object`, with complete parsed record equality to the original fixture event. This checks JSON values and structure, not byte-for-byte whitespace of the exported wrapper.
- [x] Quit the isolated application through its File menu.

## Evidence and automation boundary

Native screenshots, input/output JSON, accessibility observations and a machine-readable verification record were retained locally under `~/.hermes/cache/scratch/cloudmon-ship-e2e/` during execution. Representative screenshots, the fixture/export, native accessibility helper and verification record are preserved in `~/.hermes/reports/cloudmon/2026-09-26-native-e2e/` outside the checkout.

The initial desktop automation route often delivered ineffective background pointer events. Actual GTK/WebKit accessibility actions were used for the remaining controls; the indicator input used real key events. The credential action is exposed by WebKit as a **combo box**, not a button. This was an automation-role mismatch, not an application failure. Assertions on accessibility node names alone do not read all visible static text; screenshots and disk-export verification supplied those checks.

## Limits

This is a bounded Linux native happy-path smoke, not certification of every operating system, graphics driver, file format, large dataset or provider integration. It does not test live capture, remote attribution, all Rules/sequence modes or the eventual version-stamped release archives. Those have separate backend/browser/CI evidence and must not be inferred from this smoke. The release workflow must still succeed for the merged/tagged commit before publication is claimed.
