import type { ElectronApplication } from 'playwright'
import type { Page } from 'playwright'

/**
 * Wait for the renderer to act on an injected click. Muya and CodeMirror move
 * the selection on the frames after `mouseup`; a keystroke that arrives before
 * that lands nowhere and the first character is silently dropped.
 */
export const settleAfterInput = async(page: Page): Promise<void> => {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
}

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
  await page.locator(selector).nth(options.nth ?? 0).waitFor({ state: 'attached', timeout: 10000 })

  // Resolve the box in the page rather than through Playwright's actionability
  // checks: those rely on CDP layout quads, which come back empty for a window
  // that is parked off-display and never activated, so a plainly visible element
  // gets reported as "not visible". Poll because a freshly mounted element can
  // still be laid out at zero size for a frame or two.
  const readBox = (): Promise<{ x: number; y: number; width: number; height: number } | null> =>
    page.evaluate(
      ({ selector, nth }) => {
        const el = document.querySelectorAll(selector)[nth] as HTMLElement | undefined
        if (!el) return null
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') return null
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) return null
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      },
      { selector, nth: options.nth ?? 0 }
    )

  const deadline = Date.now() + 10000
  let box = await readBox()
  while (!box && Date.now() < deadline) {
    await page.waitForTimeout(100)
    box = await readBox()
  }
  if (!box) throw new Error(`${selector} never became visible; cannot inject a click`)

  const x = Math.round(box.x + (options.position?.x ?? box.width / 2))
  const y = Math.round(box.y + (options.position?.y ?? box.height / 2))
  await sendMouse(app, { x, y })
  if (options.dblClick) await sendMouse(app, { x, y }, 2)
  await settleAfterInput(page)
}

/** Click arbitrary page coordinates through the main process. */
export const clickPointViaMain = async(
  app: ElectronApplication,
  page: Page,
  point: { x: number; y: number },
  dblClick = false
): Promise<void> => {
  await sendMouse(app, { x: Math.round(point.x), y: Math.round(point.y) })
  if (dblClick) await sendMouse(app, { x: Math.round(point.x), y: Math.round(point.y) }, 2)
  await settleAfterInput(page)
}

/**
 * Drag between two page-coordinate points with the same main-process injection
 * as `clickViaMain`, so drag-driven UI (the sidebar resizer) stays testable
 * while the window is never activated.
 */
export const dragViaMain = async(
  app: ElectronApplication,
  page: Page,
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
  await settleAfterInput(page)
}
