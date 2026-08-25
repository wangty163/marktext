// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { Muya } from '../../muya';
import { renderToStaticHTML } from '../../state/renderToStaticHTML';

function boot(markdown: string): Muya {
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    return muya;
}

describe('Obsidian-style ==highlight==', () => {
    it('renders live and exports without changing the markdown', () => {
        const markdown = 'before ==**highlight**== after\n';
        const muya = boot(markdown);

        expect(muya.domNode.querySelector('mark strong')?.textContent).toBe('highlight');
        expect(muya.getMarkdown()).toBe(markdown);
        expect(renderToStaticHTML(markdown)).toContain('<mark><strong>highlight</strong></mark>');

        muya.domNode.remove();
        delete (window as Partial<Window>).MUYA_VERSION;
    });

    it('keeps an escaped opening marker literal', () => {
        const markdown = '\\==plain==\n';
        const muya = boot(markdown);

        expect(muya.domNode.querySelector('mark')).toBeNull();
        expect(muya.getMarkdown()).toBe(markdown);
        expect(renderToStaticHTML(markdown)).not.toContain('<mark>');

        muya.domNode.remove();
        delete (window as Partial<Window>).MUYA_VERSION;
    });
});
