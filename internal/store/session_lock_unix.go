//go:build darwin || linux

package store

import (
	"os"
	"syscall"
)

func lockSessionFile(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}
