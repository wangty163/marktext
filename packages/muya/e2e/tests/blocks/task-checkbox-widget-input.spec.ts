import { expect, test } from '@playwright/test';
import { flushState, getMarkdown } from '../helpers/api';
import { focusEditor, loadMarkdown } from '../helpers/keyboard';
import { editor } from '../helpers/selectors';

// A task-list checkbox is an `input[type=checkbox]` with
// `contenteditable="false"` embedded in the document, so toggling it fires a DOM
// `input` event that bubbles to the editor root. `Editor._dispatchEvents` used to
// route every `input` to the block that owns the caret, so a checkbox click:
//
//   1. called `setCursor` on that paragraph and emitted `selection-change` with
//      the caret's coords — which hosts read as "the caret moved" and scroll it
//      back into view. With the caret far off-screen, checking a box yanked the
//      viewport to the caret.
//   2. replayed a non-edit as an edit in the caret's block (history boundary
//      marking, auto-pair handling) for a click that changed no text.
//
// The toggle itself is a state op dispatched by the checkbox's own click handler,
// never a text edit, so these tests pin both halves: the widget event is dropped,
// the caret stays put, and the item still checks.

const MARKDOWN = 'caret stays here\n\n- [ ] buy milk\n- [ ] ship it\n';

/** Put a collapsed caret `offset` chars into the first paragraph. */
async function placeCaretInFirstParagraph(
    page: import('@playwright/test').Page,
    offset = 3,
): Promise<void> {
    await page.evaluate((off) => {
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(off, off);
    }, offset);
}

/** Count `selection-change` emissions from now on. */
async function watchSelectionChanges(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as { __selectionChanges: number };
        w.__selectionChanges = 0;
        window.muya!.eventCenter.subscribe('selection-change', () => {
            w.__selectionChanges += 1;
        });
    });
}

async function selectionChangeCount(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(
        () => (window as unknown as { __selectionChanges: number }).__selectionChanges,
    );
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loadMarkdown(page, MARKDOWN);
});

test('clicking a task checkbox checks the item without emitting selection-change', async ({ page }) => {
    await placeCaretInFirstParagraph(page);
    await watchSelectionChanges(page);

    await page.locator(editor.taskListCheckbox).first().click();

    await flushState(page);
    expect(await getMarkdown(page)).toContain('- [x] buy milk');
    expect(await getMarkdown(page)).toContain('- [ ] ship it');
    expect(await selectionChangeCount(page)).toBe(0);
});

test('a checkbox click neither moves the caret nor blocks the next real edit', async ({ page }) => {
    await placeCaretInFirstParagraph(page);
    const caretBefore = await page.evaluate(() => {
        const selection = document.getSelection()!;
        return { offset: selection.anchorOffset, text: selection.anchorNode?.textContent ?? null };
    });

    await page.locator(editor.taskListCheckbox).first().click();

    // The caret never moved: it is still at the same offset of the same node.
    const caretAfter = await page.evaluate(() => {
        const selection = document.getSelection()!;
        return { offset: selection.anchorOffset, text: selection.anchorNode?.textContent ?? null };
    });
    expect(caretAfter).toEqual(caretBefore);

    // The guard is scoped to widget events: a real edit from the editable
    // surface is still routed to the block that owns the caret, and lands at
    // the untouched caret position ("car|et stays here").
    await focusEditor(page);
    await placeCaretInFirstParagraph(page);
    await page.keyboard.type('X');
    await flushState(page);

    expect(await getMarkdown(page)).toContain('carXet stays here');
});
