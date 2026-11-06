import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { loadMarkdown } from '../helpers/keyboard';

async function readCaret(page: Page) {
    return page.evaluate(() => {
        const selection = window.muya!.editor.selection.getSelection();
        if (!selection)
            return null;
        return {
            text: selection.anchor.block.text,
            anchor: selection.anchor.offset,
            focus: selection.focus.offset,
            collapsed: selection.isCollapsed,
        };
    });
}

// Native selection endpoints can be element/child-index pairs after deleting
// the last line. Reading that child index as a character offset moved the caret
// into an earlier line, in both formatted text and code blocks.
const multilineCases = [
    { name: 'paragraph', markdown: 'alpha\nbeta', prefix: 'alpha\n' },
    { name: 'hard break', markdown: 'alpha  \nbeta', prefix: 'alpha  \n' },
    { name: 'bullet list', markdown: '- alpha\n  beta', prefix: 'alpha\n' },
    { name: 'ordered list', markdown: '1. alpha\n   beta', prefix: 'alpha\n' },
    { name: 'task list', markdown: '- [ ] alpha\n      beta', prefix: 'alpha\n' },
    { name: 'blockquote', markdown: '> alpha\n> beta', prefix: 'alpha\n' },
    { name: 'multiline heading', markdown: 'alpha\nbeta\n===', prefix: 'alpha\n' },
    { name: 'plain code', markdown: '```\nalpha\nbeta\n```', prefix: 'alpha\n' },
    { name: 'highlighted code', markdown: '```js\nconst abc = 12;\nxyz();\n```', prefix: 'const abc = 12;\n' },
    { name: 'bold last line', markdown: 'alpha\n**beta**', prefix: 'alpha\n' },
    { name: 'inline code last line', markdown: 'alpha\n`beta`', prefix: 'alpha\n' },
];

const singleLineCases = [
    { name: 'paragraph', markdown: 'alpha bravo charlie' },
    { name: 'heading', markdown: '# alpha bravo charlie' },
    { name: 'bullet list', markdown: '- alpha bravo charlie' },
    { name: 'ordered list', markdown: '1. alpha bravo charlie' },
    { name: 'task list', markdown: '- [ ] alpha bravo charlie' },
    { name: 'blockquote', markdown: '> alpha bravo charlie' },
    { name: 'plain code', markdown: '```\nalpha bravo charlie\n```' },
    { name: 'highlighted code', markdown: '```js\nalpha bravo charlie\n```' },
    { name: 'table cell', markdown: '| alpha bravo charlie | other |\n| --- | --- |\n| row | cell |' },
];

const crossBlockCases = [
    { name: 'paragraphs', markdown: 'alpha bravo\n\ndelta echo' },
    { name: 'bullet list', markdown: '- alpha bravo\n- delta echo' },
    { name: 'ordered list', markdown: '1. alpha bravo\n2. delta echo' },
    { name: 'task list', markdown: '- [ ] alpha bravo\n- [ ] delta echo' },
    { name: 'blockquote', markdown: '> alpha bravo\n>\n> delta echo' },
    { name: 'heading to paragraph', markdown: '# alpha bravo\n\ndelta echo' },
    { name: 'paragraph to code', markdown: 'alpha bravo\n\n```js\ndelta echo\n```' },
    { name: 'code to paragraph', markdown: '```js\nalpha bravo\n```\n\ndelta echo' },
];

async function selectInFirstBlock(page: Page, start: number, end: number | null, backward: boolean) {
    return page.evaluate(({ start, end, backward }) => {
        const muya = window.muya!;
        let block = muya.editor.scrollPage!.firstContentInDescendant()!;
        if (block.blockName === 'language-input')
            block = block.nextContentInContext()!;
        const finish = end ?? block.text.length;
        const text = block.text;
        muya.domNode.focus();
        block.setCursor(backward ? finish : start, backward ? start : finish, true);
        return text;
    }, { start, end, backward });
}

for (const key of ['Backspace', 'Delete']) {
    for (const backward of [false, true]) {
        const direction = backward ? 'backward' : 'forward';

        for (const { name, markdown, prefix } of multilineCases) {
            test(`last line: ${name}, ${key}, ${direction}`, async ({ page }) => {
                await loadMarkdown(page, markdown);
                await selectInFirstBlock(page, prefix.length, null, backward);

                await page.keyboard.press(key);

                await expect.poll(() => readCaret(page)).toEqual({
                    text: prefix,
                    anchor: prefix.length,
                    focus: prefix.length,
                    collapsed: true,
                });
                // The next character proves the browser's insertion point,
                // independently of the editor's reported selection offsets.
                await page.keyboard.type('Z');
                await expect.poll(() => readCaret(page)).toEqual({
                    text: `${prefix}Z`,
                    anchor: prefix.length + 1,
                    focus: prefix.length + 1,
                    collapsed: true,
                });
            });
        }

        for (const { name, markdown } of singleLineCases) {
            test(`same line: ${name}, ${key}, ${direction}`, async ({ page }) => {
                await loadMarkdown(page, markdown);
                const text = await selectInFirstBlock(page, 8, 13, backward);

                await page.keyboard.press(key);

                await expect.poll(() => readCaret(page)).toEqual({
                    text: text.slice(0, 8) + text.slice(13),
                    anchor: 8,
                    focus: 8,
                    collapsed: true,
                });
            });
        }

        for (const { name, markdown } of crossBlockCases) {
            test(`cross block: ${name}, ${key}, ${direction}`, async ({ page }) => {
                await loadMarkdown(page, markdown);
                const prefix = await page.evaluate((backward) => {
                    const muya = window.muya!;
                    let first = muya.editor.scrollPage!.firstContentInDescendant()!;
                    while (!first.text.endsWith('alpha bravo'))
                        first = first.nextContentInContext()!;
                    let last = first.nextContentInContext()!;
                    while (last.text !== 'delta echo')
                        last = last.nextContentInContext()!;
                    const prefix = first.text.slice(0, first.text.indexOf('bravo'));
                    const start = { block: first, path: first.path, offset: prefix.length };
                    const end = { block: last, path: last.path, offset: 5 };
                    muya.domNode.focus();
                    muya.editor.selection.setSelection(backward ? end : start, backward ? start : end);
                    return prefix;
                }, backward);

                await page.keyboard.press(key);

                await expect.poll(() => readCaret(page)).toMatchObject({
                    anchor: prefix.length,
                    focus: prefix.length,
                    collapsed: true,
                });
                await page.keyboard.type('Z');
                await expect.poll(() => readCaret(page).then(caret => caret?.text)).toBe(`${prefix}Z echo`);
            });
        }
    }
}
