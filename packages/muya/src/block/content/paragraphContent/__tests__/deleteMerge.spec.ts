// @vitest-environment happy-dom

import type Content from '../../../base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';

// DATA-LOSS GUARD — forward-Delete-at-end-of-paragraph block merge.
//
// Pressing Delete at the very end of a paragraph appends the NEXT paragraph onto
// it and removes the now-empty next block. The handler performs that merge in the
// model itself, so it MUST call `event.preventDefault()` — otherwise the browser
// also runs its native forward-delete on the freshly merged paragraph, eating the
// first character of the appended text (`alpha` + `beta` -> `alphaeta`). The
// preventDefault assertion below is the regression guard for that drop.

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

function contentByText(muya: Muya, text: string): Content {
    let target: Content | null = null;
    const visit = (block: {
        text?: string;
        constructor: { blockName?: string };
        children?: { forEach: (cb: (b: unknown) => void) => void };
    }) => {
        if (block.constructor.blockName?.endsWith('.content') && block.text === text)
            target = block as unknown as Content;
        block.children?.forEach(b => visit(b as typeof block));
    };
    visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);
    if (!target)
        throw new Error(`content block with text "${text}" not found`);
    return target;
}

// Land the caret at the end of the given content block (active block + cursor),
// then route a Delete through its handler the way the keydown listener does.
function deleteAtEnd(muya: Muya, content: Content): { preventDefault: ReturnType<typeof vi.fn> } {
    muya.editor.activeContentBlock = content;
    const offset = content.text.length;
    content.setCursor(offset, offset, true);
    const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        key: 'Delete',
    } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
    content.deleteHandler(event);
    return event;
}

function backspaceAtStart(muya: Muya, content: Content): void {
    muya.editor.activeContentBlock = content;
    content.setCursor(0, 0, true);
    content.backspaceHandler({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        key: 'Backspace',
    } as unknown as KeyboardEvent);
}

function flush(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

function blockText(state: ReturnType<Muya['getState']>, index: number): string {
    return (state[index] as { text: string }).text;
}

describe('forward Delete at end-of-paragraph — merge with next block', () => {
    it('appends `beta` onto the end of `alpha` into a single paragraph', async () => {
        const muya = bootMuya('alpha\n\nbeta\n');
        const alpha = contentByText(muya, 'alpha');

        deleteAtEnd(muya, alpha);

        await flush();
        const state = muya.getState();
        expect(state.length).toBe(1);
        expect(state[0].name).toBe('paragraph');
        expect(blockText(state, 0)).toBe('alphabeta');
    });

    it('calls preventDefault so the native delete cannot drop the first appended char', () => {
        const muya = bootMuya('alpha\n\nbeta\n');
        const alpha = contentByText(muya, 'alpha');

        const event = deleteAtEnd(muya, alpha);

        expect(event.preventDefault).toHaveBeenCalled();
    });

    it('lands the caret at the join point (end of the former first paragraph)', async () => {
        const muya = bootMuya('alpha\n\nbeta\n');
        const alpha = contentByText(muya, 'alpha');

        deleteAtEnd(muya, alpha);

        await flush();
        const merged = contentByText(muya, 'alphabeta');
        const cursor = merged.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(5);
    });
});

describe('deleting an imported list gap', () => {
    it.each([
        ['- one\n\n- two\n', '- one\n- two\n'],
        ['1. one\n\n2. two\n', '1. one\n2. two\n'],
        ['- [ ] one\n\n- [ ] two\n', '- [ ] one\n- [ ] two\n'],
    ])('removes the source gap in %j', async (markdown, expected) => {
        const muya = bootMuya(markdown);

        backspaceAtStart(muya, contentByText(muya, ''));

        await flush();
        expect(muya.getMarkdown()).toBe(expected);
    });

    it('also removes the source gap with forward Delete from the previous item', async () => {
        const muya = bootMuya('- one\n\n- two\n');

        deleteAtEnd(muya, contentByText(muya, 'one'));

        await flush();
        expect(muya.getMarkdown()).toBe('- one\n- two\n');
    });
});

// #1845 — forward-Delete at the end of an empty list item must pull the next
// item's WHOLE content up, not just its paragraph. The next item held a nested
// sublist (`- D`) as a sibling of its paragraph; merging only the paragraph and
// removing it stranded that sublist as the item's sole child, which serializes
// with a doubled bullet (`* - D`).
describe('forward Delete merging a list item that owns a nested sublist (#1845)', () => {
    function emptyFirstItemThenDelete(muya: Muya): void {
        const first = contentByText(muya, 'a');
        first.text = '';
        // The first Delete removes the now-editable blank line; the second
        // reaches the next list item and exercises the original merge path.
        deleteAtEnd(muya, first);
        deleteAtEnd(muya, first);
    }

    it('does not strand the nested sublist with a doubled bullet', async () => {
        const muya = bootMuya('* a\n\n* C\n  \n  - D\n');

        emptyFirstItemThenDelete(muya);

        await flush();
        const markdown = muya.getMarkdown();
        expect(markdown).not.toMatch(/\*\s+-\s+D/);
        expect(markdown).toContain('  - D');
    });

    it('moves the merged text and sublist into the first item and drops the empty one', async () => {
        const muya = bootMuya('* a\n\n* C\n  \n  - D\n');

        emptyFirstItemThenDelete(muya);

        await flush();
        const state = muya.getState();
        expect(state.length).toBe(1);
        const list = state[0] as { name: string; children: unknown[] };
        expect(list.name).toBe('bullet-list');
        expect(list.children.length).toBe(1);
        const item = list.children[0] as { name: string; children: unknown[] };
        expect(item.name).toBe('list-item');
        expect(item.children[0]).toMatchObject({ name: 'paragraph', text: 'C' });
        expect(item.children[1]).toMatchObject({ name: 'paragraph', text: '' });
        expect(item.children[2]).toMatchObject({ name: 'bullet-list' });
        const sublist = item.children[2] as { children: Array<{ children: unknown[] }> };
        expect(sublist.children[0].children[0]).toMatchObject({
            name: 'paragraph',
            text: 'D',
        });
    });
});

describe('forward Delete at end of a code block — no merge', () => {
    it('leaves the state unchanged (codeBlockContent has no merging deleteHandler)', async () => {
        const muya = bootMuya('```js\nx\n```\n');
        const before = JSON.stringify(muya.getState());
        const code = contentByText(muya, 'x');

        deleteAtEnd(muya, code);

        await flush();
        const after = JSON.stringify(muya.getState());
        expect(after).toBe(before);
        const state = muya.getState();
        expect(state.length).toBe(1);
        expect(state[0].name).toBe('code-block');
    });

    it('preventDefaults at end-of-text but performs no model merge', () => {
        const muya = bootMuya('```js\nx\n```\n');
        const code = contentByText(muya, 'x');

        const event = deleteAtEnd(muya, code);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(code.text).toBe('x');
    });
});
