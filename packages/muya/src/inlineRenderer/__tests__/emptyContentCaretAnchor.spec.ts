// @vitest-environment happy-dom

import type Format from '../../block/base/format';
import type { TState } from '../../state/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLASS_NAMES, ZERO_WIDTH_SPACE } from '../../config';
import { Muya } from '../../muya';
import { getTextContent, OFFSET_BLACKLIST } from '../../selection/dom';

// An empty content block used to render to an empty string. A collapsed range
// inside an empty inline element has no client rect, so the browser had nowhere
// to paint an insertion point: after Enter at the end of a heading, list item,
// table cell or blockquote paragraph — anywhere that creates a fresh empty
// block — the caret disappeared even though the selection was set and typing
// still worked. `InlineRenderer.patch` now parks the zero-width caret anchor in
// that case.

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
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

function bootMuyaState(json: TState[]): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { json } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);

    return muya;
}

function firstContent(muya: Muya): Format {
    return muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format;
}

describe('an empty content block keeps a paintable caret position', () => {
    it('renders the caret anchor into an empty paragraph', () => {
        const muya = bootMuya('');
        const content = firstContent(muya);

        expect(content.text).toBe('');
        expect(content.domNode!.innerHTML)
            .toBe(`<span class="${CLASS_NAMES.MU_CARET_ANCHOR}">${ZERO_WIDTH_SPACE}</span>`);
    });

    it('renders the anchor for an empty block created after a heading', () => {
        // Enter at the end of a heading appends an empty paragraph after it.
        // Markdown cannot express that trailing empty block, so build the state
        // the handler produces.
        const muya = bootMuyaState([
            { name: 'atx-heading', meta: { level: 1 }, text: '# Title' },
            { name: 'paragraph', text: '' },
        ]);
        const blocks: Format[] = [];
        const visit = (block: {
            constructor: { blockName?: string };
            children?: { forEach: (cb: (b: unknown) => void) => void };
        }) => {
            if (block.constructor.blockName?.endsWith('.content'))
                blocks.push(block as unknown as Format);
            block.children?.forEach(child => visit(child as typeof block));
        };
        visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);

        const empty = blocks.find(block => block.text === '');
        expect(empty, 'expected an empty content block in the document').toBeTruthy();
        expect(empty!.domNode!.innerHTML).toContain(CLASS_NAMES.MU_CARET_ANCHOR);
    });

    it('drops the anchor once the block has text', () => {
        const muya = bootMuya('');
        const content = firstContent(muya) as unknown as { text: string; update: () => void };

        content.text = 'typed';
        content.update();

        expect(content.text).toBe('typed');
        expect((content as unknown as { domNode: HTMLElement }).domNode.innerHTML)
            .not
            .toContain(CLASS_NAMES.MU_CARET_ANCHOR);
        expect((content as unknown as { domNode: HTMLElement }).domNode.textContent)
            .toContain('typed');
    });

    it('keeps the anchor invisible to model offsets', () => {
        const muya = bootMuya('');
        const content = firstContent(muya);
        const domNode = content.domNode!;

        // The rendered text is empty as far as offsets are concerned, while the
        // raw DOM text still holds the zero-width space the browser needs.
        expect(getTextContent(domNode, OFFSET_BLACKLIST)).toBe('');
        expect(domNode.textContent).toBe(ZERO_WIDTH_SPACE);
    });
});
