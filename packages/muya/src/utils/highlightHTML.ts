import type { IHighlight } from '../inlineRenderer/types';
import { CLASS_NAMES, ZERO_WIDTH_SPACE } from '../config';
import { getLongUniqueId } from '../utils';

// TODO: @jocs any better solutions?
export const MARKER_HASH = {
    '<': `%${getLongUniqueId()}%`,
    '>': `%${getLongUniqueId()}%`,
    '"': `%${getLongUniqueId()}%`,
    '\'': `%${getLongUniqueId()}%`,
};

export function getHighlightHtml(text: string, highlights: IHighlight[], escape = false, handleLineEnding = false) {
    let code = '';
    let pos = 0;

    const getEscapeHTML = (className: string, content: string) => {
        return `${MARKER_HASH['<']}span class=${MARKER_HASH['"']}${className}${MARKER_HASH['"']}${MARKER_HASH['>']}${content}${MARKER_HASH['<']}/span${MARKER_HASH['>']}`;
    };

    for (const highlight of highlights) {
        const { start, end, active } = highlight;
        code += text.substring(pos, start);
        const className = active ? CLASS_NAMES.MU_HIGHLIGHT : CLASS_NAMES.MU_SELECTION;
        let highlightContent = text.substring(start, end);
        if (handleLineEnding && text.endsWith('\n') && end === text.length) {
            highlightContent
                = highlightContent.substring(start, end - 1)
                    + (escape
                        ? getEscapeHTML(CLASS_NAMES.MU_LINE_END, '\n')
                        : `<span class="${CLASS_NAMES.MU_LINE_END}">\n</span>`);
        }
        code += escape
            ? getEscapeHTML(className, highlightContent)
            : `<span class="${className}">${highlightContent}</span>`;
        pos = end;
    }

    if (pos !== text.length) {
        if (handleLineEnding && text.endsWith('\n')) {
            code
                += text.substring(pos, text.length - 1)
                    + (escape
                        ? getEscapeHTML(CLASS_NAMES.MU_LINE_END, '\n')
                        : `<span class="${CLASS_NAMES.MU_LINE_END}">\n</span>`);
        }
        else {
            code += text.substring(pos);
        }
    }

    // A trailing line break leaves the caret behind the last `\n`, where the
    // browser has no layout position to paint an insertion point in — pressing
    // Enter on the last line of a code block made the caret vanish. Park the
    // same zero-width anchor the inline renderers use; `getTextContent` skips
    // it, so it never reaches the block's text.
    if (handleLineEnding && text.endsWith('\n')) {
        code += escape
            ? getEscapeHTML(CLASS_NAMES.MU_CARET_ANCHOR, ZERO_WIDTH_SPACE)
            : `<span class="${CLASS_NAMES.MU_CARET_ANCHOR}">${ZERO_WIDTH_SPACE}</span>`;
    }

    return code;
}
