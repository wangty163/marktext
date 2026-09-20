import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import {
  launchWithMarkdown, launchElectron, paragraphText, placeCaretInEditor, saveWithKeyboard,
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
    await expect.poll(() => paragraphText(page)).toBe('alpha\nbeta\ngamma')
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
    await expect.poll(() => paragraphText(page)).toBe('alpha\nbeta\ngamma')
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
      const { app, page, filePath } = await launchWithMarkdown('alpha\n\n# beta\n')
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
        await expect.poll(() => paragraphText(page)).toBe('alpha')
        await expect.poll(() => height(page)).toBe(lineHeight)
        await flushInput(page)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await expect.poll(() => paragraphText(page)).toBe('alpha\n')
        await expect.poll(() => height(page)).toBe(lineHeight * 2)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
        await expect.poll(() => paragraphText(page)).toBe('alpha')
        await expect.poll(() => height(page)).toBe(lineHeight)
        await page.keyboard.type('X')
        await saveWithKeyboard(app)
        await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('alphaX\n\n# beta\n')
        await closeTestApplication(app)
      } catch (error) {
        terminateTestApplication(app)
        throw error
      }
    })
  }
}

test('every repeated Enter has the same height and survives save and reopen', async() => {
  const launched = await launchWithMarkdown('alpha\n')
  let { app, page } = launched
  const { filePath } = launched
  try {
    await placeCaretInEditor(page)
    await page.keyboard.press(lineEnd)
    const lineHeight = await height(page)
    for (let count = 1; count <= 4; count++) {
      await page.keyboard.press('Enter')
      await expect.poll(() => paragraphText(page)).toBe(`alpha${'\n'.repeat(count)}`)
      await expect.poll(() => height(page)).toBe(lineHeight * (count + 1))
    }
    await page.keyboard.type('beta')
    await saveWithKeyboard(app)
    await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('alpha\n\n\n\nbeta\n')
    await closeTestApplication(app)
    const reopened = await launchElectron([filePath])
    app = reopened.app
    page = reopened.page
    await waitForEditor(page)
    await expect(page.locator('.mu-paragraph')).toHaveCount(1)
    await expect.poll(() => paragraphText(page)).toBe('alpha\n\n\n\nbeta')
    await expect.poll(() => height(page)).toBe(lineHeight * 5)
    await page.screenshot({ path: '/private/tmp/marktext-equal-newlines.png' })
    await placeCaretInEditor(page)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await page.keyboard.press(lineStart)
    for (let count = 3; count >= 0; count--) {
      await page.keyboard.press('Backspace')
      await expect.poll(() => paragraphText(page)).toBe(`alpha${'\n'.repeat(count)}beta`)
      await expect.poll(() => height(page)).toBe(lineHeight * (count + 1))
    }
    await saveWithKeyboard(app)
    await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('alphabeta\n')
    await closeTestApplication(app)
  } catch (error) {
    terminateTestApplication(app)
    throw error
  }
})

test('prose below a heading keeps literal blank lines and Markdown formatting', async() => {
  const markdown = '# heading\n\nalpha\n\n**beta**\n'
  const { app, page, filePath } = await launchWithMarkdown(markdown)
  try {
    await expect(page.locator('.mu-container > h1')).toContainText('heading')
    await expect.poll(() => paragraphText(page)).toBe('alpha\n\n**beta**')
    await expect(content(page).locator('strong')).toContainText('beta')
    const lineHeight = await content(page).evaluate(el => Number.parseFloat(getComputedStyle(el).lineHeight))
    const originalHeight = await height(page)
    await content(page).click({ position: { x: 2, y: 5 } })
    await page.keyboard.press(lineEnd)
    await page.keyboard.press('Enter')
    await expect.poll(() => paragraphText(page)).toBe('alpha\n\n\n**beta**')
    await expect.poll(() => height(page)).toBe(originalHeight + lineHeight)
    await saveWithKeyboard(app)
    await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('# heading\n\nalpha\n\n\n**beta**\n')
    await closeTestApplication(app)
  } catch (error) {
    terminateTestApplication(app)
    throw error
  }
})
