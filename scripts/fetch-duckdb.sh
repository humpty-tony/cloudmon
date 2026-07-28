#!/usr/bin/env bash
# Downloads the DuckDB CLI for all target platforms and gzips them into
# internal/duckdbbin/bin/ for go:embed. Run once before building (the .gz files
# are gitignored to keep the repo lean).
set -euo pipefail
V="${DUCKDB_VERSION:-v1.5.5}"
base="https://github.com/duckdb/duckdb/releases/download/$V"
dir="$(cd "$(dirname "$0")/.." && pwd)/internal/duckdbbin/bin"
mkdir -p "$dir"; cd "$dir"
fetch() { local zip; zip="$(mktemp)"; curl -fsSL -o "$zip" "$1"; unzip -oq "$zip" -d .; rm -f "$zip"; }
fetch "$base/duckdb_cli-linux-amd64.zip";   mv -f duckdb        duckdb-linux-amd64
fetch "$base/duckdb_cli-windows-amd64.zip"; mv -f duckdb.exe    duckdb-windows-amd64.exe
fetch "$base/duckdb_cli-osx-universal.zip"; mv -f duckdb        duckdb-osx-universal
gzip -f -9 duckdb-linux-amd64 duckdb-windows-amd64.exe duckdb-osx-universal
echo "duckdb $V fetched + gzipped into $dir"
