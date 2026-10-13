export interface ICodeFence {
    start: number;
    end: number;
    bodyStart: number;
    text: string;
    lang: string;
    fenceLength: number;
}

// Paragraphs can contain literal newlines. Match a fence at a line boundary,
// keeping its surrounding prose separate from the code and optional closer.
export function codeFenceAtOffset(text: string, offset: number, closedOnly = false): ICodeFence | null {
    const openings = /^ {0,3}(`{3,})([^`\n]*)$/gm;
    for (let opening = openings.exec(text); opening; opening = openings.exec(text)) {
        const start = opening.index;
        const openingEnd = start + opening[0].length;
        if (openingEnd > offset)
            break;
        const bodyStart = Math.min(openingEnd + 1, text.length);
        const fenceLength = opening[1].length;
        const closings = /^ {0,3}(`{3,})[\t ]*$/gm;
        closings.lastIndex = bodyStart;
        let closing: RegExpExecArray | null;
        do {
            closing = closings.exec(text);
        } while (closing && closing[1].length < fenceLength);

        const end = closing ? closing.index + closing[0].length : text.length;
        if (offset > end) {
            openings.lastIndex = end;
            continue;
        }
        if (closedOnly ? !closing || offset < bodyStart || offset > end : offset !== openingEnd)
            return null;

        return {
            start,
            end,
            bodyStart,
            text: text.slice(bodyStart, closing ? Math.max(bodyStart, closing.index - 1) : end),
            lang: opening[2].trim(),
            fenceLength,
        };
    }
    return null;
}
