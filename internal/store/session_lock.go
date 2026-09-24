package store

import (
	"fmt"
	"os"
)

// LockSession owns the saved evidence session for the application lifetime. Desktop single-instance
// messaging can fail (for example without D-Bus), so it is not a data-store lock.
// The OS releases this file lock on process exit, including crashes; the file's
// continued existence does not prevent the next launch from recovering evidence.
func LockSession(path string) (*os.File, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := lockSessionFile(file); err != nil {
		file.Close()
		return nil, fmt.Errorf("saved evidence cannot be locked; close any other CloudMon instance: %w", err)
	}
	return file, nil
}
