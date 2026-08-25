import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, waitForEditor, enterSourceMode, clickMenuById } from './helpers'

// marktext #3580: clicking a TOC entry in SOURCE CODE mode must scroll the
// editor to that heading and place it near the TOP of the viewport. The editor
// runs CodeMirror with viewportMargin: Infinity, so the OUTER `.source-code`
// container is the scrollable element — neither cm.scrollTo nor cm.scrollIntoView
// moves it.
const HEADING_COUNT = 20
const buildLongDoc = (): string => {
  const parts: string[] = []
  for (let i = 1; i <= HEADING_COUNT; i++) {
    parts.push(`# Heading Number ${i}`)
    for (let p = 0; p < 6; p++) parts.push(`Filler paragraph ${p} under heading ${i}. Lorem ipsum dolor.`)
  }
  return parts.join('\n\n') + '\n'
}

const srcScrollTop = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector('.source-code') as HTMLElement | null
    return el ? Math.round(el.scrollTop) : -1
  })

// Distance of the `# Heading Number N` source line from the top of the
// `.source-code` viewport (CodeMirror renders all lines, so the line is in the DOM).
const headingLineTopInViewport = (page: Page, text: string): Promise<number | null> =>
  page.evaluate((needle) => {
    const container = document.querySelector('.source-code') as HTMLElement | null
    const lines = Array.from(document.querySelectorAll('.source-code .CodeMirror-line'))
    const target = lines.find((l) => (l.textContent || '').includes(needle)) as HTMLElement | undefined
    if (!container || !target) return null
    return Math.round(target.getBoundingClientRect().top - container.getBoundingClientRect().top)
  }, `# ${text}`)

test.describe('Source Code mode: TOC click scrolls to the heading at the top', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(buildLongDoc())
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await enterSourceMode(page, app)
    const tocVisible = await page.evaluate(() => {
      const el = document.querySelector('.right-side-bar') as HTMLElement | null
      return !!(el && el.offsetParent !== null)
    })
    if (!tocVisible) await clickMenuById(app, 'tocMenuItem')
    await page.waitForSelector('.side-bar-toc .el-tree', { state: 'visible', timeout: 10000 })
    await page.waitForFunction(
      (c) => document.querySelectorAll('.side-bar-toc .el-tree-node__label').length >= c,
      HEADING_COUNT,
      { timeout: 10000 }
    )
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('clicking a deep heading scrolls down and lands it near the top', async() => {
    await page.evaluate(() => {
      const el = document.querySelector('.source-code') as HTMLElement | null
      if (el) el.scrollTop = 0
    })
    await expect.poll(() => srcScrollTop(page)).toBe(0)

    await page.locator('.side-bar-toc').getByText('Heading Number 18', { exact: true }).click()

    // animated scroll down
    await expect.poll(() => srcScrollTop(page), { timeout: 8000 }).toBeGreaterThan(0)
    // heading sits near the TOP of the viewport (not the bottom)
    await expect
      .poll(() => headingLineTopInViewport(page, 'Heading Number 18'), { timeout: 8000 })
      .toBeLessThan(150)
    expect(await headingLineTopInViewport(page, 'Heading Number 18')).toBeGreaterThan(-5)
  })

  test('clicking an earlier heading scrolls back up to it at the top', async() => {
    const fromTop = await srcScrollTop(page)
    expect(fromTop).toBeGreaterThan(0)
    await page.locator('.side-bar-toc').getByText('Heading Number 3', { exact: true }).click()
    await expect.poll(() => srcScrollTop(page), { timeout: 8000 }).toBeLessThan(fromTop)
    await expect
      .poll(() => headingLineTopInViewport(page, 'Heading Number 3'), { timeout: 8000 })
      .toBeLessThan(150)
  })

  test('only the latest TOC target line is highlighted, then it clears', async() => {
    const highlights = page.locator('.source-code .toc-flash-highlight')

    await page.locator('.side-bar-toc').getByText('Heading Number 7', { exact: true }).click()
    await expect.poll(() => highlights.count()).toBe(1)
    const edges = await page.evaluate(() => {
      const container = document.querySelector('.source-code .CodeMirror') as HTMLElement | null
      const target = document.querySelector('.source-code .toc-flash-highlight') as HTMLElement | null
      if (!container || !target) return null
      const containerRect = container.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      return {
        left: targetRect.left - containerRect.left - 50,
        right: targetRect.right - containerRect.right + 50
      }
    })
    expect(edges).not.toBeNull()
    expect(Math.abs(edges?.left ?? Infinity)).toBeLessThanOrEqual(1)
    expect(Math.abs(edges?.right ?? Infinity)).toBeLessThanOrEqual(1)

    await page.locator('.side-bar-toc').getByText('Heading Number 8', { exact: true }).click()
    expect(await highlights.count()).toBe(1)
    await expect.poll(() => highlights.count(), { timeout: 4000 }).toBe(0)
  })
})
