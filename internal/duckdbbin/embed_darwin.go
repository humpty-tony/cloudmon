//go:build darwin

package duckdbbin

import _ "embed"

//go:embed bin/duckdb-osx-universal.gz
var gzData []byte

const exeExt = ""
