// @vitest-environment happy-dom

import type Format from '../../block/base/format';
import type { TState } from '../../state/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
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

function firstContent(muya: Muya): Format {
    return muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format;
}

function stateText(muya: Muya): string {
    return (muya.editor.jsonState.getState()[0] as TState & { text?: string }).text ?? '';
}

// `JSONState` batches every edit into an operation cache and applies it on the
// next animation frame, so right after a keystroke the DOM shows the new text
// while the json state still holds the old one. Undo inverts its top entry
// against `jsonState.getState()`, so running it inside that window used to
// invert against a document the entry was never built from: fast typing
// followed by Cmd+Z produced text the user had never typed (`hello world`
// undid to `helld`), and which undo step fired depended on frame timing.
describe('undo/redo against a pending edit batch', () => {
    it('undo applies the queued edit first and then reverts exactly that edit', () => {
        const muya = bootMuya('hello\n');
        const content = firstContent(muya) as unknown as { text: string };

        content.text = 'hello world';
        // The batch has not landed: the json state is still the pre-edit doc.
        expect(stateText(muya)).toBe('hello');

        muya.undo();

        // The queued edit is applied and recorded before the undo runs, so the
        // undo reverts that edit and the document is a state the user had.
        expect(muya.getMarkdown()).toBe('hello\n');
        expect(stateText(muya)).toBe('hello');
        expect(content.text).toBe('hello');
    });

    it('redo after that undo restores the flushed edit', () => {
        const muya = bootMuya('hello\n');
        const content = firstContent(muya) as unknown as { text: string };

        content.text = 'hello world';
        muya.undo();
        expect(stateText(muya)).toBe('hello');

        muya.redo();
        expect(stateText(muya)).toBe('hello world');
        expect(content.text).toBe('hello world');
    });

    it('undo right after an edit leaves a document the user actually had', () => {
        const muya = bootMuya('hello\n');
        const content = firstContent(muya) as unknown as { text: string };

        content.text = 'hello world';
        muya.undo();

        // The flush records the pending batch, so the undo reverts it wholesale:
        // the document is either the pre-edit text or the typed text, never a
        // mix of the two, and the json state and the block agree.
        expect(['hello', 'hello world']).toContain(stateText(muya));
        expect(content.text).toBe(stateText(muya));
    });
});
