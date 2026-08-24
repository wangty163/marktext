import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// #2421 — completely hiding and restoring the sidebar must not lose its width
// or the file tree's local collapsed-section state.

const sideBarToggle = (page: Page) => page.locator('.layout-toggle-left')

const sideBarWidth = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.side-bar') as HTMLElement | null
    return el ? Math.round(el.getBoundingClientRect().width) : 0
  })

test.describe('#2421 sidebar state survives full toggle', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Doc\n\n## A\n\n## B\n')
    app = launched.app
    page = launched.page
    // The files panel is the default right column; make sure it is open + wide.
    await page.waitForFunction(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!(el && el.offsetParent !== null && el.getBoundingClientRect().width > 220)
    }, null, { timeout: 5000 })
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('collapsing then re-expanding preserves a widened sidebar width', async() => {
    // Widen the sidebar past the 220px minimum by dragging the drag-bar, so a
    // width loss on collapse is observable (the default already sits at 220).
    const dragBar = page.locator('.side-bar .drag-bar')
    const box = await dragBar.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 80)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + 80, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!el && el.getBoundingClientRect().width >= 300
    }, null, { timeout: 5000 })

    const widened = await sideBarWidth(page)
    expect(widened).toBeGreaterThanOrEqual(300)

    await sideBarToggle(page).click()
    await page.waitForFunction(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!el && el.offsetParent === null
    }, null, { timeout: 5000 })

    await sideBarToggle(page).click()
    await page.waitForFunction(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!(el && el.offsetParent !== null)
    }, null, { timeout: 5000 })

    const reExpanded = await sideBarWidth(page)
    // The widened width must survive the collapse round-trip (it was reset to
    // the clamped 220px before the fix).
    expect(Math.abs(reExpanded - widened)).toBeLessThanOrEqual(3)
  })

  test('a collapsed tree section stays collapsed after toggling the sidebar', async() => {
    const arrow = page.locator('.side-bar .opened-files > .title .icon-arrow').first()
    await expect(arrow).toBeVisible()

    // Collapse the "Opened files" section.
    await arrow.click()
    await page.waitForFunction(() => {
      const a = document.querySelector('.side-bar .opened-files .icon-arrow')
      return !!(a && a.classList.contains('fold'))
    }, null, { timeout: 5000 })

    // Toggle the whole sidebar off and back on via the title-bar control.
    await sideBarToggle(page).click()
    await page.waitForTimeout(250)
    await sideBarToggle(page).click()
    await page.waitForFunction(() => {
      const el = document.querySelector('.side-bar .opened-files') as HTMLElement | null
      return !!(el && el.offsetParent !== null)
    }, null, { timeout: 5000 })

    const stillCollapsed = await page.evaluate(() => {
      const a = document.querySelector('.side-bar .opened-files .icon-arrow')
      return !!(a && a.classList.contains('fold'))
    })
    expect(stillCollapsed).toBe(true)
  })
})
