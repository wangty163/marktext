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

/**
 * Whether the quick-insert menu is actually positioned on screen.
 *
 * `BaseFloat` parks its box far off-screen until `show()` places it, and a
 * parked box is still `display: block` with a non-empty rect — so Playwright's
 * `toBeVisible()` passes on a menu that was never opened, and the next click
 * burns the whole test timeout on "element is outside of the viewport".
 *
 * This fork needs the check because its quick-insert trigger matches only a
 * block whose text is nothing but the query (`/^[/、]\S*$/` in
 * ui/paragraphQuickInsertMenu). Enter inside a paragraph appends a literal
 * newline here instead of opening a new block, so typing `/` on that line
 * leaves the block holding `Hello\n/` and the menu never opens. List items are
 * the exception: Enter there does start a new item, so the menu opens normally.
 */
export async function quickInsertOpened(page: Page): Promise<boolean> {
    return page.evaluate((selector) => {
        const menu = document.querySelector(selector) as HTMLElement | null;
        if (!menu)
            return false;
        const rect = menu.getBoundingClientRect();

        return rect.x > -1000 && rect.y > -1000;
    }, '.mu-quick-insert');
}

/**
 * The reason a spec cannot reach the quick-insert menu in this fork, for
 * `test.skip`. Kept next to `quickInsertOpened` so the two stay in step.
 */
export const QUICK_INSERT_TRIGGER_GAP =
    'this fork keeps a paragraph Enter as a literal newline, so the block text is '
    + '"Hello\\n/" and the quick-insert trigger (a block holding only the query) never fires';
