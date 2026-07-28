# CloudMon

Process Monitor for AWS CloudTrail. Open a CloudTrail export, or stream live from a trail you own, and investigate API activity on your own machine: filter, pivot, correlate identities, and test detections, with no SIEM and no per-GB bill.

<p align="center">
  <!-- Demo video placeholder: drop the recording at assets/demo.mp4, or drag-drop a
       file into this spot on GitHub to embed a hosted copy. -->
  <video src="assets/demo.mp4" controls muted width="760">
    <a href="assets/demo.mp4">Watch the CloudMon demo</a>
  </video>
</p>

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

- a real query language over every field,
- facets, a time histogram, and live stats to pivot through millions of events,
- assumed-role lineage that walks an AssumeRole chain back to its origin identity,
- a Sigma testbench to write and validate detections against real data.

Nothing leaves the host. It is for the people who do this work without a Splunk budget: detection engineers, incident responders, researchers, and anyone learning what CloudTrail actually contains.

## How it works

- The backend is Go (via Wails). It embeds the DuckDB command-line engine, gzipped and per-OS, with no CGO in the data path. On first run it extracts DuckDB to a per-user cache directory, so CloudMon ships as a single binary with no database to install.
- Ingested CloudTrail lands in an on-disk DuckDB table. DuckDB streams and queries from disk, so multi-gigabyte dumps stay memory-bounded.
- The React front end never holds the whole dataset. It requests a window of rows plus aggregates (facets, histogram, stats) over the Wails bridge, so it stays responsive at any dataset size.
- Live capture provisions one EventBridge rule and one SQS queue against a trail you already own, then polls the queue. It never modifies your trail, and it removes the rule and queue when you stop.

## Features

**Ingest**
- Import CloudTrail exports fully offline, no AWS access needed: JSON, CSV, NDJSON, gzip, single files or whole folders, S3 log objects, and the console "Event history -> Download" exports.
- Or capture live from an existing trail, streaming management events into a follow/pause tail.

**Investigate**
- Query language: field operators (`=`, `!=`, `~` regex, `:` contains, `*` `?` wildcards), boolean `and` / `or` / `not`, and parentheses.
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

CloudMon is built with Wails. Supported targets are **windows/amd64**, **linux/amd64**, and **macOS (universal: Intel and Apple Silicon)**. Other architectures compile but report an unsupported-platform error at startup.

### Prerequisites
- Go 1.25+ (see `go.mod`)
- Node.js 18+ and npm
- Wails CLI v2: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- Linux only: GTK and WebKit2GTK dev packages, via `make deps` (or `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev`)
- `curl` and `unzip` (for the DuckDB fetch step)

`wails doctor` verifies the toolchain.

### 1. Fetch the embedded DuckDB binaries
These are not committed to the repo (they are large). Download them once:

```
./scripts/fetch-duckdb.sh
```

This fills `internal/duckdbbin/bin/` so `go:embed` can bundle the right binary at build time.

### 2. Build
Each platform's webview differs, so Windows can be built anywhere, while Linux and macOS must be built on their own OS:

- **Windows** (no CGO, cross-compiles from any OS):
  ```
  wails build -platform windows/amd64
  ```
- **macOS** (build on a Mac; needs the Xcode command-line tools):
  ```
  wails build
  ```
- **Linux** (build on Linux; needs the GTK/WebKit packages above):
  ```
  make build      # wraps: wails build -tags webkit2_41
  ```

The binary is written to `build/bin/`. Run it directly, or use `wails dev` (`make dev` on Linux) for hot reload.

## Usage

- **Import a dump.** Point CloudMon at a CloudTrail JSON/CSV export, an S3 log object, or a folder of logs. No credentials required.
- **Capture live.** Pick an authenticated AWS profile and region, verify identity, and start. CloudMon provisions an EventBridge rule and SQS queue on your existing trail and streams events. Closing the app (or the teardown action) removes what it created. Needs a trail already logging in that region.
- **Generate demo activity.** `scripts/gen-demo-events.ps1` emits benign AWS API calls so a live capture has something to show. See the script header for options.

## AWS permissions

Only live capture touches AWS; importing a dump is fully offline.

**Import a dump** needs no AWS access at all: it reads a local file, with no credentials or IAM permissions.

**Live capture** verifies the caller, checks that a trail is feeding the region, then creates, polls, and tears down its own EventBridge rule and SQS queue. Grant the profile these actions (you can scope them to the `cloudmon-*` rule and queue it creates):

| Action | Why |
| --- | --- |
| `cloudtrail:DescribeTrails`, `cloudtrail:GetTrailStatus` | Preflight (read-only): confirm a trail is actively logging in the region |
| `sqs:CreateQueue`, `sqs:GetQueueAttributes`, `sqs:SetQueueAttributes` | Create the queue and attach the policy that lets EventBridge deliver to it |
| `events:PutRule`, `events:PutTargets` | Create the capture rule and point it at the queue |
| `sqs:ReceiveMessage`, `sqs:DeleteMessage` | Consume events while capturing |
| `events:RemoveTargets`, `events:DeleteRule`, `sqs:DeleteQueue` | Tear the rule and queue down on stop or app close |

`sts:GetCallerIdentity` is also called, to confirm who you are, but it needs no IAM grant (AWS allows it for any valid credentials). The connect screen lists this same set per mode before you start.

## Project layout
- `app.go`, `main.go` - Wails backend and bindings
- `internal/store` - DuckDB-backed query engine (ingest, windows, aggregates, lineage, Sigma)
- `internal/awsflow` - live capture (profiles, STS, EventBridge/SQS provisioning, polling)
- `internal/ingest` - dump parsing (JSON/CSV/folders/gzip)
- `internal/duckdbbin` - embedded DuckDB extraction
- `frontend/src` - React/TypeScript UI

## License

MIT. See [LICENSE](LICENSE).
