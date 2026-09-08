# Electron test helpers

`launchElectron()` creates a temporary profile and returns its application and page.
`MARKTEXT_E2E_EXECUTABLE` selects an installed executable; without it, the launcher
uses the repository's Electron build. For installed startup behavior, use the
installed path documented in the root `AGENTS.md`.

`text-files-startup.spec.ts` shares one application across ordinary file cases.
Only its relaunch case closes and opens the application again. The suite is serial:
a failed case terminates the isolated test process and skips dependent cases.
Each case creates its own files, and the external-reload case restores auto-save.

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
Electron. `playwright test --config=test/e2e/playwright.config.ts
text-files-startup.spec.ts --list` also checks collection without opening the app.
