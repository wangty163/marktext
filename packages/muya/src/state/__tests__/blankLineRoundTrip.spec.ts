import type { IBulletListState, IParagraphState, TState } from '../types';
import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';
import ExportMarkdown from '../stateToMarkdown';

const options = {
    footnote: false,
    math: false,
    isGitlabCompatibilityEnabled: false,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: false,
};

function parse(markdown: string): TState[] {
    return new MarkdownToState(options).generate(markdown);
}

function serialize(states: TState[]): string {
    return new ExportMarkdown({ listIndentation: 1 }).generate(states);
}

describe('blank-line fidelity', () => {
    it('renders and round-trips every top-level source blank line', () => {
        const markdown = 'a\n\nb\n';
        const states = parse(markdown);

        expect(states.map(state => state.name === 'paragraph' ? state.text : state.name))
            .toEqual(['a', 'b']);
        expect(serialize(states)).toBe(markdown);
    });

    it('round-trips the exact blank-line count between selected list items', () => {
        const markdown = '- a\n- b\n\n- c\n\n\n\n- d\n';
        const states = parse(markdown);
        const list = states[0] as IBulletListState;

        expect(list.children.map(item => item.meta?.blankLinesBefore ?? 0))
            .toEqual([0, 0, 1, 3]);
        expect(serialize(states)).toBe(markdown);
    });

    it('serializes one editor empty paragraph as one source blank line', () => {
        const states: IParagraphState[] = [
            { name: 'paragraph', text: 'before' },
            { name: 'paragraph', text: '' },
            { name: 'paragraph', text: 'after' },
        ];

        expect(serialize(states)).toBe('before\n\nafter\n');
    });

    it('does not loosen every list item after an unrelated edit', () => {
        const states = parse('- a\n- b\n\n- c\n- d\n');
        const list = states[0] as IBulletListState;
        (list.children[0].children[0] as IParagraphState).text = 'edited';

        expect(serialize(states)).toBe('- edited\n- b\n\n- c\n- d\n');
    });

    it.each([
        '1. a\n\n2. b\n',
        '- [ ] a\n\n- [x] b\n',
    ])('preserves ordered and task-list gaps: %j', (markdown) => {
        expect(serialize(parse(markdown))).toBe(markdown);
    });
});
