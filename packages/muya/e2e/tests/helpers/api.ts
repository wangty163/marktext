import type { Page } from '@playwright/test';

/**
 * Apply the engine's queued state edits immediately.
 *
 * `JSONState` batches every edit into `_operationCache` and applies it on the
 * next animation frame, so reading `getState()` / `getMarkdown()` straight
 * after a keystroke races that frame: on a quiet machine the read wins and the
 * assertion sees the pre-keystroke document, while the same spec passes under
 * parallel load because the frame had time to run. `JSONState.flush()` is the
 * engine's own "apply now" entry point (used for the tab-switch handoff), so
 * calling it only moves work the frame callback would have done anyway.
 *
 * Every state-reading helper below flushes first. Specs that read state through
 * their own `page.evaluate` should call this too.
 */
export async function flushState(page: Page): Promise<void> {
    await page.evaluate(() => window.muya!.editor.jsonState.flush());
}

/** Pull the current markdown out of the editor's public API. */
export async function getMarkdown(page: Page): Promise<string> {
    await flushState(page);
    return page.evaluate(() => window.muya!.getMarkdown());
}

export async function getState(page: Page): Promise<unknown> {
    await flushState(page);
    return page.evaluate(() => window.muya!.getState());
}

export async function getTOC(page: Page): Promise<Array<{
    lvl: number;
    content: string;
    slug: string;
    githubSlug: string;
}>> {
    await flushState(page);
    return page.evaluate(() => window.muya!.getTOC() as Array<{
        lvl: number;
        content: string;
        slug: string;
        githubSlug: string;
    }>);
}

/** Read the test-only mocks the host wires onto window.__e2e. */
export async function getLinkJumps(page: Page): Promise<Array<{ href?: string }>> {
    return page.evaluate(() => window.__e2e!.linkJumps.slice());
}

export async function getInitialMarkdown(page: Page): Promise<string> {
    return page.evaluate(() => window.__e2e!.INITIAL_MARKDOWN);
}
