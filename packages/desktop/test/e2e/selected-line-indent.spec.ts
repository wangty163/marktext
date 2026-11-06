import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import {
  launchWithMarkdown,
  launchElectron,
  waitForEditor,
  waitForMenuReady,
  setSourceMarkdown,
  getMarkdownContent,
  sendIpcToRenderer,
  enterSourceMode
} from './helpers'

interface SourcePosition {
  line: number
  ch: number
}

interface IndentRunResult {
  indented: string
  outdented: string
}

let app: ElectronApplication
let page: Page
let filePath: string

const readSourceMarkdown = async(): Promise<string> => {
  return await page.evaluate(() => {
    const cm = document.querySelector('.source-code .CodeMirror') as
      | (Element & { CodeMirror?: { getValue(): string } })
      | null
    return cm?.CodeMirror?.getValue() ?? ''
  })
}

const selectSource = async(anchor: SourcePosition, focus: SourcePosition): Promise<void> => {
  await page.evaluate(({ anchor, focus }) => {
    const cm = (document.querySelector('.source-code .CodeMirror') as Element & {
      CodeMirror: {
        focus(): void
        setSelection(anchor: SourcePosition, focus: SourcePosition): void
      }
    }).CodeMirror
    cm.focus()
    cm.setSelection(anchor, focus)
  }, { anchor, focus })
}

// Select whole content leaves through a real DOM Range. The production keydown
// reads this live selection; no test-only engine or store API is involved.
const selectWysiwygLeaves = async(startIndex: number, endIndex: number): Promise<void> => {
  await page.evaluate(({ startIndex, endIndex }) => {
    const root = document.querySelector('.editor-component') as HTMLElement
    const leaves = root.querySelectorAll('span.mu-content')
    const start = leaves[startIndex]
    const end = leaves[endIndex]
    if (!start || !end) throw new Error(`Missing content leaves ${startIndex}..${endIndex}`)

    root.focus()
    const range = document.createRange()
    range.setStart(start, 0)
    range.setEnd(end, end.childNodes.length)
    const selection = window.getSelection()
    if (!selection) throw new Error('No DOM selection available')
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, { startIndex, endIndex })
}

const saveAndCheck = async(expected: string): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => fs.readFileSync(filePath, 'utf-8')).toBe(expected)
}

const runInSource = async(
  markdown: string,
  anchor: SourcePosition,
  focus: SourcePosition
): Promise<IndentRunResult> => {
  await setSourceMarkdown(page, app, markdown)
  // setSourceMarkdown deliberately returns to WYSIWYG. Enter once more through
  // the normal menu path so this run performs the edit in CodeMirror itself.
  await enterSourceMode(page, app)
  await selectSource(anchor, focus)
  await page.keyboard.press('Tab')
  const indented = await readSourceMarkdown()
  await saveAndCheck(indented)
  await page.keyboard.press('Shift+Tab')
  const outdented = await readSourceMarkdown()
  await saveAndCheck(outdented)
  return { indented, outdented }
}

const runInWysiwyg = async(
  markdown: string,
  startLeaf: number,
  endLeaf: number
): Promise<IndentRunResult> => {
  await setSourceMarkdown(page, app, markdown)
  await selectWysiwygLeaves(startLeaf, endLeaf)
  await page.keyboard.press('Tab')
  const indented = await getMarkdownContent(page, app)
  await saveAndCheck(indented)
  await page.keyboard.press('Shift+Tab')
  const outdented = await getMarkdownContent(page, app)
  await saveAndCheck(outdented)
  return { indented, outdented }
}

test.describe('selected-line Tab/Shift+Tab source and WYSIWYG parity', () => {
  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('seed\n')
    app = launched.app
    page = launched.page
    filePath = launched.filePath
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('ordinary text lines indent by tabSize and outdent to the original bytes', async() => {
    const markdown = 'alpha\nbravo\n'
    const source = await runInSource(markdown, { line: 0, ch: 0 }, { line: 1, ch: 5 })
    const wysiwyg = await runInWysiwyg(markdown, 0, 0)

    expect(source.indented).toBe('    alpha\n    bravo\n')
    expect(source.outdented).toBe(markdown)
    expect(wysiwyg).toEqual(source)
  })

  test('a selected bullet item nests and outdents identically in both modes', async() => {
    const markdown = '- alpha\n- bravo\n'
    const source = await runInSource(markdown, { line: 1, ch: 2 }, { line: 1, ch: 7 })
    const wysiwyg = await runInWysiwyg(markdown, 1, 1)

    expect(source.indented).toBe('- alpha\n  - bravo\n')
    expect(source.outdented).toBe(markdown)
    expect(wysiwyg).toEqual(source)
  })

  test('a first-child-to-parent selection moves only selected rows and saves identical bytes', async() => {
    const markdown = '- metrics\n  - first child\n  - second child\n- config\n  - config child\n- analysis\n'
    const source = await runInSource(markdown, { line: 1, ch: 4 }, { line: 3, ch: 8 })
    const wysiwyg = await runInWysiwyg(markdown, 1, 3)

    expect(source.indented).toBe(
      '- metrics\n    - first child\n    - second child\n  - config\n  - config child\n- analysis\n'
    )
    expect(source.outdented).toBe(markdown)
    expect(wysiwyg).toEqual(source)
  })

  for (const { name, markdown, indented } of [
    {
      name: 'bullet',
      markdown: '- root\n- parent\n  - child\n    - grandchild\n- end\n',
      indented: '- root\n  - parent\n  - child\n    - grandchild\n- end\n'
    },
    {
      name: 'ordered',
      markdown: '1. root\n2. parent\n   1. child\n      1. grandchild\n3. end\n',
      indented: '1. root\n   1. parent\n   1. child\n      1. grandchild\n3. end\n'
    },
    {
      name: 'task',
      markdown: '- [ ] root\n- [ ] parent\n  - [x] child\n    - [ ] grandchild\n- [ ] end\n',
      indented: '- [ ] root\n  - [ ] parent\n  - [x] child\n    - [ ] grandchild\n- [ ] end\n'
    }
  ]) {
    test(`${name}: selecting only a parent leaves unselected descendants unchanged`, async() => {
      const source = await runInSource(markdown, { line: 1, ch: 2 }, { line: 1, ch: markdown.split('\n')[1].length })
      const wysiwyg = await runInWysiwyg(markdown, 1, 1)

      expect(source.indented).toBe(indented)
      expect(source.indented.split('\n').slice(2)).toEqual(markdown.split('\n').slice(2))
      expect(source.outdented).toBe(markdown)
      expect(wysiwyg).toEqual(source)
    })
  }

  test('unselected descendants keep their positions after saving and reopening', async() => {
    const markdown = '- metrics\n  - first child\n  - second child\n- config\n  - config child\n    - grandchild\n- analysis\n'
    const indented = '- metrics\n    - first child\n    - second child\n  - config\n  - config child\n    - grandchild\n- analysis\n'
    await setSourceMarkdown(page, app, markdown)
    const rowX = () => page.locator('.mu-paragraph-content').evaluateAll(leaves =>
      leaves.map(leaf => leaf.getBoundingClientRect().x)
    )
    const before = await rowX()
    await selectWysiwygLeaves(1, 3)
    await page.keyboard.press('Tab')
    expect(await getMarkdownContent(page, app)).toBe(indented)
    await saveAndCheck(indented)
    const after = await rowX()
    for (let row = 0; row < before.length; row++) {
      expect(after[row] - before[row]).toBeCloseTo(row >= 1 && row <= 3 ? 30 : 0, 1)
    }

    await app.close()
    const reopened = await launchElectron([filePath])
    app = reopened.app
    page = reopened.page
    await waitForEditor(page)
    await waitForMenuReady(app)
    expect(await getMarkdownContent(page, app)).toBe(indented)
    expect(await rowX()).toEqual(after)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(indented)
  })

  test('a cross-block selection reaches the shared handler without losing the range', async() => {
    const markdown = '# alpha\nbravo\n'
    const source = await runInSource(markdown, { line: 0, ch: 0 }, { line: 1, ch: 5 })
    const wysiwyg = await runInWysiwyg(markdown, 0, 1)

    expect(source.indented).toBe('    # alpha\n    bravo\n')
    expect(source.outdented).toBe(markdown)
    expect(wysiwyg).toEqual(source)
  })
})
