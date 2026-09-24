# Tagged desktop releases

Implementation plan for this PR:

- Build version tags from commits already merged into `main`.
- Run the existing Linux amd64, Windows amd64 and macOS universal checks.
- Stamp the application version and package versioned downloads with SHA-256 checksums.
- Exercise packaging on pull requests without publishing a release.
- Upload release assets to a draft, verify them, then publish with the built-in GitHub token.
- Document stable versions, prereleases and retrying incomplete drafts.
