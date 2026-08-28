# Releasing MarkText

The release pipeline is triggered by pushing a `v*` tag. The `Release MarkText` workflow (`.github/workflows/release.yml`) then runs **validate → build (5-platform matrix) → publish** and creates a GitHub Release with installers and `SHA256SUMS.txt`.

The flow below covers both release candidates and stable releases — same steps, only the version string differs.

## Prerequisites

- Push access to `wangty163/marktext`
- `gh` CLI authenticated (`gh auth status`)
- A clean checkout of the latest `develop`

The default CI artifacts are unsigned. Public distribution without operating-system warnings
requires a Windows code-signing certificate plus an Apple Developer ID and notarization
credentials. Keep the unsigned macOS warning in the generated release notes until those external
credentials and the corresponding workflow secrets are configured.

## 1. Cut a release branch (first RC only)

```bash
git checkout develop
git pull --ff-only
git checkout -b release/vX.Y.0     # e.g. release/v0.19.0
```

Reuse the same branch for every RC of that minor version (`rc.1`, `rc.2`, …) **and** the eventual stable tag. For follow-ups, just `git checkout release/vX.Y.0` and skip to step 2.

## 2. Bump the desktop package version

Edit the `version` field in `packages/desktop/package.json`. This is the application package read
by electron-builder; the private monorepo package at the repository root does not control installer
versions. The release workflow rejects a tag that does not exactly match this value.

| Stage             | Version string                  |
| ----------------- | ------------------------------- |
| Release candidate | `0.19.0-rc.1`, `0.19.0-rc.2`, … |
| Stable            | `0.19.0`                        |

## 3. Commit and push the branch

```bash
git add packages/desktop/package.json
git commit -m "chore(release): vX.Y.Z[-rc.N]"
git push -u origin release/vX.Y.0
```

## 4. Tag and push

```bash
git tag -a vX.Y.Z-rc.N -m "vX.Y.Z-rc.N"
git push origin vX.Y.Z-rc.N
```

A prerelease component (e.g. `v0.19.0-rc.1`) tells the workflow to mark the GitHub Release as
**pre-release** automatically. Plain `vX.Y.Z` tags publish as stable releases.

## 5. Open a tracking PR (RC only)

Open a **draft** PR from `release/vX.Y.0` → `develop` for visibility. Do **not** merge it until the matching stable tag is pushed — merging an RC commit would freeze `develop` at the RC version.

```bash
gh pr create --draft --base develop --head release/vX.Y.0 \
  --title "chore(release): vX.Y.0 release branch (DO NOT MERGE until stable)" \
  --body "Tracking branch for vX.Y.0. Merge after the stable tag is published."
```

## 6. Monitor the workflow

```bash
gh run list --workflow=release.yml --limit 3
gh run watch <run-id> --exit-status
```

Approximate timing: validate ~30 s · build matrix ~15–30 min (5 platforms in parallel) · publish ~1 min.

## 7. Verify the published release

```bash
gh release view vX.Y.Z-rc.N
```

Confirm:

- `Pre-release` badge on the release page (RC only)
- **23 assets**:
  - **Linux** (5): `AppImage`, `deb`, `rpm`, `snap`, `tar.gz`
  - **macOS arm64** (4): `dmg`, `dmg.blockmap`, `zip`, `zip.blockmap`
  - **macOS x64** (4): `dmg`, `dmg.blockmap`, `zip`, `zip.blockmap`
  - **Windows x64** (3): `setup.exe`, `setup.exe.blockmap`, `zip`
  - **Windows arm64** (3): `setup.exe`, `setup.exe.blockmap`, `zip`
  - **Auto-updater metadata** (3): `latest.yml`, `latest-mac.yml`, `latest-linux.yml`
  - **Checksums** (1): `SHA256SUMS.txt`
- Auto-generated release notes list the PRs merged since the previous tag

The Windows and macOS metadata files contain both x64 and arm64 artifacts. Their per-architecture
intermediate manifests are merged by `scripts/mergeUpdateMetadata.mjs` and are not published.

## 8. Post-stable cleanup (after stable `vX.Y.0` ships)

1. Mark the tracking PR from step 5 ready for review and merge into `develop`
2. Open a follow-up PR bumping `develop`'s `packages/desktop/package.json` to the next dev version
   (e.g. `0.20.0-dev`)

---

For hotfixes off a previously-released tag, see [RELEASE_HOTFIX.md](RELEASE_HOTFIX.md). Once the hotfix branch is ready, steps 2–7 above apply.
