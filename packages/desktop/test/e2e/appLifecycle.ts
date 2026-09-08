import type { ElectronApplication } from 'playwright'

const testProcesses = new WeakMap<ElectronApplication, ReturnType<ElectronApplication['process']>>()

// Only the launcher that creates an isolated profile should register an app.
export const trackTestApplication = (app: ElectronApplication): void => {
  testProcesses.set(app, app.process())
}

export const terminateTestApplication = (app: ElectronApplication): void => {
  const child = testProcesses.get(app)
  if (!child) throw new Error('Refusing to terminate an application not created by the test launcher')
  if (child.exitCode === null && child.signalCode === null && !child.kill('SIGKILL')) {
    throw new Error('Could not terminate the isolated Electron test process')
  }
}

/** Close normally, but fail promptly and clean up if a save dialog blocks quit. */
export const closeTestApplication = async(app: ElectronApplication, timeoutMs = 3000): Promise<void> => {
  if (!testProcesses.has(app)) {
    throw new Error('Refusing to close an application not created by the test launcher')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(
          `Electron test did not close within ${timeoutMs}ms; check unsaved tabs or modal dialogs`
        )), timeoutMs)
      })
    ])
  } catch (error) {
    try {
      terminateTestApplication(app)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Electron test close and cleanup both failed')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
