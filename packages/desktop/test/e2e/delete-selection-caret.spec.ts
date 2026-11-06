import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import {
  closeTestApplication, endOfBlockPoint, launchWithMarkdown, saveWithKeyboard,
  terminateTestApplication, waitForMenuReady, ZERO_WIDTH_SPACE
} from './helpers'
import { clickPointViaMain } from './mainProcessInput'

const cases = [
  {
    name: 'paragraph',
    markdown: 'alpha\nbeta\n',
    selector: '.mu-paragraph-content',
    prefix: 'alpha\n',
    suffix: 'beta',
    expected: 'alpha\nZ\n'
  },
  {
    name: 'list',
    markdown: '- alpha\n  beta\n',
    selector: '.mu-paragraph-content',
    prefix: 'alpha\n',
    suffix: 'beta',
    expected: '- alpha\n  Z\n'
  },
  {
    name: 'quote',
    markdown: '> alpha\n> beta\n',
    selector: '.mu-paragraph-content',
    prefix: 'alpha\n',
    suffix: 'beta',
    expected: '> alpha\n> Z\n'
  },
  {
    name: 'code',
    markdown: '```js\nconst abc = 12;\nxyz();\n```\n',
    selector: '.mu-codeblock-content',
    prefix: 'const abc = 12;\n',
    suffix: 'xyz();',
    expected: '```js\nconst abc = 12;\nZ\n```\n'
  }
]

const readCaret = (page: Page, selector: string) => page.evaluate(({ selector, zwsp }) => {
  const block = document.querySelector(selector)
  const selection = document.getSelection()
  if (!block || !selection?.isCollapsed || !selection.anchorNode || !block.contains(selection.anchorNode)) return null
  const range = document.createRange()
  range.selectNodeContents(block)
  range.setEnd(selection.anchorNode, selection.anchorOffset)
  return range.toString().split(zwsp).join('').length
}, { selector, zwsp: ZERO_WIDTH_SPACE })

for (const { name, markdown, selector, prefix, suffix, expected } of cases) {
  test(`deleting a selected last line in ${name} keeps the caret and saves the next edit`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(markdown)
    try {
      await waitForMenuReady(app)
      const point = await endOfBlockPoint(page, selector)
      if (!point) throw new Error(`No caret target for ${name}`)
      await clickPointViaMain(app, page, point)
      await expect.poll(() => readCaret(page, selector)).toBe(prefix.length + suffix.length)
      for (let i = 0; i < suffix.length; i++) await page.keyboard.press('Shift+ArrowLeft')
      await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe(suffix)

      await page.keyboard.press('Backspace')
      await expect.poll(() => readCaret(page, selector)).toBe(prefix.length)
      await page.keyboard.type('Z')
      await expect.poll(() => readCaret(page, selector)).toBe(prefix.length + 1)
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(expected)
      await page.screenshot({ path: test.info().outputPath('after-selection-delete.png') })
      await closeTestApplication(app)
    } catch (error) {
      terminateTestApplication(app)
      throw error
    }
  })
}
