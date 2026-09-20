import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';

/**
 * Vertical caret movement across the two shapes a document can have:
 *
 * - several *logical lines inside one paragraph* (body text keeps its blank
 *   lines as literal newlines), and
 * - several *blocks*, where the remembered column has to survive a short block.
 *
 * The first shape regressed badly: a collapsed caret sitting on an empty line
 * has no client rect, so `getCursorYOffset` reported "position unknown"
 * (`{ topOffset: 0, bottomOffset: 0 }`) and `arrowHandler` concluded the caret
 * was already on the block's first/last line. ArrowDown then jumped out of the
 * paragraph (appending a new one) and ArrowUp jumped to offset 0, so a paragraph
 * containing a blank line could not be navigated line by line at all.
 */

interface CaretProbe {
    blockText: string | null;
    offset: number | null;
    blockCount: number;
}

async function readCaret(page: Page): Promise<CaretProbe> {
    return page.evaluate(() => {
        const selection = window.muya!.editor.selection;
        const live = selection.getSelection();
        const blocks: unknown[] = [];
        const visit = (block: {
            constructor: { blockName?: string };
            children?: { forEach: (cb: (b: unknown) => void) => void };
        }) => {
            if (block.constructor?.blockName?.endsWith('.content')) blocks.push(block);
            block.children?.forEach(b => visit(b as typeof block));
        };
        visit(window.muya!.editor.scrollPage as unknown as Parameters<typeof visit>[0]);
        return {
            blockText: selection.anchorBlock?.text ?? null,
            offset: live?.anchor?.offset ?? null,
            blockCount: blocks.length,
        };
    });
}

// Put the caret at an absolute offset of the nth content block through the DOM,
// then let the engine commit it (it derives the active block from key events).
async function setCaret(page: Page, offset: number, blockIndex = 0): Promise<void> {
    await page.evaluate(({ off, index }) => {
        const leaves = Array.from(document.querySelectorAll<HTMLElement>('.mu-content'));
        const content = leaves[index];
        if (!content) throw new Error(`no content block at index ${index}`);
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode() as Text | null;
        let remaining = off;
        while (node) {
            const length = (node.textContent ?? '').split('\u200B').join('').length;
            if (remaining <= length) break;
            remaining -= length;
            node = walker.nextNode() as Text | null;
        }
        if (!node) throw new Error(`offset ${off} is past the end of block ${index}`);
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        content.dispatchEvent(
            new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true, cancelable: true }),
        );
    }, { off: offset, index: blockIndex });
    await page.waitForTimeout(80);
}

async function pressTo(page: Page, key: string, expected: { blockText: string; offset: number }): Promise<void> {
    await page.keyboard.press(key);
    await expect
        .poll(async () => {
            const caret = await readCaret(page);
            return { blockText: caret.blockText ?? '', offset: caret.offset ?? -1 };
        }, { timeout: 3000 })
        .toEqual(expected);
}

test.describe('vertical navigation through blank lines inside one paragraph', () => {
    // 'abcdefghij' / '' / 'xy' / '' / 'abcdefghijklmn' — line starts are
    // 0, 11, 12, 15, 16 and the paragraph text is 30 characters long.
    const lines = ['abcdefghij', '', 'xy', '', 'abcdefghijklmn'];
    const text = lines.join('\n');
    const lineStart = (index: number): number =>
        lines.slice(0, index).reduce((total, line) => total + line.length + 1, 0);

    test.beforeEach(async ({ page }) => {
        await page.evaluate(() => window.__e2e!.rebuildMuya({ preserveParagraphLineBreaks: true }));
        await page.waitForFunction(() => window.muya?.editor?.scrollPage != null, undefined, {
            timeout: 15_000,
        });
        await page.evaluate((md) => window.muya!.setContent(md), `${text}\n`);
        await expect.poll(() => getMarkdown(page)).toBe(`${text}\n`);
    });

    test('ArrowDown walks every line and blank lines land at column zero', async ({ page }) => {
        await setCaret(page, lines[0].length);
        for (const index of [1, 2, 3, 4])
            await pressTo(page, 'ArrowDown', { blockText: text, offset: lineStart(index) });

        // Still one paragraph: navigating never appended a block.
        expect((await readCaret(page)).blockCount).toBe(1);
    });

    test('ArrowUp walks back through the blank lines one row at a time', async ({ page }) => {
        await setCaret(page, lineStart(4));
        for (const index of [3, 2, 1])
            await pressTo(page, 'ArrowUp', { blockText: text, offset: lineStart(index) });
        await pressTo(page, 'ArrowUp', { blockText: text, offset: 0 });
        expect((await readCaret(page)).blockCount).toBe(1);
    });

    test('a blank line clears the remembered column', async ({ page }) => {
        // Leaving column 6 of the first line, the caret must not snap back to
        // column 6 (clamped to 2) on the 'xy' line: the blank line in between is
        // a column-zero anchor.
        await setCaret(page, 6);
        await pressTo(page, 'ArrowDown', { blockText: text, offset: lineStart(1) });
        await pressTo(page, 'ArrowDown', { blockText: text, offset: lineStart(2) });
        await pressTo(page, 'ArrowDown', { blockText: text, offset: lineStart(3) });
        await pressTo(page, 'ArrowDown', { blockText: text, offset: lineStart(4) });
    });
});

test.describe('vertical navigation across blocks keeps the remembered column', () => {
    // Three separate blocks: a long paragraph, a short heading, a long paragraph.
    const markdown = 'abcdefghij\n\n# xy\n\nabcdefghijklmn\n';

    test.beforeEach(async ({ page }) => {
        await page.evaluate((md) => window.muya!.setContent(md), markdown);
        await expect.poll(() => getMarkdown(page)).toBe(markdown);
    });

    test('a short block in between does not clear the column', async ({ page }) => {
        await setCaret(page, 6, 0);
        // Down into the heading: column 6 clamps to the heading's own text
        // length ('# xy' keeps its marker), so the caret lands at 4.
        await pressTo(page, 'ArrowDown', { blockText: '# xy', offset: 4 });
        // Down into the last paragraph: the remembered column 6 is restored
        // rather than staying at the clamped 4.
        await pressTo(page, 'ArrowDown', { blockText: 'abcdefghijklmn', offset: 6 });
        // The same walk back up.
        await pressTo(page, 'ArrowUp', { blockText: '# xy', offset: 4 });
        await pressTo(page, 'ArrowUp', { blockText: 'abcdefghij', offset: 6 });
    });
});
