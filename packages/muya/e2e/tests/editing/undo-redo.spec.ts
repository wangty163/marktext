import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { slowType } from '../helpers/keyboard';
import { editor, toolbar } from '../helpers/selectors';

test.describe('undo / redo', () => {
    test('button #undo reverts the latest typed text', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('start'));
        const para = page.locator(editor.paragraph).first();
        await para.click();
        await page.keyboard.press('End');
        await slowType(page, ' more');
        await expect(para).toContainText('start more');
        await page.locator(toolbar.undo).click();
        await expect(para).not.toContainText('start more');
        const md = await getMarkdown(page);
        expect(md).toContain('start');
        expect(md).not.toContain('start more');
    });

    test('#redo reapplies an undone edit', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('alpha'));
        const para = page.locator(editor.paragraph).first();
        await para.click();
        await page.keyboard.press('End');
        await slowType(page, 'beta');
        await expect(para).toContainText('alphabeta');
        await page.locator(toolbar.undo).click();
        await expect(para).not.toContainText('alphabeta');
        await page.locator(toolbar.redo).click();
        await expect(para).toContainText('alphabeta');
    });

    // #3825: undo coalesced every keystroke typed within History's 1s window
    // into one entry, so a single undo wiped out a whole sentence instead of
    // the most recent action. A correction after typing should be its own
    // undo step.
    test('undo after a correction reverts only the correction, not the whole run (#3825)', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent(''));
        const para = page.locator(editor.paragraph).first();
        await para.click();
        await slowType(page, 'hello world');
        await expect(para).toContainText('hello world');
        // A correction is a deliberate, separate action. Wait out History's 1s
        // coalescing window so the deletion is its own undo step no matter how
        // the keystrokes were paced: under load a typed run can straddle the
        // window and land in more than one group, which used to make this
        // assertion depend on typing rhythm.
        await page.waitForTimeout(1100);
        await page.keyboard.press('Backspace');
        await expect(para).toContainText('hello worl');

        await page.evaluate(() => window.muya!.undo());
        // Only the deletion is undone — the full typed text comes back.
        await expect(para).toContainText('hello world');
        expect(await getMarkdown(page)).toContain('hello world');
    });

    test('typed words split into separate undo steps (#3825)', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent(''));
        const para = page.locator(editor.paragraph).first();
        await para.click();
        await slowType(page, 'hello world');
        await expect(para).toContainText('hello world');

        // #3825 is about undo no longer wiping a whole sentence in one step.
        // Where exactly the groups fall depends on typing rhythm — a whitespace
        // keystroke starts a new group, and so does History's 1s window under
        // load — so assert that invariant instead of one exact split.
        const text = async (): Promise<string> =>
            (await para.innerText()).split('\u200B').join('').trim();

        await page.evaluate(() => window.muya!.undo());
        const afterFirstUndo = await text();
        expect(afterFirstUndo.length).toBeGreaterThan(0);
        expect(afterFirstUndo.length).toBeLessThan('hello world'.length);
        // Whatever was removed, it was removed from the end: the document stays
        // a prefix of what was typed, never a scrambled mix.
        expect('hello world'.startsWith(afterFirstUndo)).toBe(true);

        // The remaining groups walk the rest of the way back to empty.
        for (let step = 0; step < 8 && (await text()).length > 0; step++)
            await page.evaluate(() => window.muya!.undo());
        expect(await text()).toBe('');
    });
});
