//go:build linux && amd64

package duckdbbin

import _ "embed"

//go:embed bin/duckdb-linux-amd64.gz
var gzData []byte

const exeExt = ""
