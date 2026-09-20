import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  closeTestApplication, enterSourceMode, focusEditor, getMarkdownContent,
  launchWithMarkdown, paragraphText, saveWithKeyboard, setSourceMarkdown,
  terminateTestApplication, ZERO_WIDTH_SPACE
} from './helpers'

let app: ElectronApplication
let page: Page
let filePath: string
let running = false

// Share the isolated process, not document state. Each describe resets its fixture.
test.beforeAll(async() => {
  ;({ app, page, filePath } = await launchWithMarkdown())
  running = true
})

test.beforeEach(async() => {
  test.info().annotations.push({ type: 'electron-pid', description: String(app.process().pid) })
})

test.afterEach(async() => {
  const testInfo = test.info()
  if (testInfo.status !== testInfo.expectedStatus) {
    terminateTestApplication(app)
    running = false
    return
  }
  try {
    // Save without reparsing empty paragraphs as part of cleanup.
    await enterSourceMode(page, app)
    const markdown = await getMarkdownContent(page, app)
    await saveWithKeyboard(app)
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(markdown)
  } catch (error) {
    try {
      terminateTestApplication(app)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Save verification and test cleanup both failed')
    } finally {
      running = false
    }
    throw error
  }
})

test.afterAll(async() => {
  try {
    if (running) await closeTestApplication(app)
  } finally {
    running = false
  }
})

// #3329 — moving the caret DOWN auto-scrolls the view (the #628 handler), but
// moving it UP did not, so the caret slid above the viewport. The fix adds the
// symmetric upward scroll.
test.describe('Arrow-up scrolls the document (#3329)', () => {
  test.beforeEach(async() => {
    const md = `${Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n')}\n`
    await setSourceMarkdown(page, app, md)
    await focusEditor(page)
  })

  const scrollTop = () =>
    page.evaluate(() => (document.querySelector('.editor-component') as HTMLElement)?.scrollTop ?? -1)

  const pressMany = async(key: string, times: number) => {
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(key)
      await page.waitForTimeout(6)
    }
    await page.waitForTimeout(120)
  }

  test('moving the caret up brings the view back up', async() => {
    // Caret to the bottom — the #628 handler scrolls the view down.
    await pressMany('ArrowDown', 80)
    const bottom = await scrollTop()
    expect(bottom).toBeGreaterThan(200)

    // Caret back up — the view must follow it upward.
    await pressMany('ArrowUp', 80)
    const top = await scrollTop()
    expect(top).toBeLessThan(bottom - 200)
  })
})

test.describe('Empty lines reset the vertical caret column', () => {
  // Blank lines in body text stay literal newlines inside ONE paragraph, so the
  // caret is asserted as an absolute offset into that paragraph's text rather
  // than as (paragraph index, offset).
  const lines = ['abcdefghij', '', 'xy', '', 'abcdefghijklmn']
  const text = lines.join('\n')
  const lineStart = (index: number): number =>
    lines.slice(0, index).reduce((total, line) => total + line.length + 1, 0)
  const contentSelector = '.editor-component span.mu-paragraph-content'

  test.beforeEach(async() => {
    await setSourceMarkdown(page, app, `${text}\n`)
    await expect(page.locator(contentSelector)).toHaveCount(1)
    await expect.poll(() => paragraphText(page)).toBe(text)
    await page.evaluate(() => {
      const root = document.querySelector('.editor-component') as HTMLElement
      root.scrollTop = 0
    })
  })

  // Character offset of the caret inside the paragraph, ignoring the zero-width
  // anchor the engine parks after a trailing newline.
  const expectCaret = async(offset: number) => {
    await expect
      .poll(() =>
        page.evaluate((zwsp) => {
          const selection = window.getSelection()
          if (!selection?.anchorNode || !selection.rangeCount) return null
          const node = selection.anchorNode
          const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
          const content = element?.closest('span.mu-paragraph-content')
          if (!content) return null
          // anchorOffset alone can be a child index, not a character offset.
          const range = document.createRange()
          range.selectNodeContents(content)
          range.setEnd(node, selection.anchorOffset)
          return {
            offset: range.toString().split(zwsp).join('').length,
            collapsed: selection.isCollapsed
          }
        }, ZERO_WIDTH_SPACE)
      )
      .toEqual({ offset, collapsed: true })
  }

  const press = async(key: string, offset: number) => {
    await page.keyboard.press(key)
    await expectCaret(offset)
  }

  const attachCaret = async() => {
    const testInfo = test.info()
    await testInfo.attach('after-empty-lines-target-start', {
      body: await page.screenshot({ caret: 'initial' }),
      contentType: 'image/png'
    })
  }

  // Only initialization injects a selection; every later move is a real keypress.
  const start = async(offset: number) => {
    await page.evaluate((off) => {
      const root = document.querySelector('.editor-component') as HTMLElement
      const content = document.querySelector('span.mu-paragraph-content') as HTMLElement
      root.focus()
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode() as Text | null
      let remaining = off
      while (node) {
        const length = (node.textContent ?? '').split('\u200B').join('').length
        if (remaining <= length) break
        remaining -= length
        node = walker.nextNode() as Text | null
      }
      if (!node) throw new Error('The paragraph has no text node at that offset')
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      const selection = window.getSelection()
      if (!selection) throw new Error('DOM selection is unavailable')
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      root.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    }, offset)
    // Source-mode replacement preserves the engine, including its preferred column.
    await page.keyboard.press('Escape')
    await expectCaret(offset)
  }

  test('ArrowDown and ArrowUp walk every line, blank lines included', async() => {
    await start(lines[0].length)
    for (const offset of [lineStart(1), lineStart(2), lineStart(3), lineStart(4)]) {
      await press('ArrowDown', offset)
    }
    for (const offset of [lineStart(3), lineStart(2), lineStart(1), 0]) {
      await press('ArrowUp', offset)
    }
    await attachCaret()
  })

  for (const key of ['ArrowUp', 'ArrowDown'] as const) {
    for (const column of ['end', 'middle'] as const) {
      test(`${key} resets ${column} column history across the blank lines`, async() => {
        const down = key === 'ArrowDown'
        // A blank line is a column-zero anchor: after crossing one, the caret
        // must not snap back to the column it left, so every row below lands at
        // its own line start no matter which column the walk began in.
        const sourceColumn = column === 'end' ? lines[0].length : 6
        const startOffset = down ? sourceColumn : lineStart(4) + sourceColumn
        await start(startOffset)

        const downSequence = [lineStart(1), lineStart(2), lineStart(3), lineStart(4)]
        const upSequence = [lineStart(3), lineStart(2), lineStart(1), 0]
        const forward = down ? downSequence : upSequence
        const backward = down ? upSequence : downSequence
        for (let pass = 0; pass < 2; pass++) {
          for (const offset of forward) await press(key, offset)
          for (const offset of backward) {
            await press(down ? 'ArrowUp' : 'ArrowDown', offset)
          }
        }
        await expect.poll(() => paragraphText(page)).toBe(text)
      })
    }
  }
})
