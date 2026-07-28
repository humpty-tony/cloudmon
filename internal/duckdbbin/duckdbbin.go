// Package duckdbbin embeds the DuckDB CLI (gzipped, per-OS via build tags) into
// the binary and extracts it to a per-user cache dir on first use. This keeps
// CloudMon a single standalone executable - no external DuckDB install, works
// offline/airgapped - while the app itself stays pure-Go and cross-compilable.
package duckdbbin

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

const version = "1.5.5"

var (
	once       sync.Once
	cachedPath string
	cachedErr  error
)

// Path extracts the embedded DuckDB CLI once and returns the on-disk path to it.
func Path() (string, error) {
	once.Do(func() { cachedPath, cachedErr = extract() })
	return cachedPath, cachedErr
}

func extract() (string, error) {
	if len(gzData) == 0 {
		return "", fmt.Errorf("no embedded duckdb for this platform/arch")
	}
	base, err := os.UserCacheDir()
	if err != nil || base == "" {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "cloudmon")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	// Name keyed by version + content hash: upgrades re-extract, and a truncated
	// or tampered cache file won't match and gets rewritten.
	sum := sha256.Sum256(gzData)
	name := fmt.Sprintf("duckdb-%s-%s%s", version, hex.EncodeToString(sum[:6]), exeExt)
	out := filepath.Join(dir, name)
	if fi, err := os.Stat(out); err == nil && fi.Size() > 0 {
		return out, nil // already extracted
	}

	gz, err := gzip.NewReader(bytes.NewReader(gzData))
	if err != nil {
		return "", err
	}
	defer gz.Close()

	tmp, err := os.CreateTemp(dir, "duckdb-*.tmp")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	if _, err := io.Copy(tmp, gz); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return "", err
	}
	tmp.Close()
	if err := os.Chmod(tmpName, 0o755); err != nil {
		os.Remove(tmpName)
		return "", err
	}
	if err := os.Rename(tmpName, out); err != nil {
		// A concurrent run may have created it, or Windows blocks rename-over.
		os.Remove(tmpName)
		if fi, statErr := os.Stat(out); statErr == nil && fi.Size() > 0 {
			return out, nil
		}
		return "", err
	}
	return out, nil
}
