// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Muya as MuyaType } from '../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

// Clicking a task-list checkbox used to yank the viewport back to the caret.
//
// The checkbox is an `input[type=checkbox]` with `contenteditable="false"`
// embedded in the document, so toggling it fires a DOM `input` event that
// bubbles to the editor root. `Editor._dispatchEvents` routed every `input` to
// the block that owns the caret — a paragraph the click never touched —
// replaying a non-edit as an edit there (auto-pair + undo-boundary
// bookkeeping, then `setCursor`) and emitting `selection-change`. Hosts treat
// that event as "the caret moved" and scroll it back into view, so a checkbox
// far below the caret snapped the viewport to the caret.
//
// The guard: an event from a non-editable widget is not a document edit. These
// tests pin both halves — the widget event is dropped, and real typing into the
// editable surface is still routed.

const MARKDOWN = 'caret stays here\n\n- [ ] buy milk\n- [ ] ship it\n';

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

function bootMuya(markdown = MARKDOWN): MuyaType {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);

    return muya;
}

/** The first paragraph content block, with a collapsed caret at `offset`. */
function caretInFirstParagraph(muya: MuyaType, offset = 3): Content {
    const block = muya.editor.scrollPage!.firstContentInDescendant()!;
    block.setCursor(offset, offset);

    return block;
}

function firstCheckbox(muya: MuyaType): HTMLInputElement {
    const checkbox = muya.domNode.querySelector<HTMLInputElement>('input.mu-task-list-checkbox');
    if (!checkbox)
        throw new Error('no task-list checkbox was rendered');

    return checkbox;
}

function countSelectionChanges(muya: MuyaType): () => number {
    let count = 0;
    muya.eventCenter.subscribe('selection-change', () => {
        count += 1;
    });

    return () => count;
}

// happy-dom's MouseEvent omits the `x`/`y` accessors that `isMouseEvent`
// (`'x' in event`) keys off; define them so the checkbox's own click handler
// treats the synthetic event like a real pointer event (real browsers and the
// e2e expose `x` natively).
function fireClick(node: HTMLElement): void {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    if (!('x' in event))
        Object.defineProperty(event, 'x', { value: 0, configurable: true });

    node.dispatchEvent(event);
}

describe('widget `input` events are not document edits', () => {
    it('does not route a task-list checkbox `input` event to the caret block', () => {
        const muya = bootMuya();
        const paragraph = caretInFirstParagraph(muya);
        const selectionChanges = countSelectionChanges(muya);
        const inputHandler = vi.spyOn(paragraph, 'inputHandler');

        // The browser flips `checked` in pre-click activation, then fires
        // `input` (a plain Event: no `inputType`) from the checkbox itself.
        const checkbox = firstCheckbox(muya);
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('input', { bubbles: true }));

        expect(inputHandler).not.toHaveBeenCalled();
        expect(selectionChanges()).toBe(0);
        expect(paragraph.text).toBe('caret stays here');
    });

    it('keeps the checkbox toggle itself working (state op + json-change)', () => {
        const muya = bootMuya();
        caretInFirstParagraph(muya);
        const jsonChanges: unknown[] = [];
        muya.eventCenter.subscribe('json-change', () => jsonChanges.push(true));

        const checkbox = firstCheckbox(muya);
        // happy-dom runs the checkbox's activation behavior for a dispatched
        // click, exactly like a browser: `checked` flips first, then `input`.
        fireClick(checkbox);
        checkbox.dispatchEvent(new Event('input', { bubbles: true }));
        // The engine batches state ops into the next animation frame.
        muya.editor.jsonState.flush();

        expect(checkbox.classList.contains('mu-checkbox-checked')).toBe(true);
        expect(jsonChanges.length).toBeGreaterThan(0);
        expect(muya.getMarkdown()).toContain('- [x] buy milk');
        expect(muya.getMarkdown()).toContain('- [ ] ship it');
    });

    it('still routes a real text edit from the editable surface', () => {
        const muya = bootMuya();
        const paragraph = caretInFirstParagraph(muya);
        const inputHandler = vi.spyOn(paragraph, 'inputHandler');

        // A contenteditable edit reports the editing host as its target and
        // carries an `inputType`.
        const editableHost = paragraph.domNode!.closest<HTMLElement>('[contenteditable="true"]')!;
        editableHost.dispatchEvent(
            new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'X' }),
        );

        expect(inputHandler).toHaveBeenCalledTimes(1);
    });
});
