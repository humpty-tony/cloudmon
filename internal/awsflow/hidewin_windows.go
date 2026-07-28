//go:build windows

package awsflow

import (
	"os/exec"
	"syscall"
)

// hideWindow suppresses the console window a child process would otherwise pop up
// (a GUI app spawning a console program gets a flashing shell on Windows).
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}
