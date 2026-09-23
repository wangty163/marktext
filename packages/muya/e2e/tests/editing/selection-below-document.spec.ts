import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getState } from '../helpers/api';

const fixtures: { name: string; markdown: string; emptyTail?: boolean }[] = [
    { name: 'multiline paragraph', markdown: 'Alpha beta gamma\nDelta epsilon' },
    { name: 'empty final paragraph', markdown: 'Alpha beta gamma\nDelta epsilon', emptyTail: true },
    { name: 'heading', markdown: 'Alpha beta gamma\n\n# Delta epsilon' },
    { name: 'code block', markdown: 'Alpha beta gamma\n\n```text\nDelta epsilon\n```' },
    { name: 'list', markdown: 'Alpha beta gamma\n\n- Delta epsilon' },
];

async function points(page: Page) {
    return page.evaluate(() => {
        const container = window.muya!.editor.scrollPage!.domNode!;
        const first = container.querySelector('.mu-paragraph-content')!;
        const range = document.createRange();
        range.setStart(first.firstChild!, 0);
        range.setEnd(first.firstChild!, 1);
        const start = range.getBoundingClientRect();
        const last = container.lastElementChild!.getBoundingClientRect();
        return {
            from: { x: start.left + 1, y: start.top + start.height / 2 },
            below: { x: start.left + 40, y: last.bottom + 30 },
        };
    });
}

async function selectedText(page: Page) {
    return page.evaluate(() => window.getSelection()?.toString().replace(/\u200B/g, ''));
}

for (const fixture of fixtures) {
    test(`drag below the document preserves selection: ${fixture.name}`, async ({ page }) => {
        await page.evaluate(({ markdown, emptyTail }) => {
            window.muya!.setContent(emptyTail
                ? [{ name: 'paragraph', text: markdown }, { name: 'paragraph', text: '' }]
                : markdown);
        }, fixture);
        const before = await getState(page);
        const { from, below } = await points(page);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(below.x, below.y, { steps: 12 });
        await expect.poll(() => selectedText(page)).toContain('Delta epsilon');
        const selected = await selectedText(page);
        await page.waitForTimeout(200);
        expect(await selectedText(page)).toBe(selected);
        await page.mouse.up();
        await expect.poll(() => selectedText(page)).toBe(selected);
        expect(await getState(page)).toEqual(before);
        await page.mouse.move(below.x + 20, below.y + 20);
        expect(await selectedText(page)).toBe(selected);
    });
}

test('dragging from the blank area into text does not create a paragraph', async ({ page }) => {
    await page.evaluate(() => window.muya!.setContent('Alpha beta gamma\nDelta epsilon'));
    const before = await getState(page);
    const { from, below } = await points(page);
    await page.mouse.move(below.x, below.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y, { steps: 12 });
    await expect.poll(() => selectedText(page)).toContain('Alpha beta gamma');
    const selected = await selectedText(page);
    await page.mouse.up();
    await expect.poll(() => selectedText(page)).toBe(selected);
    expect(await getState(page)).toEqual(before);
});

test('a plain click below the document still creates and reuses an empty paragraph', async ({ page }) => {
    await page.evaluate(() => {
        window.muya!.setContent('Alpha beta gamma');
        window.muya!.selectAll();
    });
    // A fresh click must still work even when an earlier gesture left a range.
    const { below } = await points(page);
    await page.mouse.click(below.x, below.y);
    await expect.poll(() => getState(page)).toEqual([
        { name: 'paragraph', text: 'Alpha beta gamma' },
        { name: 'paragraph', text: '' },
    ]);
    const next = await points(page);
    await page.mouse.click(next.below.x, next.below.y);
    expect(await getState(page)).toEqual([
        { name: 'paragraph', text: 'Alpha beta gamma' },
        { name: 'paragraph', text: '' },
    ]);
    await page.keyboard.type('continued');
    await expect.poll(() => getState(page)).toEqual([
        { name: 'paragraph', text: 'Alpha beta gamma' },
        { name: 'paragraph', text: 'continued' },
    ]);
});
