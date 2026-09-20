import { dialog } from 'electron'
import log from 'electron-log'

/**
 * Native dialogs cannot be answered during an automated run. macOS attaches
 * them as sheets on the parked (mostly off-display) window or centres them on
 * the desktop, and either way they sit there until the run times out — the
 * window stays on screen and closing the app blocks.
 *
 * Under `MARKTEXT_E2E_UNOBTRUSIVE` the dialog surface is therefore answered
 * programmatically: message boxes pick the caller's declared default button
 * (every call site defaults to the safe/cancel option), and file pickers report
 * a cancellation so a run can never read or overwrite a path the user chose.
 * Specs that need a real answer install their own stub afterwards, which simply
 * overwrites these (see test/e2e/export-pdf.spec.ts).
 */
export const installUnobtrusiveDialogs = (): void => {
  const logStub = (name: string, detail?: unknown): void => {
    log.info(`Unobtrusive test mode: auto-answered ${name} ${detail ?? ''}`.trimEnd())
  }

  // Each Electron dialog API has an overload with and without a parent window,
  // so the options object is whatever comes last.
  const optionsOf = (args: unknown[]): Record<string, unknown> =>
    (args[args.length - 1] ?? {}) as Record<string, unknown>

  dialog.showMessageBox = ((...args: unknown[]) => {
    const options = optionsOf(args)
    logStub('showMessageBox', options.message)
    return Promise.resolve({
      response: typeof options.defaultId === 'number' ? options.defaultId : 0,
      checkboxChecked: false
    })
  }) as unknown as typeof dialog.showMessageBox

  dialog.showOpenDialog = ((...args: unknown[]) => {
    logStub('showOpenDialog')
    return Promise.resolve({ canceled: true, filePaths: [] as string[] })
  }) as unknown as typeof dialog.showOpenDialog

  dialog.showSaveDialog = ((...args: unknown[]) => {
    logStub('showSaveDialog')
    return Promise.resolve({ canceled: true, filePath: undefined })
  }) as unknown as typeof dialog.showSaveDialog

  dialog.showErrorBox = ((title: string, content?: string) => {
    logStub('showErrorBox', `${title}: ${content ?? ''}`)
  }) as typeof dialog.showErrorBox
}
