//go:build !windows

package awsflow

import "os/exec"

// hideWindow is a no-op off Windows (no console-window behavior to suppress).
func hideWindow(_ *exec.Cmd) {}
