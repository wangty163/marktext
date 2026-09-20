import type { HardLineBreakToken, ISyntaxRenderOptions } from '../types';
import type Renderer from './index';
import { CLASS_NAMES, ZERO_WIDTH_SPACE } from '../../config';

export default function hardLineBreak(
    this: Renderer,
    { h, token }: ISyntaxRenderOptions & { token: HardLineBreakToken },
) {
    const { spaces, lineBreak, isAtEnd } = token;
    const className = CLASS_NAMES.MU_HARD_LINE_BREAK;
    const spaceClass = CLASS_NAMES.MU_HARD_LINE_BREAK_SPACE;
    if (isAtEnd) {
        return [
            h(`span.${className}`, h(`span.${spaceClass}`, spaces)),
            h(`span.${CLASS_NAMES.MU_LINE_END}`, lineBreak),
            // The line end is a block, so nothing follows it that the browser
            // could paint a caret in.
            h(`span.${CLASS_NAMES.MU_CARET_ANCHOR}`, ZERO_WIDTH_SPACE),
        ];
    }
    else {
        return [
            h(`span.${className}`, [h(`span.${spaceClass}`, spaces), lineBreak]),
        ];
    }
}
