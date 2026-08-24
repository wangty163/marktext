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

## Coding Style & Naming Conventions

Root `.editorconfig`, Prettier, and ESLint enforce UTF-8, LF endings, two-space indentation, single quotes, 100-column lines, and no semicolons. Use TypeScript for new desktop code, camelCase for symbols and component directories (`editorWithTabs/`), and PascalCase for types. Follow existing colocated `index.vue` entrypoints. Muya has its own ESLint rules: four-space indentation, semicolons, `I`-prefixed interfaces, and `_`-prefixed private members. Comments should explain rationale or invariants, not restate code; follow `.github/COMMENTING-GUIDELINES.md`.

## Testing Guidelines

Name tests `*.spec.ts`. Add a focused regression test for behavior changes; there is no repository-wide numeric coverage target. Use Vitest for unit logic and Playwright for real Electron, selection, clipboard, or UI flows. Keep Muya tests beside the affected source; use `test/spec/` for CommonMark or GFM behavior.

## Commit & Pull Request Guidelines

Follow the history's Conventional Commit style: `fix(desktop): preserve RTL text direction`, `fix(muya): ...`, or `docs: ...`. Keep commits scoped and avoid drive-by cleanup. Open PRs against `develop`, link the issue (`Closes #123`), explain the problem and solution, include a test plan, and attach screenshots or recordings for visible changes. Run relevant tests, `pnpm check`, and CI before requesting review.

After every completed development task in this repository, decide whether the README or related docs need updating, commit the verified task changes, and push the current branch to `origin` unless the user explicitly says not to. Do not include unrelated user changes in the commit.

For local macOS installs, replace only `/Applications/MarkText.app`: move the existing bundle to a non-`.app` backup outside `/Applications`, copy the verified build to that exact path, then unregister and move the packaged `.app` artifact out of the indexed workspace. Confirm that bundle-id lookup returns only the installed application.
