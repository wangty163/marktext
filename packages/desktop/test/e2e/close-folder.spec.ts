import { expect, test } from '@playwright/test'
import { launchElectron } from './helpers'

test('an opened sidebar folder can be closed', async() => {
  const { app, page } = await launchElectron()
  try {
    await expect(page.locator('.project-tree > .title .close-folder')).toBeVisible()
    await page.locator('.project-tree > .title .close-folder').click()
    await expect(page.locator('.project-tree')).toHaveCount(0)
    await expect(page.locator('.open-project')).toBeVisible()
  } finally {
    await app.close()
  }
})
