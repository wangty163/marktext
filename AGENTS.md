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

For list Enter and blank-line regressions, start from a nonempty list item and invoke the
production Enter handler once per simulated keypress. Assert every intermediate indentation
level and the final Markdown; do not prebuild the transient empty item or jump the selection to
the expected gap, because that bypasses the empty-item unindent path. Cover bullet, ordered, and
task lists when the shared list path changes.

For installed-app interaction QA, use a disposable Markdown file; never select or type in a
user-owned document. For save and round-trip checks, send real keypresses and poll the on-disk
content until it matches or times out. Verify the editor tree and the file; a UI-only assertion
does not prove that an inserted or deleted blank line was persisted.

## Commit & Pull Request Guidelines

Follow the history's Conventional Commit style: `fix(desktop): preserve RTL text direction`, `fix(muya): ...`, or `docs: ...`. Keep commits scoped and avoid drive-by cleanup. Open PRs against `develop`, link the issue (`Closes #123`), explain the problem and solution, include a test plan, and attach screenshots or recordings for visible changes. Run relevant tests, `pnpm check`, and CI before requesting review.

After every completed development task in this repository, decide whether the README or related docs need updating, commit the verified task changes, and push the current branch to `origin` unless the user explicitly says not to. Do not include unrelated user changes in the commit.

For local macOS installs, replace only `/Applications/MarkText.app`: move the existing bundle to a non-`.app` backup outside `/Applications`, copy the verified build to that exact path, then unregister and move the packaged `.app` artifact out of the indexed workspace. Treat LaunchServices error `-10814` as “not registered” and do not retry renamed backups. Confirm that bundle-id lookup returns only the installed application.
When only a local `.app` is needed, run `electron-builder --mac --<arch> --dir --publish never` from `packages/desktop`; do not build DMG or ZIP artifacts unless requested.
After a visible macOS change, launch that installed path once and verify the actual window and interaction; bundle contents, DOM assertions, and source-run screenshots do not replace installed-window visual QA.
