# Repository Guidelines

## Project Structure & Module Organization

MarkText is a pnpm monorepo. `packages/desktop/` contains the Electron application: main-process code is in `src/main/`, preload bridges in `src/preload/`, and the Vue renderer in `src/renderer/`. Desktop unit and end-to-end tests live in `packages/desktop/test/unit/` and `packages/desktop/test/e2e/`. `packages/muya/` is the TypeScript editor engine, with colocated `src/**/__tests__/` tests and conformance fixtures under `test/spec/`. `packages/muyajs/` is the legacy JavaScript engine; avoid expanding it unless maintaining an existing path. The website is in `packages/website/`; shared scripts and documentation are in `scripts/` and `docs/`.

## Build, Test, and Development Commands

Use Node.js 20.19+ and pnpm 10 from the repository root.

- `pnpm install` installs workspace dependencies and runs post-install setup.
- `pnpm dev` starts the Electron app with renderer hot reload.
- `pnpm build:unpack` creates an unpackaged development build.
- `pnpm check` runs root ESLint and desktop TypeScript checks.
- `pnpm test` runs desktop Vitest suites; `pnpm test:e2e` runs Playwright.
- `pnpm --filter @muyajs/core test` runs Muya unit tests.

Prefer filtered commands for package-specific work, for example `pnpm -C packages/desktop exec vitest run test/unit/specs/pdf.spec.ts`.
If that command tries to reconcile an already-populated `node_modules` in a non-interactive run, use the existing local binaries directly: `packages/desktop/node_modules/.bin/vitest`, `packages/desktop/node_modules/.bin/vue-tsc`, and root `node_modules/.bin/eslint`.
Run Muya's existing Vitest binary from `packages/muya`; running a root-level Vitest command against `packages/muya/src` skips the package Vite transforms and can produce false CSS/font import failures.
For focused Electron E2E, pass only the exact spec after `pnpm -C packages/desktop test:e2e --`; the script already owns the E2E directory and single-worker config, so do not add another directory positional argument.

## Coding Style & Naming Conventions

Root `.editorconfig`, Prettier, and ESLint enforce UTF-8, LF endings, two-space indentation, single quotes, 100-column lines, and no semicolons. Use TypeScript for new desktop code, camelCase for symbols and component directories (`editorWithTabs/`), and PascalCase for types. Follow existing colocated `index.vue` entrypoints. Muya has its own ESLint rules: four-space indentation, semicolons, `I`-prefixed interfaces, and `_`-prefixed private members. Comments should explain rationale or invariants, not restate code; follow `.github/COMMENTING-GUIDELINES.md`.

## Testing Guidelines

Name tests `*.spec.ts`. Add a focused regression test for behavior changes; there is no repository-wide numeric coverage target. Use Vitest for unit logic and Playwright for real Electron, selection, clipboard, or UI flows. Keep Muya tests beside the affected source; use `test/spec/` for CommonMark or GFM behavior.

Prefer the cheapest tier that still proves the behavior, and never take over the
developer's machine while doing it:

1. Muya Vitest (happy-dom) for engine state, Markdown and offsets.
2. `packages/muya/e2e` (Playwright, headless Chromium, no window at all) for anything
   that needs real layout — caret paintability, line heights, selection rectangles.
   Its Vite server needs `pnpm` on PATH; if pnpm is unavailable, start
   `packages/muya/e2e/node_modules/.bin/vite --port 5174 --strictPort` yourself and
   Playwright reuses it.
3. Desktop Electron E2E only for shell-level behavior (menus, tabs, save, IPC).

Desktop Electron runs are unobtrusive by default: the launcher sets
`MARKTEXT_E2E_UNOBTRUSIVE=1`, the window is parked off-display and shown inactive,
the Dock icon is hidden, and native dialogs are auto-answered, so a run neither
covers the desktop nor steals keyboard focus. Because the window is never the OS key
window, Playwright mouse events do not reach the editor — inject clicks and drags
with `test/e2e/mainProcessInput.ts` (`clickViaMain`, `dragViaMain`) instead of
`locator.click()` or `page.mouse`, and never call `app.focus({ steal: true })`.
Details and the reasoning live in `packages/desktop/test/e2e/README.md`;
`unobtrusive-window.spec.ts` guards the contract.

A known-flaky set exists in `packages/muya/e2e` (`editing/undo-redo`,
`editing/search-replace`, `editing/cross-block-enter`, `inline/format-toolbar`,
`inline/shortcuts`, `typing/ime`, `typing/math-and-diagrams`,
`ui/paragraph-front`, `ui/code-block-language-selector-orphan-4654`). Before
treating a failure there as a regression, re-run the same spec on a stashed tree and
compare: the failing subset moves between runs.

Before implementing any feature or behavior change, trace the shared production path and its
callers, then identify related variants, entry points, serialization, history, persistence, and
UI behavior that may be affected. Preserve existing invariants and adapt every impacted branch,
test, and document together; a narrow patch is not complete when it makes sibling behavior drift.

For list Enter and blank-line regressions, start from a nonempty list item and invoke the
production Enter handler once per simulated keypress. Assert every intermediate indentation
level and the final Markdown; do not prebuild the transient empty item or jump the selection to
the expected gap, because that bypasses the empty-item unindent path. Cover bullet, ordered, and
task lists when the shared list path changes.

For collapsed line copy/cut inside a list, the current row is the marker-bearing direct content
child, not the whole list-item subtree. Exclude later children such as nested lists from both the
clipboard payload and internal paste state; cutting must preserve those children, and the focused
regression must assert copied text, pasted Markdown, post-cut Markdown, and undo restoration.

For installed-app interaction QA, use a disposable Markdown file; never select or type in a
user-owned document. For save and round-trip checks, send real keypresses and poll the on-disk
content until it matches or times out. Verify the editor tree and the file; a UI-only assertion
does not prove that an inserted or deleted blank line was persisted.
When a user-owned MarkText window is already open, run the relevant existing E2E spec against the
installed executable with `MARKTEXT_E2E_EXECUTABLE=/Applications/MarkText.app/Contents/MacOS/marktext`.
The shared launcher supplies an isolated temporary profile. Do not use app-level Computer Use or a
separately shell-launched CDP instance for this case: the shared bundle id and single-instance lock
can target the user's window or terminate the QA instance.
Run this installed-app path directly from `packages/desktop` with
`MARKTEXT_E2E_EXECUTABLE=/Applications/MarkText.app/Contents/MacOS/marktext ./node_modules/.bin/playwright test --config=playwright.config.ts <spec>`;
do not route it through pnpm, whose workspace reconciliation can abort in a non-interactive run.

## Commit & Pull Request Guidelines

Follow the history's Conventional Commit style: `fix(desktop): preserve RTL text direction`, `fix(muya): ...`, or `docs: ...`. Keep commits scoped and avoid drive-by cleanup. Open PRs against `develop`, link the issue (`Closes #123`), explain the problem and solution, include a test plan, and attach screenshots or recordings for visible changes. Run relevant tests, `pnpm check`, and CI before requesting review.

After every completed development task in this repository, decide whether the README or related docs need updating, commit the verified task changes, and push the current branch to `origin` unless the user explicitly says not to. Do not include unrelated user changes in the commit.

For local macOS installs, replace only `/Applications/MarkText.app`: move the existing bundle to a non-`.app` backup outside `/Applications`, copy the verified build to that exact path, then unregister and move the packaged `.app` artifact out of the indexed workspace. Treat LaunchServices error `-10814` as “not registered” and do not retry renamed backups. Confirm that bundle-id lookup returns only the installed application.
Use `scripts/install-local-macos.sh <e2e-spec>` from the repository root for this lifecycle. It checks the Playwright config and collects the requested tests, then rejects a running installed main process before building and again before replacing the app; process inspection failure also aborts. Save and quit normally before retrying; the script never quits or kills the app. `--dry-run` performs those same checks and only prints the remaining steps. Run a real install with host authorization because it writes `/Applications` and launches Electron; it builds, packages, keeps a recoverable non-`.app` backup, verifies the installed bundle and runs the requested installed-app E2E, restoring the previous app if any step fails.
Do not run concurrent build/install tasks against the shared `dist/` output or
`/Applications/MarkText.app`. Use the exact installed path, `Info.plist`, matching `app.asar`
hashes, and a successful installed-app E2E as the completion evidence; Spotlight metadata can lag
and is not an installation gate.
When only a local `.app` is needed, run `electron-builder --mac --<arch> --dir --publish never` from `packages/desktop`; do not build DMG or ZIP artifacts unless requested.
After a visible macOS change, launch that installed path once and verify the actual window and interaction; bundle contents, DOM assertions, and source-run screenshots do not replace installed-window visual QA.
