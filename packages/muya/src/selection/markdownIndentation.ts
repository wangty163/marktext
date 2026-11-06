import type { IIndexCursor, IIndexPosition } from './offsetCursor';
import diff from 'fast-diff';
import { MarkdownToState } from '../state/markdownToState';
import StateToMarkdown from '../state/stateToMarkdown';

export type MarkdownIndentDirection = 'add' | 'subtract';

/** Markdown options that affect parsing or serialization of an indented range. */
export interface IMarkdownIndentOptions {
    tabSize: number;
    listIndentation: number | string;
    preserveParagraphLineBreaks?: boolean;
    trimUnnecessaryCodeBlockEmptyLines?: boolean;
    frontMatter?: boolean;
    footnote?: boolean;
    texMathDollars?: boolean;
    texMathGfm?: boolean;
    texMathSingleBackslash?: boolean;
    texMathDoubleBackslash?: boolean;
}

export interface IMarkdownIndentResult {
    markdown: string;
    cursor: IIndexCursor;
}

interface IIndentChange {
    oldLength: number;
    newLength: number;
    markerDelta: number;
}

interface IListLine {
    indentColumns: number;
    markerWidth: number;
    ordered: boolean;
    orderNumber: number | null;
}

interface IListIndent {
    columns: number;
    nests: boolean;
    parentSelected: boolean;
}

interface ISelectionRange {
    start: IIndexPosition;
    lastLine: number;
}

function _comparePositions(a: IIndexPosition, b: IIndexPosition): number {
    return a.line - b.line || a.ch - b.ch;
}

function _selectionRange(lines: string[], cursor: IIndexCursor): ISelectionRange | null {
    const { anchor, focus } = cursor;
    if (!anchor || !focus || _comparePositions(anchor, focus) === 0)
        return null;

    const valid = ({ line, ch }: IIndexPosition) =>
        Number.isInteger(line)
        && Number.isInteger(ch)
        && line >= 0
        && line < lines.length
        && ch >= 0
        && ch <= lines[line]!.length;
    if (!valid(anchor) || !valid(focus))
        return null;

    const [start, end] = _comparePositions(anchor, focus) < 0
        ? [anchor, focus]
        : [focus, anchor];
    return {
        start,
        lastLine: end.ch === 0 && end.line > start.line ? end.line - 1 : end.line,
    };
}

function _columns(whitespace: string, tabSize: number): number {
    let result = 0;
    for (const character of whitespace) {
        result = character === '\t'
            ? result + tabSize - (result % tabSize)
            : result + 1;
    }

    return result;
}

function _listLine(text: string, tabSize: number): IListLine | null {
    const match = /^([ \t]*)((?:[-+*]|\d+[.)])[ \t]+)/.exec(text);
    if (!match)
        return null;

    return {
        indentColumns: _columns(match[1]!, tabSize),
        // Task checkboxes are item content, not part of the parent marker.
        markerWidth: match[2]!.length,
        ordered: /^\d/.test(match[2]!),
        orderNumber: /^\d/.test(match[2]!) ? Number.parseInt(match[2]!, 10) : null,
    };
}

function _listIndent(
    lines: string[],
    line: number,
    firstSelectedLine: number,
    direction: MarkdownIndentDirection,
    tabSize: number,
    listChanges: Map<number, IListIndent>,
): IListIndent | null {
    const current = _listLine(lines[line]!, tabSize);
    if (!current)
        return null;

    let sibling: IListLine | null = null;
    let siblingLine = -1;
    let parent: IListLine | null = null;
    let parentLine = -1;
    for (let i = line - 1; i >= 0; i--) {
        const candidate = _listLine(lines[i]!, tabSize);
        if (!candidate) {
            if (lines[i]!.trim() === '')
                continue;
            break;
        }
        if (candidate.indentColumns === current.indentColumns) {
            if (!sibling) {
                sibling = candidate;
                siblingLine = i;
            }
            continue;
        }
        if (candidate.indentColumns < current.indentColumns) {
            parent = candidate;
            parentLine = i;
            break;
        }
    }

    const parentSelected = parentLine >= firstSelectedLine;
    if (direction === 'subtract') {
        return {
            columns: Math.max(0, current.indentColumns - (parent?.markerWidth ?? current.markerWidth)),
            nests: false,
            parentSelected,
        };
    }

    if (sibling) {
        return {
            columns: current.indentColumns + sibling.markerWidth,
            nests: listChanges.get(siblingLine)?.nests ?? true,
            parentSelected,
        };
    }

    if (parentSelected) {
        // Both rows are selected, so retain their relative level and numbering.
        return {
            columns: current.indentColumns + (parent?.markerWidth ?? tabSize),
            nests: false,
            parentSelected,
        };
    }

    // A selection command moves every touched row, including a first child.
    // There need not be a previous sibling: preserve the extra source indent
    // instead of leaving this row behind as an implicit anchor.
    return {
        columns: current.indentColumns + (parent?.markerWidth ?? current.markerWidth),
        nests: false,
        parentSelected: false,
    };
}

function _previousOrderNumber(
    lines: string[],
    line: number,
    targetColumns: number,
    tabSize: number,
): number {
    for (let i = line - 1; i >= 0; i--) {
        const candidate = _listLine(lines[i]!, tabSize);
        if (!candidate) {
            if (lines[i]!.trim() === '')
                continue;
            break;
        }
        if (candidate.indentColumns === targetColumns)
            return candidate.orderNumber ?? 0;
        if (candidate.indentColumns < targetColumns)
            break;
    }

    return 0;
}

interface IOrderedNumberingState {
    nestedKey: string;
    nestedNumber: number;
    outdentNumbers: Map<number, number>;
}

function _orderedNumber(
    lines: string[],
    line: number,
    listLine: IListLine | null,
    listIndent: IListIndent | null,
    direction: MarkdownIndentDirection,
    tabSize: number,
    state: IOrderedNumberingState,
): number | null {
    if (listLine?.ordered && listIndent && !listIndent.parentSelected) {
        if (listIndent.nests) {
            const key = `${listLine.indentColumns}:${listIndent.columns}`;
            if (key !== state.nestedKey) {
                state.nestedKey = key;
                state.nestedNumber = 0;
            }
            return ++state.nestedNumber;
        }
        if (direction === 'subtract' && listIndent.columns < listLine.indentColumns) {
            const previous = state.outdentNumbers.get(listIndent.columns)
                ?? _previousOrderNumber(lines, line, listIndent.columns, tabSize);
            const orderedNumber = previous + 1;
            state.outdentNumbers.set(listIndent.columns, orderedNumber);
            return orderedNumber;
        }
    }

    state.nestedKey = '';
    state.nestedNumber = 0;
    return null;
}

function _absoluteOffset(lines: string[], position: IIndexPosition): number {
    let result = position.ch;
    for (let i = 0; i < position.line; i++)
        result += lines[i]!.length + 1;

    return result;
}

function _positionAt(markdown: string, offset: number): IIndexPosition {
    const target = Math.min(Math.max(offset, 0), markdown.length);
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < target; i++) {
        if (markdown.charCodeAt(i) === 10) {
            line++;
            lineStart = i + 1;
        }
    }

    return { line, ch: target - lineStart };
}

/** Map a position through canonicalization without losing anchor/focus direction. */
function _mapOffset(changes: ReturnType<typeof diff>, offset: number): number {
    let oldOffset = 0;
    let newOffset = 0;

    for (const [operation, text] of changes) {
        const length = text.length;
        if (operation === 0) {
            if (offset <= oldOffset + length)
                return newOffset + Math.max(0, offset - oldOffset);
            oldOffset += length;
            newOffset += length;
        }
        else if (operation === -1) {
            if (offset <= oldOffset + length)
                return newOffset;
            oldOffset += length;
        }
        else {
            // Keep a caret at the exact insertion boundary before the inserted
            // formatting. Positions after it move with their original text.
            if (offset === oldOffset)
                return newOffset;
            newOffset += length;
        }
    }

    return newOffset;
}

function _canonicalize(markdown: string, options: IMarkdownIndentOptions): string {
    const state = new MarkdownToState({
        footnote: options.footnote ?? false,
        texMathDollars: options.texMathDollars ?? true,
        texMathGfm: options.texMathGfm ?? false,
        texMathSingleBackslash: options.texMathSingleBackslash ?? false,
        texMathDoubleBackslash: options.texMathDoubleBackslash ?? false,
        trimUnnecessaryCodeBlockEmptyLines: options.trimUnnecessaryCodeBlockEmptyLines ?? false,
        frontMatter: options.frontMatter ?? true,
        preserveParagraphLineBreaks: options.preserveParagraphLineBreaks,
    }).generate(markdown);

    return new StateToMarkdown({
        listIndentation: options.listIndentation,
        preserveParagraphLineBreaks: options.preserveParagraphLineBreaks,
    }).generate(state);
}

/**
 * Indent every line touched by a non-collapsed source selection and return the
 * exact canonical Markdown that both desktop modes consume. A zero-column end
 * endpoint excludes its line, matching CodeMirror's selection indentation.
 * Blank lines are normalized to empty lines, and leading tabs are measured at
 * the configured tab stops before being serialized as spaces.
 */
export function indentMarkdownSelection(
    markdown: string,
    cursor: IIndexCursor,
    direction: MarkdownIndentDirection,
    options: IMarkdownIndentOptions,
): IMarkdownIndentResult | null {
    const { anchor, focus } = cursor;
    if (!anchor || !focus)
        return null;

    const lines = markdown.split('\n');
    const range = _selectionRange(lines, cursor);
    if (!range)
        return null;
    // Indentation is a line edit, not a subtree move. Descendants outside
    // the range retain their source columns even if their list owner changes.
    const { start, lastLine } = range;
    const tabSize = Math.max(1, Math.floor(options.tabSize));
    const changes = new Map<number, IIndentChange>();
    const originalLines = [...lines];
    const listChanges = new Map<number, IListIndent>();
    const orderedState: IOrderedNumberingState = {
        nestedKey: '',
        nestedNumber: 0,
        outdentNumbers: new Map(),
    };

    for (let line = start.line; line <= lastLine; line++) {
        const text = originalLines[line]!;
        const oldIndent = /^[ \t]*/.exec(text)![0];
        // As with CodeMirror's non-aggressive indent, selected blank lines do
        // not acquire indentation; any existing whitespace-only content goes.
        const listIndent = _listIndent(originalLines, line, start.line, direction, tabSize, listChanges);
        if (listIndent)
            listChanges.set(line, listIndent);
        const columns = /\S/.test(text)
            ? listIndent?.columns ?? Math.max(
                0,
                _columns(oldIndent, tabSize) + (direction === 'add' ? tabSize : -tabSize),
            )
            : 0;
        const newIndent = ' '.repeat(columns);
        if (newIndent === oldIndent)
            continue;

        let content = text.slice(oldIndent.length);
        let markerDelta = 0;
        const listLine = _listLine(text, tabSize);
        const orderedNumber = _orderedNumber(
            originalLines,
            line,
            listLine,
            listIndent,
            direction,
            tabSize,
            orderedState,
        );
        if (orderedNumber !== null) {
            const digits = /^\d+/.exec(content)![0];
            const marker = String(orderedNumber);
            content = marker + content.slice(digits.length);
            markerDelta = marker.length - digits.length;
        }

        lines[line] = newIndent + content;
        changes.set(line, { oldLength: oldIndent.length, newLength: newIndent.length, markerDelta });
    }

    const adjust = (position: IIndexPosition): IIndexPosition => {
        const change = changes.get(position.line);
        if (!change || position.ch === 0)
            return { ...position };
        if (position.ch <= change.oldLength)
            return { line: position.line, ch: change.newLength };

        return {
            line: position.line,
            ch: Math.max(
                change.newLength,
                position.ch + change.newLength - change.oldLength + change.markerDelta,
            ),
        };
    };

    const transformedMarkdown = lines.join('\n');
    const transformedCursor: IIndexCursor = { anchor: adjust(anchor), focus: adjust(focus) };
    const canonicalMarkdown = _canonicalize(transformedMarkdown, options);
    if (canonicalMarkdown === transformedMarkdown)
        return { markdown: canonicalMarkdown, cursor: transformedCursor };

    const transformedLines = transformedMarkdown.split('\n');
    const diffChanges = diff(transformedMarkdown, canonicalMarkdown);
    const map = (position: IIndexPosition) => _positionAt(
        canonicalMarkdown,
        _mapOffset(diffChanges, _absoluteOffset(transformedLines, position)),
    );

    return {
        markdown: canonicalMarkdown,
        cursor: {
            anchor: map(transformedCursor.anchor!),
            focus: map(transformedCursor.focus!),
        },
    };
}
