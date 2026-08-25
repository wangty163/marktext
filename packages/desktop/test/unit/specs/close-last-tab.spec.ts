import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  })
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...args: unknown[]) => void; on: (...args: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'

describe('Command+W tab-aware close', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('closes the current tab first, then closes the window for the last tab', () => {
    const on = vi.spyOn(window.electron.ipcRenderer, 'on')
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')
    const store = useEditorStore()
    const tabs = [
      { id: 'one', pathname: '', markdown: '', isSaved: true },
      { id: 'two', pathname: '', markdown: '', isSaved: true }
    ] as unknown as typeof store.tabs
    store.tabs = tabs
    const current = tabs[1]
    if (!current) throw new Error('missing second tab')
    store.currentFile = current
    store.LISTEN_FOR_CLOSE_TAB()
    const handler = on.mock.calls.find(([channel]) => channel === 'mt::editor-close-tab')?.[1] as
      | (() => void)
      | undefined

    expect(handler).toBeTypeOf('function')
    if (!handler) throw new Error('close-tab handler was not registered')
    handler()
    expect(store.tabs).toHaveLength(1)
    expect(send).not.toHaveBeenCalledWith('mt::cmd-close-window')

    handler()
    expect(store.tabs).toHaveLength(1)
    expect(send).toHaveBeenCalledWith('mt::cmd-close-window')
  })
})
