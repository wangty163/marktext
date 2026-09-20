import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchElectron } from './helpers'
import { clickViaMain, dragViaMain } from './mainProcessInput'

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
  let dir: string

  test.beforeAll(async() => {
    // The sidebar only opens with content in it, so open a folder explicitly
    // instead of relying on the process working directory.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-sidebar-'))
    fs.writeFileSync(path.join(dir, 'doc.md'), '# Doc\n\n## A\n\n## B\n')
    const launched = await launchElectron([dir, path.join(dir, 'doc.md')])
    app = launched.app
    page = launched.page
    // The files panel is the default right column; make sure it is open + wide.
    await page.waitForFunction(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!(el && el.offsetParent !== null && el.getBoundingClientRect().width > 220)
    }, null, { timeout: 10000 })
  })

  test.afterAll(async() => {
    if (app) await app.close()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  test('collapsing then re-expanding preserves a widened sidebar width', async() => {
    // Widen the sidebar past the 220px minimum by dragging the drag-bar, so a
    // width loss on collapse is observable (the default already sits at 220).
    const dragBar = page.locator('.side-bar .drag-bar')
    const box = await dragBar.boundingBox()
    expect(box).not.toBeNull()
    // The window is never activated during a run, so the drag is injected by the
    // main process rather than through Playwright's CDP mouse.
    await dragViaMain(
      app,
      { x: box!.x + box!.width / 2, y: box!.y + 80 },
      { x: box!.x + box!.width / 2 + 120, y: box!.y + 80 }
    )
    await page.waitForFunction(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!el && el.getBoundingClientRect().width >= 300
    }, null, { timeout: 5000 })

    const widened = await sideBarWidth(page)
    expect(widened).toBeGreaterThanOrEqual(300)

    await clickViaMain(app, page, '.layout-toggle-left')
    await page.waitForFunction(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!el && el.offsetParent === null
    }, null, { timeout: 5000 })

    await clickViaMain(app, page, '.layout-toggle-left')
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
    await clickViaMain(app, page, '.side-bar .opened-files > .title .icon-arrow')
    await page.waitForFunction(() => {
      const a = document.querySelector('.side-bar .opened-files .icon-arrow')
      return !!(a && a.classList.contains('fold'))
    }, null, { timeout: 5000 })

    // Toggle the whole sidebar off and back on via the title-bar control.
    await clickViaMain(app, page, '.layout-toggle-left')
    await page.waitForTimeout(250)
    await clickViaMain(app, page, '.layout-toggle-left')
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
