#!/usr/bin/env python3
"""Build metadata, desktop archives and verified GitHub Releases (stdlib only)."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
from urllib.parse import quote
import zipfile


PLATFORMS = {
    "linux-amd64": ("cloudmon", ".tar.gz"),
    "windows-amd64": ("cloudmon.exe", ".zip"),
    "macos-universal": ("cloudmon.app", ".tar.gz"),
}
VERSION = re.compile(
    r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
)


def version_info(tag):
    match = VERSION.fullmatch(tag)
    if not match or len(tag) > 64:
        raise ValueError("Use vMAJOR.MINOR.PATCH, optionally with a SemVer prerelease/build suffix (64 characters maximum).")
    if any(int(part) > 65535 for part in match.group(1, 2, 3)):
        raise ValueError("Version components must fit Windows' 16-bit file version fields.")
    prerelease = match.group(4)
    if prerelease and any(part.isdigit() and len(part) > 1 and part[0] == "0" for part in prerelease.split(".")):
        raise ValueError("Numeric prerelease identifiers cannot have leading zeros.")
    return ".".join(match.group(1, 2, 3)), bool(prerelease)


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def verify_tag(tag, commit):
    version_info(tag)
    if git("rev-parse", f"refs/tags/{tag}^{{commit}}") != commit:
        raise ValueError("The release tag does not point to the checked-out commit.")
    subprocess.run(["git", "merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"], check=True)


def metadata():
    commit = git("rev-parse", "HEAD")
    ref = os.environ.get("GITHUB_REF", "")
    tagged = ref.startswith("refs/tags/")
    if tagged:
        tag = ref.removeprefix("refs/tags/")
        verify_tag(tag, commit)
    else:
        core = json.loads(Path("wails.json").read_text())["info"]["productVersion"]
        tag = f"v{core}-dev.{commit[:7]}"
    version_info(tag)
    values = {"version": tag, "commit": commit,
              "publish": str(tagged and os.environ.get("GITHUB_EVENT_NAME") == "push").lower()}
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write("".join(f"{key}={value}\n" for key, value in values.items()))
    print(json.dumps(values))


def stamp(tag):
    core, _ = version_info(tag)
    path = Path("wails.json")
    config = json.loads(path.read_text())
    config["info"]["productVersion"] = core
    config["info"]["comments"] = f"CloudMon {tag}; commit {git('rev-parse', 'HEAD')}"
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def asset_name(tag, platform):
    version_info(tag)
    return f"cloudmon-{tag}-{platform}{PLATFORMS[platform][1]}"


def package(tag, platform, directory, bin_dir=Path("build/bin"), license_path=Path("LICENSE")):
    name, extension = PLATFORMS[platform]
    source = bin_dir / name
    binary = source / "Contents/MacOS/cloudmon" if platform == "macos-universal" else source
    if not binary.is_file() or binary.stat().st_size == 0:
        raise ValueError(f"Missing desktop executable: {binary}")
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / asset_name(tag, platform)
    if extension == ".zip":
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(source, name)
            archive.write(license_path, "LICENSE")
    else:
        # tar preserves executable modes and macOS bundle symlinks.
        with tarfile.open(target, "w:gz", dereference=False) as archive:
            archive.add(source, arcname=name)
            archive.add(license_path, arcname="LICENSE")
    print(target)
    return target


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def assemble(tag, directory, verify=False):
    expected = {asset_name(tag, platform) for platform in PLATFORMS}
    actual = {path.name for path in directory.iterdir() if path.name != "SHA256SUMS"}
    if actual != expected:
        raise ValueError(f"Expected all three desktop archives. Missing: {expected-actual}; unexpected: {actual-expected}")
    for platform, (name, extension) in PLATFORMS.items():
        path = directory / asset_name(tag, platform)
        if extension == ".zip":
            with zipfile.ZipFile(path) as archive:
                if archive.getinfo(name).file_size == 0 or "LICENSE" not in archive.namelist():
                    raise ValueError(f"Incomplete Windows package: {path}")
        else:
            with tarfile.open(path, "r:gz") as archive:
                binary = f"{name}/Contents/MacOS/cloudmon" if platform == "macos-universal" else name
                member = archive.getmember(binary)
                if not member.isfile() or member.size == 0 or not member.mode & 0o111:
                    raise ValueError(f"Missing executable permissions or bytes: {path}")
                archive.getmember("LICENSE")
                if platform == "macos-universal":
                    archive.getmember(f"{name}/Contents/Info.plist")
    checksums = "".join(f"{digest(directory/name)}  {name}\n" for name in sorted(expected))
    checksum_path = directory / "SHA256SUMS"
    if verify:
        if checksum_path.read_text() != checksums:
            raise ValueError("Release checksums do not match the downloaded archives.")
    else:
        checksum_path.write_text(checksums, encoding="utf-8")
    return [directory / name for name in sorted(expected)] + [checksum_path]


def gh(*args, data=None):
    return subprocess.run(["gh", *args], input=None if data is None else json.dumps(data),
                          text=True, capture_output=True, check=True).stdout


def api(method, endpoint, data=None):
    args = ["api", "--method", method, endpoint]
    if data is not None:
        args += ["--input", "-"]
    return json.loads(gh(*args, data=data))


def publish(tag, directory, repo, commit):
    _, prerelease = version_info(tag)
    files = assemble(tag, directory, verify=True)
    # Recheck the remote tag/main after the build, before any release mutation.
    subprocess.run(["git", "fetch", "--no-tags", "origin",
                    "+refs/heads/main:refs/remotes/origin/main", f"refs/tags/{tag}:refs/tags/{tag}"], check=True)
    verify_tag(tag, commit)
    endpoint = f"repos/{repo}/releases"
    try:
        release = api("GET", f"{endpoint}/tags/{quote(tag, safe='')}")
    except subprocess.CalledProcessError as error:
        if "HTTP 404" not in (error.stderr or ""):
            raise
        release = api("POST", endpoint, {
            "tag_name": tag, "target_commitish": commit, "name": f"CloudMon {tag}",
            "draft": True, "prerelease": prerelease, "generate_release_notes": True,
            "body": "Download the archive for your OS and verify it against SHA256SUMS. "
                    "macOS includes Intel and Apple Silicon. These binaries are not code-signed or notarized.\n\n"
                    f"Built from commit `{commit}`. See [installation and release notes]"
                    f"(https://github.com/{repo}/blob/{commit}/docs/releases.md)."
        })
    if not release["draft"]:
        raise ValueError("This release is already published. Published downloads are never overwritten; use a new version.")
    if release["target_commitish"] != commit or release["tag_name"] != tag:
        raise ValueError("Existing draft was not created for this exact commit/tag; inspect it before retrying.")
    expected = {path.name: path for path in files}
    if any(asset["name"] not in expected for asset in release["assets"]):
        raise ValueError("Existing draft contains unexpected assets; inspect it before retrying.")
    gh("release", "upload", tag, *map(str, files), "--repo", repo, "--clobber")
    uploaded = api("GET", f"{endpoint}/{release['id']}")
    if not uploaded["draft"] or uploaded["tag_name"] != tag or uploaded["target_commitish"] != commit:
        raise ValueError("Release changed during upload; refusing to publish.")
    assets = uploaded["assets"]
    if len(assets) != len(files) or {a["name"] for a in assets} != set(expected):
        raise ValueError("Release upload is incomplete; draft retained for retry.")
    for asset in assets:
        path = expected[asset["name"]]
        if asset["state"] != "uploaded" or asset["size"] != path.stat().st_size or asset.get("digest") != "sha256:" + digest(path):
            raise ValueError(f"Release asset verification failed: {path.name}; draft retained for retry.")
    result = api("PATCH", f"{endpoint}/{release['id']}", {
        "draft": False, "prerelease": prerelease, "make_latest": "false" if prerelease else "legacy"
    })
    print(result["html_url"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("metadata")
    commands.add_parser("stamp").add_argument("version")
    for command in ("package", "assemble", "publish"):
        sub = commands.add_parser(command)
        sub.add_argument("version")
        sub.add_argument("directory", type=Path)
        if command == "package":
            sub.add_argument("platform", choices=PLATFORMS)
        if command == "publish":
            sub.add_argument("repo")
            sub.add_argument("commit")
    args = parser.parse_args()
    if args.command == "metadata":
        metadata()
    elif args.command == "stamp":
        stamp(args.version)
    elif args.command == "package":
        package(args.version, args.platform, args.directory)
    elif args.command == "assemble":
        assemble(args.version, args.directory)
    elif args.command == "publish":
        publish(args.version, args.directory, args.repo, args.commit)


if __name__ == "__main__":
    main()
