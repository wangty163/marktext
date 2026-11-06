import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { loadMarkdown } from '../helpers/keyboard';

const lists = [
    { name: 'bullet', markers: ['-', '-', '-'], child: '  - child\n' },
    { name: 'ordered', markers: ['1.', '2.', '3.'], child: '   1. child\n' },
    { name: 'task', markers: ['- [ ]', '- [ ]', '- [ ]'], child: '  - [ ] child\n' },
];

for (const { name, markers, child } of lists) {
    for (const target of ['alpha', 'beta']) {
        test(`${name}: Enter at the start of ${target} splits the row consistently`, async ({ page }) => {
            const markdown = `${markers[0]} alpha\n${child}${markers[1]} beta\n`;
            await loadMarkdown(page, markdown);
            await page.locator('.mu-paragraph-content').filter({ hasText: new RegExp(`^${target}$`) }).click();
            await page.keyboard.press('Home');
            await page.keyboard.press('Enter');

            const expected = target === 'alpha'
                ? `${markers[0]} \n${markers[1]} alpha\n${child}${markers[2]} beta\n`
                : `${markers[0]} alpha\n${child}${markers[1]} \n${markers[2]} beta\n`;
            await expect.poll(() => getMarkdown(page)).toBe(expected);
            const selection = () => page.evaluate(() => {
                const range = window.muya!.editor.selection.getSelection()!;
                return { text: range.anchor.block.text, anchor: range.anchor.offset, focus: range.focus.offset };
            });
            await expect.poll(selection).toEqual({ text: target, anchor: 0, focus: 0 });
            await page.screenshot({ path: test.info().outputPath('after-enter.png') });

            await page.evaluate(() => window.muya!.undo());
            await expect.poll(() => getMarkdown(page)).toBe(markdown);
            await expect.poll(selection).toEqual({ text: target, anchor: 0, focus: 0 });
            await page.evaluate(() => window.muya!.redo());
            await expect.poll(() => getMarkdown(page)).toBe(expected);
            await expect.poll(selection).toEqual({ text: target, anchor: 0, focus: 0 });
            await page.keyboard.type('Z');
            await expect.poll(() => getMarkdown(page)).toBe(expected.replace(target, `Z${target}`));
        });
    }

    test(`${name}: Enter replaces a selected part of a parent row and keeps its children`, async ({ page }) => {
        await loadMarkdown(page, `${markers[0]} alpha\n${child}${markers[1]} beta\n`);
        await page.locator('.mu-paragraph-content').filter({ hasText: /^alpha$/ }).click();
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowRight');
        for (let i = 0; i < 3; i++)
            await page.keyboard.press('Shift+ArrowRight');
        await page.keyboard.press('Enter');
        await expect.poll(() => getMarkdown(page)).toBe(`${markers[0]} a\n${markers[1]} a\n${child}${markers[2]} beta\n`);
    });
}

test('Shift+Enter still inserts a soft line break inside the parent item', async ({ page }) => {
    await loadMarkdown(page, '- alpha\n  - child\n- beta\n');
    await page.locator('.mu-paragraph-content').filter({ hasText: /^alpha$/ }).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+Enter');
    await expect.poll(() => page.evaluate(() => window.muya!.getState()[0])).toMatchObject({
        name: 'bullet-list',
        children: [
            { children: [{ name: 'paragraph', text: '\nalpha' }, { name: 'bullet-list' }] },
            { children: [{ name: 'paragraph', text: 'beta' }] },
        ],
    });
});
