# Electron test helpers

`launchElectron()` creates a temporary profile and returns its application and page.
`MARKTEXT_E2E_EXECUTABLE` selects an installed executable; without it, the launcher
uses the repository's Electron build. For installed startup behavior, use the
installed path documented in the root `AGENTS.md`.

## Code-block blank-line fixtures

Desktop's default `trimUnnecessaryCodeBlockEmptyLines` is `true`
(`src/renderer/src/store/preferences.ts`); Muya's standalone default is `false`
(`packages/muya/src/config/index.ts`). With the desktop setting enabled, importing
Markdown removes leading/trailing empty code lines before an editing test starts.
For blank-line editing, create those lines with real Enter keys, then navigate to
the target row; see `code-block-cut-empty-line.spec.ts`, verified against both the
source build and installed app. For import tests, explicitly choose the preference
instead. Recheck these defaults when either preference source or import behavior changes.

## Selection below the document

`selection-below-document.spec.ts` releases a real drag below the final block,
checks the selected word count, captures the highlight, then replaces the range
and verifies the saved file. It also checks that a fresh blank-area click still
creates/reuses an empty paragraph. Do not substitute a programmatic range: the
regression depends on the container `click` Chromium emits after the drag.

## Runs never take over the machine

Playwright cannot start Electron headless, so a plain run puts a real window on the
desktop, activates the app, and leaves native sheets there until a timeout expires.
The launcher therefore sets `MARKTEXT_E2E_UNOBTRUSIVE=1`, and the main process
responds to it:

- the editor and preferences windows are created hidden, revealed with
  `showInactive()` and then parked as far off-display as the platform allows
  (macOS clamps a shown window so a sliver of its title bar stays reachable);
- `bringToFront()` never calls `focus()`/`moveTop()`, and on macOS the Dock icon is
  hidden, so the app never becomes frontmost;
- background throttling is disabled, so the hidden window keeps painting: layout,
  caret geometry, `page.screenshot()` and `capturePage` all stay real;
- native dialogs are auto-answered (`src/main/testing/unobtrusiveDialogs.ts`):
  message boxes take the caller's declared default button and file pickers report a
  cancellation. Without this, an unanswered "Save changes?" sheet blocks quitting
  for the full `closeTestApplication` timeout on every dirty document.

`unobtrusive-window.spec.ts` asserts this contract. Pass `{ visibleWindow: true }`
to `launchElectron()` when a case genuinely has to verify activation or real window
placement.

Because the window is never the OS key window, Playwright's own mouse events do not
reach the editor: a CDP click moves `document.activeElement` but Muya never adopts
the selection. Use `mainProcessInput.ts` instead — `clickViaMain()` and
`dragViaMain()` inject `webContents.sendInputEvent` mouse sequences from the main
process, which the renderer treats as real input. Keyboard events need no such
workaround: `page.keyboard` works while the window is unfocused. Clicks on a
paragraph's content span must land on a glyph (`{ position: { x: 4 } }`); the span
spans the full line width and a click in its empty tail does not resolve to the
block.

`text-files-startup.spec.ts` shares one application across ordinary file cases.
Only its relaunch case closes and opens the application again. The suite is serial:
a failed case terminates the isolated test process and skips dependent cases.
Each case creates its own files, and the external-reload case restores auto-save.

`scroll-up-arrow.spec.ts` launches one isolated application for all nine cases and
closes it after the suite. Each case restores its fixture document and initial
selection; empty-line cases also reset scroll position and the remembered vertical
column. Real keypresses, DOM caret assertions, and on-disk save checks still run for
every case. The JSON report records `electron-pid` annotations to verify process
reuse. A failed case terminates only the tracked test process; Playwright retains
its default worker-restart behavior rather than skipping the remaining cases.
Source-mode fixture replacement preserves undo history, so this reset is scoped to
navigation tests, not undo/redo or clean-start tests.

- `saveWithKeyboard(app)` sends native Electron Cmd/Ctrl+S input, including the
  application-menu accelerator on macOS. Follow it with an assertion on the saved
  file; dispatching the key alone does not prove persistence.
- `closeTestApplication(app)` attempts a normal quit. After three seconds it fails
  with a dialog/unsaved-tab diagnostic and terminates that test process. A blocked
  quit is a test failure, never a successful cleanup.
- `terminateTestApplication(app)` skips normal quit for cleanup after a test has
  already failed. Both cleanup helpers reject applications not registered by the
  launcher and target the captured child process, never a bundle name or PID search.

Lifecycle unit tests use fake child processes and timers; they do not launch
Electron. `playwright test --config=playwright.config.ts
text-files-startup.spec.ts --list` also checks collection without opening the app.

A bare `launchElectron()` follows the configured startup action and opens a blank
document; it does not adopt the process working directory. Cases that need a sidebar
folder pass an explicit temporary directory as a launch argument.
