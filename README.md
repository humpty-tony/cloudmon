# CloudMon

Process Monitor for AWS CloudTrail. Open a CloudTrail export, or stream live from a trail you own, and investigate API activity on your own machine: filter, pivot, correlate identities, and test detections, with no SIEM and no per-GB bill.

https://github.com/user-attachments/assets/6e5f09d8-cb21-4fa1-a13d-0d47bed212e8

## The problem

When you need an answer out of CloudTrail (who assumed this role, what did this access key touch, what threw AccessDenied at 3am) every option is bad unless you already pay for a pipeline:

- **The AWS console (Event History)** searches one region at a time, keeps 90 days, gives you five fixed filter fields, and has no free-text search, no correlation, and no way to follow an assumed-role chain. Fine for looking up a single event, useless for an investigation.
- **CloudTrail Lake / Athena** means writing SQL and paying per scan. Good for scheduled analytics, painful for interactively poking at an incident.
- **A SIEM** (Splunk, Datadog, Elastic, and friends) is the usual answer, and it works, but per-GB ingest pricing makes ad-hoc and research use absurd, on top of the infrastructure and pipeline you have to run. A solo responder, a small team, or a student looking at an exported log set is not going to stand one up for a one-off.
- **Rolling your own log stack** (OpenSearch/Elastic, Grafana Loki, Quickwit) escapes the per-GB bill, but now you own the cluster: provisioning it, wiring up ingestion, sizing storage, and keeping it patched and alive. That is a permanent piece of infrastructure to babysit for what is usually a one-off look at a log set.
- **grep and jq** over the raw JSON have no structure, no faceting, no identity correlation, and fall over past a few hundred megabytes.

The result is a gate: unless you already run a log pipeline, investigating your own CloudTrail means the console's crippled search or hand-rolled shell scripts.

## What CloudMon does

CloudMon removes that gate. It reads CloudTrail directly (a downloaded dump, or a live stream from a trail you already have) and gives you the exploration you would expect from a SIEM, running entirely on your laptop, offline, for free:

- a query language over supported event and identity fields ([semantics and limits](docs/search-correctness.md)),
- facets, a time histogram, and live stats to pivot through millions of events,
- [event investigation](docs/investigation-context.md) with surrounding-event timelines, resource correlations, and explicit relationship evidence,
- [credential lineage](docs/credential-lineage.md) with qualified STS links, explicit gaps/conflicts, and snapshot-consistent expansion,
- [original-record comparison](docs/event-comparison.md) with two pinned source copies and exact numeric evidence,
- a Sigma testbench to write and validate detections against real data.

Nothing leaves the host. It is for the people who do this work without a Splunk budget: detection engineers, incident responders, researchers, and anyone learning what CloudTrail actually contains.

## How it works

- The backend is Go (via Wails), with DuckDB linked into the application. One persistent engine shares the saved evidence database between a serialized writer and a bounded pool of readers. No separate database installation or extracted executable is needed.
- Ingested CloudTrail lands in an on-disk DuckDB table. DuckDB streams and queries from disk, so multi-gigabyte dumps stay memory-bounded.
- The React front end never holds the whole dataset. It requests a window of rows plus aggregates (facets, histogram, stats) over the Wails bridge, so it stays responsive at any dataset size.
- Live capture provisions one EventBridge rule and one SQS queue against a trail you already own, then polls the queue. It never modifies your trail, and it removes the rule and queue when you stop.

## Features

**Ingest**
- Import CloudTrail exports fully offline, no AWS access needed: JSON, CSV, NDJSON, gzip, single files or whole folders, S3 log objects, and the console "Event history -> Download" exports.
- Or capture live from an existing trail, streaming management events into a follow/pause tail.

**Investigate**
- Query language: field operators (`=`, `!=`, `~` regex, `:` contains, `*` `?` wildcards), boolean `and` / `or` / `not`, and parentheses.
- Consistent search snapshots, stable paging during capture, and [complete filtered export](docs/query-snapshots.md) beyond the loaded-row limit.
- Facet sidebar, a brushable time histogram, and a live stats bar (errors, principals, sources, regions, span).
- Assumed-role lineage: trace an AssumeRole session back to the identity that started the chain, or open the full lineage graph.
- Sigma testbench: paste a Sigma rule and see whether it parses and translates, the SQL it compiles to, and the events it matches.
- Lenses: errors-only, hide read-only, and a tunable "sensitive API" highlight.

**Operate**
- Keyboard-first: `j`/`k`/`g`/`G` to move, `Enter` to expand, `/` to filter, `f` to pivot, `Ctrl+K` for the command palette.
- Column presets, drag to reorder and resize, density, timezone, and themes.
- Export the current selection back out as re-importable CloudTrail JSON.

## Install

Prebuilt binaries for Windows, Linux, and macOS are on the [releases page](https://github.com/humpty-tony/CloudMon/releases). Each one is self-contained (the DuckDB engine is embedded), so download the build for your platform and run it, with nothing else to install.

### Build from source

CloudMon is built with Wails. Supported targets are **windows/amd64**, **linux/amd64**, and **macOS (universal: Intel and Apple Silicon)**. The native build matrix tests each supported operating system and verifies both architectures in the macOS executable.

### Prerequisites
- Go 1.25+ (see `go.mod`)
- Node.js 18+ and npm
- Wails CLI v2: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- Linux only: GTK and WebKit2GTK dev packages, via `make deps` (or `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev`)
- A C/C++ compiler for the embedded DuckDB library: GCC on Linux, Xcode command-line tools on macOS, or MinGW-w64 GCC on Windows. CGO must be enabled.

`wails doctor` verifies the toolchain.

### Build

The Go module pins the DuckDB Go driver and its prebuilt static libraries. Go
fetches them during the build; the old CLI download step is no longer needed.
Build on the target OS (cross-compiling now requires a compatible C cross-compiler).

- **Windows**: install a compatible [MinGW-w64 GCC toolchain](https://duckdb.org/docs/current/clients/go/troubleshoot), add `C:\msys64\ucrt64\bin` to `PATH`, and set `CGO_ENABLED=1`:
  ```powershell
  $env:CGO_ENABLED = '1'
  $env:PATH = "C:\msys64\ucrt64\bin;$env:PATH"
  wails build -platform windows/amd64
  ```
- **macOS** (on a Mac with Xcode command-line tools):
  ```
  wails build -platform darwin/universal
  ```
- **Linux** (with GCC and the GTK/WebKit packages above):
  ```
  make build
  ```

The binary is written to `build/bin/`. Run it directly, or use `wails dev` (`make dev` on Linux) for hot reload.

## Usage

- **Hunt across evidence.** Use **Hunts** for bulk IP/CIDR, key-ID, event-ID and ARN searches, or look for one event followed by another for the same recorded principal/credential. Matches expose their source records, scope and limitations. See [investigation hunts](docs/investigation-hunts.md).
- **Analyze activity.** Use **Analysis** for activity rankings, exact entity drilldowns, and comparisons against the preceding equal time window. Results explain scope, missing fields and evidence gaps; original records remain accessible. See [activity analysis](docs/activity-analysis.md).
- **Import a dump.** Point CloudMon at a CloudTrail JSON/CSV export, an S3 log object, or a folder of logs. No credentials required.
- **Capture live.** Pick an authenticated AWS profile and region, verify identity, and start. CloudMon provisions an EventBridge rule and SQS queue on your existing trail and streams events. Closing the app pauses consumption and preserves the local evidence and resource handles. Resume explicitly on the next launch, or use **Remove infrastructure** to delete the rule and queue; unread queued messages are lost on removal. AWS charges and queue retention still apply while CloudMon is closed. Needs a trail already logging in that region.
- **Recover and inspect evidence.** Reopen saved evidence without AWS access. Expand an event and choose **Sources & hashes** to inspect original records, source locations, duplicate observations, and byte variants. Imports replace the dataset only after all input records validate and commit. See [evidence and recovery](docs/evidence-recovery.md).
- **Generate demo activity.** `scripts/gen-demo-events.ps1` emits benign AWS API calls so a live capture has something to show. See the script header for options.

## AWS permissions

Only live capture touches AWS; importing a dump is fully offline.

**Import a dump** needs no AWS access at all: it reads a local file, with no credentials or IAM permissions.

**Live capture** verifies the caller, checks that a trail is feeding the region, then creates, polls, and tears down its own EventBridge rule and SQS queue. Grant the profile these actions (you can scope them to the `cloudmon-*` rule and queue it creates):

| Action | Why |
| --- | --- |
| `cloudtrail:DescribeTrails`, `cloudtrail:GetTrailStatus`, `cloudtrail:GetEventSelectors` | Preflight (read-only): confirm a trail is actively logging in the region |
| `sqs:CreateQueue`, `sqs:GetQueueAttributes`, `sqs:GetQueueUrl`, `sqs:SetQueueAttributes` | Create/recover the queue and attach the policy that lets EventBridge deliver to it |
| `events:PutRule`, `events:PutTargets` | Create the capture rule and point it at the queue |
| `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` | Consume events and renew visibility until the local commit |
| `events:RemoveTargets`, `events:DeleteRule`, `sqs:DeleteQueue` | Remove the rule and queue only through the explicit cleanup action |

`sts:GetCallerIdentity` is also called, to confirm who you are, but it needs no IAM grant (AWS allows it for any valid credentials). The connect screen lists this same set per mode before you start.

## Project layout
- `app.go`, `main.go` - Wails backend and bindings
- `internal/store` - DuckDB-backed query engine (ingest, windows, aggregates, lineage, Sigma)
- `internal/awsflow` - live capture (profiles, STS, EventBridge/SQS provisioning, polling)
- `internal/ingest` - dump parsing (JSON/CSV/folders/gzip)
- `frontend/src` - React/TypeScript UI

## License

MIT. See [LICENSE](LICENSE).
