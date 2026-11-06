import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import type { ElectronApplication, Page } from 'playwright'
import {
  enterSourceMode,
  clickMenuById,
  expectNoRendererErrors,
  getMarkdownContent,
  launchWithMarkdown,
  placeCaretAtOffset,
  saveWithKeyboard,
  terminateTestApplication
} from './helpers'
import { clickViaMain, dragViaMain } from './mainProcessInput'

const historyShortcut = (app: ElectronApplication, redo = false) => app.evaluate(({ BrowserWindow }, redo) => {
  const win = BrowserWindow.getAllWindows()[0]
  const modifiers: ('meta' | 'control' | 'shift')[] = [process.platform === 'darwin' ? 'meta' : 'control']
  if (redo) modifiers.push('shift')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers })
}, redo)

const selectedText = (page: Page): Promise<string> => page.evaluate(() =>
  window.getSelection()?.toString().replace(/\u200B/g, '') ?? ''
)

const readSourceMarkdown = (page: Page): Promise<string> => page.evaluate(() => {
  const cm = document.querySelector('.source-code .CodeMirror') as
    | (Element & { CodeMirror?: { getValue(): string } })
    | null
  return cm?.CodeMirror?.getValue() ?? ''
})

const dragAcrossVisualLines = async(
  app: ElectronApplication,
  page: Page,
  from: number,
  to: number,
  backward = false
): Promise<void> => {
  const box = await page.locator('p.mu-paragraph').first().boundingBox()
  if (!box) throw new Error('paragraph not found')
  const lineHeight = await page.evaluate(() => Number.parseFloat(
    window.getComputedStyle(document.querySelector('.mu-paragraph-content') as HTMLElement).lineHeight
  ))
  const lineY = (line: number): number => box.y + lineHeight * line + lineHeight / 2
  const start = backward
    ? { x: box.x + box.width - 1, y: lineY(from) }
    : { x: box.x + 1, y: lineY(from) }
  const end = backward
    ? { x: box.x + 1, y: lineY(to) }
    : { x: box.x + box.width - 1, y: lineY(to) }
  await dragViaMain(app, page, start, end)
}

const dragBetweenContentLeaves = async(
  app: ElectronApplication,
  page: Page,
  startIndex: number,
  endIndex: number
): Promise<void> => {
  const start = await page.locator('.mu-paragraph-content').nth(startIndex).boundingBox()
  const end = await page.locator('.mu-paragraph-content').nth(endIndex).boundingBox()
  if (!start || !end) throw new Error('list content not found')
  await dragViaMain(
    app,
    page,
    { x: start.x + 1, y: start.y + start.height / 2 },
    { x: end.x + end.width - 1, y: end.y + end.height / 2 }
  )
}

test.describe('selected-line indentation through real user input', () => {
  test('mouse-selected lines and their selection survive consecutive Tab presses', async() => {
    const { app, page } = await launchWithMarkdown('Alpha beta gamma\nDelta epsilon\n', {
      suppressErrorDialog: true
    })
    try {
      await dragAcrossVisualLines(app, page, 0, 1)
      await expect.poll(() => selectedText(page)).toContain('Delta epsilon')

      await page.keyboard.press('Tab')
      await expect.poll(() => selectedText(page)).toContain('Alpha beta gamma')
      await page.keyboard.press('Tab')

      expect(await getMarkdownContent(page, app)).toBe(
        '        Alpha beta gamma\n        Delta epsilon\n'
      )
      await expectNoRendererErrors(app)
    } finally {
      terminateTestApplication(app)
    }
  })

  test('Select All followed by Tab keeps the whole document and indents every line', async() => {
    const { app, page } = await launchWithMarkdown('Alpha beta gamma\nDelta epsilon\n', {
      suppressErrorDialog: true
    })
    try {
      await placeCaretAtOffset(page, 2)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
      await expect.poll(() => selectedText(page)).toContain('Delta epsilon')

      await page.keyboard.press('Tab')

      expect(await getMarkdownContent(page, app)).toBe(
        '    Alpha beta gamma\n    Delta epsilon\n'
      )
      await expectNoRendererErrors(app)
    } finally {
      terminateTestApplication(app)
    }
  })

  test('mouse selection across several list items indents every selected row without text loss', async() => {
    const { app, page } = await launchWithMarkdown('- alpha\n- bravo\n- charlie\n', {
      suppressErrorDialog: true
    })
    try {
      await dragBetweenContentLeaves(app, page, 0, 2)
      await expect.poll(() => selectedText(page)).toContain('charlie')

      await page.keyboard.press('Tab')

      expect(await getMarkdownContent(page, app)).toBe(
        '  - alpha\n  - bravo\n  - charlie\n'
      )
      await expectNoRendererErrors(app)
    } finally {
      terminateTestApplication(app)
    }
  })

  test('a run from the first nested child to a later parent indents every selected row', async() => {
    const markdown = [
      '- 实验指标数据获取',
      '  - taoqab报表数据接入：效率、相关性、广告等',
      '  - taoqab外关键指标查询：丰富性',
      '- 实验配置',
      '  - 实验桶初始是否平：拿到用户提供的实验桶后，先去taoqab和脚本看是否和base桶平，将结果告知用户',
      '    - 脚本实验配置读取、检查、生成：保证安全性，上实验要人工',
      '    - taoqab实验配置读取、检查、生成：保证安全性，上实验要人工',
      '- 漏斗分析（深层归因）',
      '  - 精排输出分析：接入SP日志，也是混排候选',
      ''
    ].join('\n')
    const { app, page, filePath } = await launchWithMarkdown(markdown, { suppressErrorDialog: true })
    const rowX = () => page.locator('.mu-paragraph-content').evaluateAll(leaves =>
      leaves.map(leaf => leaf.getBoundingClientRect().x)
    )
    try {
      const before = await rowX()
      await dragBetweenContentLeaves(app, page, 1, 3)
      await expect.poll(() => selectedText(page)).toContain('taoqab报表数据接入')
      await expect.poll(() => selectedText(page)).toContain('实验配置')

      await page.keyboard.press('Tab')

      const indented = [
        '- 实验指标数据获取',
        '    - taoqab报表数据接入：效率、相关性、广告等',
        '    - taoqab外关键指标查询：丰富性',
        '  - 实验配置',
        '  - 实验桶初始是否平：拿到用户提供的实验桶后，先去taoqab和脚本看是否和base桶平，将结果告知用户',
        '    - 脚本实验配置读取、检查、生成：保证安全性，上实验要人工',
        '    - taoqab实验配置读取、检查、生成：保证安全性，上实验要人工',
        '- 漏斗分析（深层归因）',
        '  - 精排输出分析：接入SP日志，也是混排候选',
        ''
      ].join('\n')
      expect(await getMarkdownContent(page, app)).toBe(indented)
      const after = await rowX()
      const markers = await page.locator('.mu-paragraph-content').evaluateAll(leaves =>
        leaves.map(leaf => {
          const item = leaf.closest('li')
          if (!item) throw new Error('list content must belong to a list item')
          return getComputedStyle(item).listStyleType
        })
      )
      expect(markers.slice(1, 4)).toEqual(['square', 'square', 'circle'])
      for (let row = 0; row < before.length; row++) {
        // Unselected descendants keep their source columns and screen positions.
        expect(after[row] - before[row]).toBeCloseTo(row >= 1 && row <= 3 ? 30 : 0, 1)
      }
      await expect.poll(() => selectedText(page)).toContain('taoqab报表数据接入')
      await expect.poll(() => selectedText(page)).toContain('实验配置')
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(filePath, 'utf-8')).toBe(indented)
      await page.screenshot({ path: test.info().outputPath('all-selected-rows-indented.png') })

      await historyShortcut(app)
      await expect.poll(() => getMarkdownContent(page, app)).toBe(markdown)
      await historyShortcut(app, true)
      await expect.poll(() => getMarkdownContent(page, app)).toBe(indented)
      // Redo leaves a caret; select the same rows again for the inverse command.
      await dragBetweenContentLeaves(app, page, 1, 3)
      await page.keyboard.press('Shift+Tab')
      expect(await getMarkdownContent(page, app)).toBe(markdown)
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(filePath, 'utf-8')).toBe(markdown)
      await expectNoRendererErrors(app)
    } finally {
      terminateTestApplication(app)
    }
  })

  test('a selected parent and its existing children keep their relative levels', async() => {
    const markdown = [
      '- 实验指标数据获取',
      '  - taoqab报表数据接入：效率、相关性、广告等',
      '  - taoqab外关键指标查询：丰富性',
      '- 实验配置',
      '  - 实验桶初始是否平：拿到用户提供的实验桶后，先去taoqab和脚本看是否和base桶平，将结果告知用户',
      '  - 脚本实验配置读取、检查、生成：保证安全性，上实验要人工',
      '  - taoqab实验配置读取、检查、生成：保证安全性，上实验要人工',
      '- 漏斗分析（深层归因）',
      '  - 精排输出分析：接入SP日志，也是混排候选',
      ''
    ].join('\n')
    const { app, page } = await launchWithMarkdown(markdown, { suppressErrorDialog: true })
    try {
      await dragBetweenContentLeaves(app, page, 3, 6)
      await expect.poll(() => selectedText(page)).toContain('实验配置')
      await expect.poll(() => selectedText(page)).toContain('taoqab实验配置读取')

      await page.keyboard.press('Tab')

      expect(await getMarkdownContent(page, app)).toBe([
        '- 实验指标数据获取',
        '  - taoqab报表数据接入：效率、相关性、广告等',
        '  - taoqab外关键指标查询：丰富性',
        '  - 实验配置',
        '    - 实验桶初始是否平：拿到用户提供的实验桶后，先去taoqab和脚本看是否和base桶平，将结果告知用户',
        '    - 脚本实验配置读取、检查、生成：保证安全性，上实验要人工',
        '    - taoqab实验配置读取、检查、生成：保证安全性，上实验要人工',
        '- 漏斗分析（深层归因）',
        '  - 精排输出分析：接入SP日志，也是混排候选',
        ''
      ].join('\n'))
      await page.keyboard.press('Shift+Tab')
      expect(await getMarkdownContent(page, app)).toBe(markdown)
      await expectNoRendererErrors(app)
    } finally {
      terminateTestApplication(app)
    }
  })

  test('a backward mouse selection over a blank line keeps every character', async() => {
    const { app, page } = await launchWithMarkdown('Alpha beta gamma\n\nDelta epsilon\n', {
      suppressErrorDialog: true
    })
    try {
      await dragAcrossVisualLines(app, page, 2, 0, true)
      await expect.poll(() => selectedText(page)).toContain('Alpha beta gamma')

      await page.keyboard.press('Tab')

      expect(await getMarkdownContent(page, app)).toBe(
        '    Alpha beta gamma\n    \n    Delta epsilon\n'
      )
      await expectNoRendererErrors(app)
    } finally {
      terminateTestApplication(app)
    }
  })

  test('a partial Shift+Arrow selection indents whole lines without deleting unselected text', async() => {
    const { app, page } = await launchWithMarkdown('Alpha beta gamma\nDelta epsilon\n', {
      suppressErrorDialog: true
    })
    try {
      await placeCaretAtOffset(page, 2)
      await page.keyboard.press('Shift+ArrowDown')
      await expect.poll(() => selectedText(page)).not.toBe('')

      await page.keyboard.press('Tab')

      expect(await getMarkdownContent(page, app)).toBe(
        '    Alpha beta gamma\n    Delta epsilon\n'
      )
      await expectNoRendererErrors(app)
    } finally {
      terminateTestApplication(app)
    }
  })

  test('indenting a selected parent preserves the viewport in typewriter mode', async() => {
    const markdown = Array.from(
      { length: 60 },
      (_, index) => `- item ${index}\n  - child ${index}\n`
    ).join('')
    const { app, page } = await launchWithMarkdown(markdown, { suppressErrorDialog: true })
    const scrollTop = () => page.evaluate(() =>
      (document.querySelector('.editor-component') as HTMLElement).scrollTop
    )
    try {
      await page.locator('.mu-paragraph-content').nth(80).evaluate(el =>
        el.scrollIntoView({ block: 'center' })
      )
      await dragBetweenContentLeaves(app, page, 80, 81)
      await expect.poll(() => selectedText(page)).toContain('child 40')
      await clickMenuById(app, 'typewriterModeMenuItem')
      await page.waitForTimeout(600)
      const before = await scrollTop()
      expect(before).toBeGreaterThan(500)

      await page.keyboard.press('Tab')
      const samples: number[] = []
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(50)
        samples.push(await scrollTop())
      }
      expect(samples).toEqual(Array.from({ length: 10 }, () => before))
      expect(await scrollTop()).toBe(before)
      await expect.poll(() => selectedText(page)).toContain('child 40')
      expect(await getMarkdownContent(page, app)).toContain('  - item 40\n    - child 40')
      await expectNoRendererErrors(app)
    } finally {
      terminateTestApplication(app)
    }
  })

  test('source mode also preserves the viewport while indenting a selection', async() => {
    const markdown = Array.from(
      { length: 60 },
      (_, index) => `- item ${index}\n  - child ${index}\n`
    ).join('')
    const { app, page } = await launchWithMarkdown(markdown, { suppressErrorDialog: true })
    const scrollTop = () => page.evaluate(() =>
      (document.querySelector('.source-code') as HTMLElement).scrollTop
    )
    try {
      await enterSourceMode(page, app)
      await page.evaluate(() => {
        const cm = (document.querySelector('.source-code .CodeMirror') as Element & {
          CodeMirror: {
            setSelection(anchor: unknown, focus: unknown): void
          }
        }).CodeMirror
        cm.setSelection({ line: 80, ch: 2 }, { line: 81, ch: 11 })
        document.querySelectorAll('.CodeMirror-line')[80].scrollIntoView({ block: 'center' })
      })
      await page.waitForTimeout(250)
      const before = await scrollTop()
      expect(before).toBeGreaterThan(500)

      await page.keyboard.press('Tab')
      const samples: number[] = []
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(50)
        samples.push(await scrollTop())
      }

      expect(samples).toEqual(Array.from({ length: 10 }, () => before))
      expect(await readSourceMarkdown(page)).toContain('  - item 40\n    - child 40')
      await expectNoRendererErrors(app)
    } finally {
      terminateTestApplication(app)
    }
  })

  test('source mode indents a keyboard-selected document without deleting it', async() => {
    const { app, page } = await launchWithMarkdown('Alpha beta gamma\nDelta epsilon\n', {
      suppressErrorDialog: true
    })
    try {
      await enterSourceMode(page, app)
      await clickViaMain(app, page, '.source-code .CodeMirror')
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
      await page.keyboard.press('Tab')

      expect(await readSourceMarkdown(page)).toBe('    Alpha beta gamma\n    Delta epsilon\n')
      await expectNoRendererErrors(app)
    } finally {
      terminateTestApplication(app)
    }
  })
})
