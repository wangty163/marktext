import type { Lexer, MarkedExtension, Tokens } from 'marked';

const MARK_RULE = /^(==)(?=\S)([\s\S]*?\S)(\\*)\1/;

interface IMarkToken {
    type: 'mark';
    raw: string;
    tokens: Tokens.Generic[];
}

interface ITokenizerThis {
    lexer: Lexer;
}

interface IRendererThis {
    parser?: { parseInline: (tokens: Tokens.Generic[]) => string };
}

export default function markExtension(): MarkedExtension {
    return {
        extensions: [{
            name: 'mark',
            level: 'inline',
            start(src: string) {
                const index = src.indexOf('==');
                return index === -1 ? undefined : index;
            },
            tokenizer(src: string): IMarkToken | undefined {
                const match = MARK_RULE.exec(src);
                if (!match || match[3].length % 2)
                    return;

                const { lexer } = this as unknown as ITokenizerThis;
                return {
                    type: 'mark',
                    raw: match[0],
                    tokens: lexer.inlineTokens(match[2]),
                };
            },
            renderer(token) {
                if (token.type !== 'mark')
                    return false;

                const { parser } = this as IRendererThis;
                return `<mark>${parser?.parseInline((token as IMarkToken).tokens) ?? ''}</mark>`;
            },
        }],
    };
}
