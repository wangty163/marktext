import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

interface CapturedMenuItem {
  id?: string
  label?: string
  enabled?: boolean
  type?: string
}

test.describe('title path context menu', () => {
  let app: ElectronApplication
  let page: Page
  let filePath: string

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# title\n')
    app = launched.app
    page = launched.page
    filePath = launched.filePath

    // Keep the test unobtrusive: capture the native menu template and invoke
    // its only action through the same callback channel Electron normally uses.
    await app.evaluate(({ ipcMain }) => {
      const mainGlobal = globalThis as typeof globalThis & {
        __mt_title_path_menu__?: CapturedMenuItem[]
      }
      ipcMain.removeAllListeners('mt::menu::popup')
      ipcMain.on('mt::menu::popup', (event, template) => {
        const items = template as CapturedMenuItem[]
        mainGlobal.__mt_title_path_menu__ = items
        const id = items[0]?.id
        if (id) {
          setTimeout(() => {
            try {
              event.sender.send('mt::menu::click', { id })
              event.sender.send('mt::menu::closed', {})
            } catch { /* window gone */ }
          }, 30)
        }
      })
    })
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('copies the absolute file path from the title path menu', async() => {
    await page.evaluate(() => {
      const titlePath = document.querySelector('.title-bar .path') as HTMLElement | null
      if (!titlePath) throw new Error('title path not found')
      const rect = titlePath.getBoundingClientRect()
      titlePath.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        })
      )
    })

    await expect
      .poll(() =>
        app.evaluate(() => {
          const mainGlobal = globalThis as typeof globalThis & {
            __mt_title_path_menu__?: CapturedMenuItem[]
          }
          return mainGlobal.__mt_title_path_menu__
        })
      )
      .toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^copyPath-/),
          label: 'Copy path',
          enabled: true
        })
      ])

    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(filePath)
  })
})
