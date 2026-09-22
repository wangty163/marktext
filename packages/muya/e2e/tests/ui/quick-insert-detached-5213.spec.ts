import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { quickInsertOpened } from '../helpers/api';
import { floats, quickInsertItem } from '../helpers/selectors';

function collectErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(String(err?.message ?? err)));
    return errors;
}

async function openMenuInNewParagraph(page: Page): Promise<void> {
    // Not `setContent('first')` + Enter: in this fork Enter inside a paragraph
    // appends a literal newline, so the block would hold `first\n/` and the
    // quick-insert trigger — a block whose text is nothing but the query — would
    // never fire. An empty paragraph is the shape that does open the menu, and
    // removing it below reproduces the same detached-block situation.
    await page.evaluate(() => window.muya!.setContent(''));
    await page.evaluate(() => {
        window.muya!.editor.scrollPage.firstContentInDescendant().setCursor(0, 0, true);
    });
    await page.waitForTimeout(150);
    await page.keyboard.type('/');
    await expect(page.locator(floats.quickInsert)).toBeVisible();
    expect(await quickInsertOpened(page), 'quick-insert menu never positioned').toBe(true);
}

test.describe('quick-insert menu whose paragraph left the document (#5213)', () => {
    test('picking an item after the paragraph was removed does not crash', async ({ page }) => {
        const errors = collectErrors(page);
        await openMenuInNewParagraph(page);

        await page.evaluate(() => {
            window.muya!.editor.activeContentBlock.parent.remove();
        });
        await page.locator(quickInsertItem('bullet-list')).click({ force: true });
        await page.waitForTimeout(300);

        expect(errors, `renderer pageerrors: ${errors.join(' | ')}`).toEqual([]);
        await expect.poll(() => page.evaluate(() =>
            [...window.muya!.ui.shownFloat].some(float =>
                (float.constructor as { pluginName?: string }).pluginName === 'quickInsert'),
        )).toBe(false);
    });
});
