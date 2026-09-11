import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  closeTestApplication, enterSourceMode, focusEditor, getMarkdownContent,
  launchWithMarkdown, saveWithKeyboard
} from './helpers'

// #3329 — moving the caret DOWN auto-scrolls the view (the #628 handler), but
// moving it UP did not, so the caret slid above the viewport. The fix adds the
// symmetric upward scroll.
test.describe('Arrow-up scrolls the document (#3329)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const md = `${Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n')}\n`
    const launched = await launchWithMarkdown(md)
    app = launched.app
    page = launched.page
    await focusEditor(page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
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
  const texts = ['abcdefghij', 'xy', 'abcdefghijklmn']
  const contentSelector = '.editor-component span.mu-paragraph-content'
  let app: ElectronApplication | undefined
  let page: Page
  let filePath: string

  test.afterEach(async() => {
    const running = app
    app = undefined
    if (!running) return
    try {
      // Keep source mode open so teardown saves without reparsing the test document.
      await enterSourceMode(page, running)
      const markdown = await getMarkdownContent(page, running)
      await saveWithKeyboard(running)
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(markdown)
    } finally {
      await closeTestApplication(running)
    }
  })

  const expectCaret = async(index: number, offset: number) => {
    await expect.poll(() => page.evaluate((selector) => {
      const selection = window.getSelection()
      if (!selection?.anchorNode || !selection.rangeCount) return null
      const node = selection.anchorNode
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element
      const content = element?.closest('span.mu-paragraph-content')
      if (!content) return null
      // anchorOffset alone can be a child index, not a character offset.
      const range = document.createRange()
      range.selectNodeContents(content)
      range.setEnd(node, selection.anchorOffset)
      return {
        index: Array.from(document.querySelectorAll(selector)).indexOf(content),
        offset: range.toString().length,
        collapsed: selection.isCollapsed
      }
    }, contentSelector)).toEqual({ index, offset, collapsed: true })
  }

  const press = async(key: string, index: number, offset: number) => {
    await page.keyboard.press(key)
    await expectCaret(index, offset)
  }

  const attachCaret = async() => {
    const testInfo = test.info()
    await testInfo.attach('after-empty-lines-target-start', {
      body: await page.screenshot({ caret: 'initial' }),
      contentType: 'image/png'
    })
  }

  const start = async(index: number, atEnd: boolean) => {
    const launched = await launchWithMarkdown(`${texts.join('\n\n')}\n`)
    app = launched.app
    page = launched.page
    filePath = launched.filePath
    await expect(page.locator(contentSelector)).toHaveText(texts)
    // Only initialization injects a selection; every subsequent move is a real keypress.
    await page.locator(contentSelector).nth(index).evaluate((content, end) => {
      const root = document.querySelector('.editor-component') as HTMLElement
      root.focus()
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      let textNode = walker.nextNode()
      if (!textNode) throw new Error('The initial paragraph has no text node')
      if (end) {
        for (let next = walker.nextNode(); next; next = walker.nextNode()) textNode = next
      }
      // Muya expects a text offset, not an element child index during selection commit.
      const range = document.createRange()
      range.setStart(textNode, end ? textNode.textContent!.length : 0)
      range.collapse(true)
      const selection = window.getSelection()
      if (!selection) throw new Error('DOM selection is unavailable')
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      root.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    }, atEnd)
    await expectCaret(index, atEnd ? texts[index].length : 0)
  }

  const createGaps = async(key: 'ArrowUp' | 'ArrowDown') => {
    const down = key === 'ArrowDown'
    await start(down ? 0 : 2, down)
    const paragraphs = [...texts]
    // Markdown separators do not produce editable empty paragraphs; Enter must create them.
    for (let count = 1; count <= 2; count++) {
      paragraphs.splice(down ? count : count + 1, 0, '')
      await press('Enter', down ? count : count + 2, 0)
      await expect(page.locator(contentSelector)).toHaveText(paragraphs)
    }
    return paragraphs
  }

  for (const key of ['ArrowUp', 'ArrowDown'] as const) {
    test(`${key} leaves newly entered empty lines at column zero`, async() => {
      await createGaps('ArrowDown')
      if (key === 'ArrowUp') await press(key, 1, 0)
      await press(key, key === 'ArrowUp' ? 0 : 3, 0)
      await attachCaret()
    })

    for (const column of ['end', 'middle'] as const) {
      test(`${key} resets ${column} history across consecutive empty lines`, async() => {
        const down = key === 'ArrowDown'
        const paragraphs = await createGaps(key)
        const source = down ? 0 : 4
        const sourceLength = paragraphs[source].length
        const offset = column === 'end' ? sourceLength : 6
        if (down) {
          await press('ArrowLeft', 1, 0)
          await press('ArrowLeft', 0, sourceLength)
          for (let ch = sourceLength - 1; ch >= offset; ch--) {
            await press('ArrowLeft', source, ch)
          }
        } else {
          for (let ch = 1; ch <= offset; ch++) await press('ArrowRight', source, ch)
        }

        const forward = down ? [1, 2, 3, 4] : [3, 2, 1, 0]
        const backward = down ? [3, 2, 1, 0] : [1, 2, 3, 4]
        const reverseKey = down ? 'ArrowUp' : 'ArrowDown'
        for (let pass = 0; pass < 2; pass++) {
          for (const index of forward) {
            await press(key, index, 0)
            if (pass === 0 && index === forward[2]) await attachCaret()
          }
          for (const index of backward) await press(reverseKey, index, 0)
        }
        await expect(page.locator(contentSelector)).toHaveText(paragraphs)
      })
    }
  }

  for (const column of ['end', 'middle'] as const) {
    test(`nonempty lines preserve ${column} navigation through a short line`, async() => {
      await start(0, true)
      const offset = column === 'end' ? texts[0].length : 6
      for (let ch = texts[0].length - 1; ch >= offset; ch--) {
        await press('ArrowLeft', 0, ch)
      }
      const lastOffset = column === 'end' ? texts[2].length : offset
      for (let pass = 0; pass < 2; pass++) {
        await press('ArrowDown', 1, texts[1].length)
        await press('ArrowDown', 2, lastOffset)
        await press('ArrowUp', 1, texts[1].length)
        await press('ArrowUp', 0, offset)
      }
      await expect(page.locator(contentSelector)).toHaveText(texts)
    })
  }
})
