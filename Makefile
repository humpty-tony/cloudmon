# CloudMon build helpers (Linux). macOS/Windows just need `wails build` with no tags.
# Recent Linux distros ship libwebkit2gtk-4.1, so Wails needs the webkit2_41 build tag.
export PATH := /usr/local/go/bin:$(HOME)/go/bin:$(PATH)
TAGS := webkit2_41

# One-time system dependencies (needs sudo).
deps:
	sudo apt install -y libgtk-3-dev libwebkit2gtk-4.1-dev

# Hot-reload dev app (opens the window; best for testing).
dev:
	wails dev -tags $(TAGS)

# Production binary -> build/bin/cloudmon
build:
	wails build -tags $(TAGS)

# Run the built binary.
run:
	./build/bin/cloudmon

.PHONY: deps dev build run
