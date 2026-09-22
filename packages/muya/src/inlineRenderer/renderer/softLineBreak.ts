import type { ISyntaxRenderOptions, SoftLineBreakToken } from '../types';
import type Renderer from './index';
import { CLASS_NAMES, ZERO_WIDTH_SPACE } from '../../config';

export default function softLineBreak(
    this: Renderer,
    { h, token }: ISyntaxRenderOptions & { token: SoftLineBreakToken },
) {
    let selector = `span.${CLASS_NAMES.MU_SOFT_LINE_BREAK}`;
    if (this.muya.options.softNewlineAsSpace) {
        selector += `.${CLASS_NAMES.MU_SOFT_NEWLINE_AS_SPACE}`;
    }

    const nodes = [h(selector, token.lineBreak)];
    // Behind the document's last line break the browser has no layout position
    // to paint an insertion point in, so park a zero-width anchor there for the
    // caret. `getTextContent` skips it, so it never reaches the block's text.
    // Deliberately not the block-level `mu-line-end` wrapper: with literal
    // paragraph line breaks the trailing `\n` already renders its own line, and
    // a second block box would claim one more (#5282).
    if (token.isAtEnd) {
        nodes.push(h(`span.${CLASS_NAMES.MU_CARET_ANCHOR}`, ZERO_WIDTH_SPACE));
    }

    return nodes;
}
