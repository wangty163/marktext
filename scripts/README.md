# Local macOS installation

Run `scripts/install-local-macos.sh <e2e-spec> [<e2e-spec> ...]` from the repository
root after saving and quitting the installed application. It validates test
collection, builds and packages, backs up the old app, replaces only
`/Applications/MarkText.app`, checks bundle identity and hashes, and runs the
requested specs against the installed executable. An installation failure restores
the backup. The process checks never quit or kill the user's app.

- `--help` / `-h`: print usage without collecting tests, inspecting processes,
  building or installing. Works without dependencies installed.
- `--dry-run`: collect tests and check that the installed app is closed, then print
  the remaining steps. This still requires the desktop dependencies.
- Remaining arguments are spec filters, not arbitrary Playwright options. For
  example, `--pass-with-no-tests` must not bypass the installation gate. Run
  Playwright directly for test-only options.

## Electron downloads despite a cached ZIP

Verified on 2026-09-23 with electron-builder 26.15.3 and @electron/get 3.1.0:
`@electron/get` validates a cached Electron ZIP by downloading `SHASUMS256.txt`
with cache bypass. Thus a complete ZIP cache does **not** make packaging offline;
`ETIMEDOUT` on `release-assets.githubusercontent.com` can be a checksum download
failure, not a missing Electron distribution. Check the error and the installed
`@electron/get` implementation before deleting or downloading the large ZIP again.
The downloader's progress message alone does not prove validation succeeded.

For a network where the default release endpoint is unavailable, use an approved,
reachable mirror through the existing downloader configuration. One verified
fallback for this failure was:

```bash
version=$(node -p "require('./packages/desktop/node_modules/electron/package.json').version")
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_CUSTOM_DIR="$version" \
  scripts/install-local-macos.sh selection-below-document.spec.ts
```

Use the spec relevant to the current change. This mirror expects the version
without a leading `v`; other mirrors may use different directory layouts. The
cache is keyed by download URL, so switching mirrors can require another ZIP
download. Never disable TLS or checksum validation to work around a timeout.
A matching checksum from a mirror verifies consistency with that mirror, not an
independent verification against GitHub.

`scripts/postinstall.ts` already has a mirror fallback for dependency installation,
but does not configure subsequent electron-builder invocations. Do not rerun the
whole postinstall (including native rebuilds) merely to change the packaging
endpoint. Recheck this guidance after electron-builder/@electron/get upgrades,
Electron version changes, or network/mirror changes; the endpoint timeout itself
is not a permanent property of every machine.

## Script regression tests

`node --test scripts/install-local-macos.test.mjs` runs in disposable fixture trees
with mocked processes and test collection. It never builds or replaces the actual
application. `bash -n scripts/install-local-macos.sh` checks shell syntax.
