import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
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

const readSelection = (page: Page, selector: string) => page.evaluate(({ selector, zwsp }) => {
  const block = document.querySelector(selector)
  const selection = document.getSelection()
  if (!block || !selection?.anchorNode || !selection.focusNode ||
      !block.contains(selection.anchorNode) || !block.contains(selection.focusNode)) return null
  const offset = (node: Node, end: number): number => {
    const range = document.createRange()
    range.selectNodeContents(block)
    range.setEnd(node, end)
    return range.toString().split(zwsp).join('').length
  }
  return {
    anchor: offset(selection.anchorNode, selection.anchorOffset),
    focus: offset(selection.focusNode, selection.focusOffset)
  }
}, { selector, zwsp: ZERO_WIDTH_SPACE })

const historyShortcut = (app: ElectronApplication, redo = false) => app.evaluate(({ BrowserWindow }, redo) => {
  const win = BrowserWindow.getAllWindows()[0]
  const modifiers: ('meta' | 'control' | 'shift')[] = [process.platform === 'darwin' ? 'meta' : 'control']
  if (redo) modifiers.push('shift')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers })
}, redo)

for (const { name, markdown, selector, prefix, suffix, expected } of cases) {
  test(`undo/redo restores the selection and next edit in ${name}`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(markdown)
    try {
      await waitForMenuReady(app)
      const point = await endOfBlockPoint(page, selector)
      if (!point) throw new Error(`No caret target for ${name}`)
      await clickPointViaMain(app, page, point)
      for (let i = 0; i < suffix.length; i++) await page.keyboard.press('Shift+ArrowLeft')
      const before = { anchor: prefix.length + suffix.length, focus: prefix.length }
      await expect.poll(() => readSelection(page, selector)).toEqual(before)
      await page.keyboard.press('Backspace')
      const after = { anchor: prefix.length, focus: prefix.length }
      await expect.poll(() => readSelection(page, selector)).toEqual(after)
      await page.keyboard.press('Home')

      await historyShortcut(app)
      await expect.poll(() => readSelection(page, selector)).toEqual(before)
      await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe(suffix)
      await page.screenshot({ path: test.info().outputPath('after-undo.png') })
      await historyShortcut(app, true)
      await expect.poll(() => readSelection(page, selector)).toEqual(after)
      await historyShortcut(app)
      await expect.poll(() => readSelection(page, selector)).toEqual(before)
      await page.keyboard.type('Z')
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(expected)
      await closeTestApplication(app)
    } catch (error) {
      terminateTestApplication(app)
      throw error
    }
  })
}
