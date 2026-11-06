// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { shouldCrossBlockCut } from '../index';

// The clipboard module pulls in CodeBlockContent → utils/prism which touches
// `window` at import time. Stub the prism shim (same stub as sibling specs).
vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => null,
    search: () => [],
}));

// #3491: on a cross-block selection, the keydown handler cuts (replaces) the
// selection for an editing keystroke. It must NOT cut on a modifier combo —
// in particular Ctrl+C (copy) on Windows/Linux, which previously deleted the
// selected text because only metaKey (macOS Cmd) was excluded.

describe('shouldCrossBlockCut (#3491)', () => {
    it('does NOT cut on Ctrl+C (Windows/Linux copy)', () => {
        expect(shouldCrossBlockCut('c', false, true)).toBe(false);
    });

    it('does NOT cut on Cmd+C (macOS copy)', () => {
        expect(shouldCrossBlockCut('c', true, false)).toBe(false);
    });

    it('does NOT cut on Ctrl+V / Ctrl+X / any Ctrl combo', () => {
        expect(shouldCrossBlockCut('v', false, true)).toBe(false);
        expect(shouldCrossBlockCut('x', false, true)).toBe(false);
    });

    it('cuts on a plain printable key (type-to-replace the selection)', () => {
        expect(shouldCrossBlockCut('c', false, false)).toBe(true);
        expect(shouldCrossBlockCut('a', false, false)).toBe(true);
    });

    it('cuts on Backspace / Delete / Enter', () => {
        expect(shouldCrossBlockCut('Backspace', false, false)).toBe(true);
        expect(shouldCrossBlockCut('Delete', false, false)).toBe(true);
        expect(shouldCrossBlockCut('Enter', false, false)).toBe(true);
    });

    it('cuts on space and printable Unicode, but never on Tab', () => {
        expect(shouldCrossBlockCut(' ', false, false)).toBe(true);
        expect(shouldCrossBlockCut('字', false, false)).toBe(true);
        expect(shouldCrossBlockCut('😀', false, false)).toBe(true);
        expect(shouldCrossBlockCut('Tab', false, false)).toBe(false);
    });

    it('does NOT cut on other non-editing command keys', () => {
        expect(shouldCrossBlockCut('Home', false, false)).toBe(false);
        expect(shouldCrossBlockCut('End', false, false)).toBe(false);
        expect(shouldCrossBlockCut('Escape', false, false)).toBe(false);
        expect(shouldCrossBlockCut('F1', false, false)).toBe(false);
        expect(shouldCrossBlockCut('Dead', false, false)).toBe(false);
    });

    it('does NOT cut on navigation / modifier-only keys', () => {
        expect(shouldCrossBlockCut('ArrowDown', false, false)).toBe(false);
        expect(shouldCrossBlockCut('Shift', false, false)).toBe(false);
    });
});
