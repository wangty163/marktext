import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { editor } from '../helpers/selectors';

/**
 * Pressing Enter at the very end of the last paragraph appends a literal
 * newline, which leaves the caret behind the document's final line break. A
 * collapsed DOM range only paints an insertion point when it resolves to a
 * position the browser can layout — an empty element whose only content comes
 * from a CSS pseudo-element does not qualify, so the caret visually disappears
 * even though the selection is still set.
 *
 * Check both the collapsed range geometry and native caret pixels: a zero-width
 * inline-block can have a non-zero-height range without painting a caret.
 */

interface CaretSnapshot {
    rectCount: number;
    height: number;
    width: number;
    anchorNodeName: string | null;
    anchorText: string | null;
    anchorOffset: number | null;
    isCollapsed: boolean | null;
    hasFocus: boolean;
}

async function readCaret(page: Page): Promise<CaretSnapshot> {
    return page.evaluate(() => {
        const sel = document.getSelection();
        if (!sel || sel.rangeCount === 0) {
            return {
                rectCount: 0,
                height: 0,
                width: 0,
                anchorNodeName: null,
                anchorText: null,
                anchorOffset: null,
                isCollapsed: null,
                hasFocus: document.hasFocus(),
            };
        }
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        return {
            rectCount: range.getClientRects().length,
            height: rect.height,
            width: rect.width,
            anchorNodeName: sel.anchorNode?.nodeName ?? null,
            anchorText: sel.anchorNode?.textContent ?? null,
            anchorOffset: sel.anchorOffset,
            isCollapsed: sel.isCollapsed,
            hasFocus: document.hasFocus(),
        };
    });
}

// Click immediately after the last character of the first paragraph so the
// caret starts where a user's click would land at the end of the document.
async function clickEndOfLastText(page: Page): Promise<void> {
    const point = await page.evaluate((selector) => {
        const paragraphs = document.querySelectorAll(selector);
        const p = paragraphs[paragraphs.length - 1] as HTMLElement;
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let last: Text | null = null;
        let node: Node | null;
        while ((node = walker.nextNode())) {
            if ((node.textContent ?? '').length > 0) last = node as Text;
        }
        const range = document.createRange();
        range.setStart(last!, last!.length);
        range.collapse(true);
        const r = range.getBoundingClientRect();
        return { x: r.x + 1, y: r.y + r.height / 2 };
    }, editor.paragraph);
    await page.mouse.click(point.x, point.y);
}

test.describe('Enter at the end of the document keeps a visible caret', () => {
    test.beforeEach(async ({ page }) => {
        await page.evaluate(() => window.__e2e!.rebuildMuya({ preserveParagraphLineBreaks: true }));
        await page.waitForFunction(() => window.muya?.editor?.scrollPage != null, undefined, {
            timeout: 15_000,
        });
    });

    test('the caret stays paintable after one trailing Enter', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('alpha'));
        await clickEndOfLastText(page);
        await expect.poll(() => getMarkdown(page)).toBe('alpha\n');

        await page.keyboard.press('Enter');
        await expect.poll(() => getMarkdown(page)).toBe('alpha\n\n');

        const caret = await readCaret(page);
        expect(caret.isCollapsed, JSON.stringify(caret)).toBe(true);
        expect(caret.height, JSON.stringify(caret)).toBeGreaterThan(0);
    });

    test('the trailing caret is actually painted, not just measurable', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Pixel check uses Chromium caret-animation support');
        await page.evaluate(() => window.muya!.setContent('alpha'));
        await clickEndOfLastText(page);
        await page.keyboard.press('Enter');
        await expect.poll(() => getMarkdown(page)).toBe('alpha\n\n');
        // Freeze blinking so the screenshots differ only by the native caret.
        await page.addStyleTag({ content: '* { caret-animation: manual !important; }' });
        const clip = await page.evaluate(() => {
            const rect = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
            return { x: rect.x - 2, y: rect.y, width: 5, height: rect.height };
        });
        expect(clip.height).toBeGreaterThan(0);
        const visible = await page.screenshot({ clip, caret: 'initial' });
        const hidden = await page.screenshot({ clip, caret: 'hide' });
        expect(visible.equals(hidden), 'the native caret must contribute visible pixels').toBe(false);
    });

    test('the caret stays paintable across repeated trailing Enters', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('alpha'));
        await clickEndOfLastText(page);

        for (let count = 1; count <= 3; count++) {
            await page.keyboard.press('Enter');
            await expect.poll(() => getMarkdown(page)).toBe(`alpha${'\n'.repeat(count + 1)}`);
            const caret = await readCaret(page);
            expect(caret.height, `press ${count}: ${JSON.stringify(caret)}`).toBeGreaterThan(0);
        }
    });

    test('typing after a trailing Enter lands in the new line', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('alpha'));
        await clickEndOfLastText(page);
        await page.keyboard.press('Enter');
        await page.keyboard.type('beta');

        await expect.poll(() => getMarkdown(page)).toBe('alpha\nbeta\n');
        const caret = await readCaret(page);
        expect(caret.height, JSON.stringify(caret)).toBeGreaterThan(0);
    });
});

test.describe('a trailing hard line break keeps a visible caret', () => {
    // A document cannot *start* with a trailing hard break — the parser treats
    // a final "  \n" as the end of the paragraph. Deleting the text after a hard
    // break does produce one, so that is the path under test.
    test('deleting the text after a hard break leaves a paintable caret', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('alpha  \nbeta'));
        await clickEndOfLastText(page);
        for (let i = 0; i < 'beta'.length; i++)
            await page.keyboard.press('Backspace');

        await expect.poll(() => getMarkdown(page)).toBe('alpha  \n\n');
        const html = await page.evaluate(
            () => document.querySelector('.mu-paragraph-content')?.innerHTML ?? ''
        );
        const caret = await readCaret(page);
        expect(caret.height, `${JSON.stringify(caret)} html=${html}`).toBeGreaterThan(0);
    });
});
