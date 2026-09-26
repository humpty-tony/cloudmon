# CloudMon

A local, cloud-centric investigation workspace for AWS CloudTrail. Open exported logs and browse activity without needing a predefined hunt, or capture live from an existing trail. Follow recorded identities and credential relationships, inspect original evidence, and test indicators and detections on your own machine.

CloudMon provides SIEM-style investigation tools without a separate log server. It is not a managed SIEM, continuous alerting service, or proof of who physically operated a credential.

## Start with the logs

1. **Open evidence.** Use **File → Open dataset…** or **Data sources…** to import CloudTrail files. Local imports need no AWS credentials. Saved evidence can be reopened offline.
2. **Browse in Events.** Scan the event grid, narrow with facets and the time histogram, or enter a query and press **Search** / Enter. **Activity** and **Summarize** expose broader activity patterns without leaving the event workspace.
3. **Inspect an event.** The right-hand inspector shows recorded context, fields and **Original JSON**. **Related events** opens a scoped contextual view; return to Events without losing your browsing context.
4. **Follow credentials when useful.** **Credential chain** opens a connected graph of supported identity/credential relationships and the selected activity. Click nodes or connections for evidence. If ancestry is incomplete, **Resolve lineage dynamically** explicitly requests remote enrichment; simply opening the graph stays local.
5. **Hunt deliberately.** **Hunt** contains **Indicators**, **Rules**, and **Event sequences**. Add typed indicators individually or choose **Paste multiple indicators**. Review scope before running. Rules evaluate the full evidence snapshot, not the Events filters.
6. **Export evidence.** **File → Export loaded events…** exports loaded rows; **Export all matching events…** exports the complete applied search snapshot, beyond the loaded-row limit. Both produce re-importable CloudTrail JSON.

## Investigation tools

- **Search and facets:** field operators, boolean expressions, regex/contains/wildcards, time filtering, stable paging and snapshot-consistent aggregates. See [search semantics and limits](docs/search-correctness.md) and [filtered export](docs/query-snapshots.md).
- **Event context:** surrounding activity, recorded resources and explicit relationship evidence. See [event investigation](docs/investigation-context.md) and [activity analysis](docs/activity-analysis.md).
- **Credential lineage:** qualified STS links, recorded identity associations, explicit gaps/conflicts and selected-activity connections. A directory identity is not proof of credential issuance or a physical human. See [credential lineage](docs/credential-lineage.md) and [dynamic session attribution](docs/session-attribution.md).
- **Original evidence and comparison:** inspect retained records and source observations; add two events to comparison without rounding large numbers. See [evidence and recovery](docs/evidence-recovery.md) and [record comparison](docs/event-comparison.md).
- **IOC hunts:** IP/CIDR, access-key ID, event-ID and ARN matching, with visible scope and original records. See [investigation hunts](docs/investigation-hunts.md).
- **Rules and sequences:** Sigma diagnostics, match explanations and suites of up to 25 rules; ordered sequences of two to five events tied to recorded principals/credentials. See [Sigma investigation](docs/sigma-investigation.md) and [ordered sequences](docs/ordered-sequences.md).
- **Reusable local configuration:** [saved hunts](docs/saved-hunts.md) and [personal labels](docs/local-aliases.md). Loading a configuration does not automatically run it.
- **Investigation reports:** ZIP exports with printable HTML, manifests, exact event JSON and retained source observations. See [report contents and limits](docs/investigation-reports.md).
- **Desktop controls:** keyboard navigation, command palette, column presets/reordering/resizing, density, timezone and themes.

## Data, privacy and live capture

CloudMon imports local JSON, CSV, NDJSON and gzip files, including downloaded S3 CloudTrail log objects and console Event History exports, individually or from folders. Imports replace the active dataset only after validation and commit.

Go/Wails connects the React UI to an embedded DuckDB engine. Evidence is stored and queried locally; the UI requests bounded row windows and aggregates instead of loading the entire dataset. Dataset size, query complexity and available resources still affect performance.

**Offline review does not need AWS.** Live capture and explicitly requested dynamic attribution do contact configured AWS or identity services. Optional attribution adapters support Identity Center, Entra ID and Vault; their configuration, evidence handling and coverage limits are documented in [session attribution](docs/session-attribution.md). Retained original records can contain sensitive data: protect the local evidence/cache and exported reports accordingly.

**Live capture requires an existing trail logging in the chosen Region.** Select an authenticated profile, verify the caller, and explicitly start capture. CloudMon provisions its own EventBridge rule and SQS queue; it does not modify the trail. Stopping consumption or closing the app preserves saved evidence and resource handles. Resume explicitly, or choose **Remove infrastructure** to delete the rule and queue. Removal loses unread queued messages; AWS charges and queue retention can still apply while CloudMon is closed.

`scripts/gen-demo-events.ps1` can generate benign AWS API activity for an authorized live capture; see the script header before running it.

## Install

Prebuilt Windows, Linux and macOS archives are on the [releases page](https://github.com/humpty-tony/cloudmon/releases). Download the archive for your platform, verify it against `SHA256SUMS`, and extract it. DuckDB is embedded; no database server is needed.

- **Windows / amd64:** requires WebView2.
- **Linux / amd64:** requires compatible GTK 3, WebKit2GTK 4.1 and C++ runtime libraries; the release build targets the Ubuntu 22.04 ABI baseline.
- **macOS / universal:** Intel and Apple Silicon executable. macOS builds are not notarized, and Windows builds are not Authenticode-signed.

See [downloads, runtime requirements and tagged releases](docs/releases.md), including the Linux software-rendering fallback.

## Build from source

Build on the target operating system. Cross-compiling the embedded DuckDB dependencies requires a compatible C/C++ cross-toolchain.

### Prerequisites

- Go 1.25+ (the module version is in `go.mod`).
- Node.js 22 and npm, matching CI.
- The pinned Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@v2.13.0`.
- A C/C++ compiler with CGO enabled: GCC on Linux, Xcode command-line tools on macOS, or MinGW-w64 GCC on Windows.
- Linux: GTK 3 and WebKit2GTK 4.1 development packages. On Debian/Ubuntu, `make deps` installs `libgtk-3-dev` and `libwebkit2gtk-4.1-dev`; other distributions need equivalent packages.

Run `wails doctor` to check the toolchain. Go fetches the pinned DuckDB driver and static libraries during the build.

### Commands

**Linux:**

```sh
make build
```

**macOS:**

```sh
wails build -platform darwin/universal
```

**Windows**, with MinGW-w64 GCC available (adjust the path to your installation):

```powershell
$env:CGO_ENABLED = '1'
$env:PATH = "C:\msys64\ucrt64\bin;$env:PATH"
wails build -platform windows/amd64
```

Output is written to `build/bin/`. Use `make dev` on Linux or `wails dev` on macOS/Windows for hot reload. CI runs native builds, backend/frontend checks and package verification for each supported platform. Browser checks are distinct from native desktop E2E; the verified Linux import → browse → inspect/lineage → hunt → export smoke is recorded in [native E2E verification](docs/ui-reviews/native-e2e.md).

## AWS permissions

**Local imports and offline review:** no AWS access or IAM permissions required.

**Live capture:** verifies the caller, checks the existing trail, and creates/consumes/removes its own capture resources. Scope resource permissions to the `cloudmon-*` rules and queues where the service permits:

| Actions | Purpose |
| --- | --- |
| `cloudtrail:DescribeTrails`, `cloudtrail:GetTrailStatus`, `cloudtrail:GetEventSelectors` | Read-only trail preflight |
| `sqs:CreateQueue`, `sqs:GetQueueAttributes`, `sqs:GetQueueUrl`, `sqs:SetQueueAttributes` | Create/recover the queue and delivery policy |
| `events:PutRule`, `events:PutTargets` | Create the capture rule and target |
| `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` | Consume and acknowledge committed events |
| `events:RemoveTargets`, `events:DeleteRule`, `sqs:DeleteQueue` | Explicit infrastructure removal |

Capture also calls `sts:GetCallerIdentity` to show the authenticated caller. The connection screen lists the required actions before starting.

**Dynamic lineage resolution:** is separately opt-in. It can use CloudTrail history and configured identity-provider APIs rather than the capture queue. See [source configuration, credential handling and bounded coverage](docs/session-attribution.md); capture permissions alone do not imply every enrichment source is available.

## Project layout

- `app.go`, `main.go` — native application and Wails bindings.
- `internal/store` — DuckDB evidence, search, aggregates, correlation, hunts and rules.
- `internal/ingest` — local dump parsing.
- `internal/awsflow` — profile selection, preflight, provisioning and capture.
- `internal/attribution` — optional historical/identity-source enrichment.
- `frontend/src` — React/TypeScript desktop UI.
- `scripts/release.py`, `.github/workflows/build.yml` — versioning, platform packages and tagged publication.

## License

MIT. See [LICENSE](LICENSE).
