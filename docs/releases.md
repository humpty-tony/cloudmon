# Tagged desktop releases

The **Build, check and release** workflow builds every PR and merge to `main`. A pushed version tag also publishes the checked binaries to GitHub Releases, after all three native builds and package checks pass. The workflow uses the built-in `GITHUB_TOKEN`; maintainers do not need to add a PAT or a repository secret.

## Publish a version

First merge the changes, including this workflow, into `main`. Then choose an unused version and tag the merged commit. For example:

```sh
git switch main
git pull --ff-only origin main
git tag -a v0.2.0 -m "CloudMon v0.2.0"
git push origin v0.2.0
```

Use `vMAJOR.MINOR.PATCH`, for example `v0.2.0`. A suffix such as `v0.2.0-rc.1` creates a prerelease and does not mark it Latest. Stable releases use GitHub's version/date-based Latest selection. Full SemVer build suffixes are accepted. Tag names are limited to 64 characters, and each numeric version component must fit Windows' 16-bit version fields. The old `v0.1` release remains available, but new tags must use three version components.

Tags must point to commits already reachable from `main`. Lightweight and annotated tags both work. The workflow validates the tagged commit before building and rechecks the remote tag/main before uploading and publishing. It rejects moved tags, tags outside `main`, and incomplete packages. An ordinary merge does not invent a version or publish a release: push the version tag **after** merging. Push one release tag at a time, using your normal Git credentials; tags created by another workflow using `GITHUB_TOKEN` do not trigger a new push workflow.

The tag supplies the version displayed in CloudMon and in download names. Native Windows/macOS version fields use the numeric core, such as `0.2.0`; native comments include the full tag and commit. Untagged CI builds use a `v0.1.0-dev.<commit>`-style preview label based on `wails.json`, and local builds without `VITE_APP_VERSION` display `dev`.

## Downloads

Each release includes:

| File (example version) | Contents |
| --- | --- |
| `cloudmon-v0.2.0-windows-amd64.zip` | `cloudmon.exe` and license |
| `cloudmon-v0.2.0-linux-amd64.tar.gz` | Executable `cloudmon` and license |
| `cloudmon-v0.2.0-macos-universal.tar.gz` | `cloudmon.app` for Intel and Apple Silicon, and license |
| `SHA256SUMS` | SHA-256 hashes of the three archives |

On Linux, download the archives and checksum file into the same directory, then run `sha256sum -c SHA256SUMS`. On macOS, use `shasum -a 256 -c SHA256SUMS`. If you downloaded only one archive, the other two entries report missing files; check the `OK` result for your archive. On Windows, compare `(Get-FileHash .\cloudmon-v0.2.0-windows-amd64.zip -Algorithm SHA256).Hash` with that file's entry in `SHA256SUMS`.

Extract the archive before launching the executable or app. Tar archives retain executable permissions and macOS app-bundle symlinks. DuckDB is embedded, but system desktop dependencies still apply:

- Windows requires the Microsoft WebView2 runtime.
- Linux builds target updated Ubuntu 22.04 (glibc 2.35) and require GTK 3, WebKit2GTK 4.1 and a GCC 12-compatible C++ runtime (`GLIBCXX_3.4.30`, `CXXABI_1.3.13`). On Ubuntu 22.04, install the current `libgtk-3-0`, `libwebkit2gtk-4.1-0` and `libstdc++6` packages. Other glibc-based distributions need equivalent runtimes. These are not a portable AppImage or a static Linux desktop executable; older glibc and musl/Alpine are not supported.
- macOS archives include both architectures; the workflow verifies the universal executable. These builds are not signed with a publisher certificate or notarized, and Windows builds are not Authenticode-signed. OS trust prompts may therefore apply.

Linux requests WebKit accelerated rendering instead of Wails' software-only default. If a particular graphics driver produces a blank window or rendering corruption, start with `CLOUDMON_DISABLE_GPU=1 ./cloudmon` to use the software fallback. The CI native startup check uses Mesa software rendering and verifies both the accelerated policy and the explicit fallback; it cannot establish performance on every GPU, compositor, or display resolution.

## Checks and retries

The Linux job builds on Ubuntu 22.04, extracts the actual release archive, and rejects executable imports newer than the glibc 2.35 / GCC 12 ABI baseline. It checks runtime library resolution and starts the packaged app under Xvfb, requiring a visible window, a mounted React UI calling the Go bridge, and an initialized DuckDB database. Native startup logs and a screenshot are retained as the `linux-startup` artifact. This complements the existing browser checks, which do not exercise the native loader or WebKit runtime.

The v0.2.0 Linux binary was linked on Ubuntu 24.04 and imports `fmod`/`fmodf` from `GLIBC_2.38`. A `GLIBC_2.38 not found` error with that version is a binary compatibility failure, before CloudMon can start. Use a later release built against the baseline above or build from source on your distribution. Do not replace your system glibc manually to run the old download.

PRs, `main` pushes and manual runs execute the same build, package and checksum steps and upload a **release-assets** preview artifact. They do not publish releases. The only publishing event is a version-tag push. Download preview artifacts from the Actions run; they are retained for seven days.

Publishing creates a draft with generated release notes, uploads all four files, checks the uploaded asset names, sizes and GitHub SHA-256 digests, then publishes. Only this final job has `contents: write`; build and PR jobs have read access. Prereleases stay separate from stable Latest releases.

If a build fails, fix it before choosing a new tag. If only publishing fails (for example, an interrupted upload), inspect the failure and rerun the failed job while its artifacts remain available. The workflow can resume a draft created for the same exact tag and commit. It refuses drafts with unexpected assets and never overwrites a published release. After publication, fixes need a new version; do not move or reuse release tags. A rerun after publication deliberately reports that the release already exists.

No public release is created by the PR checks. Publishing behavior is covered with mocked GitHub responses; real platform archives, checksum assembly, native builds and version display are exercised in CI. The first real version tag exercises the repository's release-write permission.

## References

- [GitHub push/tag workflow triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)
- [GitHub token permissions and event triggering](https://docs.github.com/en/actions/concepts/security/github_token)
- [GitHub release API](https://docs.github.com/en/rest/releases/releases) and [asset digests](https://docs.github.com/en/rest/releases/assets)
- [Draft-first publication and immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [Wails project version metadata](https://v2.wails.io/docs/reference/project-config/) and [platform dependencies](https://v2.wails.io/docs/gettingstarted/installation/)
- Ubuntu 22.04 runtime packages: [glibc](https://packages.ubuntu.com/jammy/libc6), [WebKit2GTK 4.1](https://packages.ubuntu.com/jammy/libwebkit2gtk-4.1-dev), [libstdc++6](https://packages.ubuntu.com/jammy/libstdc++6), and [GCC ABI versions](https://gcc.gnu.org/onlinedocs/gcc-13.4.0/libstdc++/manual/manual/abi.html)
