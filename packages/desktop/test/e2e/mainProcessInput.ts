import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import type { Page } from 'playwright'

/**
 * Playwright drives mouse events through CDP, which only reaches the renderer
 * usefully when the window is the OS key window. The unobtrusive launcher never
 * activates the test window (that would steal focus from whoever is using the
 * machine), so real clicks have to be injected by the main process instead:
 * `webContents.sendInputEvent` delivers genuine mouse events to the renderer
 * without the window ever becoming frontmost.
 */
const sendMouse = async(
  app: ElectronApplication,
  point: { x: number; y: number },
  clickCount = 1
): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, payload) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No test window is available for a synthetic click')
    const { x, y, clickCount } = payload
    for (let i = 0; i < clickCount; i++) {
      for (const type of ['mouseDown', 'mouseUp'] as const) {
        win.webContents.sendInputEvent({
          type,
          x,
          y,
          button: 'left',
          clickCount: i + 1
        })
      }
    }
  }, { ...point, clickCount })
}

export interface MainProcessClickOptions {
  /** Index into the locator's matches; defaults to the first. */
  nth?: number
  /**
   * Click position relative to the element's box, like Playwright's option.
   * An omitted axis falls back to the centre of that axis.
   */
  position?: { x?: number; y?: number }
  /** Send a double click (two down/up pairs with clickCount 1 then 2). */
  dblClick?: boolean
}

export const clickViaMain = async(
  app: ElectronApplication,
  page: Page,
  selector: string,
  options: MainProcessClickOptions = {}
): Promise<void> => {
  const locator = page.locator(selector).nth(options.nth ?? 0)
  await locator.waitFor({ state: 'visible', timeout: 10000 })
  const box = await locator.boundingBox()
  if (!box) throw new Error(`No bounding box for ${selector}; cannot inject a click`)
  const x = Math.round(box.x + (options.position?.x ?? box.width / 2))
  const y = Math.round(box.y + (options.position?.y ?? box.height / 2))
  await sendMouse(app, { x, y })
  if (options.dblClick) await sendMouse(app, { x, y }, 2)
}

/** Click arbitrary page coordinates through the main process. */
export const clickPointViaMain = async(
  app: ElectronApplication,
  point: { x: number; y: number },
  dblClick = false
): Promise<void> => {
  await sendMouse(app, { x: Math.round(point.x), y: Math.round(point.y) })
  if (dblClick) await sendMouse(app, { x: Math.round(point.x), y: Math.round(point.y) }, 2)
}

/**
 * Drag between two page-coordinate points with the same main-process injection
 * as `clickViaMain`, so drag-driven UI (the sidebar resizer) stays testable
 * while the window is never activated.
 */
export const dragViaMain = async(
  app: ElectronApplication,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8
): Promise<void> => {
  const start = { x: Math.round(from.x), y: Math.round(from.y) }
  const end = { x: Math.round(to.x), y: Math.round(to.y) }
  await app.evaluate(({ BrowserWindow }, payload) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No test window is available for a synthetic drag')
    const { start, end, steps } = payload
    const send = (type: 'mouseDown' | 'mouseMove' | 'mouseUp', x: number, y: number, buttons: number): void => {
      win.webContents.sendInputEvent({
        type,
        x,
        y,
        button: 'left',
        buttons,
        clickCount: 1
      } as Parameters<typeof win.webContents.sendInputEvent>[0])
    }
    send('mouseDown', start.x, start.y, 1)
    for (let i = 1; i <= steps; i++) {
      send(
        'mouseMove',
        Math.round(start.x + ((end.x - start.x) * i) / steps),
        Math.round(start.y + ((end.y - start.y) * i) / steps),
        1
      )
    }
    send('mouseUp', end.x, end.y, 0)
  }, { start, end, steps })
}
