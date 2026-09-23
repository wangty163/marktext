#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: scripts/install-local-macos.sh [--dry-run] <e2e-spec> [<e2e-spec> ...]"
  echo 'Validates test collection and requires the installed app to be closed; never quits it for you.'
  echo '--dry-run performs those checks and only prints the remaining install steps.'
}

dry_run=false
if [[ ${1:-} == '--dry-run' ]]; then
  dry_run=true
  shift
fi
if [[ $# -eq 0 ]]; then
  usage >&2
  exit 2
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
desktop_dir="$repo_root/packages/desktop"
playwright_config="$desktop_dir/playwright.config.ts"
playwright_bin="$desktop_dir/node_modules/.bin/playwright"
installed_app='/Applications/MarkText.app'
lsregister='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
arch=${MARKTEXT_INSTALL_ARCH:-$(uname -m)}

case "$arch" in
  arm64)
    builder_arch='arm64'
    package_dir='mac-arm64'
    ;;
  x86_64)
    builder_arch='x64'
    package_dir='mac'
    ;;
  *)
    echo "Unsupported architecture: $arch" >&2
    exit 2
    ;;
esac

# A stale config path or invalid test filter must fail before an expensive
# build or any app replacement. --list collects tests without launching Electron.
[[ -f "$playwright_config" ]] || { echo "Playwright config not found: $playwright_config" >&2; exit 2; }
[[ -x "$playwright_bin" ]] || { echo "Playwright executable not found: $playwright_bin" >&2; exit 2; }
(
  cd "$desktop_dir"
  env MARKTEXT_E2E_EXECUTABLE="$installed_app/Contents/MacOS/marktext" \
    "$playwright_bin" test --config="$playwright_config" --list "$@"
)

# Fail closed if the process snapshot is unavailable. Match the executable
# path, not a bundle name or command argument that could belong to another app.
require_app_closed() {
  local processes running
  if ! processes=$(ps -axo pid=,comm=); then
    echo 'Cannot inspect running applications; refusing app replacement.' >&2
    return 3
  fi
  running=$(printf '%s\n' "$processes" | awk -v target="$installed_app/Contents/MacOS/marktext" '
    { pid = $1; sub(/^[[:space:]]*[0-9]+[[:space:]]+/, ""); if ($0 == target) print pid }
  ')
  if [[ -n "$running" ]]; then
    echo "Installed MarkText is still running (PID: $running). Save your work and quit normally, then retry. No app files were replaced." >&2
    return 3
  fi
}

require_app_closed
packaged_app="$repo_root/dist/$package_dir/marktext.app"
if $dry_run; then
  scratch='/private/tmp/marktext-local-install.DRYRUN'
else
  [[ $(uname -s) == 'Darwin' ]] || { echo 'macOS is required.' >&2; exit 2; }
  [[ -d "$installed_app" ]] || { echo "$installed_app does not exist." >&2; exit 2; }
  scratch=$(mktemp -d "${TMPDIR:-/private/tmp}/marktext-local-install.XXXXXX")
fi
backup_app="$scratch/MarkText-backup"
packaged_copy="$scratch/MarkText-packaged"
failed_app="$scratch/MarkText-failed"
install_started=false

run() {
  if $dry_run; then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

rollback() {
  local status=$?
  if [[ $status -ne 0 ]] && $install_started && ! $dry_run; then
    echo "Install failed; restoring $backup_app" >&2
    [[ ! -e "$installed_app" ]] || mv "$installed_app" "$failed_app"
    mv "$backup_app" "$installed_app"
    "$lsregister" -f "$installed_app" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap rollback EXIT

cd "$desktop_dir"
run "$repo_root/node_modules/.bin/tsx" "$repo_root/scripts/minify-locales.ts"
run "$desktop_dir/node_modules/.bin/electron-vite" build
run "$desktop_dir/node_modules/.bin/electron-builder" --mac "--$builder_arch" --dir --publish never

if ! $dry_run; then
  [[ -d "$packaged_app" ]] || { echo "$packaged_app was not produced." >&2; exit 1; }
fi

# The user may have reopened the app while packaging was running.
require_app_closed
run mv "$installed_app" "$backup_app"
install_started=true
run cp -R "$packaged_app" "$installed_app"

if $dry_run; then
  run "$lsregister" -u "$packaged_app"
else
  unregister_output=''
  if ! unregister_output=$("$lsregister" -u "$packaged_app" 2>&1); then
    [[ "$unregister_output" == *'-10814'* ]] || { echo "$unregister_output" >&2; exit 1; }
  fi
fi
run mv "$packaged_app" "$packaged_copy"
run "$lsregister" -f "$installed_app"

if ! $dry_run; then
  installed_hash=$(shasum -a 256 "$installed_app/Contents/Resources/app.asar")
  packaged_hash=$(shasum -a 256 "$packaged_copy/Contents/Resources/app.asar")
  [[ ${installed_hash%% *} == "${packaged_hash%% *}" ]] || {
    echo 'Installed app.asar does not match the packaged build.' >&2
    exit 1
  }
  bundle_id=$(plutil -extract CFBundleIdentifier raw "$installed_app/Contents/Info.plist")
  [[ "$bundle_id" == 'com.github.marktext.marktext' ]] || {
    echo "Unexpected bundle identifier: $bundle_id" >&2
    exit 1
  }
  resolved_app=$(swift -e 'import AppKit; print(NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.github.marktext.marktext")?.path ?? "NOT_FOUND")')
  [[ "$resolved_app" == "$installed_app" ]] || {
    echo "Bundle identifier resolves to $resolved_app" >&2
    exit 1
  }
fi

run env MARKTEXT_E2E_EXECUTABLE="$installed_app/Contents/MacOS/marktext" \
  "$playwright_bin" test --config="$playwright_config" "$@"

install_started=false
if $dry_run; then
  echo 'Dry run complete.'
else
  echo "Installed and verified $installed_app"
  echo "Recovery backup: $backup_app"
fi
