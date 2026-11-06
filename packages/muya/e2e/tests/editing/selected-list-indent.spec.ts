import { expect, test } from '@playwright/test';
import { getMarkdown } from '../helpers/api';

const variants = [
    {
        name: 'bullet',
        original: '- parent\n  - first\n  - second\n- next\n  - child\n- end\n',
        indented: '- parent\n    - first\n    - second\n  - next\n  - child\n- end\n',
    },
    {
        name: 'ordered',
        original: '1. parent\n   1. first\n   2. second\n2. next\n   1. child\n3. end\n',
        indented: '1. parent\n      1. first\n      2. second\n   1. next\n   1. child\n3. end\n',
    },
    {
        name: 'task',
        original: '- [ ] parent\n  - [x] first\n  - [ ] second\n- [ ] next\n  - [x] child\n- [ ] end\n',
        indented: '- [ ] parent\n    - [x] first\n    - [ ] second\n  - [ ] next\n  - [x] child\n- [ ] end\n',
    },
];

for (const { name, original, indented: crossBlockIndent } of variants) {
    for (const from of [0, 1, 3]) {
        const to = from === 0 ? 0 : 3;
        const indented = original.split('\n').map((line, index) => {
            if (from === 0)
                return index === 0 ? `${' '.repeat(name === 'ordered' ? 3 : 2)}${line}` : line;
            return index >= from && index <= to ? crossBlockIndent.split('\n')[index] : line;
        }).join('\n');
        test(`${name}: ${from === 1 ? 'cross-block' : `parent-only at ${from}`} selection leaves unselected rows fixed`, async ({ page }) => {
            await page.goto('/');
            await page.evaluate((markdown) => {
                window.__e2e!.rebuildMuya({ preserveParagraphLineBreaks: true, markdown });
            }, original);
            const rows = page.locator('.mu-paragraph-content');
            const before = await rows.evaluateAll(leaves => leaves.map(leaf => leaf.getBoundingClientRect().x));
            const start = await rows.nth(from).boundingBox();
            const end = await rows.nth(to).boundingBox();
            if (!start || !end)
                throw new Error('missing list rows');
            await page.mouse.move(start.x + 1, start.y + start.height / 2);
            await page.mouse.down();
            await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, { steps: 12 });
            await page.mouse.up();
            const selected = () => page.evaluate(() => document.getSelection()?.toString());
            if (from === 1)
                await expect.poll(selected).toContain('first');
            await expect.poll(selected).toContain(from === 0 ? 'parent' : 'next');

            await page.keyboard.press('Tab');
            expect(await getMarkdown(page)).toBe(indented);
            const after = await rows.evaluateAll(leaves => leaves.map(leaf => leaf.getBoundingClientRect().x));
            for (let row = 0; row < before.length; row++)
                expect(after[row]! - before[row]!).toBeCloseTo(row >= from && row <= to ? 30 : 0, 1);
            if (from === 1)
                await expect.poll(selected).toContain('first');
            await expect.poll(selected).toContain(from === 0 ? 'parent' : 'next');
            await page.keyboard.press('Shift+Tab');
            expect(await getMarkdown(page)).toBe(original);

            await page.evaluate(markdown => window.muya!.setContent(markdown), indented);
            expect(await getMarkdown(page)).toBe(indented);
            expect(await rows.evaluateAll(leaves => leaves.map(leaf => leaf.getBoundingClientRect().x)))
                .toEqual(after);
            if (name === 'task') {
                await page.locator('input[type="checkbox"]').nth(1).click();
                expect(await getMarkdown(page)).toBe(indented.replace('- [x] first', '- [ ] first'));
            }
        });
    }
}
