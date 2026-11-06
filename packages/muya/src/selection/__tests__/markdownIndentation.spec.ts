import type { IMarkdownIndentOptions } from '../markdownIndentation';
import type { IIndexCursor } from '../offsetCursor';
import { describe, expect, it } from 'vitest';
import { indentMarkdownSelection } from '../markdownIndentation';

const options: IMarkdownIndentOptions = {
    tabSize: 4,
    listIndentation: 1,
    preserveParagraphLineBreaks: true,
};

function cursor(
    anchorLine: number,
    anchorCh: number,
    focusLine: number,
    focusCh: number,
): IIndexCursor {
    return {
        anchor: { line: anchorLine, ch: anchorCh },
        focus: { line: focusLine, ch: focusCh },
    };
}

describe('indentMarkdownSelection', () => {
    it('indents and outdents ordinary text lines without replacing their contents', () => {
        const selected = cursor(0, 0, 1, 5);
        const indented = indentMarkdownSelection('alpha\nbravo\n', selected, 'add', options);

        expect(indented).toEqual({
            markdown: '    alpha\n    bravo\n',
            cursor: cursor(0, 0, 1, 9),
        });

        const outdented = indentMarkdownSelection(
            indented!.markdown,
            indented!.cursor,
            'subtract',
            options,
        );
        expect(outdented).toEqual({ markdown: 'alpha\nbravo\n', cursor: selected });
    });

    it('honors a two-space tabSize for ordinary Markdown paragraphs', () => {
        const result = indentMarkdownSelection(
            'alpha\nbravo\n',
            cursor(0, 0, 1, 5),
            'add',
            { ...options, tabSize: 2 },
        );

        expect(result).toEqual({
            markdown: '  alpha\n  bravo\n',
            cursor: cursor(0, 0, 1, 7),
        });
    });

    it('nests a selected bullet item and canonicalizes the marker-width indent', () => {
        const result = indentMarkdownSelection(
            '- alpha\n- bravo\n',
            cursor(1, 2, 1, 7),
            'add',
            options,
        );

        expect(result).toEqual({
            markdown: '- alpha\n  - bravo\n',
            cursor: cursor(1, 4, 1, 9),
        });
    });

    it('outdents a nested bullet item back to the original source and selection', () => {
        const result = indentMarkdownSelection(
            '- alpha\n  - bravo\n',
            cursor(1, 4, 1, 9),
            'subtract',
            options,
        );

        expect(result).toEqual({
            markdown: '- alpha\n- bravo\n',
            cursor: cursor(1, 2, 1, 7),
        });
    });

    it('uses the ordered-list marker width and preserves backward selection direction', () => {
        const result = indentMarkdownSelection(
            '1. alpha\n2. bravo\n',
            cursor(1, 8, 1, 3),
            'add',
            options,
        );

        expect(result).toEqual({
            markdown: '1. alpha\n   1. bravo\n',
            cursor: cursor(1, 11, 1, 6),
        });
    });

    it('supports task-list text through the same list path', () => {
        const result = indentMarkdownSelection(
            '- [ ] alpha\n- [x] bravo\n',
            cursor(1, 6, 1, 11),
            'add',
            options,
        );

        expect(result).toEqual({
            markdown: '- [ ] alpha\n  - [x] bravo\n',
            cursor: cursor(1, 8, 1, 13),
        });
    });

    it('excludes an end line whose endpoint is at column zero', () => {
        const result = indentMarkdownSelection(
            '- alpha\n- bravo\n- charlie\n',
            cursor(1, 2, 2, 0),
            'add',
            options,
        );

        expect(result?.markdown).toBe('- alpha\n  - bravo\n- charlie\n');
        expect(result?.cursor).toEqual(cursor(1, 4, 2, 0));
    });

    it('indents every item even when the selected run starts at the first item', () => {
        const result = indentMarkdownSelection(
            '- alpha\n- bravo\n- charlie\n',
            cursor(0, 2, 2, 7),
            'add',
            options,
        );

        expect(result).toEqual({
            markdown: '  - alpha\n  - bravo\n  - charlie\n',
            cursor: cursor(0, 4, 2, 9),
        });
    });

    it('moves a selected parent and its existing children down and back together', () => {
        const original = '- metrics\n  - existing child\n- config\n  - bucket check\n  - script config\n- analysis\n';
        const result = indentMarkdownSelection(
            original,
            cursor(2, 2, 4, 15),
            'add',
            options,
        );

        expect(result?.markdown).toBe(
            '- metrics\n  - existing child\n  - config\n    - bucket check\n    - script config\n- analysis\n',
        );
        expect(indentMarkdownSelection(result!.markdown, result!.cursor, 'subtract', options)?.markdown)
            .toBe(original);
    });

    it('indents every selected item from a first child through a later parent', () => {
        const result = indentMarkdownSelection(
            '- metrics\n  - first child\n  - second child\n- config\n  - config child\n- analysis\n',
            cursor(1, 2, 3, 6),
            'add',
            options,
        );

        expect(result?.markdown).toBe(
            '- metrics\n    - first child\n    - second child\n  - config\n  - config child\n- analysis\n',
        );
    });

    it.each([
        ['- parent\n  - first\n  - second\n- next\n  - child\n', '- parent\n    - first\n    - second\n  - next\n  - child\n'],
        ['1. parent\n   1. first\n   2. second\n2. next\n   1. child\n', '1. parent\n      1. first\n      2. second\n   1. next\n   1. child\n'],
        ['- [ ] parent\n  - [x] first\n  - [ ] second\n- [ ] next\n  - [x] child\n', '- [ ] parent\n    - [x] first\n    - [ ] second\n  - [ ] next\n  - [x] child\n'],
    ])('moves a first-child-to-parent range down and back for %j', (original, expected) => {
        const originalCursor = cursor(1, original.split('\n')[1]!.length, 3, original.split('\n')[3]!.length);
        const result = indentMarkdownSelection(original, originalCursor, 'add', options)!;
        expect(result.markdown).toBe(expected);
        expect(indentMarkdownSelection(result.markdown, result.cursor, 'subtract', options))
            .toEqual({ markdown: original, cursor: originalCursor });
    });

    it.each([
        ['- parent\n  - child\n    - grandchild\n- next\n', '  - parent\n  - child\n    - grandchild\n- next\n'],
        ['1. parent\n   1. child\n      1. grandchild\n2. next\n', '   1. parent\n   1. child\n      1. grandchild\n2. next\n'],
        ['- [ ] parent\n  - [x] child\n    - [ ] grandchild\n- [ ] next\n', '  - [ ] parent\n  - [x] child\n    - [ ] grandchild\n- [ ] next\n'],
    ])('indents only the selected parent text, not its unselected descendants in %j', (original, expected) => {
        const selected = cursor(0, 0, 0, original.split('\n')[0]!.length);
        const result = indentMarkdownSelection(original, selected, 'add', options)!;
        expect(result.markdown).toBe(expected);
        expect(result.markdown.split('\n').slice(1)).toEqual(original.split('\n').slice(1));
        expect(indentMarkdownSelection(result.markdown, result.cursor, 'subtract', options))
            .toEqual({ markdown: original, cursor: selected });
    });

    it('excludes the unselected child at a zero-column endpoint in either selection direction', () => {
        const original = '- root\n- parent\n  - child\n    - grandchild\n- end\n';
        for (const selected of [cursor(1, 2, 2, 0), cursor(2, 0, 1, 2)]) {
            const result = indentMarkdownSelection(original, selected, 'add', options)!;
            expect(result.markdown).toBe('- root\n  - parent\n  - child\n    - grandchild\n- end\n');
            expect(indentMarkdownSelection(result.markdown, result.cursor, 'subtract', options))
                .toEqual({ markdown: original, cursor: selected });
        }
    });

    it('preserves existing child numbering when an ordered parent moves with its children', () => {
        const original = '1. metrics\n   1. existing child\n2. config\n   1. bucket check\n   2. script config\n3. analysis\n';
        const result = indentMarkdownSelection(
            original,
            cursor(2, 3, 4, 17),
            'add',
            options,
        );

        expect(result?.markdown).toBe(
            '1. metrics\n   1. existing child\n   1. config\n      1. bucket check\n      2. script config\n3. analysis\n',
        );
        expect(indentMarkdownSelection(result!.markdown, result!.cursor, 'subtract', options)?.markdown)
            .toBe(original);
    });

    it('numbers a newly nested ordered run from one', () => {
        const result = indentMarkdownSelection(
            '1. alpha\n2. bravo\n3. charlie\n',
            cursor(1, 3, 2, 9),
            'add',
            options,
        );

        expect(result).toEqual({
            markdown: '1. alpha\n   1. bravo\n   2. charlie\n',
            cursor: cursor(1, 6, 2, 12),
        });
    });

    it('indents selected fenced-code lines without changing the fence', () => {
        const selected = cursor(1, 0, 2, 11);
        const indented = indentMarkdownSelection(
            '```js\nconst a = 1\nconst b = 2\n```\n',
            selected,
            'add',
            options,
        );

        expect(indented).toEqual({
            markdown: '```js\n    const a = 1\n    const b = 2\n```\n',
            cursor: cursor(1, 0, 2, 15),
        });
        expect(indentMarkdownSelection(
            indented!.markdown,
            indented!.cursor,
            'subtract',
            options,
        )).toEqual({
            markdown: '```js\nconst a = 1\nconst b = 2\n```\n',
            cursor: selected,
        });
    });

    it('returns null for a collapsed selection', () => {
        expect(indentMarkdownSelection('alpha\n', cursor(0, 2, 0, 2), 'add', options)).toBeNull();
    });
});
