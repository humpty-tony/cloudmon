//go:build !windows

package store

import "os/exec"

// hideWindow is a no-op off Windows (no console window to suppress).
func hideWindow(_ *exec.Cmd) {}
