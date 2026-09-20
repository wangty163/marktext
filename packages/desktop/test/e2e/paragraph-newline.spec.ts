import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import {
  launchWithMarkdown, launchElectron, placeCaretInEditor, saveWithKeyboard,
  waitForEditor, sendIpcToRenderer
} from './helpers'
import { closeTestApplication, terminateTestApplication } from './appLifecycle'

const content = (page: Page) => page.locator('.mu-paragraph-content').first()
const height = (page: Page) => content(page).evaluate(el => el.getBoundingClientRect().height)
const lineEnd = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
const lineStart = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'
// History records the engine's queued operations on the next animation frame.
const flushInput = (page: Page) => page.evaluate(() => new Promise<void>(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
))

test('Enter creates consecutive lines in the editor, saved file and reopened document', async() => {
  const launched = await launchWithMarkdown('alpha\n')
  let { app, page } = launched
  const { filePath } = launched
  try {
    await placeCaretInEditor(page)
    await page.keyboard.press(lineEnd)
    const lineHeight = await height(page)
    await page.keyboard.press('Enter')
    await expect.poll(() => height(page)).toBe(lineHeight * 2)
    await page.keyboard.type('beta')
    await page.keyboard.press('Enter')
    await page.keyboard.type('gamma')
    await expect(content(page)).toHaveJSProperty('textContent', 'alpha\nbeta\ngamma')
    await expect(page.locator('.mu-paragraph')).toHaveCount(1)
    await expect.poll(() => height(page)).toBe(lineHeight * 3)
    await saveWithKeyboard(app)
    await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('alpha\nbeta\ngamma\n')
    await page.screenshot({ path: '/private/tmp/marktext-paragraph-newline.png' })
    await closeTestApplication(app)
    const reopened = await launchElectron([filePath])
    app = reopened.app
    page = reopened.page
    await waitForEditor(page)
    await expect(content(page)).toHaveJSProperty('textContent', 'alpha\nbeta\ngamma')
    await expect.poll(() => height(page)).toBe(lineHeight * 3)
    await closeTestApplication(app)
  } catch (error) {
    terminateTestApplication(app)
    throw error
  }
})

for (const key of ['Enter', 'Shift+Enter']) {
  for (const deletion of ['Backspace', 'Delete', 'selection']) {
    test(`${key}: ${deletion} removes the trailing newline without phantom rows`, async() => {
      const { app, page, filePath } = await launchWithMarkdown('alpha\n\nbeta\n')
      try {
        await placeCaretInEditor(page)
        await page.keyboard.press(lineEnd)
        const lineHeight = await height(page)
        await page.keyboard.press(key)
        await expect.poll(() => height(page)).toBe(lineHeight * 2)
        await flushInput(page)
        if (deletion === 'selection') {
          await page.keyboard.press('Shift+ArrowLeft')
          await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('\n')
        } else if (deletion === 'Delete') {
          await page.keyboard.press('ArrowLeft')
        }
        await page.keyboard.press(deletion === 'Delete' ? 'Delete' : 'Backspace')
        await expect(content(page)).toHaveJSProperty('textContent', 'alpha')
        await expect.poll(() => height(page)).toBe(lineHeight)
        await flushInput(page)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await expect(content(page)).toHaveJSProperty('textContent', 'alpha\n')
        await expect.poll(() => height(page)).toBe(lineHeight * 2)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
        await expect(content(page)).toHaveJSProperty('textContent', 'alpha')
        await expect.poll(() => height(page)).toBe(lineHeight)
        await page.keyboard.type('X')
        await saveWithKeyboard(app)
        await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('alphaX\n\nbeta\n')
        await closeTestApplication(app)
      } catch (error) {
        terminateTestApplication(app)
        throw error
      }
    })
  }
}

test('two Enter presses create a paragraph that merges back without a residual soft break', async() => {
  const { app, page, filePath } = await launchWithMarkdown('alpha\n')
  try {
    await placeCaretInEditor(page)
    await page.keyboard.press(lineEnd)
    const lineHeight = await height(page)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(page.locator('.mu-paragraph')).toHaveCount(2)
    await expect(content(page)).toHaveJSProperty('textContent', 'alpha')
    await page.keyboard.type('beta')
    await saveWithKeyboard(app)
    await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('alpha\n\nbeta\n')
    await page.keyboard.press(lineStart)
    await page.keyboard.press('Backspace')
    await expect(page.locator('.mu-paragraph')).toHaveCount(1)
    await expect(content(page)).toHaveJSProperty('textContent', 'alphabeta')
    await expect.poll(() => height(page)).toBe(lineHeight)
    await saveWithKeyboard(app)
    await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('alphabeta\n')
    await closeTestApplication(app)
  } catch (error) {
    terminateTestApplication(app)
    throw error
  }
})
