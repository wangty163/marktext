import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication } from 'playwright'
import { launchElectron, waitForEditor, waitForMenuReady, clickMenuById, sendIpcToRenderer } from './helpers'

// CDP keyboard events do not invoke macOS application-menu accelerators.
// Send native Electron input so Cmd/Ctrl+S follows the installed menu path.
const saveWithKeyboard = async(app: ElectronApplication) => {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const modifiers: ('meta' | 'control')[] = [process.platform === 'darwin' ? 'meta' : 'control']
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers })
  })
}

test('icon launch defaults to a blank document', async() => {
  const { app, page } = await launchElectron()
  try {
    await waitForEditor(page)
    const profile = await app.evaluate(({ app }) => app.getPath('userData'))
    const preferences = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'))
    expect(preferences.startUpAction).toBe('blank')
    await expect(page.locator('.editor-component')).toHaveText('')
    await page.screenshot({ path: test.info().outputPath('blank-startup.png') })
  } finally {
    await app.close()
  }
})

for (const ext of ['sql', 'txt', 'json']) {
  test(`${ext} opens as plain text and saves without Markdown rewriting`, async() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-text-'))
    const file = path.join(dir, `sample.${ext}`)
    const original = '-- sample\nSELECT a_b, c_d FROM records;\n\n# literal heading\n  trailing spaces  \n\n\n'
    fs.writeFileSync(file, original)
    const { app, page } = await launchElectron([file])
    try {
      await waitForMenuReady(app)
      await expect(page.locator('.source-code .CodeMirror')).toBeVisible()
      const read = () => page.evaluate(() => {
        const cm = (document.querySelector('.source-code .CodeMirror') as Element & { CodeMirror: { getValue(): string; getOption(name: string): string } }).CodeMirror
        return { value: cm.getValue(), mode: cm.getOption('mode') }
      })
      await expect.poll(read).toEqual({ value: original, mode: 'text/plain' })
      await clickMenuById(app, 'sourceCodeModeMenuItem')
      await expect(page.locator('.source-code .CodeMirror')).toBeVisible()
      await app.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true })
        BrowserWindow.getAllWindows()[0].focus()
      })
      await page.locator('.source-code .CodeMirror').click()
      await page.keyboard.press('Control+Home')
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
      await page.keyboard.type('PREFIX ')
      await expect.poll(read).toEqual({ value: 'PREFIX ' + original, mode: 'text/plain' })
      await saveWithKeyboard(app)
      await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('PREFIX ' + original)
      await page.screenshot({ path: test.info().outputPath(`${ext}-plain-text.png`) })
    } catch (error) {
      await page.screenshot({ path: test.info().outputPath('failure.png') })
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy()))
      throw error
    } finally {
      await app.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('relaunch ignores recently opened documents and opens a blank page', async() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-startup-'))
  const file = path.join(dir, 'previous.md')
  fs.writeFileSync(file, '# Previous document\n')
  const first = await launchElectron([file])
  let profile = ''
  try {
    await waitForEditor(first.page)
    await expect(first.page.locator('.editor-component')).toContainText('Previous document')
    profile = await first.app.evaluate(({ app }) => app.getPath('userData'))
  } finally {
    await first.app.close()
  }
  const second = await launchElectron(['--user-data-dir', profile])
  try {
    await waitForEditor(second.page)
    await expect(second.page.locator('.editor-component')).toHaveText('')
    await expect(second.page).not.toHaveTitle(/previous/)
  } finally {
    await second.app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('text tabs survive switching to Markdown and receive external reloads', async() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-text-tabs-'))
  const file = path.join(dir, 'query.sql')
  const markdownFile = path.join(dir, 'note.md')
  const original = 'SELECT a_b FROM table_name;\n'
  fs.writeFileSync(file, original)
  fs.writeFileSync(markdownFile, '# Markdown document\n')
  const { app, page } = await launchElectron([file, markdownFile])
  try {
    await waitForMenuReady(app)
    if (!await page.locator('.editor-tabs').isVisible()) await clickMenuById(app, 'tabBarMenuItem')
    const sqlTab = page.locator('.tabs-container > li').filter({ hasText: 'query.sql' })
    const mdTab = page.locator('.tabs-container > li').filter({ hasText: 'note.md' })
    await sqlTab.click({ timeout: 5000 })
    await expect(page.locator('.source-code .CodeMirror')).toBeVisible()
    await app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true })
      BrowserWindow.getAllWindows()[0].focus()
    })
    await page.locator('.source-code .CodeMirror').click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
    await page.keyboard.type('-- edited\n')
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
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('failure.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy()))
    throw error
  } finally {
    await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Finder open-file and drag-and-drop accept text documents', async() => {
  test.skip(process.platform !== 'darwin', 'Finder uses the macOS open-file event')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-open-text-'))
  const sqlFile = path.join(dir, 'finder.sql')
  const textFile = path.join(dir, 'dropped.txt')
  fs.writeFileSync(sqlFile, 'SELECT finder_column;\n')
  fs.writeFileSync(textFile, '# Literal text\n')
  const { app, page } = await launchElectron()
  try {
    await waitForEditor(page)
    await app.evaluate(({ app }, file) => {
      app.emit('open-file', { preventDefault() {} }, file)
    }, sqlFile)
    await expect(page.locator('.source-code .CodeMirror')).toContainText('SELECT finder_column;')
    await page.evaluate(file => window.electron.ipcRenderer.send('mt::window::drop', [file]), textFile)
    await expect(page.locator('.source-code .CodeMirror')).toContainText('# Literal text')
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('failure.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy()))
    throw error
  } finally {
    await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
