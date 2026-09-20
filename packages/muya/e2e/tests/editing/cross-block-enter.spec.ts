import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { loadMarkdown } from '../helpers/keyboard';
import { editor } from '../helpers/selectors';

// #2443 — pressing Enter while a selection spans two blocks. The cross-block
// keydown handler only `preventDefault()`ed Backspace/Delete, so the browser's
// native Enter ran on top of the model edit and split/`<br>`-corrupted the
// contenteditable. Enter must behave like the same-block case: delete the
// selection and insert one newline at the caret. Body text keeps that newline
// as a literal line break inside a single paragraph, so the two blocks merge
// rather than staying separate — the point of the regression is that the result
// is clean text, not corrupted DOM.

async function selectAcrossParagraphs(
    page: import('@playwright/test').Page,
    startOffset: number,
    endOffset: number,
): Promise<void> {
    await page.evaluate(({ startOffset, endOffset }) => {
        const paras = document.querySelectorAll('.mu-paragraph');
        const firstText = (el: Element): Text => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            return walker.nextNode() as Text;
        };
        const n1 = firstText(paras[0]);
        const n2 = firstText(paras[1]);
        const range = document.createRange();
        range.setStart(n1, startOffset);
        range.setEnd(n2, endOffset);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
    }, { startOffset, endOffset });
}

test.describe('cross-block selection + Enter (#2443)', () => {
    test('replaces the selection with a paragraph break, not native DOM corruption', async ({ page }) => {
        await loadMarkdown(page, 'Hello world\n\nFoo bar\n');
        await page.locator(editor.paragraph).first().click();

        // Select "world\n\nFoo": from after "Hello " (p1 offset 6) to after
        // "Foo" (p2 offset 3).
        await selectAcrossParagraphs(page, 6, 3);
        await page.keyboard.press('Enter');

        await expect.poll(() => getMarkdown(page)).toBe('Hello \n bar\n');
        // The merged text lives in one paragraph with a literal line break — no
        // leftover <br> or duplicated fragment from the native handler.
        await expect(page.locator(editor.paragraph)).toHaveCount(1);
        await expect(page.locator(editor.paragraph).first()).toContainText('Hello \n bar');
        expect(
            await page.evaluate(() => document.querySelectorAll('.editor-component br').length)
        ).toBe(0);
    });
});
