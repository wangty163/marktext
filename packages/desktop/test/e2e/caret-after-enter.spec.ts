import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import fs from 'node:fs'
import {
  caretPaintMetrics, closeTestApplication, endOfBlockPoint, launchWithMarkdown,
  paragraphText, saveWithKeyboard, terminateTestApplication, waitForMenuReady, ZERO_WIDTH_SPACE
} from './helpers'
import { clickPointViaMain } from './mainProcessInput'

// Pressing Enter at the end of a block used to lose the caret in every shape
// except a plain paragraph. Two rendering gaps caused it:
//
//   - Enter at the end of a heading, list item, table cell or blockquote
//     paragraph creates a NEW empty block, and an empty content block rendered
//     to an empty string. A collapsed range inside an empty inline element has
//     no client rect, so the browser had nowhere to paint an insertion point.
//   - Enter on the last line of a code block appends a trailing newline, which
//     renders as a `mu-line-end` span with nothing after it.
//
// Both now park a zero-width `mu-caret-anchor`. These cases drive the real
// Electron shell with real clicks, assert the caret's layout evidence, type
// through it, and check that the anchor character never reaches the saved file.

interface Case {
  name: string
  /** File name for this case; each case needs its own so a drop opens it fresh. */
  file: string
  markdown: string
  /** Selector for the block whose last character the caret starts after. */
  selector: string
  /** Paragraph text expected after Enter + typing `X`. */
  expectBlocks: string[]
  /** File content expected after saving. */
  expectFile: string
}

const CASES: Case[] = [
  {
    name: 'heading',
    file: 'heading.md',
    markdown: '# Title\n',
    selector: '.mu-atxheading-content',
    expectBlocks: ['# Title', 'X'],
    expectFile: '# Title\n\nX\n'
  },
  {
    name: 'bullet list item',
    file: 'list.md',
    markdown: '- one\n- two\n',
    selector: '.mu-list-item .mu-paragraph-content',
    expectBlocks: ['one', 'two', 'X'],
    expectFile: '- one\n- two\n- X\n'
  },
  {
    name: 'blockquote paragraph',
    file: 'quote.md',
    markdown: '> quoted text\n',
    selector: '.mu-block-quote .mu-paragraph-content',
    expectBlocks: ['quoted text', 'X'],
    expectFile: '> quoted text\n>\n> X\n'
  },
  {
    name: 'fenced code block',
    file: 'fence.md',
    markdown: '```\ncode line\n```\n',
    selector: '.mu-codeblock-content',
    expectBlocks: ['code line\nX'],
    expectFile: '```\ncode line\nX\n```\n'
  },
  {
    name: 'indented code block',
    file: 'indent.md',
    markdown: '    indented code\n',
    selector: '.mu-codeblock-content',
    expectBlocks: ['indented code\nX'],
    // An indented block stays indented on save; it is not converted to a fence.
    expectFile: '    indented code\n    X\n'
  }
]

const readBlocks = (page: Page): Promise<string[]> =>
  page.evaluate((zwsp) =>
    Array.from(document.querySelectorAll('.mu-content'))
      .map((el) => ((el as HTMLElement).textContent ?? '').split(zwsp).join(''))
      // The language-input row of a code block is a sibling content block that
      // stays empty; it is not part of the document text.
      .filter((text, index, all) => text.length > 0 || all.length === 1),
  ZERO_WIDTH_SPACE)

test.describe('Enter at the end of a block keeps a visible caret', () => {
  let app: ElectronApplication
  let page: Page
  let dirPath: string

  const run = async(testCase: Case): Promise<void> => {
    // A fresh path per case: dropping a file MarkText already has open does not
    // reload it, so the previous case's document would stay on screen.
    const casePath = `${dirPath}/${testCase.file}`
    fs.writeFileSync(casePath, testCase.markdown)
    await page.evaluate((f) => window.electron.ipcRenderer.send('mt::window::drop', [f]), casePath)
    // Wait for this case's block to actually render before measuring a caret.
    await page.waitForSelector(testCase.selector, { state: 'visible', timeout: 15000 })
    await page.waitForTimeout(300)

    const point = await endOfBlockPoint(page, testCase.selector)
    expect(point, `no caret target for ${testCase.name}`).not.toBeNull()
    await clickPointViaMain(app, page, point!)
    await page.waitForTimeout(300)

    await page.keyboard.press('Enter')
    await page.waitForTimeout(450)

    // The caret must be paintable: a collapsed range with a real box.
    const metrics = await caretPaintMetrics(page)
    expect(metrics.rects, `${testCase.name}: ${JSON.stringify(metrics)}`).toBeGreaterThan(0)
    expect(metrics.height, `${testCase.name}: ${JSON.stringify(metrics)}`).toBeGreaterThan(0)

    // And it must be a real insertion point.
    await page.keyboard.type('X')
    await page.waitForTimeout(400)
    await saveWithKeyboard(app)
    await expect
      .poll(async() => (await readBlocks(page)).join('|'))
      .toBe(testCase.expectBlocks.join('|'))

    await expect
      .poll(() => fs.readFileSync(casePath, 'utf8'))
      .toBe(testCase.expectFile)
    // The anchor character must never reach the document or the file.
    expect(fs.readFileSync(casePath, 'utf8')).not.toContain(ZERO_WIDTH_SPACE)
  }

  test.beforeAll(async() => {
    dirPath = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/marktext-caret-enter-`)
    const launched = await launchWithMarkdown('')
    app = launched.app
    page = launched.page
    await waitForMenuReady(app)
  })

  test.afterAll(async() => {
    try {
      if (app) await closeTestApplication(app)
    } finally {
      if (dirPath) fs.rmSync(dirPath, { recursive: true, force: true })
    }
  })

  for (const testCase of CASES) {
    test(`${testCase.name}: caret survives Enter and typing lands in the new line`, async() => {
      try {
        await run(testCase)
      } catch (error) {
        terminateTestApplication(app)
        throw error
      }
    })
  }

  test('an empty document shows a caret and accepts text', async() => {
    const empty = await launchWithMarkdown('')
    try {
      await waitForMenuReady(empty.app)
      await expect.poll(() => paragraphText(empty.page)).toBe('')
      const metrics = await caretPaintMetrics(empty.page)
      // The empty paragraph renders the caret anchor, so its range has a box
      // even before anything is typed into it.
      const point = await endOfBlockPoint(empty.page, '.mu-paragraph-content')
      expect(point).not.toBeNull()
      await clickPointViaMain(empty.app, empty.page, point!)
      await page.waitForTimeout(300)
      const clicked = await caretPaintMetrics(empty.page)
      expect(clicked.height, JSON.stringify({ metrics, clicked })).toBeGreaterThan(0)

      await empty.page.keyboard.type('hello')
      await expect.poll(() => paragraphText(empty.page)).toBe('hello')
      await expect
        .poll(() => empty.page.evaluate(() => document.querySelector('.mu-paragraph-content')?.innerHTML ?? ''))
        .not.toContain('mu-caret-anchor')
    } finally {
      await closeTestApplication(empty.app)
    }
  })
})
