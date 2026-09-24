import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import release


class ReleaseChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bins = self.root / "bin"
        self.bins.mkdir()
        self.out = self.root / "assets"
        self.license = self.root / "LICENSE"
        self.license.write_text("license fixture\n")
        for name in ("cloudmon", "cloudmon.exe", "cloudmon.app/Contents/MacOS/cloudmon"):
            path = self.bins / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"desktop executable fixture\n")
            path.chmod(0o755)
        (self.bins / "cloudmon.app/Contents/Info.plist").write_text("plist fixture")
        self.tag = "v1.2.3-rc.1"
        self.commit = "a" * 40

    def packages(self):
        with contextlib.redirect_stdout(io.StringIO()):
            for platform in release.PLATFORMS:
                release.package(self.tag, platform, self.out, self.bins, self.license)
        return release.assemble(self.tag, self.out)

    def test_version_validation_and_native_version(self):
        self.assertEqual(release.version_info("v1.2.3"), ("1.2.3", False))
        self.assertEqual(release.version_info("v1.2.3-rc.1+build.42"), ("1.2.3", True))
        for invalid in ("v0.1", "1.2.3", "v01.2.3", "v1.2.3-01", "v1.2.3;whoami", "v65536.2.3", "v1.2.3\n"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                release.version_info(invalid)

    def test_preview_cannot_publish_and_tag_push_can(self):
        output = self.root / "output"
        env = {"GITHUB_OUTPUT": str(output), "GITHUB_REF": "refs/tags/" + self.tag,
               "GITHUB_EVENT_NAME": "workflow_dispatch"}
        with patch.dict(os.environ, env), patch.object(release, "git", return_value=self.commit), \
                patch.object(release, "verify_tag") as verify, contextlib.redirect_stdout(io.StringIO()):
            release.metadata()
            self.assertIn("publish=false\n", output.read_text())
            output.write_text("")
            with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "push"}):
                release.metadata()
            self.assertIn("publish=true\n", output.read_text())
            verify.assert_called_with(self.tag, self.commit)

    def test_tag_must_name_checked_commit_already_on_main(self):
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        def git(*args):
            return subprocess.check_output(["git", "-c", "user.name=Release test", "-c", "user.email=test@example.invalid", *args], text=True, stderr=subprocess.DEVNULL).strip()
        git("init", "-b", "main")
        git("add", "LICENSE")
        git("commit", "-m", "main")
        commit = git("rev-parse", "HEAD")
        git("update-ref", "refs/remotes/origin/main", commit)
        git("tag", "-a", self.tag, "-m", "annotated release")
        release.verify_tag(self.tag, commit)
        with self.assertRaises(ValueError):
            release.verify_tag(self.tag, "b" * 40)
        git("switch", "-c", "unmerged")
        git("commit", "--allow-empty", "-m", "unmerged")
        git("tag", "v1.2.4")
        with self.assertRaises(subprocess.CalledProcessError):
            release.verify_tag("v1.2.4", git("rev-parse", "HEAD"))

    def test_archives_keep_binary_permissions_symlinks_and_checksums(self):
        link = self.bins / "cloudmon.app/Contents/Resources"
        link.symlink_to("MacOS", target_is_directory=True)
        files = self.packages()
        with tarfile.open(self.out / release.asset_name(self.tag, "macos-universal")) as archive:
            self.assertTrue(archive.getmember("cloudmon.app/Contents/Resources").issym())
            self.assertEqual(archive.getmember("cloudmon.app/Contents/Resources").linkname, "MacOS")
            self.assertEqual(archive.getmember("cloudmon.app/Contents/MacOS/cloudmon").mode & 0o777, 0o755)
        with zipfile.ZipFile(self.out / release.asset_name(self.tag, "windows-amd64")) as archive:
            self.assertEqual(set(archive.namelist()), {"cloudmon.exe", "LICENSE"})
        expected = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in files[:-1])
        self.assertEqual((self.out / "SHA256SUMS").read_text(), expected)
        release.assemble(self.tag, self.out, verify=True)
        (self.out / "SHA256SUMS").write_text("corrupt\n")
        with self.assertRaisesRegex(ValueError, "checksums"):
            release.assemble(self.tag, self.out, verify=True)
        files[0].unlink()
        with self.assertRaisesRegex(ValueError, "Missing"):
            release.assemble(self.tag, self.out)

    def exercise_publish(self, *, new=False, published=False, wrong_digest=False, upload_fails=False, forbidden=False):
        files = self.packages()
        record = {"id": 7, "draft": not published, "tag_name": self.tag,
                  "target_commitish": self.commit, "assets": []}
        calls = []
        def api(method, endpoint, data=None):
            calls.append((method, endpoint, data))
            if method == "GET" and "/tags/" in endpoint:
                if forbidden or new:
                    raise subprocess.CalledProcessError(1, ["gh"], stderr="HTTP 403" if forbidden else "HTTP 404")
            if method == "PATCH":
                return {"html_url": "https://github.com/owner/repo/releases/tag/" + self.tag}
            return record
        def upload(*args, **kwargs):
            calls.append(("UPLOAD", args, None))
            if upload_fails:
                raise subprocess.CalledProcessError(1, ["gh"], stderr="upload interrupted")
            record["assets"] = [{"name": path.name, "state": "uploaded", "size": path.stat().st_size,
                                  "digest": "sha256:" + ("0" * 64 if wrong_digest else release.digest(path))} for path in files]
            return ""
        with patch.object(release, "api", side_effect=api), patch.object(release, "gh", side_effect=upload), \
                patch.object(release, "verify_tag"), patch.object(release.subprocess, "run"), contextlib.redirect_stdout(io.StringIO()):
            error = None
            try:
                release.publish(self.tag, self.out, "owner/repo", self.commit)
            except (ValueError, subprocess.CalledProcessError) as caught:
                error = caught
        return calls, error

    def test_new_release_is_draft_until_verified_then_prerelease(self):
        calls, error = self.exercise_publish(new=True)
        self.assertIsNone(error)
        self.assertEqual([call[0] for call in calls], ["GET", "POST", "UPLOAD", "GET", "PATCH"])
        self.assertTrue(calls[1][2]["draft"])
        self.assertEqual(calls[-1][2], {"draft": False, "prerelease": True, "make_latest": "false"})

    def test_existing_draft_resumes_as_stable_without_duplicate_creation(self):
        self.tag = "v1.2.3"
        calls, error = self.exercise_publish()
        self.assertIsNone(error)
        self.assertNotIn("POST", [call[0] for call in calls])
        self.assertEqual(calls[-1][2], {"draft": False, "prerelease": False, "make_latest": "legacy"})

    def test_failed_or_corrupt_upload_never_publishes(self):
        for options in ({"wrong_digest": True}, {"upload_fails": True}):
            with self.subTest(options=options):
                calls, error = self.exercise_publish(**options)
                self.assertIsNotNone(error)
                self.assertNotIn("PATCH", [call[0] for call in calls])

    def test_published_release_and_auth_failure_never_upload_or_create(self):
        for options in ({"published": True}, {"forbidden": True}):
            with self.subTest(options=options):
                calls, error = self.exercise_publish(**options)
                self.assertIsNotNone(error)
                self.assertEqual([call[0] for call in calls], ["GET"])


if __name__ == "__main__":
    unittest.main()
