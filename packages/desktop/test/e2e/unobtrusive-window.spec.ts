import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import { launchWithMarkdown, saveWithKeyboard } from './helpers'
import { clickViaMain } from './mainProcessInput'
import { closeTestApplication, terminateTestApplication } from './appLifecycle'

// Playwright cannot run Electron headless, so the shared launcher parks the
// window off-display, shows it inactive and hides the Dock icon. These
// assertions pin that contract: an automated run must never take keyboard focus
// or cover the desktop, while the window stays real enough to paint, receive
// input and be captured.

interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isVisible: boolean
  isFocused: boolean
  dockVisible: boolean | null
  displays: Array<{ x: number; y: number; width: number; height: number }>
}

const readWindowState = async(
  app: Awaited<ReturnType<typeof launchWithMarkdown>>['app']
): Promise<WindowState> =>
  app.evaluate(({ app, screen, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const { x, y, width, height } = win.getBounds()
    return {
      x,
      y,
      width,
      height,
      isVisible: win.isVisible(),
      isFocused: win.isFocused(),
      dockVisible: typeof app.dock?.isVisible === 'function' ? app.dock.isVisible() : null,
      displays: screen.getAllDisplays().map((display) => display.bounds)
    }
  })

test('the test window stays off-display, unfocused and fully functional', async() => {
  const { app, page, filePath } = await launchWithMarkdown('alpha\n')
  try {
    await page.waitForSelector('.editor-component', { state: 'attached', timeout: 15000 })
    const state = await readWindowState(app)

    // At most a thin sliver may remain reachable: macOS clamps a shown window so
    // its title bar can still be dragged back, so "completely off-screen" is not
    // achievable there. Anything beyond that sliver means the run is covering
    // the user's desktop.
    const SLIVER_PX = 80
    for (const display of state.displays) {
      const overlapX =
        Math.min(state.x + state.width, display.x + display.width) - Math.max(state.x, display.x)
      const overlapY =
        Math.min(state.y + state.height, display.y + display.height) - Math.max(state.y, display.y)
      if (overlapX > 0 && overlapY > 0) {
        expect(
          Math.min(overlapX, overlapY),
          `window ${JSON.stringify(state)} overlaps display ${JSON.stringify(display)}`
        ).toBeLessThanOrEqual(SLIVER_PX)
      }
    }

    // Shown (so the renderer paints and capturePage works) but never activated.
    expect(state.isVisible).toBe(true)
    expect(state.isFocused).toBe(false)
    if (process.platform === 'darwin') expect(state.dockVisible).toBe(false)

    // Layout is real: the paragraph has a non-zero box.
    const rendered = await page.evaluate(() => {
      const el = document.querySelector('.mu-paragraph-content') as HTMLElement | null
      return { height: el?.getBoundingClientRect().height ?? 0, text: el?.textContent ?? '' }
    })
    expect(rendered.height).toBeGreaterThan(0)
    expect(rendered.text).toBe('alpha')

    // A screenshot of an unfocused, off-display window still captures content.
    const shot = await page.screenshot()
    expect(shot.byteLength).toBeGreaterThan(1000)

    // Input keeps working without OS focus: a main-process click places the
    // caret, then CDP keys reach the engine.
    await clickViaMain(app, page, '.mu-paragraph-content', { position: { x: 4, y: 13 } })
    await expect
      .poll(() =>
        page.evaluate(() => ({
          anchor: document.getSelection()?.anchorNode?.textContent ?? null,
          collapsed: document.getSelection()?.isCollapsed ?? null
        }))
      )
      .toEqual({ anchor: 'alpha', collapsed: true })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
    await page.keyboard.type('beta')
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector('.mu-paragraph-content')?.textContent ?? '')
      )
      .toBe('alphabeta')

    // The keystrokes went through the real save path too, so closing cannot be
    // blocked by an unsaved-changes dialog.
    await saveWithKeyboard(app)
    await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('alphabeta\n')

    await closeTestApplication(app)
  } catch (error) {
    terminateTestApplication(app)
    throw error
  }
})
