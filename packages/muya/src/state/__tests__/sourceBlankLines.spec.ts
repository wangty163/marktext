// @vitest-environment happy-dom

import type { TState } from '../types';
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';
import { MarkdownToState } from '../markdownToState';
import ExportMarkdown from '../stateToMarkdown';

const options = {
    footnote: true,
    texMathDollars: true,
    texMathGfm: false,
    texMathSingleBackslash: false,
    texMathDoubleBackslash: false,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: true,
    preserveParagraphLineBreaks: true,
};
function parse(markdown: string) {
    return new MarkdownToState(options).generate(markdown);
}
function serialize(states: TState[]) {
    return new ExportMarkdown({
        listIndentation: 1,
        preserveParagraphLineBreaks: true,
    }).generate(states);
}

const hosts: HTMLElement[] = [];
afterEach(() => {
    hosts.splice(0).forEach(host => host.remove());
    document.getSelection()?.removeAllRanges();
});

describe('source blank lines in line-break-preserving mode', () => {
    const adjacentBlocks = [
        '# Prompt\n```\nexample\n```\n',
        '# first\n## second\n',
        '# heading\ntext\n',
        'text\n# heading\n',
        'text\n```js\nexample()\n```\n',
        '```\nexample\n```\ntext\n',
        '```\nfirst\n```\n```\nsecond\n```\n',
        '# heading\n- item\n',
        '# heading\n1. item\n',
        '# heading\n- [ ] task\n',
        '- item\n# heading\n',
        '# heading\n> quote\n',
        '> quote\n# heading\n',
        '# heading\n---\n',
        '# heading\n$$\nx\n$$\n',
        '# heading\n```mermaid\ngraph TD; A-->B\n```\n',
        '---\ntitle: example\n---\n# heading\n',
        '> # heading\n> ```\n> example\n> ```\n',
        '- # heading\n  ```\n  example\n  ```\n',
        '> first\n>\n> second\n',
        '- first\n\n  second\n',
        '- first\n\n- second\n',
    ];

    it.each(adjacentBlocks)('does not invent source blank lines: %j', (markdown) => {
        const states = parse(markdown);
        expect(serialize(states)).toBe(markdown);
        expect(parse(serialize(states))).toEqual(states);
    });

    it.each([
        '# title\n',
        'title\n===\n',
        '```\ncode\n```\n',
        '---\n',
        '$$\nx\n$$\n',
        '- item\n',
        '1. item\n',
        '- [ ] task\n',
        '> quote\n',
        '| a   |\n| --- |\n| b   |\n',
        '<div>\nhtml\n</div>\n',
    ])('keeps every source gap around %j', (block) => {
        for (const count of [1, 2, 3]) {
            const markdown = `# before\n${'\n'.repeat(count)}${block}${'\n'.repeat(count)}# after\n`;
            const states = parse(markdown);
            expect(states.filter(state => state.name === 'paragraph' && state.text === ''))
                .toHaveLength(count * 2);
            expect(serialize(states)).toBe(markdown);
        }
    });

    it.each([0, 1, 2, 3])('preserves %i source gaps after front matter', (count) => {
        const markdown = `---\ntitle: example\n---\n${'\n'.repeat(count)}# heading\n`;
        const states = parse(markdown);
        expect(states[0].name).toBe('frontmatter');
        expect(states.filter(state => state.name === 'paragraph' && state.text === ''))
            .toHaveLength(count);
        expect(serialize(states)).toBe(markdown);
    });

    it.each([0, 1, 2, 3])('round-trips %i editable heading/code gap lines', (count) => {
        const markdown = `# Prompt\n${'\n'.repeat(count)}\`\`\`\nexample\n\`\`\`\n`;
        const states = parse(markdown);
        expect(states.filter(state => state.name === 'paragraph' && state.text === ''))
            .toHaveLength(count);
        expect(serialize(states)).toBe(markdown);
    });

    it('removing the gap changes serialization, not just the displayed state', () => {
        const states = parse('# Prompt\n\n```\nexample\n```\n');
        expect(states[1]).toEqual({ name: 'paragraph', text: '' });
        states.splice(1, 1);
        expect(serialize(states)).toBe('# Prompt\n```\nexample\n```\n');
        expect(parse(serialize(states))).toEqual(states);
    });

    it.each(['Backspace', 'Delete'])('threads %s through the live editor and arbitrary-state serialization', (key) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, {
            ...options,
            markdown: '# Prompt\n\n```\nexample\n```\n',
        });
        muya.init();
        hosts.push(muya.domNode);
        const paragraph = muya.editor.scrollPage!.children.find(1)!;
        if (!paragraph.isParent())
            throw new Error('Expected a paragraph');
        const blank = paragraph.firstContentInDescendant()!;
        muya.editor.activeContentBlock = blank;
        blank.setCursor(0, 0, true);
        blank.keydownHandler(new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        }));
        muya.editor.jsonState.flush();
        const expected = '# Prompt\n```\nexample\n```\n';
        expect(muya.getState().map(state => state.name)).toEqual(['atx-heading', 'code-block']);
        expect(muya.getMarkdown()).toBe(expected);
        expect(muya.editor.jsonState.getMarkdownFromState(muya.getState())).toBe(expected);
        muya.undo();
        expect(muya.getMarkdown()).toBe('# Prompt\n\n```\nexample\n```\n');
        muya.redo();
        expect(muya.getMarkdown()).toBe(expected);
    });

    it.each([
        ['- item\n', 'prose\n'],
        ['> quote\n', 'prose\n'],
        ['| a   |\n| --- |\n| b   |\n', 'prose\n'],
        ['prose\n', 'heading\n===\n'],
        ['prose\n', '---\n'],
        ['prose\n', '2. item\n'],
        ['prose\n', '    code\n'],
        ['<div>\ncontent\n</div>\n', '# heading\n'],
    ])('keeps syntax-required separation between %j and %j', (left, right) => {
        // An edit can create adjacent states that need a separator in Markdown.
        const states = [...parse(left), ...parse(right)];
        const markdown = serialize(states);
        expect(markdown).toBe(`${left}\n${right}`);
        expect(parse(markdown).filter(state => !(state.name === 'paragraph' && state.text === '')))
            .toEqual(states);
    });

    it('honors an explicit loose-list toggle in preserving mode', () => {
        const states = parse('- one\n- two\n');
        const list = states[0];
        if (list.name !== 'bullet-list')
            throw new Error('Expected a bullet list');
        list.meta.loose = true;
        expect(serialize(states)).toBe('- one\n\n- two\n');
    });

    it('keeps traditional block separators when preservation is disabled', () => {
        expect(new ExportMarkdown().generate(parse('# Prompt\n```\nexample\n```\n')))
            .toBe('# Prompt\n\n```\nexample\n```\n');
    });
});
