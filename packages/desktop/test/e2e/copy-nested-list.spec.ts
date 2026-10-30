import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeTestApplication, launchWithMarkdown, saveWithKeyboard, terminateTestApplication
} from './helpers'

const firstItem = '所有case重新标一下理由：明确怎么写理由；买了的话写在哪里买的；'
const nestedItems = ['晚上标注，明天早上回收', '记不清就不标注']
const middleItem = '人&id映射关系收集'
const lastItem = '如果看完这个品，只是决定不买这个品，需求还在进行，那么记为 L3；如果看完这个品，需求终止了，那么记为L2'
const destination = '粘贴位置'
const listMarkdown = [
  `- ${firstItem}`,
  ...nestedItems.map(text => `  - ${text}`),
  `- ${middleItem}`,
  `- ${lastItem}`
].join('\n') + '\n'
const prefix = `TODO:\n\n${listMarkdown}\n## 需求终止：有了控件行为，后续多天都没成交（根据后续行为）\n\n`
const documentMarkdown = `${prefix}${destination}\n`

const selectText = async(
  page: Page,
  startText: string,
  endText: string,
  backward = false
): Promise<void> => {
  await page.evaluate(({ startText, endText, backward }) => {
    const root = document.querySelector<HTMLElement>('.editor-component')
    const selection = window.getSelection()
    if (!root || !selection) throw new Error('No editor selection is available')
    root.focus()
    const contents = Array.from(root.querySelectorAll('span.mu-paragraph-content'))
    const point = (text: string, atEnd: boolean): { node: Node; offset: number } => {
      const content = contents.find(el => el.textContent?.includes(text))
      if (!content) throw new Error(`Missing paragraph: ${text}`)
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      let offset = (content.textContent ?? '').indexOf(text) + (atEnd ? text.length : 0)
      while (node) {
        const length = node.textContent?.length ?? 0
        if (offset <= length) return { node, offset }
        offset -= length
        node = walker.nextNode()
      }
      throw new Error(`Missing text offset for: ${text}`)
    }
    const start = point(startText, false)
    const end = point(endText, true)
    const [anchor, focus] = backward ? [end, start] : [start, end]
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
    document.dispatchEvent(new Event('selectionchange'))
    root.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }))
  }, { startText, endText, backward })

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toContain(startText)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toContain(endText)
}

const clickEditMenu = async(app: ElectronApplication, command: 'Copy' | 'Paste'): Promise<void> => {
  await app.evaluate(({ Menu, BrowserWindow }, command) => {
    const menu = Menu.getApplicationMenu()
    const edit = menu?.items.find(item => item.label.replace(/&/g, '') === 'Edit')
    const item = edit?.submenu?.items.find(item => item.label.replace(/&/g, '') === command)
    const win = BrowserWindow.getAllWindows()[0]
    if (!item || !win) throw new Error(`Missing Edit > ${command} command or test window`)
    item.click(undefined, win, win.webContents)
  }, command)
}

for (const backward of [false, true]) {
  test(`${backward ? 'backward' : 'forward'} nested-list selection copies every item through the Copy menu`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(documentMarkdown)
    try {
      await expect(page.locator('.editor-component li')).toHaveCount(5)
      await selectText(page, firstItem, lastItem, backward)
      const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
      for (const text of [...nestedItems, middleItem]) expect(selected).toContain(text)
      await page.screenshot({ path: test.info().outputPath('selected-nested-list.png') })

      await app.evaluate(({ clipboard }) => clipboard.writeText('before-nested-list-copy'))
      await clickEditMenu(app, 'Copy')
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(listMarkdown)
      await expect(page.locator('.editor-component li')).toHaveCount(5)

      await selectText(page, destination, destination)
      await clickEditMenu(app, 'Paste')
      await expect(page.locator('.editor-component li')).toHaveCount(10)
      await expect(page.locator('.editor-component li li')).toHaveCount(4)
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(`${prefix}${listMarkdown}`)
      await closeTestApplication(app)
    } catch (error) {
      terminateTestApplication(app)
      throw error
    }
  })
}
