import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  waitForMenuReady,
  placeCaretAtOffset,
  expectNoRendererErrors
} from './helpers'
import { clickPointViaMain } from './mainProcessInput'
import { closeTestApplication } from './appLifecycle'

// Clicking a task-list checkbox used to yank the viewport back to the caret.
//
// The checkbox is an `input[type=checkbox]` with `contenteditable="false"`
// inside the document, so toggling it fires a DOM `input` event that bubbles to
// the editor root. The engine routed every `input` to the block owning the
// caret, which re-ran `setCursor` there and emitted `selection-change` with the
// caret's coords. This component treats that event as "the caret moved" and
// scrolls it back into view (the #628 / #3329 keep-cursor-visible branches
// below `editor.value.on('selection-change')`), so checking a box while the
// caret sat far off-screen scrolled the document to the caret.
//
// The engine-side contract is pinned in
// packages/muya/e2e/tests/blocks/task-checkbox-widget-input.spec.ts (no
// `selection-change` on a checkbox click) and in
// packages/muya/src/editor/__tests__/widgetInputRouting.spec.ts. This spec owns
// the user-visible half: the scroll position must not move.

// A task list at the very bottom of a document long enough to scroll.
const filler = Array.from({ length: 60 }, (_, i) => `paragraph number ${i}`).join('\n\n')
const MARKDOWN = `caret stays here\n\n${filler}\n\n- [ ] buy milk\n- [ ] ship it\n`

const scrollState = async(
  page: Page
): Promise<{ scrollTop: number; checkboxX: number; checkboxY: number }> =>
  page.evaluate(() => {
    const container = document.querySelector('.editor-component') as HTMLElement
    const box = document.querySelectorAll<HTMLInputElement>(
      '.editor-component input[type=checkbox]'
    )[0].getBoundingClientRect()
    return {
      scrollTop: Math.round(container.scrollTop),
      checkboxX: Math.round(box.x + box.width / 2),
      checkboxY: Math.round(box.y + box.height / 2)
    }
  })

const isChecked = async(page: Page, index: number): Promise<boolean> =>
  page.evaluate((i) => {
    const inputs = document.querySelectorAll<HTMLInputElement>(
      '.editor-component input[type=checkbox]'
    )
    return !!inputs[i]?.checked
  }, index)

test.describe('task-list checkbox click does not scroll to the caret', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(MARKDOWN, { suppressErrorDialog: true })
    app = launched.app
    page = launched.page
    await waitForMenuReady(app)
  })

  test.afterAll(async() => {
    await closeTestApplication(app)
  })

  test('checking a box far below the caret keeps the scroll position', async() => {
    // Caret in the first paragraph, at the top of the document.
    await placeCaretAtOffset(page, 3, 0)

    // Scroll the checkbox to the middle of the viewport, leaving the caret far
    // off-screen above it.
    await page.evaluate(() => {
      document.querySelectorAll('.editor-component input[type=checkbox]')[0]
        .scrollIntoView({ block: 'center' })
    })
    await page.waitForTimeout(200)

    const before = await scrollState(page)
    const caretY = await page.evaluate(() => {
      const selection = document.getSelection()
      const rect = selection?.rangeCount
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null
      return rect ? Math.round(rect.y) : null
    })
    // Precondition: the caret really is off-screen, so a scroll-to-caret would
    // be a large, visible jump.
    expect(caretY ?? 0).toBeLessThan(-500)
    expect(before.checkboxY).toBeGreaterThan(100)

    await clickPointViaMain(app, page, { x: before.checkboxX, y: before.checkboxY })
    await page.waitForTimeout(400)

    // The box toggled ...
    await expect.poll(() => isChecked(page, 0)).toBe(true)
    // ... and the viewport stayed where the user left it.
    const after = await scrollState(page)
    expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(2)

    await expectNoRendererErrors(app)
  })
})
