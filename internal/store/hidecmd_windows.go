//go:build windows

package store

import (
	"os/exec"
	"syscall"
)

// hideWindow stops the duckdb subprocess from flashing a console window.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}
