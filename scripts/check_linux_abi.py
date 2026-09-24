#!/usr/bin/env python3
"""Check the Linux executable's imported libc/libstdc++ ABI (stdlib + readelf)."""

import argparse
import os
import re
import subprocess
import sys


# Ubuntu 22.04: glibc 2.35 and the updated GCC 12 libstdc++6 package.
# These are imported-symbol ceilings, not a replacement for a launch smoke test:
# GTK/WebKit and transitive shared-library dependencies need the target OS too.
LIMITS = {"GLIBC": "2.35", "GLIBCXX": "3.4.30", "CXXABI": "1.3.13"}
NUMERIC_VERSION = re.compile(r"[0-9]+(?:\.[0-9]+)+\Z")


def version_tuple(version):
    parts = [int(part) for part in version.split(".")]
    while parts and parts[-1] == 0:
        parts.pop()
    return tuple(parts)


def check_symbols(output):
    """Return maximum imported versions and actionable compatibility errors."""
    requirements = {family: {} for family in LIMITS}
    for line in output.splitlines():
        fields = line.split()
        # readelf --dyn-syms --wide: Num Value Size Type Bind Vis Ndx Name.
        # Defined symbols are exports, not requirements on the host runtime.
        if len(fields) < 8 or fields[6] != "UND" or "@" not in fields[7]:
            continue
        symbol, version = fields[7].split("@", 1)
        family, _, number = version.lstrip("@").partition("_")
        if family in requirements:
            requirements[family].setdefault(number, set()).add(symbol)

    maxima = {}
    errors = []
    if not requirements["GLIBC"]:
        errors.append("No imported GLIBC versions found; expected a dynamically linked Linux executable.")
    for family, versions in requirements.items():
        numeric = [value for value in versions if NUMERIC_VERSION.fullmatch(value)]
        if numeric:
            maxima[family] = max(numeric, key=version_tuple)
        for version, symbols in sorted(versions.items()):
            label = f"{family}_{version}"
            if not NUMERIC_VERSION.fullmatch(version):
                errors.append(f"Unsupported/private ABI requirement {label}: {', '.join(sorted(symbols))}")
            elif version_tuple(version) > version_tuple(LIMITS[family]):
                errors.append(f"{label} exceeds {family}_{LIMITS[family]}: {', '.join(sorted(symbols))}")
    return maxima, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", help="Linux executable to inspect before packaging")
    args = parser.parse_args()
    try:
        output = subprocess.check_output(
            ["readelf", "--dyn-syms", "--wide", args.binary],
            text=True, stderr=subprocess.STDOUT, env={**os.environ, "LC_ALL": "C"},
        )
        maxima, errors = check_symbols(output)
        for family, limit in LIMITS.items():
            found = f"{family}_{maxima[family]}" if family in maxima else "none"
            print(f"Maximum imported {family}: {found} (ceiling {family}_{limit})", flush=True)
        if errors:
            raise ValueError("\n".join(errors))
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        detail = error.output if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f"Linux ABI check failed: {detail.strip()}", file=sys.stderr)
        return 1
    print("Linux ABI check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
