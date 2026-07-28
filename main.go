package main

import (
	"embed"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	// Use a dedicated WebView2 user-data dir (NOT the default %APPDATA%\cloudmon.exe,
	// whose HTTP cache had pinned the UI to a stale build). A fresh dir + the no-cache
	// asset middleware below means new builds always render - no manual cache clearing.
	webviewData := ""
	if d, err := os.UserConfigDir(); err == nil {
		webviewData = filepath.Join(d, "cloudmon-app")
	}

	err := wails.Run(&options.App{
		Title:            "CloudMon - CloudTrail Monitor",
		Width:            1280,
		Height:           880,
		MinWidth:         960,
		MinHeight:        640,
		WindowStartState: options.Maximised, // open filling the screen so nothing is below the fold
		Frameless:        true,              // no OS title bar / menu bar - we draw a custom TitleBar
		// Match --bg-0 (#0e1319), fully opaque - Wails RGBA is 0-255. The old
		// A:1 was ~0% opaque and caused the cold-start / resize flash.
		BackgroundColour: &options.RGBA{R: 10, G: 13, B: 19, A: 255}, // matches --canvas #0a0d13
		AssetServer: &assetserver.Options{
			Assets: assets,
			// Caching strategy that stays snappy AND never renders a stale build:
			// content-hashed assets (Vite emits /assets/<name>-<hash>.js|css|png) are
			// immutable, so WebView2 caches them hard and relaunches skip re-fetching +
			// re-parsing the ~900KB bundle. index.html (and the root) are never cached, so
			// a new build's index.html - which points at the NEW hashes - always loads
			// fresh and pulls the new assets (old hashes stay cached but unreferenced).
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.HasPrefix(r.URL.Path, "/assets/") {
						w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
					} else {
						w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
						w.Header().Set("Pragma", "no-cache")
						w.Header().Set("Expires", "0")
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		OnStartup:  app.startup,
		OnShutdown: app.onShutdown, // tear down any live capture so nothing is orphaned
		Bind:       []interface{}{app},
		Windows: &windows.Options{
			Theme: windows.Dark,
			CustomTheme: &windows.ThemeSettings{
				DarkModeTitleBar:  windows.RGB(10, 13, 19),
				DarkModeTitleText: windows.RGB(238, 241, 246),
				DarkModeBorder:    windows.RGB(10, 13, 19),
			},
			WebviewUserDataPath: webviewData,
		},
		Mac: &mac.Options{
			TitleBar:   mac.TitleBarHiddenInset(),
			Appearance: mac.NSAppearanceNameDarkAqua,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
