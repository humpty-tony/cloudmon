#!/usr/bin/env python3
"""Launch the packaged app under Xvfb; require React, the Go bridge and DuckDB."""

import argparse
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time


def check(executable, output):
    executable = executable.resolve(strict=True)
    output.mkdir(parents=True, exist_ok=True)
    linked = subprocess.run(["ldd", "-r", str(executable)], text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
    (output / "libraries.log").write_text(linked.stdout)
    if linked.returncode or "not found" in linked.stdout or "undefined symbol" in linked.stdout:
        raise RuntimeError("Packaged executable has unresolved runtime dependencies:\n" + linked.stdout)

    app_log = executable.with_name("cloudmon.log")
    app_log.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix="cloudmon-linux-smoke-") as temporary:
        root = Path(temporary)
        env = dict(os.environ, XDG_CONFIG_HOME=str(root / "config"),
                   XDG_CACHE_HOME=str(root / "cache"), XDG_DATA_HOME=str(root / "data"),
                   AWS_CONFIG_FILE=str(root / "aws-config"),
                   AWS_SHARED_CREDENTIALS_FILE=str(root / "aws-credentials"),
                   AWS_EC2_METADATA_DISABLED="true", GDK_BACKEND="x11",
                   LIBGL_ALWAYS_SOFTWARE="1")
        database = root / "config/cloudmon/evidence/events.duckdb"
        with (output / "startup.log").open("w") as log:
            process = subprocess.Popen([str(executable)], cwd=root, env=env,
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                deadline = time.monotonic() + 45
                window = None
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError(f"Packaged application exited during startup ({process.returncode})")
                    windows = subprocess.run(
                        ["xdotool", "search", "--onlyvisible", "--name", "^CloudMon - CloudTrail Monitor$"],
                        capture_output=True, text=True, timeout=5)
                    content = app_log.read_text(errors="replace") if app_log.exists() else ""
                    if "[error]" in content:
                        raise RuntimeError("Application logged an error during native startup:\n" + content)
                    if windows.returncode == 0 and "crash logging installed" in content and database.is_file():
                        window = windows.stdout.splitlines()[0]
                        break
                    time.sleep(0.25)
                if window is None:
                    raise RuntimeError("Native window, React-to-Go startup log, or DuckDB did not become ready")
                # Capture the real WebKit window, after React has mounted and painted.
                time.sleep(2)
                subprocess.run(["import", "-window", window, str(output.resolve() / "startup.png")],
                               check=True, timeout=10)
                if process.poll() is not None:
                    raise RuntimeError("Application exited after mounting its UI")
                if "[error]" in app_log.read_text(errors="replace"):
                    raise RuntimeError("Application logged an error after mounting its UI")
                print("Packaged Linux app loaded its native window, React UI, Go bridge and DuckDB.")
            finally:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                if app_log.exists():
                    shutil.copyfile(app_log, output / "cloudmon.log")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    check(args.executable, args.output)
