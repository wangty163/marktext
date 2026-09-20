import type { ISyntaxRenderOptions, SoftLineBreakToken } from '../types';
import type Renderer from './index';
import { CLASS_NAMES } from '../../config';

export default function softLineBreak(
    this: Renderer,
    { h, token }: ISyntaxRenderOptions & { token: SoftLineBreakToken },
) {
    const nodes = [h(`span.${CLASS_NAMES.MU_SOFT_LINE_BREAK}`, token.lineBreak)];
    if (token.isAtEnd)
        nodes.push(h('span.mu-soft-line-break-caret'));
    return nodes;
}
