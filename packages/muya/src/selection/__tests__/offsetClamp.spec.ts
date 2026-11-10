// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { getLegalOffset, getNodeAndOffset, getOffsetOfParagraph, normalizeCaretAnchorOffset } from '../dom';

// Regression coverage for the `Failed to execute 'setStart' on 'Range'`
// crashes reported in #4575 / #4464 (offset past the rendered text after a
// re-render) and #4458 (offset 4294967295 = unsigned -1 from a corrupted
// browser selection). The legacy engine clamped the recorded offset to the
// node's legal range before touching the DOM Range API; the rewrite dropped
// that guard. `getLegalOffset` restores it.
describe('getNodeAndOffset line-break boundaries', () => {
    it.each([
        '<span>alpha</span><span>\n</span><span>beta</span>',
        '<span>alpha</span><span class="mu-hard-line-break"><span>  </span>\n</span><span>beta</span>',
        '<span>alpha\n</span><span>beta</span>',
    ])('places the caret in the following text after a newline in %j', (html) => {
        const content = document.createElement('span');
        content.innerHTML = html;
        const boundary = content.textContent!.indexOf('beta');
        const endpoint = getNodeAndOffset(content, boundary);

        expect(endpoint).toEqual({ node: content.lastChild!.firstChild!, offset: 0 });
        expect(getOffsetOfParagraph(endpoint.node, content) + normalizeCaretAnchorOffset(endpoint.node, endpoint.offset)).toBe(boundary);
    });

    it('keeps a terminal hard-break endpoint inside the newline', () => {
        const content = document.createElement('span');
        content.innerHTML = '<span>alpha</span><span class="mu-hard-line-break"><span>  </span>\n</span>';

        expect(getNodeAndOffset(content, 8)).toEqual({ node: content.lastChild!.lastChild!, offset: 1 });
    });

    it('does not advance an endpoint before the hard-break newline', () => {
        const content = document.createElement('span');
        content.innerHTML = '<span>alpha</span><span class="mu-hard-line-break"><span>  </span>\n</span><span>beta</span>';
        const endpoint = getNodeAndOffset(content, 7);

        expect(endpoint).toEqual({ node: content.childNodes[1].firstChild!.firstChild!, offset: 2 });
        expect(getOffsetOfParagraph(endpoint.node, content) + normalizeCaretAnchorOffset(endpoint.node, endpoint.offset)).toBe(7);
    });
});

describe('getLegalOffset', () => {
    it('clamps a text-node offset to the text length', () => {
        const text = document.createTextNode('abc');

        expect(getLegalOffset(text, 99)).toBe(3);
    });

    it('clamps an element-node offset to childNodes.length', () => {
        const el = document.createElement('span');
        el.appendChild(document.createTextNode('a'));
        el.appendChild(document.createElement('b'));

        expect(getLegalOffset(el, 99)).toBe(2);
    });

    it('coerces a negative offset to 0', () => {
        const text = document.createTextNode('abc');

        expect(getLegalOffset(text, -1)).toBe(0);
    });

    it('clamps the unsigned -1 offset (4294967295) to the text length', () => {
        const text = document.createTextNode('abc');

        expect(getLegalOffset(text, 4294967295)).toBe(3);
    });

    it('leaves an in-range offset unchanged', () => {
        const text = document.createTextNode('abcde');

        expect(getLegalOffset(text, 2)).toBe(2);
    });

    it('produces an offset Range.setStart accepts when getNodeAndOffset overflows', () => {
        const p = document.createElement('p');
        p.appendChild(document.createTextNode('hello'));
        document.body.appendChild(p);

        const { node, offset } = getNodeAndOffset(p, 999);
        const legal = getLegalOffset(node, offset);

        expect(legal).toBeLessThanOrEqual(
            node.nodeType === Node.TEXT_NODE
                ? (node as Text).length
                : node.childNodes.length,
        );
        expect(legal).toBeGreaterThanOrEqual(0);

        p.remove();
    });
});
