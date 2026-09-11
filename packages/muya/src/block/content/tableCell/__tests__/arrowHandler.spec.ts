// @vitest-environment happy-dom

import type Content from '../../../base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';

// ArrowUp / ArrowDown navigation inside a table cell — `TableCellContent.arrowHandler`.
//
// The migration audit flagged the vertical-navigation branches as untested:
//   - ArrowDown from a header cell jumps to the SAME column of the next row
//     (same-column offset preservation is load-bearing).
//   - ArrowDown from the last body row with no following block appends a
//     trailing paragraph and lands the caret there at offset 0.
//   - ArrowUp from a header cell with a preceding block keeps the caret column.
// Each branch is driven through a real boot so cell-resolution and caret
// placement run exactly as an Arrow keystroke would.

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    document.getSelection()?.removeAllRanges();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

// Collect the table cell content blocks in document order.
function tableCells(muya: Muya): Content[] {
    const out: Content[] = [];
    const visit = (block: {
        constructor: { blockName?: string };
        children?: { forEach: (cb: (b: unknown) => void) => void };
    }) => {
        if (block.constructor.blockName === 'table.cell.content')
            out.push(block as unknown as Content);
        block.children?.forEach(b => visit(b as typeof block));
    };
    visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);
    return out;
}

function arrowAtStart(muya: Muya, cell: Content, key: 'ArrowUp' | 'ArrowDown'): void {
    muya.editor.activeContentBlock = cell;
    cell.setCursor(0, 0, true);
    const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        key,
    } as unknown as KeyboardEvent;
    cell.arrowHandler(event);
}

function flush(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

function pressVertical(content: Content, key: 'ArrowUp' | 'ArrowDown'): void {
    const event = { key, bubbles: true, cancelable: true };
    content.domNode!.dispatchEvent(new KeyboardEvent('keydown', event));
    content.domNode!.dispatchEvent(new KeyboardEvent('keyup', event));
}

function expectCaretAt(content: Content, offset: number): void {
    expect(content.getCursor()).toMatchObject({
        start: { offset },
        end: { offset },
    });
}

describe('tableCellContent arrow navigation', () => {
    it('arrowDown from a header cell lands the caret in the same column of the body row', async () => {
        // Cells in document order: [ab, cd] (header), [ef, gh] (body).
        const muya = bootMuya('| ab | cd |\n| --- | --- |\n| ef | gh |\n');
        const cells = tableCells(muya);
        expect(cells.length).toBe(4);

        // ArrowDown from header column 0 (`ab`).
        arrowAtStart(muya, cells[0], 'ArrowDown');
        await flush();

        // The caret should now be in the body cell of the SAME column (`ef`).
        const bodyCol0 = cells[2];
        expect(bodyCol0.text).toBe('ef');
        const cursor = bodyCol0.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(0);
    });

    it('arrowDown preserves the column index when moving down (column 1)', async () => {
        const muya = bootMuya('| ab | cd |\n| --- | --- |\n| ef | gh |\n');
        const cells = tableCells(muya);

        // ArrowDown from header column 1 (`cd`).
        arrowAtStart(muya, cells[1], 'ArrowDown');
        await flush();

        // The caret should be in the body cell of column 1 (`gh`), not column 0.
        const bodyCol1 = cells[3];
        expect(bodyCol1.text).toBe('gh');
        const cursor = bodyCol1.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(0);

        // The other body cell did not receive the caret.
        expect(cells[2].getCursor()).toBeNull();
    });

    it('arrowDown from the last body cell with no following block appends a trailing paragraph and lands the caret there', async () => {
        const muya = bootMuya('| ab | cd |\n| --- | --- |\n| ef | gh |\n');
        const cells = tableCells(muya);
        expect(cells.length).toBe(4);

        // ArrowDown from the last body cell (`gh`), nothing after the table.
        arrowAtStart(muya, cells[3], 'ArrowDown');
        await flush();

        // A trailing paragraph was appended after the table.
        const state = muya.getState();
        expect(state.length).toBe(2);
        expect(state[0].name).toBe('table');
        expect(state[1].name).toBe('paragraph');
        expect((state[1] as { text: string }).text).toBe('');

        // The caret lands in the new paragraph at offset 0.
        const appended = muya.editor.scrollPage!.lastContentInDescendant() as Content;
        expect(appended.constructor.name).toBe('ParagraphContent');
        const cursor = appended.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(0);
    });

    it('arrowUp from a header cell with a preceding paragraph keeps offset 0', async () => {
        // A paragraph `intro` precedes the table.
        const muya = bootMuya('intro\n\n| ab | cd |\n| --- | --- |\n| ef | gh |\n');
        const cells = tableCells(muya);
        expect(cells.length).toBe(4);

        // ArrowUp from header column 0 (`ab`).
        arrowAtStart(muya, cells[0], 'ArrowUp');
        await flush();

        // The caret keeps offset 0 in the preceding paragraph (`intro`).
        const first = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        expect(first.text).toBe('intro');
        const cursor = first.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(0);
        expect(cursor!.end.offset).toBe(0);
    });

    it('arrowUp from a body cell lands the caret in the same column of the header row', async () => {
        const muya = bootMuya('| ab | cd |\n| --- | --- |\n| ef | gh |\n');
        const cells = tableCells(muya);

        // ArrowUp from body column 1 (`gh`).
        arrowAtStart(muya, cells[3], 'ArrowUp');
        await flush();

        // The caret keeps offset 0 in the header cell of the SAME column (`cd`).
        const headerCol1 = cells[1];
        expect(headerCol1.text).toBe('cd');
        const cursor = headerCol1.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(0);
    });

    describe.each(['ArrowUp', 'ArrowDown'] as const)('%s across empty cells', (key) => {
        it('moves from an empty cell to the start of the nonempty cell in the same column', async () => {
            const muya = bootMuya('| left | header |\n| --- | --- |\n| left | |\n| left | body |\n');
            const cells = tableCells(muya);
            const empty = cells[3];
            const target = cells[key === 'ArrowUp' ? 1 : 5];
            expect(empty.text).toBe('');
            expect(target.text).toBe(key === 'ArrowUp' ? 'header' : 'body');
            muya.editor.activeContentBlock = empty;
            empty.setCursor(0, 0, true);

            pressVertical(empty, key);
            await flush();

            expectCaretAt(target, 0);
            expect(muya.editor.verticalCursorOffset).toBe(0);
        });

        it.each([3, 'end'] as const)('forgets offset %s after crossing an empty cell', async (offset) => {
            const muya = bootMuya(
                '| left | abcdef |\n| --- | --- |\n| left | hijklmnop |\n| left | |\n| left | qrstuvwxy |\n| left | zabcde |\n',
            );
            const column = tableCells(muya).filter((_, index) => index % 2 === 1);
            if (key === 'ArrowUp')
                column.reverse();
            const [source, remembered, empty, target] = column;
            expect(empty.text).toBe('');
            expect(target.text.length).toBeGreaterThan(3);
            const startOffset = offset === 'end' ? source.text.length : offset;
            muya.editor.activeContentBlock = source;
            source.setCursor(startOffset, startOffset, true);

            // Establish real vertical memory before entering the empty cell;
            // resetting the selection between keypresses would hide stale memory.
            pressVertical(source, key);
            await flush();
            expectCaretAt(remembered, offset === 'end' ? remembered.text.length : offset);
            expect(muya.editor.verticalCursorOffset).toBe(
                offset === 'end' ? Number.POSITIVE_INFINITY : offset,
            );

            pressVertical(remembered, key);
            await flush();
            expectCaretAt(empty, 0);
            expect(muya.editor.verticalCursorOffset).toBe(0);

            pressVertical(empty, key);
            await flush();
            expectCaretAt(target, 0);
            expect(muya.editor.verticalCursorOffset).toBe(0);
        });

        it.each(['empty', 3, 'end'] as const)(
            'exits an empty header/body cell at paragraph start (starting at %s)',
            async (start) => {
                const muya = bootMuya(
                    'intro\n\n| left | |\n| --- | --- |\n| left | abcdef |\n| left | |\n\noutro\n',
                );
                const cells = tableCells(muya);
                const empty = cells[key === 'ArrowUp' ? 1 : 5];
                const source = start === 'empty' ? empty : cells[3];
                const offset = start === 'end' ? source.text.length : start === 'empty' ? 0 : start;
                const paragraph = (key === 'ArrowUp'
                    ? muya.editor.scrollPage!.firstContentInDescendant()
                    : muya.editor.scrollPage!.lastContentInDescendant()) as Content;
                expect(empty.text).toBe('');
                expect(paragraph.blockName).toBe('paragraph.content');
                expect(paragraph.text).toBe(key === 'ArrowUp' ? 'intro' : 'outro');
                const before = muya.getState();
                muya.editor.activeContentBlock = source;
                source.setCursor(offset, offset, true);

                if (start !== 'empty') {
                    pressVertical(source, key);
                    await flush();
                    expectCaretAt(empty, 0);
                    expect(muya.editor.verticalCursorOffset).toBe(0);
                }

                pressVertical(empty, key);
                await flush();
                expectCaretAt(paragraph, 0);
                expect(muya.editor.verticalCursorOffset).toBe(0);
                expect(muya.getState()).toEqual(before);
            },
        );
    });
});
