import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { loadMarkdown, metaKey } from '../helpers/keyboard';

const lineStart = metaKey() === 'Meta' ? 'Meta+ArrowLeft' : 'Home';
const lineEnd = metaKey() === 'Meta' ? 'Meta+ArrowRight' : 'End';

async function readSelection(page: Page) {
    return page.evaluate(() => {
        const selection = window.muya!.editor.selection.getSelection();
        return selection && {
            anchor: selection.anchor.offset,
            focus: selection.focus.offset,
            anchorText: selection.anchor.block.text,
            focusText: selection.focus.block.text,
        };
    });
}

const cases = [
    { name: 'paragraph', markdown: 'alpha\nbeta' },
    { name: 'bullet list', markdown: '- alpha\n  beta' },
    { name: 'ordered list', markdown: '1. alpha\n   beta' },
    { name: 'task list', markdown: '- [ ] alpha\n      beta' },
    { name: 'blockquote', markdown: '> alpha\n> beta' },
    { name: 'multiline heading', markdown: 'alpha\nbeta\n===' },
    { name: 'code', markdown: '```js\nconst abc = 12;\nxyz();\n```' },
];

for (const { name, markdown } of cases) {
    for (const backward of [false, true]) {
        test(`${name}: undo/redo the first deletion (backward: ${backward})`, async ({ page }) => {
            await loadMarkdown(page, markdown);
            const initialMarkdown = await getMarkdown(page);
            await page.evaluate((backward) => {
                const muya = window.muya!;
                let block = muya.editor.scrollPage!.firstContentInDescendant()!;
                if (block.blockName === 'language-input')
                    block = block.nextContentInContext()!;
                const start = block.text.indexOf('\n') + 1;
                const end = block.text.length;
                muya.domNode.focus();
                block.setCursor(backward ? end : start, backward ? start : end, true);
            }, backward);
            const before = await readSelection(page);
            await page.keyboard.press('Backspace');
            const after = await readSelection(page);
            const deletedMarkdown = await getMarkdown(page);

            await page.evaluate(() => window.muya!.undo());
            await expect.poll(() => readSelection(page)).toEqual(before);
            expect(await getMarkdown(page)).toBe(initialMarkdown);

            await page.evaluate(() => window.muya!.redo());
            await expect.poll(() => readSelection(page)).toEqual(after);
            expect(await getMarkdown(page)).toBe(deletedMarkdown);
            await page.keyboard.type('Z');
            await expect.poll(() => readSelection(page).then(range => range?.anchorText)).toBe(`${after!.anchorText}Z`);
        });
    }
}

test('undo/redo remembers the edit location after the caret moves elsewhere', async ({ page }) => {
    await loadMarkdown(page, 'first\n\nsecond');
    await page.locator('.mu-paragraph-content').first().click();
    await page.keyboard.press(lineEnd);
    await page.keyboard.type('X');
    await expect.poll(() => getMarkdown(page)).toBe('firstX\n\nsecond\n');
    await page.locator('.mu-paragraph-content').last().click();
    await page.keyboard.press(lineStart);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => readSelection(page)).toEqual({
        anchor: 1, focus: 1, anchorText: 'second', focusText: 'second',
    });
    await page.keyboard.type('Y');
    await expect.poll(() => getMarkdown(page)).toBe('firstX\n\nsYecond\n');
    await page.locator('.mu-paragraph-content').first().click();
    await page.keyboard.press(lineStart);

    await page.evaluate(() => window.muya!.undo());
    await expect.poll(() => readSelection(page)).toEqual({
        anchor: 1, focus: 1, anchorText: 'second', focusText: 'second',
    });
    expect(await getMarkdown(page)).toBe('firstX\n\nsecond\n');
    await page.evaluate(() => window.muya!.redo());
    await expect.poll(() => readSelection(page)).toEqual({
        anchor: 2, focus: 2, anchorText: 'sYecond', focusText: 'sYecond',
    });
});

test('beforeinput captures a native selection that has not reached the editor cache', async ({ page }) => {
    await loadMarkdown(page, 'alpha beta');
    await page.locator('.mu-paragraph-content').click();
    await page.evaluate(() => {
        const content = document.querySelector('.mu-paragraph-content')!;
        const text = document.createTreeWalker(content, NodeFilter.SHOW_TEXT).nextNode()!;
        document.getSelection()!.setBaseAndExtent(text, 6, text, 6);
    });
    // insertText emits beforeinput/input without a preceding keydown.
    await page.keyboard.insertText('中');
    expect(await getMarkdown(page)).toBe('alpha 中beta\n');
    await page.evaluate(() => window.muya!.undo());
    await expect.poll(() => readSelection(page)).toEqual({
        anchor: 6, focus: 6, anchorText: 'alpha beta', focusText: 'alpha beta',
    });
});

for (const backward of [false, true]) {
    test(`cross-block undo restores a range that can be replaced (backward: ${backward})`, async ({ page }) => {
        await loadMarkdown(page, 'first\n\nsecond');
        await page.evaluate((backward) => {
            const muya = window.muya!;
            const first = muya.editor.scrollPage!.firstContentInDescendant()!;
            const last = first.nextContentInContext()!;
            const start = { block: first, path: first.path, offset: 2 };
            const end = { block: last, path: last.path, offset: 3 };
            muya.domNode.focus();
            muya.editor.selection.setSelection(backward ? end : start, backward ? start : end);
        }, backward);
        const before = await readSelection(page);
        await page.keyboard.press('Backspace');
        expect(await getMarkdown(page)).toBe('fiond\n');
        await page.evaluate(() => window.muya!.undo());
        await expect.poll(() => readSelection(page)).toEqual(before);
        await page.keyboard.type('Z');
        expect(await getMarkdown(page)).toBe('fiZond\n');
    });
}

test('undo an IME commit returns to the caret before composition started', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Uses Chromium IME events');
    await loadMarkdown(page, 'alpha beta');
    await page.evaluate(() => {
        const muya = window.muya!;
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        muya.domNode.focus();
        block.setCursor(6, 6, true);
    });
    const session = await page.context().newCDPSession(page);
    await session.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
    await session.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
    await session.send('Input.insertText', { text: '中文' });
    expect(await getMarkdown(page)).toBe('alpha 中文beta\n');

    await page.evaluate(() => window.muya!.undo());
    await expect.poll(() => readSelection(page)).toEqual({
        anchor: 6, focus: 6, anchorText: 'alpha beta', focusText: 'alpha beta',
    });
    await page.evaluate(() => window.muya!.redo());
    await expect.poll(() => readSelection(page)).toEqual({
        anchor: 8, focus: 8, anchorText: 'alpha 中文beta', focusText: 'alpha 中文beta',
    });
    await session.detach();
});
