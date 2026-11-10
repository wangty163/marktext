// utils used in selection/index.js
import { CLASS_NAMES, ZERO_WIDTH_SPACE } from '../config';
import { isElement } from '../utils';

/**
 * Nodes whose rendered text must not shift a model offset as-is. Math and ruby
 * render output that differs from their source, so they contribute nothing; the
 * soft-line-break caret holds a zero-width space that only exists to give the
 * browser a paintable insertion point after a trailing newline, so it
 * contributes its real text minus that anchor character.
 */
export const OFFSET_BLACKLIST = [
    CLASS_NAMES.MU_MATH_RENDER,
    CLASS_NAMES.MU_RUBY_RENDER,
    CLASS_NAMES.MU_CARET_ANCHOR,
];

function isCaretAnchor(node: Node | null | undefined): boolean {
    return (
        !!node
        && isElement(node)
        && node.classList.contains(CLASS_NAMES.MU_CARET_ANCHOR)
    );
}

function withoutCaretAnchors(text: string): string {
    return text.split(ZERO_WIDTH_SPACE).join('');
}

/**
 * Translate a DOM range offset into real characters. Element offsets count
 * children, not characters: deleting a final line can leave the caret between
 * the remaining text and a browser-inserted <br>. Caret-anchor text also omits
 * its zero-width placeholder, wherever newly typed text has moved it.
 */
export function normalizeCaretAnchorOffset(node: Node, offset: number): number {
    if (isCaretAnchor(node)) {
        let effective = 0;
        for (const child of Array.from(node.childNodes).slice(0, offset))
            effective += withoutCaretAnchors(child.textContent ?? '').length;

        return effective;
    }

    if (isCaretAnchor(node.parentNode))
        return withoutCaretAnchors((node.textContent ?? '').slice(0, offset)).length;

    if (node.nodeType !== Node.TEXT_NODE) {
        let effective = 0;
        for (const child of Array.from(node.childNodes).slice(0, offset))
            effective += getTextContent(child, OFFSET_BLACKLIST).length;

        return effective;
    }

    return offset;
}

export function isContentDOM(element: HTMLElement) {
    return (
        element
        && element.tagName === 'SPAN'
        && element.classList.contains('mu-content')
    );
}

export function findContentDOM(node: Node | null | undefined) {
    if (!node)
        return null;

    do {
        if (node instanceof HTMLElement && isContentDOM(node))
            return node;

        node = node.parentNode;
    } while (node);

    return null;
}

export function compareParagraphsOrder(paragraph1: HTMLElement, paragraph2: HTMLElement) {
    return (
        paragraph1.compareDocumentPosition(paragraph2)
        & Node.DOCUMENT_POSITION_FOLLOWING
    );
}

export function getTextContent(node: Node, blackList: string[] = []) {
    if (node.nodeType === Node.TEXT_NODE || blackList.length === 0)
        return node.textContent!;

    let text = '';
    if (
        isElement(node)
        && blackList.some(
            className => node.classList && node.classList.contains(className),
        )
    ) {
        // Text typed at a trailing-newline caret lands inside the anchor span,
        // so only its zero-width placeholder is dropped.
        return isCaretAnchor(node) ? withoutCaretAnchors(node.textContent ?? '') : text;
    }

    if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
    }
    else if (
        isElement(node)
        && node.tagName === 'IMG'
        && node.parentElement?.classList.contains(CLASS_NAMES.MU_IMAGE_CONTAINER)
    ) {
        // A native caret can sit inside the image container after its <img>.
        // It occupies the source token's length there, just as when the same
        // image is counted through its outer wrapper below.
        text += node.closest(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)?.getAttribute('data-raw') ?? '';
    }
    else if (
        isElement(node)
        && node.classList.contains(`${CLASS_NAMES.MU_INLINE_IMAGE}`)
    ) {
    // handle inline image
        const raw = node.getAttribute('data-raw');
        const imageContainer = node.querySelector(
            `.${CLASS_NAMES.MU_IMAGE_CONTAINER}`,
        );
        const hasImg = imageContainer!.querySelector('img');
        const childNodes = imageContainer!.childNodes;
        if (childNodes.length && hasImg) {
            for (const child of childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE && child.nodeName === 'IMG')
                    text += raw;
                else if (child.nodeType === Node.TEXT_NODE)
                    text += child.textContent;
            }
        }
        else {
            text += raw;
        }
    }
    else {
        const childNodes = node.childNodes;

        for (const n of childNodes)
            text += getTextContent(n, blackList);
    }

    return text;
}

export function getOffsetOfParagraph(node: Node, paragraph: HTMLElement): number {
    let offset = 0;
    let preSibling: Node | null = node;

    if (node === paragraph)
        return offset;

    do {
        preSibling = preSibling.previousSibling;
        if (preSibling) {
            offset += getTextContent(preSibling, OFFSET_BLACKLIST).length;
        }
    } while (preSibling);

    return node === paragraph || node.parentNode === paragraph
        ? offset
        : offset + getOffsetOfParagraph(node.parentNode!, paragraph);
}

export function getNodeAndOffset(
    node: Node,
    offset: number,
): { node: Node; offset: number } {
    if (node.nodeType === Node.TEXT_NODE) {
        return {
            node,
            offset,
        };
    }

    const childNodes = node.childNodes;
    const len = childNodes.length;
    let i;
    let count = 0;

    for (i = 0; i < len; i++) {
        const child = childNodes[i];
        const textContent = getTextContent(child, OFFSET_BLACKLIST);
        const textLength = textContent.length;

        // A next-line endpoint must not sit inside the preceding break during native deletion.
        if (
            textContent.endsWith('\n') && i !== len - 1
                ? count + textLength > offset
                : count + textLength >= offset
        ) {
            if (
                isElement(child)
                && child.classList
                && child.classList.contains(`${CLASS_NAMES.MU_INLINE_IMAGE}`)
            ) {
                const imageContainer = child.querySelector(
                    `.${CLASS_NAMES.MU_IMAGE_CONTAINER}`,
                )!;
                const hasImg = imageContainer.querySelector('img');

                if (!hasImg) {
                    return {
                        node: child,
                        offset: 0,
                    };
                }

                if (count + textLength === offset) {
                    if (child.nextElementSibling) {
                        return {
                            node: child.nextElementSibling,
                            offset: 0,
                        };
                    }
                    else {
                        return {
                            node: imageContainer,
                            offset: 1,
                        };
                    }
                }
                else if (count === offset && count === 0) {
                    return {
                        node: imageContainer,
                        offset: 0,
                    };
                }
                else {
                    return {
                        node: child,
                        offset: 0,
                    };
                }
            }
            else {
                return getNodeAndOffset(child, offset - count);
            }
        }
        else {
            count += textLength;
        }
    }

    return { node, offset };
}

export function getLegalOffset(node: Node, offset: number): number {
    if (!node || typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0)
        return 0;

    const max = node.nodeType === Node.TEXT_NODE
        ? (node as Text).length
        : node.childNodes.length;

    return Math.min(offset, max);
}
