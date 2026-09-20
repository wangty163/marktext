// @vitest-environment happy-dom

import type Content from '../../../base/content';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLASS_NAMES, ZERO_WIDTH_SPACE } from '../../../../config';
import { Muya } from '../../../../muya';

// Pressing Enter on the last line of a code block appends a trailing newline,
// which the block renders as a `mu-line-end` span. The caret behind it had no
// layout position, so it disappeared. The renderer now parks a zero-width caret
// anchor there — which means the block's own input handler must not read that
// character back into the code text.

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

function codeContent(muya: Muya): Content {
    let target: Content | null = null;
    const visit = (block: {
        constructor: { blockName?: string };
        children?: { forEach: (cb: (b: unknown) => void) => void };
    }) => {
        if (block.constructor.blockName === 'codeblock.content')
            target = block as unknown as Content;
        block.children?.forEach(b => visit(b as typeof block));
    };
    visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);
    if (!target)
        throw new Error('codeblock.content block not found');

    return target;
}

describe('code block caret anchor after a trailing newline', () => {
    it('renders the anchor after the line-end span', () => {
        const muya = bootMuya('```\ncode\n```\n');
        const content = codeContent(muya) as unknown as { text: string; update: () => void; domNode: HTMLElement };

        content.text = 'code\n';
        content.update();

        const html = content.domNode.innerHTML;
        expect(html).toContain(CLASS_NAMES.MU_LINE_END);
        expect(html).toContain(CLASS_NAMES.MU_CARET_ANCHOR);
        expect(html.lastIndexOf(CLASS_NAMES.MU_CARET_ANCHOR))
            .toBeGreaterThan(html.lastIndexOf(CLASS_NAMES.MU_LINE_END));
    });

    it('renders no anchor while the text does not end with a newline', () => {
        const muya = bootMuya('```\ncode\n```\n');
        const content = codeContent(muya) as unknown as { text: string; update: () => void; domNode: HTMLElement };

        content.text = 'code';
        content.update();

        expect(content.domNode.innerHTML).not.toContain(CLASS_NAMES.MU_CARET_ANCHOR);
    });

    it('keeps the anchor out of the text the input handler reads back', () => {
        const muya = bootMuya('```\ncode\n```\n');
        const content = codeContent(muya) as unknown as {
            text: string;
            update: () => void;
            domNode: HTMLElement;
            inputHandler: (event: Event) => void;
        };

        content.text = 'code\n';
        content.update();
        // The rendered DOM carries the anchor character...
        expect(content.domNode.textContent).toContain(ZERO_WIDTH_SPACE);

        // Simulate the browser having inserted an `X` at the caret, which sits
        // after the newline inside the anchor: the anchor span now holds the
        // typed character ahead of its own zero-width space.
        content.domNode.innerHTML = `code<span class="${CLASS_NAMES.MU_LINE_END}">\n</span>`
            + `<span class="${CLASS_NAMES.MU_CARET_ANCHOR}">X${ZERO_WIDTH_SPACE}</span>`;
        // Point the DOM selection at the insertion point the browser would have
        // left behind, so `getCursor()` resolves the way it does live.
        const anchorText = content.domNode.querySelector(
            `.${CLASS_NAMES.MU_CARET_ANCHOR}`,
        )!.firstChild as Text;
        const range = document.createRange();
        range.setStart(anchorText, 1);
        range.collapse(true);
        const selection = document.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        content.inputHandler(new InputEvent('input', { inputType: 'insertText', data: 'X' }));

        // The block text gains the typed character and nothing else.
        expect(content.text).toBe('code\nX');
        expect(content.text).not.toContain(ZERO_WIDTH_SPACE);
        expect(muya.getMarkdown()).not.toContain(ZERO_WIDTH_SPACE);
    });

    it('leaves the markdown of a block ending in a newline free of the anchor', () => {
        const muya = bootMuya('```\ncode\n```\n');
        const content = codeContent(muya) as unknown as { text: string; update: () => void };

        content.text = 'code\n';
        content.update();

        expect(muya.getMarkdown()).not.toContain(ZERO_WIDTH_SPACE);
    });
});
