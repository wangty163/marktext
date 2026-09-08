import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ElectronApplication } from 'playwright'
import { closeTestApplication, terminateTestApplication, trackTestApplication } from '../../e2e/appLifecycle'

const fakeApplication = () => {
  const child = { exitCode: null as number | null, signalCode: null as string | null, kill: vi.fn(() => true) }
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const app = { close, process: () => child } as unknown as ElectronApplication
  return { app, child, close }
}

afterEach(() => vi.useRealTimers())

describe('isolated Electron test cleanup', () => {
  it('refuses to close or terminate an untracked application', async() => {
    const { app, close, child } = fakeApplication()
    await expect(closeTestApplication(app)).rejects.toThrow('not created by the test launcher')
    expect(() => terminateTestApplication(app)).toThrow('not created by the test launcher')
    expect(close).not.toHaveBeenCalled()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('allows a normal close without force termination', async() => {
    const { app, close, child } = fakeApplication()
    trackTestApplication(app)
    await closeTestApplication(app)
    expect(close).toHaveBeenCalledOnce()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('fails promptly and terminates the test process when a dialog blocks close', async() => {
    vi.useFakeTimers()
    const { app, close, child } = fakeApplication()
    close.mockImplementation(() => new Promise(() => {}))
    trackTestApplication(app)
    const result = expect(closeTestApplication(app)).rejects.toThrow('within 3000ms')
    await vi.advanceTimersByTimeAsync(2999)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await result
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves a close failure while cleaning up', async() => {
    const { app, close, child } = fakeApplication()
    const error = new Error('connection lost')
    close.mockRejectedValue(error)
    trackTestApplication(app)
    await expect(closeTestApplication(app)).rejects.toBe(error)
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('retains both errors if closing and termination fail', async() => {
    const { app, close, child } = fakeApplication()
    const error = new Error('connection lost')
    close.mockRejectedValue(error)
    child.kill.mockReturnValue(false)
    trackTestApplication(app)
    const result = closeTestApplication(app)
    await expect(result).rejects.toBeInstanceOf(AggregateError)
    await expect(result).rejects.toHaveProperty('errors.0', error)
  })

  it('does not signal an already exited process', () => {
    const { app, child } = fakeApplication()
    child.exitCode = 0
    trackTestApplication(app)
    terminateTestApplication(app)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('reports a failed termination', () => {
    const { app, child } = fakeApplication()
    child.kill.mockReturnValue(false)
    trackTestApplication(app)
    expect(() => terminateTestApplication(app)).toThrow('Could not terminate')
  })
})
