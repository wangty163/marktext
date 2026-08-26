// @vitest-environment happy-dom

import type Content from '../../../base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';

// ENTER-SPLIT GUARD — pressing Enter mid-paragraph splits the block in two.
//
// `ParagraphContent.enterHandler` routes a plain (non-shift) Enter on a
// top-level paragraph through `_enterConvert`, which — when the text is not a
// block-conversion trigger — falls through to `Format.enterHandler`. That base
// handler keeps the text BEFORE the caret on the original block, moves the text
// AFTER the caret onto a freshly inserted sibling paragraph, and drops the
// caret at offset 0 of the new block. These characterization tests drive the
// handler the way the keydown listener does and assert the resulting document
// state after the json1 op flushes on the next frame.

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

// Find the leaf `.content` block whose rendered text matches `text`, the way a
// click resolves the active content block.
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

// Land the caret at `offset` of the given content block (active block + cursor),
// then route an Enter through its handler the way the keydown listener does.
function enterAt(muya: Muya, content: Content, offset: number): { preventDefault: ReturnType<typeof vi.fn> } {
    muya.editor.activeContentBlock = content;
    content.setCursor(offset, offset, true);
    const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        shiftKey: false,
        key: 'Enter',
    } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
    content.enterHandler(event);
    return event;
}

function flush(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

function listDepth(content: Content): number {
    let parent = content.parent;
    let depth = 0;
    while (parent && !parent.isScrollPage) {
        if (parent.blockName === 'list-item' || parent.blockName === 'task-list-item')
            depth++;
        parent = parent.parent;
    }
    return depth;
}

// `getState()` returns a discriminated `TState` union; only some variants carry
// `text`. The blocks asserted here are paragraphs, so narrow to read it.
function blockText(state: ReturnType<Muya['getState']>, index: number): string {
    return (state[index] as { text: string }).text;
}

describe('enter mid-paragraph — split into two paragraphs', () => {
    it('keeps `hello` on the first block and moves ` world` onto the new block', async () => {
        const muya = bootMuya('hello world\n');
        const content = contentByText(muya, 'hello world');

        enterAt(muya, content, 5);

        await flush();
        const state = muya.getState();
        expect(state.length).toBe(2);
        expect(state[0].name).toBe('paragraph');
        expect(state[1].name).toBe('paragraph');
        expect(blockText(state, 0)).toBe('hello');
        expect(blockText(state, 1)).toBe(' world');
    });

    it('lands the caret at offset 0 of the new (second) block', async () => {
        const muya = bootMuya('hello world\n');
        const content = contentByText(muya, 'hello world');

        enterAt(muya, content, 5);

        await flush();
        const newBlock = contentByText(muya, ' world');
        const cursor = newBlock.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(0);
    });

    it('calls preventDefault so the browser cannot also insert a native newline', () => {
        const muya = bootMuya('hello world\n');
        const content = contentByText(muya, 'hello world');

        const event = enterAt(muya, content, 5);

        expect(event.preventDefault).toHaveBeenCalled();
    });
});

describe('enter at offset 0 — all text moves to the new block', () => {
    it('leaves the first block empty and carries the whole text onto the second', async () => {
        const muya = bootMuya('hello world\n');
        const content = contentByText(muya, 'hello world');

        enterAt(muya, content, 0);

        await flush();
        const state = muya.getState();
        expect(state.length).toBe(2);
        expect(state[0].name).toBe('paragraph');
        expect(state[1].name).toBe('paragraph');
        expect(blockText(state, 0)).toBe('');
        expect(blockText(state, 1)).toBe('hello world');
    });

    it('lands the caret at offset 0 of the new block holding the text', async () => {
        const muya = bootMuya('hello world\n');
        const content = contentByText(muya, 'hello world');

        enterAt(muya, content, 0);

        await flush();
        const newBlock = contentByText(muya, 'hello world');
        const cursor = newBlock.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(0);
    });
});

describe('enter at end-of-text — appends an empty paragraph with the caret in it', () => {
    it('keeps the full text on the first block and adds an empty second block', async () => {
        const muya = bootMuya('hello world\n');
        const content = contentByText(muya, 'hello world');

        enterAt(muya, content, content.text.length);

        await flush();
        const state = muya.getState();
        expect(state.length).toBe(2);
        expect(state[0].name).toBe('paragraph');
        expect(state[1].name).toBe('paragraph');
        expect(blockText(state, 0)).toBe('hello world');
        expect(blockText(state, 1)).toBe('');
    });

    it('lands the caret at offset 0 of the new empty block', async () => {
        const muya = bootMuya('hello world\n');
        const content = contentByText(muya, 'hello world');

        enterAt(muya, content, content.text.length);

        await flush();
        const state = muya.getState();
        expect(blockText(state, 1)).toBe('');
        const empty = contentByText(muya, '');
        const cursor = empty.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(0);
    });
});

describe('enter at the end of a list row', () => {
    it.each([
        {
            name: 'bullet',
            markdown: '- parent\n  - child\n',
            nestedListName: 'bullet-list',
            expected: '- parent\n  * \n  * child\n',
            afterUnindent: '- parent\n- \n  - child\n',
        },
        {
            name: 'ordered',
            markdown: '1. parent\n   1. child\n',
            nestedListName: 'order-list',
            expected: '1. parent\n   1. \n   2. child\n',
            afterUnindent: '1. parent\n2. \n   1. child\n',
        },
        {
            name: 'task',
            markdown: '- [ ] parent\n  - [ ] child\n',
            nestedListName: 'task-list',
            expected: '- [ ] parent\n  - [ ] \n  - [ ] child\n',
            afterUnindent: '- [ ] parent\n- [ ] \n  - [ ] child\n',
        },
    ])('inserts an empty $name child before the existing child list', async ({
        markdown,
        nestedListName,
        expected,
        afterUnindent,
    }) => {
        const muya = bootMuya(markdown);
        const parent = contentByText(muya, 'parent');

        enterAt(muya, parent, parent.text.length);

        await flush();
        const outer = muya.getState()[0] as {
            children: Array<{ children: Array<{ name: string; children?: unknown[] }> }>;
        };
        const nestedList = outer.children[0].children[1];
        expect(nestedList.name).toBe(nestedListName);
        expect(nestedList.children).toHaveLength(2);
        let active = muya.editor.activeContentBlock!;
        expect(active.text).toBe('');
        expect(listDepth(active)).toBe(2);
        expect(muya.getMarkdown()).toBe(expected);

        enterAt(muya, active, 0);
        await flush();
        active = muya.editor.activeContentBlock!;
        expect(active.text).toBe('');
        expect(listDepth(active)).toBe(1);
        expect(muya.getMarkdown()).toBe(afterUnindent);
    });

    it.each([
        { name: 'bullet', markdown: '- parent\n', expected: '- parent\n- \n' },
        { name: 'ordered', markdown: '1. parent\n', expected: '1. parent\n2. \n' },
        { name: 'task', markdown: '- [ ] parent\n', expected: '- [ ] parent\n- [ ] \n' },
    ])('inserts an empty $name sibling when there is no child list', async ({
        markdown,
        expected,
    }) => {
        const muya = bootMuya(markdown);
        const parent = contentByText(muya, 'parent');

        enterAt(muya, parent, parent.text.length);

        await flush();
        const list = muya.getState()[0] as { children: unknown[] };
        expect(list.children).toHaveLength(2);
        expect(muya.editor.activeContentBlock?.text).toBe('');
        expect(muya.getMarkdown()).toBe(expected);
    });

    it('undoes and redoes the child insertion as one edit', async () => {
        const muya = bootMuya('- parent\n  - child\n');
        const parent = contentByText(muya, 'parent');

        enterAt(muya, parent, parent.text.length);
        await flush();
        expect(muya.getMarkdown()).toBe('- parent\n  * \n  * child\n');

        muya.undo();
        await flush();
        expect(muya.getMarkdown()).toBe('- parent\n  - child\n');

        muya.redo();
        await flush();
        expect(muya.getMarkdown()).toBe('- parent\n  * \n  * child\n');
    });
});

describe('enter on an imported list gap', () => {
    it('creates a sibling item, then unindents once per Enter before using the gap', async () => {
        const muya = bootMuya('- outer\n  - middle\n    - inner\n\n- next\n');
        let content = contentByText(muya, 'inner');
        const depths = [];

        for (let i = 0; i < 4; i++) {
            enterAt(muya, content, content.text.length);
            await flush();
            content = muya.editor.activeContentBlock!;
            depths.push(listDepth(content));
        }

        expect(depths).toEqual([3, 2, 1, 0]);
        expect(muya.getMarkdown()).toBe('- outer\n  - middle\n    - inner\n\n- next\n');
    });
});
