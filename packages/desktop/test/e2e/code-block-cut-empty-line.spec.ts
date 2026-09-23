import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeTestApplication, launchElectron, launchWithMarkdown, saveWithKeyboard,
  terminateTestApplication, waitForEditor, waitForMenuReady
} from './helpers'

const codeSelector = '.mu-codeblock-content'
const codeText = (page: Page): Promise<string> =>
  page.locator(codeSelector).evaluate(el => el.textContent ?? '')

const caretOffset = (page: Page): Promise<number | null> => page.evaluate((selector) => {
  const code = document.querySelector(selector)
  const selection = window.getSelection()
  if (!code || !selection?.isCollapsed || !selection.anchorNode || !code.contains(selection.anchorNode)) return null
  const range = document.createRange()
  range.selectNodeContents(code)
  range.setEnd(selection.anchorNode, selection.anchorOffset)
  return range.toString().length
}, codeSelector)

const placeCaretAtStart = async(page: Page): Promise<void> => {
  await page.evaluate((selector) => {
    const root = document.querySelector<HTMLElement>('.editor-component')
    const code = root?.querySelector(selector)
    const selection = window.getSelection()
    if (!root || !code || !selection) throw new Error('No code block to place the caret in')
    root.focus()
    const text = document.createTreeWalker(code, NodeFilter.SHOW_TEXT).nextNode()
    if (!text) throw new Error('No code text to place the caret in')
    selection.setBaseAndExtent(text, 0, text, 0)
    document.dispatchEvent(new Event('selectionchange'))
    root.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }))
  }, codeSelector)
  await expect.poll(() => caretOffset(page)).toBe(0)
}

// Native input also exercises macOS's menu accelerator; CDP keyboard shortcuts
// do not invoke the app's Cut/Copy/Paste commands while the window is inactive.
const shortcut = async(app: ElectronApplication, key: string): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, keyCode) => {
    const win = BrowserWindow.getAllWindows()[0]
    const modifiers: ('meta' | 'control')[] = [process.platform === 'darwin' ? 'meta' : 'control']
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }, key)
}

for (const blankLines of [1, 2]) {
  test(`cut removes ${blankLines} leading empty code line(s), preserves the caret and saves`, async() => {
    const fence = (text: string): string => `\`\`\`js\n${text}\n\`\`\`\n`
    const initialText = `${'\n'.repeat(blankLines)}const value = 1\nnext()`
    // Desktop preferences trim leading code blank lines on import. Create
    // them by typing so this exercises editing, independent of that setting.
    const launched = await launchWithMarkdown(fence('const value = 1\nnext()'))
    let { app, page } = launched
    const { filePath } = launched
    try {
      await waitForMenuReady(app)
      await expect.poll(() => codeText(page)).toBe('const value = 1\nnext()')
      await placeCaretAtStart(page)
      for (let count = 1; count <= blankLines; count++) {
        await page.keyboard.press('Enter')
        await expect.poll(() => codeText(page)).toBe(`${'\n'.repeat(count)}const value = 1\nnext()`)
      }
      for (let count = 0; count < blankLines; count++) await page.keyboard.press('ArrowLeft')
      await expect.poll(() => codeText(page)).toBe(initialText)
      await expect.poll(() => caretOffset(page)).toBe(0)
      const height = await page.locator(codeSelector).evaluate(el => el.getBoundingClientRect().height)
      const lineHeight = await page.locator(codeSelector).evaluate(el => parseFloat(getComputedStyle(el).lineHeight))

      for (let remaining = blankLines - 1; remaining >= 0; remaining--) {
        await shortcut(app, 'X')
        await expect.poll(() => codeText(page)).toBe(`${'\n'.repeat(remaining)}const value = 1\nnext()`)
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('\n')
        await expect.poll(() => caretOffset(page)).toBe(0)
        await expect.poll(() => page.locator(codeSelector).evaluate(el => el.getBoundingClientRect().height))
          .toBeCloseTo(height - (blankLines - remaining) * lineHeight, 0)
      }

      // Pasting the cut empty line must insert it before the current first row.
      await shortcut(app, 'V')
      await expect.poll(() => codeText(page)).toBe('\nconst value = 1\nnext()')
      await expect.poll(() => caretOffset(page)).toBe(0)
      await shortcut(app, 'X')
      await expect.poll(() => codeText(page)).toBe('const value = 1\nnext()')
      await expect.poll(() => caretOffset(page)).toBe(0)
      await page.keyboard.type('X')
      await expect.poll(() => codeText(page)).toBe('Xconst value = 1\nnext()')
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(fence('Xconst value = 1\nnext()'))
      await page.screenshot({ path: test.info().outputPath('after-cut.png') })

      await closeTestApplication(app)
      const reopened = await launchElectron([filePath])
      app = reopened.app
      page = reopened.page
      await waitForEditor(page)
      await expect.poll(() => codeText(page)).toBe('Xconst value = 1\nnext()')
      await closeTestApplication(app)
    } catch (error) {
      terminateTestApplication(app)
      throw error
    }
  })
}

test('copying a leading empty code line duplicates that line without moving the caret', async() => {
  const { app, page } = await launchWithMarkdown('```js\nconst value = 1\n```\n')
  try {
    await waitForMenuReady(app)
    await expect.poll(() => codeText(page)).toBe('const value = 1')
    await placeCaretAtStart(page)
    await page.keyboard.press('Enter')
    await expect.poll(() => codeText(page)).toBe('\nconst value = 1')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => caretOffset(page)).toBe(0)
    await shortcut(app, 'C')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('\n')
    await expect.poll(() => codeText(page)).toBe('\nconst value = 1')
    await shortcut(app, 'V')
    await expect.poll(() => codeText(page)).toBe('\n\nconst value = 1')
    await expect.poll(() => caretOffset(page)).toBe(0)
    await closeTestApplication(app)
  } catch (error) {
    terminateTestApplication(app)
    throw error
  }
})
