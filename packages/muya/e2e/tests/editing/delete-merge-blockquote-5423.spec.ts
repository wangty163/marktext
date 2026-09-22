import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { loadMarkdown } from '../helpers/keyboard';

// #5423: the quote's remaining paragraphs were moved out of it.

function collectPageErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(String(err?.message ?? err)));
    return errors;
}

// `deletes` is 1 at the top level, where the blank line before the quote is a
// block separator. Inside a list item that blank line is an editable block of its
// own, so one Delete consumes it and the second performs the merge. A third would
// forward-delete the `p` that just moved up: the merge leaves the caret before it.
async function deleteAtEndOfA(page: Page, deletes = 1): Promise<void> {
    await page.locator('.mu-paragraph-content').filter({ hasText: /^a$/ }).click();
    await page.keyboard.press('End');
    for (let i = 0; i < deletes; i++)
        await page.keyboard.press('Delete');
    await page.keyboard.type('Z');
}

test.describe('forward Delete before a blockquote (#5423)', () => {
    test('keeps the rest of the blockquote quoted', async ({ page }) => {
        const errors = collectPageErrors(page);
        await loadMarkdown(page, 'a\n\n> p\n>\n> q\n');

        await deleteAtEndOfA(page);

        await expect.poll(() => getMarkdown(page)).toBe('aZp\n\n> q\n');
        expect(errors).toEqual([]);
    });

    test('keeps the rest of a blockquote nested in a list item quoted', async ({ page }) => {
        const errors = collectPageErrors(page);
        await loadMarkdown(page, '- a\n\n  > p\n  >\n  > q\n');

        await deleteAtEndOfA(page, 2);

        // The empty quoted line is source content here, so it survives the merge
        // instead of being folded away. What #5423 guards still holds: `q` is
        // still quoted, and still nested in the list item.
        await expect.poll(() => getMarkdown(page)).toBe('- aZp\n\n  > \n  >\n  > q\n');
        expect(errors).toEqual([]);
    });
});
