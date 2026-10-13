import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  closeTestApplication, launchElectron, launchWithMarkdown, placeCaretInEditor,
  saveWithKeyboard, terminateTestApplication, waitForEditor
} from './helpers'

const cases = [
  { name: 'empty document', prefix: '', lang: '', manual: false },
  { name: 'after a paragraph newline', prefix: 'before\n', lang: '', manual: false },
  { name: 'language picker after a blank line', prefix: 'before\n\n', lang: 'js', manual: false },
  { name: 'manually completed fences', prefix: 'before\n', lang: '', manual: true }
]

// Both Enter conversion and manual fence completion must accept immediate
// typing, then survive the desktop save/import path with separate fence lines.
for (const scenario of cases) {
  test(`code block typing: ${scenario.name} saves and reopens`, async() => {
    const launched = await launchWithMarkdown('')
    let { app, page } = launched
    const { filePath } = launched
    try {
      await placeCaretInEditor(page)
      if (scenario.prefix) {
        await page.keyboard.type('before', { delay: 30 })
        for (const _ of scenario.prefix.match(/\n/g) ?? []) await page.keyboard.press('Enter')
      }
      await page.keyboard.type(`\`\`\`${scenario.lang}`, { delay: 30 })
      if (scenario.manual) {
        await page.keyboard.press('Shift+Enter')
        await page.keyboard.press('Shift+Enter')
        await page.keyboard.type('```', { delay: 30 })
      } else {
        await page.keyboard.press('Enter')
      }

      const code = page.locator('.mu-codeblock-content')
      await expect(code).toHaveCount(1)
      await page.keyboard.type('first line', { delay: 30 })
      await page.keyboard.press('Enter')
      await page.keyboard.type('second line', { delay: 30 })
      await expect(code).toHaveText('first line\nsecond line')
      await expect(page.locator('.mu-language-input')).toHaveText(scenario.lang)

      const expected = `${scenario.prefix}\`\`\`${scenario.lang}\nfirst line\nsecond line\n\`\`\`\n`
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(expected)
      await page.screenshot({ path: test.info().outputPath('typed-code-block.png') })

      await closeTestApplication(app)
      const reopened = await launchElectron([filePath])
      app = reopened.app
      page = reopened.page
      await waitForEditor(page)
      await expect(page.locator('.mu-codeblock-content')).toHaveText('first line\nsecond line')
      await expect(page.locator('.mu-language-input')).toHaveText(scenario.lang)
      expect(fs.readFileSync(filePath, 'utf8')).toBe(expected)
      await closeTestApplication(app)
    } catch (error) {
      terminateTestApplication(app)
      throw error
    }
  })
}
