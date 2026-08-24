import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, clickMenuById } from './helpers'

// Wait until a `v-show`-toggled element's visibility differs from `wasVisible`.
// A missing element counts as "not visible", so the change-detection logic
// stays consistent whether v-show clears the inline style or unmounts the node.
const waitForVisibilityFlip = (page: Page, selector: string, wasVisible: boolean) =>
  page.waitForFunction(
    ({ sel, prior }) => {
      const el = document.querySelector(sel) as HTMLElement | null
      const visible = !!(el && el.style.display !== 'none' && el.offsetParent !== null)
      return visible !== prior
    },
    { sel: selector, prior: wasVisible },
    { timeout: 5000 }
  )

test.describe('Layout panel toggles', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Layout\n\n## Section A\n\n## Section B\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('Sidebar toggle changes .side-bar visibility', async() => {
    const sideBar = page.locator('.side-bar')
    const initial = await sideBar.isVisible()
    await clickMenuById(app, 'sideBarMenuItem')
    await waitForVisibilityFlip(page, '.side-bar', initial)
    const afterToggle = await sideBar.isVisible()
    expect(afterToggle).not.toBe(initial)
    await clickMenuById(app, 'sideBarMenuItem')
  })

  test('Tab bar toggle flips .editor-tabs visibility', async() => {
    const tabBar = page.locator('.editor-tabs')
    const initial = await tabBar.isVisible()
    await clickMenuById(app, 'tabBarMenuItem')
    await waitForVisibilityFlip(page, '.editor-tabs', initial)
    const afterToggle = await tabBar.isVisible()
    expect(afterToggle).not.toBe(initial)
    await clickMenuById(app, 'tabBarMenuItem')
  })

  test('TOC menu toggles the right sidebar', async() => {
    const rightSideBar = page.locator('.right-side-bar')
    const initial = await rightSideBar.isVisible()
    await clickMenuById(app, 'tocMenuItem')
    await waitForVisibilityFlip(page, '.right-side-bar', initial)
    expect(await rightSideBar.isVisible()).not.toBe(initial)
    await clickMenuById(app, 'tocMenuItem')
  })

  test('title-bar buttons completely hide and restore both sidebars', async() => {
    const sideBar = page.locator('.side-bar')
    if (!(await sideBar.isVisible())) {
      await page.locator('.layout-toggle-left').click()
      await expect(sideBar).toBeVisible()
    }

    await page.locator('.layout-toggle-left').click()
    await expect(sideBar).toBeHidden()
    await page.locator('.layout-toggle-left').click()
    await expect(sideBar).toBeVisible()

    const rightSideBar = page.locator('.right-side-bar')
    if (await rightSideBar.isVisible()) await page.locator('.layout-toggle-right').click()
    await expect(rightSideBar).toBeHidden()
    await page.locator('.layout-toggle-right').click()
    await expect(rightSideBar).toBeVisible()
    await page.locator('.layout-toggle-right').click()
  })
})
