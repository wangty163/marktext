import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';

test('table columns size to their content (#4894)', async ({ page }) => {
    await page.evaluate(() => window.muya!.setContent([
        '| # | Short | Content |',
        '| --- | --- | --- |',
        '| 1 | Ok | A long description that should make this column much wider '
        + 'than the first two columns. |',
        '',
    ].join('\n')));

    const widths = await page
        .locator(editor.table)
        .first()
        .locator('tr')
        .first()
        .locator('td')
        .evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));

    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeLessThan(100);
    expect(widths[1]).toBeLessThan(120);
    expect(widths[2]).toBeGreaterThan((widths[0] + widths[1]) * 2);
});

test('a genuinely wide table scrolls without widening the editor', async ({ page }) => {
    const longToken = 'x'.repeat(240);
    await page.evaluate(md => window.muya!.setContent(md), [
        '| Key | Value |',
        '| --- | --- |',
        `| id | ${longToken} |`,
        '',
    ].join('\n'));

    const metrics = await page.locator(editor.table).first().evaluate((table) => {
        const figure = table.parentElement!;
        const content = figure.parentElement!;
        return {
            overflowX: getComputedStyle(figure).overflowX,
            tableClientWidth: figure.clientWidth,
            tableScrollWidth: figure.scrollWidth,
            editorClientWidth: content.clientWidth,
            editorScrollWidth: content.scrollWidth,
        };
    });

    expect(metrics.overflowX).toBe('auto');
    expect(metrics.tableScrollWidth).toBeGreaterThan(metrics.tableClientWidth);
    expect(metrics.editorScrollWidth).toBeLessThanOrEqual(metrics.editorClientWidth + 1);
});
