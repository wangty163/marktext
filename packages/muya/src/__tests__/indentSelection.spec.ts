// @vitest-environment happy-dom

import type Content from '../block/base/content';
import type { ISelection } from '../selection/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../muya';
import { SelectionCaretType, SelectionDirection } from '../selection/types';

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    vi.restoreAllMocks();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
        preserveParagraphLineBreaks: true,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

function selection(anchor: Content, anchorOffset: number, focus: Content, focusOffset: number): ISelection {
    return {
        anchor: { block: anchor, path: anchor.path, offset: anchorOffset },
        focus: { block: focus, path: focus.path, offset: focusOffset },
        isCollapsed: false,
        isSelectionInSameBlock: anchor === focus,
        direction: SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    };
}

function undoDepth(muya: Muya): number {
    // @ts-expect-error — inspect the private stack to prove one history boundary.
    return muya.editor.history._stack.undo.length;
}

describe('muya.indentSelection', () => {
    it('treats a cross-block indent as one undoable edit and restores it on redo', async () => {
        const muya = boot('alpha\n\nbravo\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;
        const selected = selection(first, 0, last, last.text.length);
        vi.spyOn(muya.editor.selection, 'getSelection').mockReturnValue(selected);

        const depth = undoDepth(muya);
        expect(muya.indentSelection('add')).toBe(true);
        expect(muya.getMarkdown()).toBe('    alpha\n    \n    bravo\n');
        expect(undoDepth(muya)).toBe(depth + 1);

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe('alpha\n\nbravo\n'));
        muya.redo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe('    alpha\n    \n    bravo\n'));
    });

    it('keeps a heading-to-paragraph range non-collapsed while indenting', () => {
        const muya = boot('# alpha\nbravo\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;
        vi.spyOn(muya.editor.selection, 'getSelection').mockReturnValue(
            selection(first, 0, last, last.text.length),
        );

        expect(muya.getCursorOffset()).toEqual({
            anchor: { line: 0, ch: 0 },
            focus: { line: 1, ch: 5 },
        });
        expect(muya.indentSelection('add')).toBe(true);
        expect(muya.getMarkdown()).toBe('    # alpha\n    bravo\n');
    });

    it('preserves the viewport and marks only the final selection restore', () => {
        const muya = boot('alpha\n\nbravo\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;
        vi.spyOn(muya.editor.selection, 'getSelection').mockReturnValue(
            selection(first, 0, last, last.text.length),
        );
        muya.domNode.scrollTop = 120;
        muya.domNode.scrollLeft = 8;
        const events: Array<{ preserveViewport?: boolean }> = [];
        muya.on('selection-change', event => events.push(event));

        expect(muya.indentSelection('add')).toBe(true);

        expect(muya.domNode.scrollTop).toBe(120);
        expect(muya.domNode.scrollLeft).toBe(8);
        expect(events.length).toBeGreaterThan(0);
        expect(events.every(event => event.preserveViewport)).toBe(true);

        muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 0);
        expect(events.at(-1)?.preserveViewport).toBe(false);
    });

    it('routes a cross-block Tab before the same-block event guard', () => {
        const muya = boot('alpha\n\nbravo\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;
        vi.spyOn(muya.editor.selection, 'getSelection').mockReturnValue(
            selection(first, 0, last, last.text.length),
        );
        const indent = vi.spyOn(muya, 'indentSelection').mockReturnValue(true);
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

        muya.domNode.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(indent).toHaveBeenCalledOnce();
        expect(indent).toHaveBeenCalledWith('add');
    });
});
