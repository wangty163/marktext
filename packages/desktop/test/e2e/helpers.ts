import { expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { trackTestApplication, terminateTestApplication } from './appLifecycle'

export { closeTestApplication, terminateTestApplication } from './appLifecycle'

const projectRoot = path.resolve(__dirname, '../..')

const getDateAsFilename = (): string => {
  const date = new Date()
  return '' + date.getFullYear() + (date.getMonth() + 1) + date.getDate()
}

const getTempPath = (suffix = ''): string => {
  const name =
    'marktext-e2etest-' +
    getDateAsFilename() +
    '-' +
    Math.random().toString(36).slice(2, 8) +
    suffix
  return path.join(os.tmpdir(), name)
}

export const getElectronPath = (): string => {
  if (process.platform === 'win32') {
    return path.resolve(path.join('node_modules', '.bin', 'electron.cmd'))
  }
  const pathTxt = path.join(projectRoot, 'node_modules/electron/path.txt')
  const relPath = fs.readFileSync(pathTxt, 'utf-8').trim()
  return path.join(projectRoot, 'node_modules/electron/dist', relPath)
}

// Track every temp directory we create so we can sweep them on process exit
// (Playwright workers persist across specs but die when the run ends).
const createdTempDirs = new Set<string>()
const trackTempDir = (dir: string): string => {
  createdTempDirs.add(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of createdTempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

export interface LaunchResult {
  app: ElectronApplication
  page: Page
}

export interface LaunchOptions {
  // When true, sets MARKTEXT_ERROR_INTERACTION=1 in the launch env so
  // src/main/exceptionHandler.ts suppresses the modal "Unexpected error"
  // dialog. Only crash-guard specs that explicitly call expectNoRendererErrors
  // should opt in — otherwise existing specs would silently ignore renderer
  // exceptions that previously surfaced as a dialog (a hidden regression risk).
  suppressErrorDialog?: boolean
  // Playwright cannot run Electron headless, so by default the window is parked
  // off-screen and shown inactive: the renderer still paints (layout,
  // screenshots and caret geometry stay real) while the run never takes focus
  // away from whoever is using the machine. Specs that must verify real window
  // activation opt out explicitly.
  visibleWindow?: boolean
  // Variables that override the inherited environment of the app process.
  env?: Record<string, string>
}

export const launchElectron = async(
  userArgs?: string[],
  options: LaunchOptions = {}
): Promise<LaunchResult> => {
  userArgs = userArgs || []
  const externalExecutable = process.env.MARKTEXT_E2E_EXECUTABLE
  const executablePath = externalExecutable ? path.resolve(externalExecutable) : getElectronPath()
  if (externalExecutable && !fs.existsSync(executablePath)) {
    throw new Error(`MARKTEXT_E2E_EXECUTABLE does not exist: ${executablePath}`)
  }
  // Pass project root as entry so Electron reads package.json and getAppPath() returns project root.
  // Passing out/main/index.js directly bypasses package.json and breaks __static path resolution.
  const userDataDir = trackTempDir(getTempPath())
  // Pin the UI language. Since first-start detection follows the system locale
  // (#5131), a fresh `--user-data-dir` would otherwise boot this suite in
  // whatever language the machine runs — every assertion on menu labels,
  // placeholders or the title-bar counter would depend on the host. `--lang` is
  // Chromium's own override for `app.getLocale()`, which is what the detector
  // reads, so no product code needs a test-only branch.
  const args = (externalExecutable
    ? ['--user-data-dir', userDataDir]
    : [projectRoot, '--user-data-dir', userDataDir]
  ).concat(['--lang=en'], userArgs)
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env.PERF_TESTING = 'true'
  if (!options.visibleWindow) env.MARKTEXT_E2E_UNOBTRUSIVE = '1'
  if (options.suppressErrorDialog) env.MARKTEXT_ERROR_INTERACTION = '1'
  Object.assign(env, options.env)
  const app = await _electron.launch({
    executablePath,
    args,
    cwd: projectRoot,
    env,
    timeout: 30000
  })
  trackTestApplication(app)
  try {
    if (options.suppressErrorDialog) await installRendererErrorCounter(app)
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { app, page }
  } catch (error) {
    try {
      terminateTestApplication(app)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Electron test setup and cleanup both failed')
    }
    throw error
  }
}

// Capture renderer-process errors that would otherwise pop the "Unexpected
// error" dialog. We attach a parallel listener to the same IPC channel
// (`mt::handle-renderer-error`) that exceptionHandler.ts listens on, and
// accumulate the count in a shared global so specs can read it back via
// `getRendererErrors`. Multiple listeners are allowed on ipcMain.
const installRendererErrorCounter = async(app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ ipcMain }) => {
    const g = global as unknown as {
      __mt_renderer_errors__?: Array<{ message?: string; name?: string; stack?: string }>
    }
    if (!g.__mt_renderer_errors__) {
      const sink: Array<{ message?: string; name?: string; stack?: string }> = []
      g.__mt_renderer_errors__ = sink
      ipcMain.on('mt::handle-renderer-error', (_e, error) => {
        sink.push(error)
      })
    }
  })
}

export const getRendererErrors = async(
  app: ElectronApplication
): Promise<Array<{ message?: string; name?: string; stack?: string }>> => {
  return await app.evaluate(() => {
    const g = global as unknown as {
      __mt_renderer_errors__?: Array<{ message?: string; name?: string; stack?: string }>
    }
    return (g.__mt_renderer_errors__ || []).slice()
  })
}

export const clearRendererErrors = async(app: ElectronApplication): Promise<void> => {
  await app.evaluate(() => {
    const g = global as unknown as {
      __mt_renderer_errors__?: Array<unknown>
    }
    if (g.__mt_renderer_errors__) g.__mt_renderer_errors__.length = 0
  })
}

// Assert that no renderer-process error has been captured since the last clear.
// On failure, prints the captured stacks so the spec output is actionable.
export const expectNoRendererErrors = async(app: ElectronApplication): Promise<void> => {
  const errors = await getRendererErrors(app)
  if (errors.length > 0) {
    const summary = errors.map((e) => `- ${e.name ?? 'Error'}: ${e.message}\n${e.stack ?? ''}`).join('\n\n')
    throw new Error(`Expected no renderer errors, captured ${errors.length}:\n\n${summary}`)
  }
  expect(errors.length).toBe(0)
}

// Poll until a renderer error matching `predicate` is captured (or timeout).
// Prefer this over a fixed `waitForTimeout` when waiting for an error to
// surface — IPC delivery time varies on slower CI runners.
export const waitForRendererError = async(
  app: ElectronApplication,
  predicate: (e: { message?: string; name?: string; stack?: string }) => boolean,
  timeoutMs = 5000,
  pollMs = 50
): Promise<{ message?: string; name?: string; stack?: string } | null> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const errors = await getRendererErrors(app)
    const match = errors.find(predicate)
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return null
}

export const waitForMenuReady = async(
  app: ElectronApplication,
  timeout = 10000
): Promise<void> => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const ready = await app.evaluate(({ Menu }) => !!Menu.getApplicationMenu())
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Application menu was not built within timeout')
}

export const clickMenuById = async(app: ElectronApplication, id: string): Promise<void> => {
  await app.evaluate(({ Menu, BrowserWindow }, menuId) => {
    const menu = Menu.getApplicationMenu()
    if (!menu) throw new Error('Application menu is not built yet')
    const item = menu.getMenuItemById(menuId)
    if (!item) throw new Error('Menu id not found: ' + menuId)
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    // Electron auto-toggles `checked` for checkbox/radio items on a real
    // click. Replicate that here so handlers that read `menuItem.checked`
    // (e.g. theme `follow-system-theme`) behave the same under tests.
    if (item.type === 'checkbox') {
      item.checked = !item.checked
    } else if (item.type === 'radio') {
      item.checked = true
    }
    // MenuItem.click signature: (event, focusedWindow, focusedWebContents).
    // Electron synthesizes the menuItem argument for template handlers via
    // _executeCommand, so we only need to forward window/webContents.
    // Do not call win.focus() — on xvfb that can collapse the renderer's
    // current DOM selection, breaking format/selection-driven menu actions.
    item.click(undefined, win, win ? win.webContents : undefined)
  }, id)
}

// CDP key events do not trigger macOS application-menu accelerators. Native
// Electron input exercises the same Save menu command as Cmd/Ctrl+S.
export const saveWithKeyboard = async(app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No test window is available for Save')
    const modifiers: ('meta' | 'control')[] = [process.platform === 'darwin' ? 'meta' : 'control']
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers })
  })
}

// The engine parks a zero-width space after a trailing newline so the browser
// has a layout position to paint the caret in. It never reaches the document
// text, the saved file, or a model offset, so specs compare against the
// stripped text.
export const ZERO_WIDTH_SPACE = '\u200B'

export const paragraphText = async(page: Page, index = 0): Promise<string> => {
  const text = await page
    .locator('.mu-paragraph-content')
    .nth(index)
    .evaluate((el) => el.textContent ?? '')
  return text.split(ZERO_WIDTH_SPACE).join('')
}

/**
 * Put a collapsed caret at an absolute character offset inside a paragraph.
 * Blank lines in body text stay literal newlines within ONE paragraph, so specs
 * address the caret by offset into that paragraph's text rather than by
 * (paragraph index, line). Only initialization injects a selection this way;
 * follow-up moves in a spec should be real keypresses.
 */
export const placeCaretAtOffset = async(
  page: Page,
  offset: number,
  paragraphIndex = 0
): Promise<void> => {
  const placed = await page.evaluate(
    ({ off, index, zwsp }) => {
      const root = document.querySelector('.editor-component') as HTMLElement | null
      if (!root) return false
      root.focus()
      const content = root.querySelectorAll('span.mu-paragraph-content')[index] as
        | HTMLElement
        | undefined
      if (!content) return false
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode() as Text | null
      let remaining = off
      while (node) {
        const length = (node.textContent ?? '').split(zwsp).join('').length
        if (remaining <= length) break
        remaining -= length
        node = walker.nextNode() as Text | null
      }
      if (!node) return false
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      const selection = window.getSelection()
      if (!selection) return false
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      // The engine derives its active block from key events on the editor root,
      // so a bare selectionchange is not enough.
      root.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true, cancelable: true })
      )
      return true
    },
    { off: offset, index: paragraphIndex, zwsp: ZERO_WIDTH_SPACE }
  )
  if (!placed) throw new Error(`Could not place the caret at offset ${offset} of paragraph ${paragraphIndex}`)
}

/** Paragraph index and absolute character offset of the current DOM caret. */
export const readCaretOffset = async(
  page: Page
): Promise<{ index: number; offset: number; collapsed: boolean } | null> =>
  page.evaluate((zwsp) => {
    const selection = window.getSelection()
    if (!selection?.anchorNode || !selection.rangeCount) return null
    const node = selection.anchorNode
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
    const content = element?.closest('span.mu-paragraph-content')
    if (!content) return null
    // anchorOffset alone can be a child index, not a character offset.
    const range = document.createRange()
    range.selectNodeContents(content)
    range.setEnd(node, selection.anchorOffset)
    const spans = Array.from(document.querySelectorAll('span.mu-paragraph-content'))
    return {
      index: spans.indexOf(content),
      offset: range.toString().split(zwsp).join('').length,
      collapsed: selection.isCollapsed
    }
  }, ZERO_WIDTH_SPACE)

export const waitForEditor = async(page: Page, timeout = 15000): Promise<void> => {
  await page.waitForSelector('.editor-component', { state: 'attached', timeout })
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.editor-component')
      return el && el.children.length > 0
    },
    null,
    { timeout }
  )
}

export const enterSourceMode = async(page: Page, app: ElectronApplication): Promise<void> => {
  const already = await page.evaluate(() => !!document.querySelector('.source-code .CodeMirror'))
  if (already) return
  await clickMenuById(app, 'sourceCodeModeMenuItem')
  await page.waitForSelector('.source-code .CodeMirror', { state: 'attached', timeout: 10000 })
  await page.waitForFunction(
    () => {
      const cm = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: unknown })
        | null
      return cm && cm.CodeMirror
    },
    null,
    { timeout: 10000 }
  )
}

export const exitSourceMode = async(page: Page, app: ElectronApplication): Promise<void> => {
  const inSource = await page.evaluate(() => !!document.querySelector('.source-code .CodeMirror'))
  if (!inSource) return
  await clickMenuById(app, 'sourceCodeModeMenuItem')
  await page.waitForFunction(() => !document.querySelector('.source-code'), null, {
    timeout: 10000
  })
}

export const getMarkdownContent = async(
  page: Page,
  app: ElectronApplication
): Promise<string> => {
  const wasInSource = await page.evaluate(
    () => !!document.querySelector('.source-code .CodeMirror')
  )
  if (!wasInSource) await enterSourceMode(page, app)
  const value = await page.evaluate(() => {
    const cm = document.querySelector('.source-code .CodeMirror') as
      | (Element & { CodeMirror?: { getValue(): string } })
      | null
    return cm && cm.CodeMirror ? cm.CodeMirror.getValue() : ''
  })
  if (!wasInSource) await exitSourceMode(page, app)
  return value
}

export const typeIntoEditor = async(page: Page, text: string): Promise<void> => {
  // Focus and place the caret through the DOM instead of clicking the component.
  // A CDP click is unreliable while the window is never the OS key window, and a
  // click that lands in the empty area below the text makes the engine append a
  // paragraph — silently moving the caret away from where the caller put it.
  await placeCaretInEditor(page)
  // Let contenteditable settle between input-driven renders. At delay: 0 the
  // next key can target a span that Muya has just replaced, dropping a letter.
  await page.keyboard.type(text, { delay: 10 })
}

// The @muyajs/core engine wraps editable paragraph text in
// `span.mu-paragraph-content` (inside `p.mu-paragraph`). Selecting the inner
// content span is what the engine's selection logic expects, so we target it.
// Place a selection inside the first non-empty paragraph content span and let
// the engine commit it to its model. The @muyajs/core engine derives its
// `activeContentBlock` from `click`/`input`/`keydown`/`keyup` events on the
// editor root (see editor/index.ts), so a bare `selectionchange` is not enough
// — we dispatch a synthetic `keyup` on the editor so the active block updates.
const commitSelection = (collapse: boolean) => {
  const root = document.querySelector('.editor-component') as HTMLElement | null
  if (!root) return false
  root.focus()
  const spans = root.querySelectorAll('span.mu-paragraph-content')
  let target: Element | null = null
  for (const span of spans) {
    if (span.textContent && span.textContent.trim().length > 0) {
      target = span
      break
    }
  }
  target = target || spans[0] || null
  if (!target) return false
  const range = document.createRange()
  range.selectNodeContents(target)
  if (collapse) range.collapse(false)
  const sel = window.getSelection()
  if (!sel) return false
  sel.removeAllRanges()
  sel.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  root.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true, cancelable: true })
  )
  return true
}

export const focusEditor = async(page: Page): Promise<void> => {
  await page.evaluate(commitSelection, false)
  // Allow muya's selectionchange listener to commit the selection to its model.
  await page.waitForTimeout(150)
}

export const placeCaretInEditor = async(page: Page): Promise<void> => {
  await page.evaluate(commitSelection, true)
  await page.waitForTimeout(150)
}

export const setSourceMarkdown = async(
  page: Page,
  app: ElectronApplication,
  markdown: string
): Promise<void> => {
  await enterSourceMode(page, app)
  await page.evaluate((value) => {
    const cm = document.querySelector('.source-code .CodeMirror') as
      | (Element & { CodeMirror?: { setValue(v: string): void } })
      | null
    if (cm && cm.CodeMirror) cm.CodeMirror.setValue(value)
  }, markdown)
  await exitSourceMode(page, app)
}

const writeTempMarkdown = (content: string): string => {
  const dir = trackTempDir(getTempPath('-doc'))
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, 'note.md')
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

export const launchWithDoc = async(
  relativeFixture: string,
  options: LaunchOptions = {}
): Promise<LaunchResult> => {
  const { app, page } = await launchElectron([relativeFixture], options)
  await waitForEditor(page)
  await waitForMenuReady(app)
  return { app, page }
}

export interface LaunchWithMarkdownResult extends LaunchResult {
  filePath: string
}

export const launchWithMarkdown = async(
  markdown = '',
  options: LaunchOptions = {}
): Promise<LaunchWithMarkdownResult> => {
  const filePath = writeTempMarkdown(markdown)
  const { app, page } = await launchElectron([filePath], options)
  await waitForEditor(page)
  await waitForMenuReady(app)
  return { app, page, filePath }
}

export const sendIpcToRenderer = async(
  app: ElectronApplication,
  channel: string,
  ...args: unknown[]
): Promise<void> => {
  await app.evaluate(
    ({ BrowserWindow }, payload) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send(payload.channel, ...payload.args)
    },
    { channel, args }
  )
}

/**
 * Page coordinates just after the last visible character of a block, for clicks
 * that have to look like a user putting the caret at the end of a line. Returns
 * null when the selector matches nothing or the block has no text.
 */
export const endOfBlockPoint = async(
  page: Page,
  selector: string
): Promise<{ x: number; y: number } | null> =>
  page.evaluate((sel) => {
    const hosts = Array.from(document.querySelectorAll(sel)) as HTMLElement[]
    const host = hosts[hosts.length - 1]
    if (!host) return null
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (((node.textContent ?? '').split('\u200B').join('')).length > 0) last = node as Text
    }
    const target = last ?? (host.firstChild as Text | null)
    if (!target) {
      // An empty block has no text node to measure; aim at the start of its own
      // box, which is where a click would put the caret.
      const box = host.getBoundingClientRect()
      return box.height > 0 ? { x: box.x + 3, y: box.y + box.height / 2 } : null
    }
    const range = document.createRange()
    const text = target.textContent ?? ''
    // A caret anchor holds only a zero-width space, so the meaningful position
    // is before it, not after.
    const offset = text.split('\u200B').join('').length
    range.setStart(target, offset)
    range.collapse(true)
    const rect = range.getBoundingClientRect()
    if (rect.height === 0) {
      const box = host.getBoundingClientRect()
      return box.height > 0 ? { x: box.x + 3, y: box.y + box.height / 2 } : null
    }
    return { x: rect.x + 2, y: rect.y + rect.height / 2 }
  }, selector)

/**
 * Layout evidence for the current caret. A collapsed range only paints an
 * insertion point when it resolves to a position the browser can lay out, so
 * positive dimensions are necessary but do not prove visibility. Also check
 * viewport bounds and actual caret pixels; zero-width inline-blocks can have
 * a range box without painting an insertion point.
 */
export const caretPaintMetrics = async(
  page: Page
): Promise<{ rects: number; height: number; anchorText: string | null; anchorOffset: number | null }> =>
  page.evaluate(() => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) { return { rects: 0, height: 0, anchorText: null, anchorOffset: null } }
    const range = selection.getRangeAt(0)
    return {
      rects: range.getClientRects().length,
      height: range.getBoundingClientRect().height,
      anchorText: selection.anchorNode?.textContent ?? null,
      anchorOffset: selection.anchorOffset
    }
  })

/**
 * Whether Chromium actually paints a caret inside `selector`, read from pixels.
 *
 * `caretPaintMetrics` cannot answer this for a caret sitting behind a trailing
 * newline — a collapsed range at the end of a text node that ends in `\n` has no
 * client rects even when the insertion point is plainly visible, which is why a
 * code block's last empty line needs a different probe. Paint the caret red and
 * look for it in a screenshot instead. This is the same evidence the engine's own
 * e2e uses (packages/muya/e2e/tests/blocks/codeblock-trailing-newline-5114.spec.ts).
 *
 * Only `caret-color` is overridden, not the glyph colour, so the rest of the
 * document stays readable for whatever the caller asserts next. Callers should
 * use it on a block with no syntax highlighting: a red token would be
 * indistinguishable from the caret.
 */
export const caretPaintedInScreenshot = async(page: Page, selector: string): Promise<boolean> => {
  await page.addStyleTag({
    content: `${selector}, ${selector} * {
      caret-color: rgb(255, 0, 0) !important;
      caret-animation: manual !important;
    }`
  })
  const clip = await page.locator(selector).first().boundingBox()
  if (!clip) { return false }
  const png = await page.screenshot({ clip, caret: 'initial' })

  return page.evaluate(async(base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) { return false }
    context.drawImage(image, 0, 0)
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) { return true }
      }
    }
    return false
  }, png.toString('base64'))
}
