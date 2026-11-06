// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Nullable } from '../../types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    document.getSelection()?.removeAllRanges();
    delete (window as Partial<Window>).MUYA_VERSION;
});

function boot(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

function blockAt(muya: Muya, text: string): Content {
    let block: Nullable<Content> = muya.editor.scrollPage!.firstContentInDescendant();
    while (block && block.text !== text)
        block = block.nextContentInContext();
    if (!block)
        throw new Error(`Missing content: ${text}`);
    return block;
}

function selection(muya: Muya) {
    const range = muya.editor.selection.getSelection();
    return range && {
        anchor: range.anchor.offset,
        focus: range.focus.offset,
        anchorText: range.anchor.block.text,
        focusText: range.focus.block.text,
    };
}

function insert(muya: Muya, block: Content, offset: number, text: string) {
    block.setCursor(offset, offset, true);
    block.text = block.text.slice(0, offset) + text + block.text.slice(offset);
    block.setCursor(offset + text.length, offset + text.length, true);
    muya.editor.jsonState.flush();
}

describe('undo and redo selection snapshots', () => {
    it.each([false, true])('restores the first deleted range, including its direction (%s)', (backward) => {
        const muya = boot('alpha\nbeta\n');
        const block = blockAt(muya, 'alpha\nbeta');
        block.setCursor(backward ? 10 : 6, backward ? 6 : 10, true);
        const before = selection(muya);

        muya.editor.clipboard.cutHandler();
        muya.editor.jsonState.flush();
        expect(block.text).toBe('alpha\n');
        muya.undo();

        expect(selection(muya)).toEqual(before);
        expect(muya.getMarkdown()).toBe('alpha\nbeta\n');
    });

    it('uses the new editing location after moving to another block', () => {
        const muya = boot('first\n\nsecond\n');
        insert(muya, blockAt(muya, 'first'), 5, 'X');
        insert(muya, blockAt(muya, 'second'), 3, 'Y');

        muya.undo();

        expect(muya.getMarkdown()).toBe('firstX\n\nsecond\n');
        expect(selection(muya)).toEqual({ anchor: 3, focus: 3, anchorText: 'second', focusText: 'second' });
        muya.undo();
        expect(selection(muya)).toEqual({ anchor: 5, focus: 5, anchorText: 'first', focusText: 'first' });
    });

    it('keeps the edit-end caret through serialization and navigation before undo/redo', () => {
        const muya = boot('alpha\n\nother\n');
        insert(muya, blockAt(muya, 'alpha'), 3, 'X');
        muya.setHistory(JSON.parse(JSON.stringify(muya.getHistory())));
        blockAt(muya, 'other').setCursor(1, 1, true);

        muya.undo();
        expect(selection(muya)).toEqual({ anchor: 3, focus: 3, anchorText: 'alpha', focusText: 'alpha' });
        blockAt(muya, 'other').setCursor(2, 2, true);
        muya.redo();
        expect(selection(muya)).toEqual({ anchor: 4, focus: 4, anchorText: 'alpXha', focusText: 'alpXha' });
        muya.undo();
        expect(selection(muya)).toEqual({ anchor: 3, focus: 3, anchorText: 'alpha', focusText: 'alpha' });
    });

    it('coalesces consecutive typing with the first start and final end caret', () => {
        const muya = boot('alpha\n');
        const block = blockAt(muya, 'alpha');
        insert(muya, block, 3, 'X');
        insert(muya, block, 4, 'Y');
        expect(muya.getHistory().stack.undo).toHaveLength(1);

        muya.undo();
        expect(selection(muya)).toEqual({ anchor: 3, focus: 3, anchorText: 'alpha', focusText: 'alpha' });
        muya.redo();
        expect(selection(muya)).toEqual({ anchor: 5, focus: 5, anchorText: 'alpXYha', focusText: 'alpXYha' });
    });

    it('restores both endpoints after a cross-block delete rebuilds the removed blocks', () => {
        const muya = boot('first\n\nsecond\n');
        const first = blockAt(muya, 'first');
        const last = blockAt(muya, 'second');
        muya.editor.selection.setSelection(
            { block: last, path: last.path, offset: 3 },
            { block: first, path: first.path, offset: 2 },
        );
        const before = selection(muya);
        muya.editor.clipboard.cutHandler();
        muya.editor.jsonState.flush();

        muya.undo();

        expect(selection(muya)).toEqual(before);
        expect(muya.getMarkdown()).toBe('first\n\nsecond\n');
    });
});
