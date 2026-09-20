import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchElectron, waitForEditor, waitForMenuReady, clickMenuById, sendIpcToRenderer,
  saveWithKeyboard, closeTestApplication, terminateTestApplication, placeCaretInEditor
} from './helpers'
import { clickViaMain } from './mainProcessInput'

// Ordinary file cases share a window; only the relaunch regression restarts it.
test.describe.configure({ mode: 'serial' })
let app: ElectronApplication
let page: Page
let running = false
let dir: string

test.beforeAll(async() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-text-'))
  ;({ app, page } = await launchElectron())
  running = true
  await waitForEditor(page)
  await waitForMenuReady(app)
})

test.afterEach(async() => {
  const testInfo = test.info()
  if (running && testInfo.status !== testInfo.expectedStatus) {
    // Preserve the assertion failure instead of waiting on a save dialog.
    terminateTestApplication(app)
    running = false
  }
})

test.afterAll(async() => {
  try {
    if (running) await closeTestApplication(app)
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const openFiles = async(...files: string[]) => {
  await page.evaluate(files => window.electron.ipcRenderer.send('mt::window::drop', files), files)
}

const expectBlankTitle = async() => {
  await expect(page).toHaveTitle('MarkText')
  await expect(page.locator('.title-bar .title')).toHaveText('MarkText')
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getTitle()
  )).toBe('MarkText')
}

test('icon launch defaults to a blank document', async() => {
  await waitForEditor(page)
  const profile = await app.evaluate(({ app }) => app.getPath('userData'))
  const preferences = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'))
  expect(preferences.startUpAction).toBe('blank')
  await expect(page.locator('.editor-component')).toHaveText('')
  await expectBlankTitle()
  await page.screenshot({ path: test.info().outputPath('blank-startup.png') })
})

test('an untitled document name appears after typing and clears on undo', async() => {
  await placeCaretInEditor(page)
  await page.keyboard.type('x')
  await expect(page).toHaveTitle('Untitled-1')
  await expect(page.locator('.title-bar .filename')).toHaveText('Untitled-1')
  await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
  await expect(page.locator('.editor-component')).toHaveText('')
  await expectBlankTitle()
})

for (const ext of ['sql', 'txt', 'json']) {
  test(`${ext} opens as plain text and saves without Markdown rewriting`, async() => {
    const file = path.join(dir, `sample.${ext}`)
    const original = '-- sample\nSELECT a_b, c_d FROM records;\n\n# literal heading\n  trailing spaces  \n\n\n'
    fs.writeFileSync(file, original)
    await openFiles(file)
    await waitForMenuReady(app)
    await expect(page).toHaveTitle(`sample.${ext}`)
    await expect(page.locator('.title-bar .filename')).toHaveText(`sample.${ext}`)
    await expect(page.locator('.source-code .CodeMirror')).toBeVisible()
    const read = () => page.evaluate(() => {
      const cm = (document.querySelector('.source-code .CodeMirror') as Element & { CodeMirror: { getValue(): string; getOption(name: string): string } }).CodeMirror
      return { value: cm.getValue(), mode: cm.getOption('mode') }
    })
    await expect.poll(read).toEqual({ value: original, mode: 'text/plain' })
    await clickMenuById(app, 'sourceCodeModeMenuItem')
    await expect(page.locator('.source-code .CodeMirror')).toBeVisible()
    // The window is never activated during a run, so the click has to be
    // injected by the main process; `app.focus({ steal: true })` would take the
    // keyboard away from whoever is using the machine.
    await clickViaMain(app, page, '.source-code .CodeMirror')
    await page.keyboard.press('Control+Home')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
    await page.keyboard.type('PREFIX ')
    await expect.poll(read).toEqual({ value: 'PREFIX ' + original, mode: 'text/plain' })
    await saveWithKeyboard(app)
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('PREFIX ' + original)
    await page.screenshot({ path: test.info().outputPath(`${ext}-plain-text.png`) })
  })
}

test('text tabs survive switching to Markdown and receive external reloads', async() => {
  const file = path.join(dir, 'query.sql')
  const markdownFile = path.join(dir, 'note.md')
  const original = 'SELECT a_b FROM table_name;\n'
  fs.writeFileSync(file, original)
  fs.writeFileSync(markdownFile, '# Markdown document\n')
  await openFiles(file, markdownFile)
  await waitForMenuReady(app)
  if (!await page.locator('.editor-tabs').isVisible()) await clickMenuById(app, 'tabBarMenuItem')
  const sqlTab = page.locator('.tabs-container > li').filter({ hasText: 'query.sql' })
  const mdTab = page.locator('.tabs-container > li').filter({ hasText: 'note.md' })
  await sqlTab.click({ timeout: 5000 })
  await expect(page.locator('.source-code .CodeMirror')).toBeVisible()
  await clickViaMain(app, page, '.source-code .CodeMirror')
  // CodeMirror swallows the first keystroke that arrives while it is still
  // taking focus from the injected click, so let it settle before typing.
  await page.waitForTimeout(300)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
  await page.waitForTimeout(150)
  await page.keyboard.type('-- edited\n', { delay: 20 })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const cm = (document.querySelector('.source-code .CodeMirror') as
          Element & { CodeMirror: { getValue(): string } }).CodeMirror
        return cm.getValue()
      })
    )
    .toBe('-- edited\n' + original)
  await saveWithKeyboard(app)
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('-- edited\n' + original)
  await mdTab.click({ timeout: 5000 })
  await expect(page.locator('.source-code')).toHaveCount(0)
  await expect(page.locator('.editor-component')).toContainText('Markdown document')
  await sqlTab.click({ timeout: 5000 })
  await expect(page.locator('.source-code .CodeMirror')).toBeVisible()
  await sendIpcToRenderer(app, 'mt::user-preference', { autoSave: true })
  const updated = 'SELECT updated_column FROM table_name;\n\n\n'
  fs.writeFileSync(file, updated)
  await expect.poll(() => page.evaluate(() => {
    const cm = (document.querySelector('.source-code .CodeMirror') as
      Element & { CodeMirror: { getValue(): string } }).CodeMirror
    return cm.getValue()
  })).toBe(updated)
  await saveWithKeyboard(app)
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(updated)
  await expect(page.locator('.tabs-container > li.unsaved')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('text-reload-saved.png') })
  await sendIpcToRenderer(app, 'mt::user-preference', { autoSave: false })
})

test('Finder open-file and drag-and-drop accept text documents', async() => {
  test.skip(process.platform !== 'darwin', 'Finder uses the macOS open-file event')
  const sqlFile = path.join(dir, 'finder.sql')
  const textFile = path.join(dir, 'dropped.txt')
  fs.writeFileSync(sqlFile, 'SELECT finder_column;\n')
  fs.writeFileSync(textFile, '# Literal text\n')
  await app.evaluate(({ app }, file) => {
    app.emit('open-file', { preventDefault() {} }, file)
  }, sqlFile)
  await expect(page.locator('.source-code .CodeMirror')).toContainText('SELECT finder_column;')
  await page.evaluate(file => window.electron.ipcRenderer.send('mt::window::drop', [file]), textFile)
  await expect(page.locator('.source-code .CodeMirror')).toContainText('# Literal text')
})

test('relaunch ignores recently opened documents and opens a blank page', async() => {
  const file = path.join(dir, 'previous.md')
  fs.writeFileSync(file, '# Previous document\n')
  await openFiles(file)
  await expect(page.locator('.editor-component')).toContainText('Previous document')
  const profile = await app.evaluate(({ app }) => app.getPath('userData'))
  // A blocked normal quit must fail the regression, even though cleanup kills it.
  try {
    await closeTestApplication(app)
  } finally {
    running = false
  }
  ;({ app, page } = await launchElectron(['--user-data-dir', profile]))
  running = true
  await waitForEditor(page)
  await expect(page.locator('.editor-component')).toHaveText('')
  await expectBlankTitle()
  await page.screenshot({ path: test.info().outputPath('blank-relaunch-title.png') })
})

test('an empty saved file still shows its real filename', async() => {
  const file = path.join(dir, 'empty.md')
  fs.writeFileSync(file, '')
  await openFiles(file)
  await expect(page.locator('.editor-component')).toHaveText('')
  await expect(page).toHaveTitle('empty.md')
  await expect(page.locator('.title-bar .filename')).toHaveText('empty.md')
  await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '')
  await expectBlankTitle()
})
