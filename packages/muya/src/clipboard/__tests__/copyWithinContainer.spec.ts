// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Muya } from '../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../muya';
import { SelectionCaretType, SelectionDirection } from '../../selection/types';

// Copying a multi-leaf selection that stays inside a single list or block-quote
// must truncate both boundary items to the caret, not carry whole items / the
// whole quote. Regression: `collectSameOutMostBlockState` pushed the whole
// block-quote and sliced list items by index without truncating their text.

vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => null,
    search: () => [],
}));

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
    const muya = new MuyaClass(host, { markdown } as ConstructorParameters<typeof MuyaClass>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function setCrossSelection(
    muya: Muya,
    anchorBlock: Content,
    anchorOffset: number,
    focusBlock: Content,
    focusOffset: number,
    backward = false,
) {
    const start = { offset: anchorOffset, block: anchorBlock, path: anchorBlock.path };
    const end = { offset: focusOffset, block: focusBlock, path: focusBlock.path };
    muya.editor.selection.setSelection(backward ? end : start, backward ? start : end);
    expect(muya.editor.selection.getSelection()).toMatchObject({
        direction: backward ? SelectionDirection.BACKWARD : SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    });
}

describe('copy within a single list', () => {
    it.each([false, true])('truncates both boundary items and keeps fully-selected middle items (backward: %s)', (backward) => {
        const muya = bootMuya('- one\n- two\n- three\n');
        const scrollPage = muya.editor.scrollPage!;

        const oneContent = scrollPage.firstContentInDescendant()!;
        const threeContent = scrollPage.lastContentInDescendant()!;

        // after "o" in "one" to after "th" in "three"
        setCrossSelection(muya, oneContent, 1, threeContent, 2, backward);

        const { text } = muya.editor.clipboard.getClipboardData();

        expect(text).toBe('- ne\n- two\n- th\n');
    });

    it.each([false, true])('copies every selected nested list row (backward: %s)', (backward) => {
        const markdown = '- 所有case重新标一下理由：买了的话写在哪里买的；\n'
            + '  - 晚上标注，明天早上回收\n'
            + '  - 记不清就不标注\n'
            + '- 人&id映射关系收集\n'
            + '- 如果需求还在进行，那么记为L3；如果需求终止了，那么记为L2\n';
        const muya = bootMuya(markdown);
        const scrollPage = muya.editor.scrollPage!;
        const start = scrollPage.firstContentInDescendant()!;
        const end = scrollPage.lastContentInDescendant()!;
        setCrossSelection(muya, start, 0, end, end.text.length, backward);

        expect(muya.editor.clipboard.getClipboardData().text).toBe(markdown);
    });

    for (const marker of ['1.', '- [ ]']) {
        it.each([false, true])(`preserves partial ${marker} list boundaries (backward: %s)`, (backward) => {
            const muya = bootMuya(`${marker} one\n${marker} two\n${marker} three\n`);
            const scrollPage = muya.editor.scrollPage!;
            setCrossSelection(
                muya,
                scrollPage.firstContentInDescendant()!,
                1,
                scrollPage.lastContentInDescendant()!,
                2,
                backward,
            );

            const expected = marker === '1.' ? '1. ne\n1. two\n1. th\n' : '- [ ] ne\n- [ ] two\n- [ ] th\n';
            expect(muya.editor.clipboard.getClipboardData().text).toBe(expected);
        });
    }
});

describe('copy within a single block-quote', () => {
    it.each([false, true])('truncates both boundary paragraphs, not the whole quote (backward: %s)', (backward) => {
        const muya = bootMuya('> alpha\n>\n> beta\n');
        const scrollPage = muya.editor.scrollPage!;

        const alphaContent = scrollPage.firstContentInDescendant()!;
        const betaContent = scrollPage.lastContentInDescendant()!;

        // after "al" in "alpha" to after "be" in "beta"
        setCrossSelection(muya, alphaContent, 2, betaContent, 2, backward);

        const { text } = muya.editor.clipboard.getClipboardData();

        expect(text).toBe('> pha\n>\n> be\n');
    });
});
