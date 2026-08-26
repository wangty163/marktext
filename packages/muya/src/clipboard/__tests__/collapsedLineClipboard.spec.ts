// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Muya } from '../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../muya';

vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => Promise.resolve([]),
    search: () => [],
}));

vi.mock('../../utils/paste', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/paste')>();
    return { ...actual, normalizePastedHTML: async (html: string) => html };
});

const bootedHosts: HTMLElement[] = [];
let hadVersion = false;
let originalVersion: string | undefined;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaClass(host, { markdown } as ConstructorParameters<typeof MuyaClass>[1]);
    muya.init();
    muya.hasFocus = () => muya.domNode.contains(document.activeElement);
    bootedHosts.push(muya.domNode);
    return muya;
}

function contentBlocks(muya: Muya): Content[] {
    const blocks: Content[] = [];
    let block: Content | null = muya.editor.scrollPage!.firstContentInDescendant();
    while (block) {
        blocks.push(block);
        block = block.nextContentInContext() ?? null;
    }
    return blocks;
}

function placeCursor(block: Content, offset: number): void {
    block.domNode!.focus();
    block.setCursor(offset, offset, true);
}

function dispatchClipboard(
    muya: Muya,
    type: 'copy' | 'cut' | 'paste',
    store = new Map<string, string>(),
): Map<string, string> {
    const clipboardData = {
        files: [],
        items: [],
        setData: (format: string, value: string) => store.set(format, value),
        getData: (format: string) => store.get(format) ?? '',
    };
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
        clipboardData: typeof clipboardData;
    };
    event.clipboardData = clipboardData;
    muya.domNode.dispatchEvent(event);
    return store;
}

async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 40));
}

describe('collapsed line clipboard', () => {
    it('cmd+C then cmd+V duplicates the current paragraph as a whole line', async () => {
        const muya = bootMuya('before\n\ncopy me\n\nafter\n');
        const line = contentBlocks(muya).find(block => block.text === 'copy me')!;
        placeCursor(line, 4);

        const clipboard = dispatchClipboard(muya, 'copy');
        expect(clipboard.get('text/plain')).toBe('copy me\n');
        expect(muya.getMarkdown()).toBe('before\n\ncopy me\n\nafter\n');

        dispatchClipboard(muya, 'paste', clipboard);
        await settle();

        expect(muya.getMarkdown()).toBe('before\n\ncopy me\n\ncopy me\n\nafter\n');
    });

    it('cmd+X cuts the current paragraph and keeps the surrounding blocks', async () => {
        const muya = bootMuya('before\n\ncut me\n\nafter\n');
        const line = contentBlocks(muya).find(block => block.text === 'cut me')!;
        placeCursor(line, 3);

        const clipboard = dispatchClipboard(muya, 'cut');
        await settle();

        expect(clipboard.get('text/plain')).toBe('cut me\n');
        expect(muya.getMarkdown()).toBe('before\n\nafter\n');
    });

    it('preserves block syntax when copying and cutting headings and list items', async () => {
        const headingMuya = bootMuya('## Heading\n\nbody\n');
        const heading = contentBlocks(headingMuya)[0];
        placeCursor(heading, 5);
        const headingClipboard = dispatchClipboard(headingMuya, 'cut');
        await settle();
        expect(headingClipboard.get('text/plain')).toBe('## Heading\n');
        expect(headingMuya.getMarkdown()).toBe('body\n');

        const listMuya = bootMuya('- one\n- two\n- three\n');
        const two = contentBlocks(listMuya).find(block => block.text === 'two')!;
        placeCursor(two, 1);
        const listClipboard = dispatchClipboard(listMuya, 'copy');
        dispatchClipboard(listMuya, 'paste', listClipboard);
        await settle();
        expect(listClipboard.get('text/plain')).toBe('- two\n');
        expect(listMuya.getMarkdown()).toBe('- one\n- two\n- two\n- three\n');
    });

    it('cuts only the logical line inside soft-break and fenced-code content', async () => {
        const paragraphMuya = bootMuya('first\nsecond\nthird\n');
        const paragraph = contentBlocks(paragraphMuya)[0];
        placeCursor(paragraph, paragraph.text.indexOf('second') + 2);
        const paragraphClipboard = dispatchClipboard(paragraphMuya, 'cut');
        await settle();
        expect(paragraphClipboard.get('text/plain')).toBe('second\n');
        expect(paragraphMuya.getMarkdown()).toBe('first\nthird\n');

        const codeMuya = bootMuya('```js\none\ntwo\nthree\n```\n');
        const code = contentBlocks(codeMuya).find(block => block.text.includes('two'))!;
        placeCursor(code, code.text.indexOf('two') + 1);
        const codeClipboard = dispatchClipboard(codeMuya, 'cut');
        await settle();
        expect(codeClipboard.get('text/plain')).toBe('two\n');
        expect(codeMuya.getMarkdown()).toBe('```js\none\nthree\n```\n');
    });

    it('keeps an enclosing list when cutting a line from its nested code block', async () => {
        const muya = bootMuya('- item\n\n  ```js\n  code\n  ```\n');
        const code = contentBlocks(muya).find(block => block.text === 'code')!;
        placeCursor(code, 2);

        const clipboard = dispatchClipboard(muya, 'cut');
        await settle();

        expect(clipboard.get('text/plain')).toBe('code');
        expect(muya.getMarkdown()).toContain('- item');
        expect(muya.getMarkdown()).toContain('```js');
    });

    it('keeps the existing selected-text cut behavior', async () => {
        const muya = bootMuya('selected tail\n');
        const block = contentBlocks(muya)[0];
        block.domNode!.focus();
        block.setCursor(0, 8, true);

        const clipboard = dispatchClipboard(muya, 'cut');
        await settle();

        expect(clipboard.get('text/plain')).toBe('selected');
        expect(muya.getMarkdown()).toBe(' tail\n');
    });

    it('keeps quote structure and removes an emptied list container', async () => {
        const quoteMuya = bootMuya('> one\n>\n> two\n');
        const two = contentBlocks(quoteMuya).find(block => block.text === 'two')!;
        placeCursor(two, 1);
        const quoteClipboard = dispatchClipboard(quoteMuya, 'copy');
        dispatchClipboard(quoteMuya, 'paste', quoteClipboard);
        await settle();
        expect(quoteClipboard.get('text/plain')).toBe('> two\n');
        expect(quoteMuya.getMarkdown()).toBe('> one\n>\n> two\n>\n> two\n');

        const listMuya = bootMuya('before\n\n- only\n\nafter\n');
        const only = contentBlocks(listMuya).find(block => block.text === 'only')!;
        placeCursor(only, 2);
        dispatchClipboard(listMuya, 'cut');
        await settle();
        expect(listMuya.getMarkdown()).toBe('before\n\nafter\n');
    });

    it('leaves collapsed table-cell clipboard behavior unchanged', async () => {
        const markdown = '| a | b |\n| - | - |\n| c | d |\n';
        const muya = bootMuya(markdown);
        const cell = contentBlocks(muya).find(block => block.text === 'b')!;
        placeCursor(cell, 1);

        const clipboard = dispatchClipboard(muya, 'cut');
        await settle();

        expect(clipboard.has('text/plain')).toBe(false);
        expect(muya.getMarkdown()).toContain('| b');
    });

    it('records a collapsed line cut as one undoable edit', async () => {
        const muya = bootMuya('one\n\ntwo\n');
        const two = contentBlocks(muya).find(block => block.text === 'two')!;
        placeCursor(two, 1);
        dispatchClipboard(muya, 'cut');
        await settle();
        expect(muya.getMarkdown()).toBe('one\n');

        muya.undo();
        await settle();
        expect(muya.getMarkdown()).toBe('one\n\ntwo\n');
    });

    it('pastes a cut last line back in its original position', async () => {
        const muya = bootMuya('one\n\ntwo\n');
        const two = contentBlocks(muya).find(block => block.text === 'two')!;
        placeCursor(two, 1);

        const clipboard = dispatchClipboard(muya, 'cut');
        await settle();
        dispatchClipboard(muya, 'paste', clipboard);
        await settle();

        expect(muya.getMarkdown()).toBe('one\n\ntwo\n');
    });
});
