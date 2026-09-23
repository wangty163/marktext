import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import {
  closeTestApplication, expectNoRendererErrors, launchWithMarkdown, saveWithKeyboard,
  terminateTestApplication
} from './helpers'
import { clickPointViaMain, dragViaMain } from './mainProcessInput'

const DOC = 'Alpha beta gamma\nDelta epsilon\n'

const selectedText = (page: Page): Promise<string> => page.evaluate(() =>
  window.getSelection()?.toString().replace(/\u200B/g, '') ?? ''
)

const points = (page: Page) => page.evaluate(() => {
  const container = document.querySelector('.editor-component .mu-container')
  const text = container?.querySelector('.mu-paragraph-content')?.firstChild
  const lastBlock = container?.lastElementChild
  if (!text || !lastBlock) throw new Error('No document text to drag from')
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 1)
  const start = range.getBoundingClientRect()
  const last = lastBlock.getBoundingClientRect()
  return {
    from: { x: start.left + 1, y: start.top + start.height / 2 },
    below: { x: start.left + 40, y: last.bottom + 30 }
  }
})

test('releasing a text selection below the last line preserves highlighting and replaces only the selection', async() => {
  const { app, page, filePath } = await launchWithMarkdown(DOC)
  try {
    const { from, below } = await points(page)
    const blocks = await page.locator('.mu-container > *').count()
    await dragViaMain(app, page, from, below)
    await expect.poll(() => selectedText(page)).toContain('Alpha beta gamma\nDelta epsilon')
    await expect(page.locator('.word-count')).toHaveText('Words 5 / 5')
    await expect(page.locator('.mu-container > *')).toHaveCount(blocks)
    const selection = await selectedText(page)
    // Hovering farther below the document must not clear the released range.
    await app.evaluate(({ BrowserWindow }, point) => {
      BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({
        type: 'mouseMove', x: Math.round(point.x + 20), y: Math.round(point.y + 20)
      })
    }, below)
    await page.waitForTimeout(200)
    expect(await selectedText(page)).toBe(selection)
    await page.screenshot({ path: test.info().outputPath('selection-below-last-line.png') })
    await page.keyboard.type('replacement')
    await saveWithKeyboard(app)
    await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('replacement\n')
    await expectNoRendererErrors(app)
    await closeTestApplication(app)
  } catch (error) {
    terminateTestApplication(app)
    throw error
  }
})

test('a fresh blank-area click after selecting still creates a paragraph and reuses it', async() => {
  const { app, page, filePath } = await launchWithMarkdown(DOC)
  try {
    const { from, below } = await points(page)
    const blocks = await page.locator('.mu-container > *').count()
    await dragViaMain(app, page, from, below)
    await expect.poll(() => selectedText(page)).toContain('Delta epsilon')
    await clickPointViaMain(app, page, below)
    await expect(page.locator('.mu-container > *')).toHaveCount(blocks + 1)
    await expect.poll(() => selectedText(page)).toBe('')
    const next = await points(page)
    await clickPointViaMain(app, page, next.below)
    await expect(page.locator('.mu-container > *')).toHaveCount(blocks + 1)
    await page.keyboard.type('continued')
    await expect(page.locator('.mu-paragraph-content').last()).toHaveText('continued')
    await saveWithKeyboard(app)
    await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(`${DOC}continued\n`)
    await expectNoRendererErrors(app)
    await closeTestApplication(app)
  } catch (error) {
    terminateTestApplication(app)
    throw error
  }
})
