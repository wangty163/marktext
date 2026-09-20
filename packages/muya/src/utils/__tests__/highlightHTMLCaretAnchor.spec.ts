import { describe, expect, it } from 'vitest';
import { CLASS_NAMES, ZERO_WIDTH_SPACE } from '../../config';
import { getHighlightHtml, MARKER_HASH } from '../highlightHTML';

// A code block whose text ends in a newline renders that newline as a
// `mu-line-end` span. The caret after it sits behind the last line break, where
// the browser has no layout position to paint an insertion point, so pressing
// Enter on the last line of a code block made the caret vanish. The renderer
// parks the same zero-width anchor the inline line-break renderers use.
describe('getHighlightHtml parks a caret anchor after a trailing line break', () => {
    it('adds the anchor after the line-end span', () => {
        const html = getHighlightHtml('code\n', [], false, true);

        expect(html).toContain(`class="${CLASS_NAMES.MU_LINE_END}"`);
        expect(html).toContain(`class="${CLASS_NAMES.MU_CARET_ANCHOR}"`);
        expect(html).toContain(ZERO_WIDTH_SPACE);
        expect(html.lastIndexOf(CLASS_NAMES.MU_CARET_ANCHOR))
            .toBeGreaterThan(html.lastIndexOf(CLASS_NAMES.MU_LINE_END));
    });

    it('adds the anchor when the trailing newline follows highlighted text', () => {
        const html = getHighlightHtml(
            'code\n',
            [{ start: 0, end: 5, active: true }],
            false,
            true,
        );

        expect(html).toContain(CLASS_NAMES.MU_HIGHLIGHT);
        expect(html).toContain(`class="${CLASS_NAMES.MU_CARET_ANCHOR}"`);
        expect(html.lastIndexOf(CLASS_NAMES.MU_CARET_ANCHOR))
            .toBeGreaterThan(html.lastIndexOf(CLASS_NAMES.MU_HIGHLIGHT));
    });

    it('adds no anchor when the text does not end with a newline', () => {
        expect(getHighlightHtml('code', [], false, true))
            .not
            .toContain(CLASS_NAMES.MU_CARET_ANCHOR);
    });

    it('adds no anchor when line-ending handling is off', () => {
        // The language-input row reuses this helper without line-ending
        // handling; it must stay free of anchors.
        expect(getHighlightHtml('code\n', [], true))
            .not
            .toContain(CLASS_NAMES.MU_CARET_ANCHOR);
    });

    it('emits the escaped marker form when escape is on', () => {
        const html = getHighlightHtml('code\n', [], true, true);

        expect(html).toContain(
            `${MARKER_HASH['"']}${CLASS_NAMES.MU_CARET_ANCHOR}${MARKER_HASH['"']}`,
        );
        expect(html).toContain(ZERO_WIDTH_SPACE);
    });
});
