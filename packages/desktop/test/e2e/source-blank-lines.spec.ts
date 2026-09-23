import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  closeTestApplication, getMarkdownContent, launchElectron, launchWithMarkdown,
  placeCaretAtOffset, saveWithKeyboard, sendIpcToRenderer, terminateTestApplication,
  waitForEditor, waitForMenuReady
} from './helpers'

const original = '# ASE\n\n## TODO\n\n# Prompt\n\n```\nexample prompt\n```\n\n正文\n'
const withoutGap = original.replace('# Prompt\n\n```', '# Prompt\n```')
const gapSelector = 'h1 + .mu-paragraph:has(+ .mu-code-block)'

for (const key of ['Backspace', 'Delete']) {
  test(`${key} removes the heading/code gap from the view, source, saved file and reopened document`, async() => {
    const launched = await launchWithMarkdown(original)
    let { app, page } = launched
    const { filePath } = launched
    try {
      // The Prompt gap is the third empty paragraph in this fixture; the
      // preceding heading gaps and following prose must remain untouched.
      await expect(page.locator(gapSelector)).toHaveCount(1)
      const gapHeight = await page.locator(gapSelector).evaluate(el => el.getBoundingClientRect().height)
      expect(gapHeight).toBeGreaterThan(0)
      await page.screenshot({ path: test.info().outputPath('before-delete.png') })
      await placeCaretAtOffset(page, 0, 2)
      await page.keyboard.press(key)
      await expect(page.locator(gapSelector)).toHaveCount(0)
      await expect(page.locator('.editor-tabs li.unsaved')).toHaveCount(1)
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(withoutGap)

      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await expect(page.locator(gapSelector)).toHaveCount(1)
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(original)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      await expect(page.locator(gapSelector)).toHaveCount(0)
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(withoutGap)

      // Source mode also serializes and rebuilds the tree. No gap may return.
      expect(await getMarkdownContent(page, app)).toBe(withoutGap)
      await expect(page.locator(gapSelector)).toHaveCount(0)
      await page.screenshot({ path: test.info().outputPath('after-delete.png') })
      await closeTestApplication(app)
      const reopened = await launchElectron([filePath])
      app = reopened.app
      page = reopened.page
      await waitForEditor(page)
      await waitForMenuReady(app)
      await expect(page.locator(gapSelector)).toHaveCount(0)
      await expect(page.locator('.mu-codeblock-content')).toHaveText('example prompt')
      expect(await getMarkdownContent(page, app)).toBe(withoutGap)
      await page.screenshot({ path: test.info().outputPath('reopened.png') })
      await closeTestApplication(app)
    } catch (error) {
      terminateTestApplication(app)
      throw error
    }
  })
}
