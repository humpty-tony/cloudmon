#!/usr/bin/env python3
"""Check overlay geometry in system WebKitGTK (python-gi, cairo, GTK3/WebKit4.1).

Run against a loopback Vite server, e.g.:
/usr/bin/python scripts/check-overlay-webkit.py http://127.0.0.1:5199 sources
Uses an offscreen GTK window; no focus changes, AWS calls or real evidence.
"""
import json
import os
import pathlib
import sys
import urllib.parse

os.environ.setdefault('GDK_BACKEND', 'x11')
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2

base = sys.argv[1]
parsed = urllib.parse.urlparse(base)
if parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.scheme != 'http':
    raise SystemExit('Only loopback fixture servers are supported')
panel = sys.argv[2] if len(sys.argv) > 2 else 'sources'
width, height = map(int, sys.argv[3:5]) if len(sys.argv) > 4 else (1280, 800)
capture = sys.argv[5] if len(sys.argv) > 5 else 'running'
out = pathlib.Path(__file__).resolve().parent.parent / 'test-results' / 'overlay-layout'
out.mkdir(parents=True, exist_ok=True)
stem = f'webkit-{panel}-{capture}-{width}x{height}'
window = Gtk.OffscreenWindow()
window.set_default_size(width, height)
view = WebKit2.WebView.new_with_context(WebKit2.WebContext.new_ephemeral())
window.add(view)
window.show_all()
finished = False
exit_code = 2


def screenshot_done(widget, result, report):
    global exit_code
    try:
        widget.get_snapshot_finish(result).write_to_png(str(out / (stem + '.png')))
        print(json.dumps(report), flush=True)
        exit_code = int(bool(report['failures']))
    except Exception as error:
        print(str(error), file=sys.stderr)
    Gtk.main_quit()


def evaluated(widget, result, _data):
    global finished
    if finished:
        return
    try:
        value = widget.evaluate_javascript_finish(result)
        report = json.loads(value.to_string())
        if not report.get('ready'):
            return
        finished = True
        (out / (stem + '.json')).write_text(json.dumps(report, indent=2) + '\n')
        widget.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE,
                            None, screenshot_done, report)
    except Exception as error:
        print(str(error), file=sys.stderr)
        finished = True
        Gtk.main_quit()


def poll():
    if finished:
        return False
    view.evaluate_javascript('JSON.stringify(window.checkOverlayLayout?.() || {ready:false})',
                             -1, None, None, None, evaluated, None)
    return True


def timeout():
    print('Overlay fixture timed out', file=sys.stderr)
    Gtk.main_quit()
    return False


view.load_uri(f'{base}/scripts/fixtures/overlay-layout.html?panel={panel}&capture={capture}')
GLib.timeout_add(150, poll)
GLib.timeout_add_seconds(20, timeout)
Gtk.main()
window.destroy()
sys.exit(exit_code)
