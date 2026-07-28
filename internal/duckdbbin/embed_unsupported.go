//go:build !((linux && amd64) || (windows && amd64) || darwin)

package duckdbbin

// No DuckDB CLI is embedded for this OS/arch, so Path() returns a clear
// "no embedded duckdb for this platform/arch" error (see extract()) instead of
// shipping a mismatched binary. Supported build targets: windows/amd64, linux/amd64,
// and darwin (the embedded macOS binary is universal: amd64 + arm64).
var gzData []byte

const exeExt = ""
