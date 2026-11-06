// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { CLASS_NAMES, ZERO_WIDTH_SPACE } from '../../config';
import { getOffsetOfParagraph, normalizeCaretAnchorOffset } from '../dom';

describe('element selection offsets', () => {
    it('reads the caret before a native trailing break as a character offset', () => {
        const content = document.createElement('span');
        content.innerHTML = '<span>alpha</span><span>\n</span><br>';

        expect(normalizeCaretAnchorOffset(content, 2)).toBe(6);
    });

    it('adds the text before a nested endpoint and the children before its offset', () => {
        const content = document.createElement('span');
        content.innerHTML = '<span>alpha </span><span><b>beta</b><i> gamma</i></span>';
        const endpoint = content.lastChild!;

        expect(getOffsetOfParagraph(endpoint, content) + normalizeCaretAnchorOffset(endpoint, 1)).toBe(10);
        expect(normalizeCaretAnchorOffset(endpoint, 0)).toBe(0);
    });

    it('does not count rendered math, ruby or caret placeholders', () => {
        const content = document.createElement('span');
        content.innerHTML = `<span>alpha\n</span><span class="${CLASS_NAMES.MU_MATH_RENDER}">rendered math</span><span class="${CLASS_NAMES.MU_RUBY_RENDER}">ruby</span><span class="${CLASS_NAMES.MU_CARET_ANCHOR}">${ZERO_WIDTH_SPACE}Z</span>`;

        expect(normalizeCaretAnchorOffset(content, 3)).toBe(6);
        expect(normalizeCaretAnchorOffset(content, 4)).toBe(7);
        const anchor = content.lastChild!;
        expect(normalizeCaretAnchorOffset(anchor, 1)).toBe(1);
        expect(normalizeCaretAnchorOffset(anchor.firstChild!, 1)).toBe(0);
        expect(normalizeCaretAnchorOffset(anchor.firstChild!, 2)).toBe(1);
    });

    it('keeps text-node offsets in UTF-16 code units', () => {
        const text = document.createTextNode('中文😀text');

        expect(normalizeCaretAnchorOffset(text, 4)).toBe(4);
    });

    it('counts an image token at an element boundary inside its container', () => {
        const wrapper = document.createElement('span');
        const raw = '![alt](image.png)';
        wrapper.className = CLASS_NAMES.MU_INLINE_IMAGE;
        wrapper.setAttribute('data-raw', raw);
        wrapper.innerHTML = `<span class="${CLASS_NAMES.MU_IMAGE_CONTAINER}"><img></span>`;
        const container = wrapper.firstChild!;

        expect(normalizeCaretAnchorOffset(container, 0)).toBe(0);
        expect(normalizeCaretAnchorOffset(container, 1)).toBe(raw.length);
        expect(normalizeCaretAnchorOffset(wrapper, 1)).toBe(raw.length);
    });
});
