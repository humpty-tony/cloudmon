//go:build windows && amd64

package duckdbbin

import _ "embed"

//go:embed bin/duckdb-windows-amd64.exe.gz
var gzData []byte

const exeExt = ".exe"
