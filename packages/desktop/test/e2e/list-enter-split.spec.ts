import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import {
  closeTestApplication, launchElectron, launchWithMarkdown, saveWithKeyboard,
  sendIpcToRenderer, terminateTestApplication, waitForEditor, ZERO_WIDTH_SPACE
} from './helpers'
import { clickViaMain } from './mainProcessInput'

const lists = [
  { name: 'bullet', selector: '.mu-bullet-list', markers: ['-', '-', '-'], child: '  - child\n' },
  { name: 'ordered', selector: '.mu-order-list', markers: ['1.', '2.', '3.'], child: '   1. child\n' },
  { name: 'task', selector: '.mu-task-list', markers: ['- [ ]', '- [ ]', '- [ ]'], child: '  - [ ] child\n' }
]

const rows = (page: Page, selector: string) => page.locator(selector).first().evaluate((list, zwsp) =>
  Array.from(list.children).map(item => ({
    text: item.querySelector('.mu-paragraph-content')?.textContent?.split(zwsp).join(''),
    childLists: item.querySelectorAll('ul, ol').length
  })), ZERO_WIDTH_SPACE
)

for (const { name, selector, markers, child } of lists) {
  for (const target of ['alpha', 'beta']) {
    test(`${name}: Enter at ${target} row start preserves list structure through save and reopen`, async() => {
      const markdown = `${markers[0]} alpha\n${child}${markers[1]} beta\n`
      const launched = await launchWithMarkdown(markdown)
      let { app, page } = launched
      const { filePath } = launched
      try {
        await clickViaMain(app, page, '.mu-paragraph-content', {
          nth: target === 'alpha' ? 0 : 2,
          position: { x: 4, y: 5 }
        })
        await page.keyboard.press('Home')
        await page.keyboard.press('Enter')

        const empty = { text: '', childLists: 0 }
        const alpha = { text: 'alpha', childLists: 1 }
        const beta = { text: 'beta', childLists: 0 }
        const expectedRows = target === 'alpha' ? [empty, alpha, beta] : [alpha, empty, beta]
        await expect.poll(() => rows(page, selector)).toEqual(expectedRows)
        await page.screenshot({ path: test.info().outputPath('after-enter.png') })

        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await expect.poll(() => rows(page, selector)).toEqual([alpha, beta])
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
        await expect.poll(() => rows(page, selector)).toEqual(expectedRows)
        await page.keyboard.type('Z')
        const expected = (target === 'alpha'
          ? `${markers[0]} \n${markers[1]} alpha\n${child}${markers[2]} beta\n`
          : `${markers[0]} alpha\n${child}${markers[1]} \n${markers[2]} beta\n`
        ).replace(target, `Z${target}`)
        await saveWithKeyboard(app)
        await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(expected)
        await closeTestApplication(app)

        const reopened = await launchElectron([filePath])
        app = reopened.app
        page = reopened.page
        await waitForEditor(page)
        await expect.poll(() => rows(page, selector)).toEqual(expectedRows.map(row => ({
          ...row, text: row.text === target ? `Z${target}` : row.text
        })))
        expect(fs.readFileSync(filePath, 'utf8')).toBe(expected)
        await closeTestApplication(app)
      } catch (error) {
        terminateTestApplication(app)
        throw error
      }
    })
  }
}
