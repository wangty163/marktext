import { isElement } from '../utils';

export function getCursorCoords(preferEnd = false): DOMRect | null {
    const sel = document.getSelection();
    let range;
    let rect: DOMRect | null = null;

    if (sel?.rangeCount) {
        range = sel.getRangeAt(0).cloneRange();
        if (range.getClientRects) {
            let rects: DOMRectList | null = range.getClientRects();
            if (rects.length === 0) {
                rects
                    = range.startContainer && isElement(range.startContainer)
                        ? range.startContainer.getClientRects()
                        : null;
            }

            if (rects?.length)
                rect = preferEnd ? rects[rects.length - 1] : rects[0];
        }
    }

    return rect;
}

export function getSelectionStart(): Node | null {
    const node = document.getSelection()!.anchorNode;

    return node && node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
}

/** Logical-line fallback source for when the caret has no client rect. */
export interface ICursorLineFallback {
    text: string;
    offset: number;
}

function lineIndexOf(text: string, offset: number): number {
    let line = 0;
    const limit = Math.min(Math.max(offset, 0), text.length);
    for (let i = 0; i < limit; i++) {
        if (text.charCodeAt(i) === 10 /* \n */)
            line++;
    }

    return line;
}

export function getCursorYOffset(
    paragraph: HTMLElement,
    fallback?: ICursorLineFallback,
): { topOffset: number; bottomOffset: number } {
    const coords = getCursorCoords();
    // The collapsed caret can yield no client rects (e.g. an HTML/code block
    // boundary position), so `getCursorCoords()` returns null. Treat that as
    // "position unknown" and let arrow navigation leave the block.
    if (coords == null) {
        // One case does have a known position: a caret on an empty line inside a
        // paragraph, where literal newlines keep several logical lines in a
        // single block. Reporting 0/0 there makes ArrowUp/ArrowDown escape to
        // the neighbouring block (or to the paragraph's first/last line), so
        // fall back to the logical line index.
        if (fallback) {
            const topOffset = lineIndexOf(fallback.text, fallback.offset);
            const bottomOffset = lineIndexOf(fallback.text, fallback.text.length) - topOffset;

            return { topOffset, bottomOffset };
        }

        return { topOffset: 0, bottomOffset: 0 };
    }

    const { y } = coords;
    const { height, top } = paragraph.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight);
    const topOffset = Math.floor((y - top) / lineHeight);
    const bottomOffset = Math.round((top + height - lineHeight - y) / lineHeight);

    return { topOffset, bottomOffset };
}
