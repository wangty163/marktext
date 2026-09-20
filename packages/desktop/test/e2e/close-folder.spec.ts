import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchElectron } from './helpers'
import { clickViaMain } from './mainProcessInput'
import { closeTestApplication, terminateTestApplication } from './appLifecycle'

test('an opened sidebar folder can be closed', async() => {
  // Open the folder explicitly: a bare launch follows the configured startup
  // action (a blank document), it does not adopt the process working directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-close-folder-'))
  fs.writeFileSync(path.join(dir, 'note.md'), '# note\n')
  const { app, page } = await launchElectron([dir])
  try {
    await expect(page.locator('.project-tree > .title .close-folder')).toBeVisible({ timeout: 10000 })
    await clickViaMain(app, page, '.project-tree > .title .close-folder')
    await expect(page.locator('.project-tree')).toHaveCount(0)
    await expect(page.locator('.open-project')).toBeVisible()
    await closeTestApplication(app)
  } catch (error) {
    terminateTestApplication(app)
    throw error
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
