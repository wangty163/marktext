import type Content from '../block/base/content';
import type Parent from '../block/base/parent';
import type TreeNode from '../block/base/treeNode';
import type Table from '../block/gfm/table';
import type TableBodyCell from '../block/gfm/table/cell';
import type { ISelection } from '../selection/types';
import type { TState } from '../state/types';
import type { Nullable } from '../types';
import type { IClipboardPayload } from './copyData';
import type Clipboard from './index';
import Format from '../block/base/format';
import CodeBlockContent from '../block/content/codeBlockContent';
import LangInputContent from '../block/content/langInputContent';
import TableCellContent from '../block/content/tableCell';
import { ScrollPage } from '../block/scrollPage';
import { CLASS_NAMES } from '../config';
import { SelectionCaretType, SelectionDirection, SelectionType } from '../selection/types';
import { deepClone } from '../utils';
import { getBlock } from '../utils/dom';
import { getSelectionClipboardData } from './copyData';

export type TLineCopy
    = | {
        kind: 'block';
        text: string;
        state: TState;
        sourceParentName: string;
        cursorIndex: number;
        cursorOffset: number;
        pasteAfter: boolean;
    }
    | {
        kind: 'text';
        text: string;
        sourceBlockName: string;
        cursorColumn: number;
        pasteAfter: boolean;
    };

export interface ICollapsedLineClipboard {
    copy: TLineCopy;
    payload: IClipboardPayload;
    cut: () => void;
}

function selectionRange(
    anchorBlock: Content,
    anchorOffset: number,
    focusBlock: Content,
    focusOffset: number,
): ISelection {
    const isSelectionInSameBlock = anchorBlock === focusBlock;

    return {
        anchor: { offset: anchorOffset, block: anchorBlock, path: anchorBlock.path },
        focus: { offset: focusOffset, block: focusBlock, path: focusBlock.path },
        isCollapsed: false,
        isSelectionInSameBlock,
        direction: SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    };
}

function contentDescendants(block: Parent): Content[] {
    const contents: Content[] = [];
    let content: Nullable<Content> = block.firstContentInDescendant();
    while (content && content.isInBlock(block)) {
        contents.push(content);
        content = content.nextContentInContext();
    }

    return contents;
}

function structuralLineBlock(content: Content): Nullable<Parent> {
    let child = content.parent;
    let parent = child?.parent;
    while (parent && !parent.isScrollPage) {
        if (parent.blockName === 'list-item' || parent.blockName === 'task-list-item') {
            return child === parent.firstChild ? parent : child;
        }
        child = parent;
        parent = parent.parent;
    }

    return content.parent;
}

function isTextLine(content: Content): boolean {
    let parent = content.parent;
    while (parent && !parent.isScrollPage) {
        if (/code-block|html-block|math-block|frontmatter|diagram/.test(parent.blockName))
            return true;
        parent = parent.parent;
    }

    return content.text.includes('\n');
}

function preserveListRowChildren(
    block: Parent,
    list: Parent,
    previousItem: Nullable<Parent>,
): Nullable<Content> {
    let preserved: Nullable<Content> = null;

    block.forEach((node, index) => {
        if (index === 0 || !node.isParent())
            return;

        if (previousItem) {
            const clone = node.clone() as Parent;
            previousItem.append(clone, 'user');
            preserved ??= clone.firstContentInDescendant();
        }
        else if (node.blockName === list.blockName) {
            node.forEach((item) => {
                if (!item.isParent())
                    return;
                const clone = item.clone() as Parent;
                list.insertBefore(clone, block);
                preserved ??= clone.firstContentInDescendant();
            });
        }
        else {
            const clone = node.clone() as Parent;
            list.parent!.insertBefore(clone, list);
            preserved ??= clone.firstContentInDescendant();
        }
    });

    return preserved;
}

function removeEmptyParents(parent: Nullable<Parent>): void {
    let empty = parent;
    while (empty && !empty.isScrollPage && empty.length() === 0) {
        const next = empty.parent;
        empty.remove();
        empty = next;
    }
}

function removeListRow(clipboard: Clipboard, block: Parent): boolean {
    const list = block.parent;
    if (!list)
        return false;

    const nextItem = block.next as Nullable<Parent>;
    const previousItem = block.prev as Nullable<Parent>;
    const preserved = preserveListRowChildren(block, list, previousItem);

    block.remove();
    removeEmptyParents(list);
    if (clipboard.scrollPage?.length() === 0) {
        resetToEmptyParagraph(clipboard);
        return false;
    }

    let cursor = nextItem?.firstContentInDescendant() ?? null;
    if (!cursor && previousItem)
        cursor = previousItem.firstContentInDescendant();
    if (!cursor)
        cursor = preserved ?? null;
    cursor?.domNode?.focus();
    cursor?.setCursor(0, 0, true);

    return nextItem == null && previousItem != null;
}

function removeStructuralLine(clipboard: Clipboard, block: Parent): boolean {
    if (block.blockName === 'list-item' || block.blockName === 'task-list-item')
        return removeListRow(clipboard, block);

    const next = block.lastContentInDescendant()?.nextContentInContext();
    const previous = block.firstContentInDescendant()?.previousContentInContext();
    const parent = block.parent;

    block.remove();
    removeEmptyParents(parent);
    if (clipboard.scrollPage?.length() === 0) {
        resetToEmptyParagraph(clipboard);
        return false;
    }

    const cursor = next?.parent ? next : previous?.parent ? previous : null;
    cursor?.domNode?.focus();
    cursor?.setCursor(0, 0, true);

    return next == null && previous != null;
}

function textLineStart(text: string, offset: number): number {
    // lastIndexOf clamps a negative position to zero, so at offset 0 a
    // leading newline would otherwise be mistaken for the previous line end.
    return offset > 0 ? text.lastIndexOf('\n', offset - 1) + 1 : 0;
}

function textLineClipboard(
    content: Content,
    offset: number,
): ICollapsedLineClipboard {
    const text = content.text;
    const cursorOffset = Math.min(Math.max(offset, 0), text.length);
    const start = textLineStart(text, cursorOffset);
    const nextBreak = text.indexOf('\n', cursorOffset);
    const copyEnd = nextBreak < 0 ? text.length : nextBreak + 1;
    const deleteStart = nextBreak < 0 && start > 0 ? start - 1 : start;
    const copiedText = text.substring(start, copyEnd) || (deleteStart < start ? '\n' : '');

    const copy: TLineCopy = {
        kind: 'text',
        text: copiedText,
        sourceBlockName: content.blockName,
        cursorColumn: cursorOffset - start,
        pasteAfter: false,
    };

    return {
        payload: { html: '', text: copiedText },
        copy,
        cut: () => {
            copy.pasteAfter = nextBreak < 0 && start > 0;
            content.text = text.substring(0, deleteStart) + text.substring(copyEnd);
            setCursorAndConvert(content, deleteStart);
        },
    };
}

export function collapsedLineClipboard(
    clipboard: Clipboard,
): Nullable<ICollapsedLineClipboard> {
    if (clipboard.selection.image || clipboard.selection.table.hasSelection)
        return null;

    const selection = clipboard.selection.getSelection();
    if (selection == null || !selection.isCollapsed)
        return null;

    const { block, offset } = selection.anchor;
    if (
        block.blockName === 'language-input'
        || block.closestBlock('table')
    ) {
        return null;
    }

    if (isTextLine(block))
        return textLineClipboard(block, offset);

    const lineBlock = structuralLineBlock(block);
    if (lineBlock == null || lineBlock.parent == null)
        return null;

    const isListRow
        = lineBlock.blockName === 'list-item' || lineBlock.blockName === 'task-list-item';
    const rowBlock = isListRow && lineBlock.firstChild?.isParent()
        ? lineBlock.firstChild
        : lineBlock;
    const contents = contentDescendants(rowBlock);
    const first = contents[0];
    const last = contents[contents.length - 1];
    if (!first || !last)
        return null;

    const lineSelection = selectionRange(first, 0, last, last.text.length);
    const payload = getSelectionClipboardData(clipboard, lineSelection, true);

    const state = deepClone(lineBlock.getState()) as TState & { children?: TState[] };
    if (isListRow && state.children)
        state.children = state.children.slice(0, 1);

    const copy: TLineCopy = {
        kind: 'block',
        text: payload.text,
        state,
        sourceParentName: lineBlock.parent.blockName,
        cursorIndex: Math.max(contents.indexOf(block), 0),
        cursorOffset: offset,
        pasteAfter: false,
    };

    return {
        payload,
        copy,
        cut: () => {
            copy.pasteAfter = removeStructuralLine(clipboard, lineBlock);
        },
    };
}

export function pasteCopiedLine(clipboard: Clipboard, copy: TLineCopy): boolean {
    if (clipboard.selection.image || clipboard.selection.table.hasSelection)
        return false;

    const selection = clipboard.selection.getSelection();
    if (selection == null || !selection.isCollapsed)
        return false;

    const { block, offset } = selection.anchor;
    if (copy.kind === 'text') {
        if (block.blockName !== copy.sourceBlockName)
            return false;

        const lineStart = textLineStart(block.text, offset);
        const nextBreak = block.text.indexOf('\n', offset);
        const start = copy.pasteAfter
            ? nextBreak < 0 ? block.text.length : nextBreak + 1
            : lineStart;
        const text = copy.text.endsWith('\n') ? copy.text : `${copy.text}\n`;
        block.text = block.text.substring(0, start) + text + block.text.substring(start);
        setCursorAndConvert(block, start + Math.min(copy.cursorColumn, text.length - 1));

        return true;
    }

    const target = structuralLineBlock(block);
    if (target?.parent == null || target.parent.blockName !== copy.sourceParentName)
        return false;

    const pasted = ScrollPage.loadBlock(copy.state.name).create(
        clipboard.muya,
        deepClone(copy.state),
    );
    if (copy.pasteAfter)
        target.parent.insertAfter(pasted, target);
    else
        target.parent.insertBefore(pasted, target);
    const contents = contentDescendants(pasted);
    const cursor = contents[Math.min(copy.cursorIndex, contents.length - 1)];
    cursor?.domNode?.focus();
    cursor?.setCursor(
        Math.min(copy.cursorOffset, cursor.text.length),
        Math.min(copy.cursorOffset, cursor.text.length),
        true,
    );

    return true;
}

/**
 * Whole-document selection predicate: the selection spans from the very first
 * content leaf at offset 0 to the very last content leaf at its end.
 */
function isSelectAll(
    clipboard: Clipboard,
    startBlock: Content,
    startOffset: number,
    endBlock: Content,
    endOffset: number,
): boolean {
    const firstContent = clipboard.scrollPage?.firstContentInDescendant();
    const lastContent = clipboard.scrollPage?.lastContentInDescendant();

    return (
        firstContent === startBlock
        && startOffset === 0
        && lastContent === endBlock
        && endOffset === endBlock.text.length
    );
}

/**
 * Replace the whole document with a single empty paragraph and seat the
 * caret in it.
 */
function resetToEmptyParagraph(clipboard: Clipboard): void {
    const { scrollPage } = clipboard;
    if (scrollPage == null)
        return;

    scrollPage.forEach((child) => {
        (child as Parent).remove();
    });

    const newParagraphBlock = ScrollPage.loadBlock('paragraph').create(
        clipboard.muya,
        { name: 'paragraph', text: '' },
    );
    scrollPage.append(newParagraphBlock, 'user');

    const cursorBlock = newParagraphBlock.firstContentInDescendant();
    cursorBlock?.domNode?.focus();
    cursorBlock?.setCursor(0, 0, true);
}

// Seat the caret and re-evaluate the block's type from its new text — a cut can
// add or remove a block-leading marker (`# `, `- `, …).
function setCursorAndConvert(block: Content, offset: number): void {
    block.setCursor(offset, offset, true);
    if (block instanceof Format)
        block.checkInlineUpdate();
}

// Collapse the document to a single empty paragraph once a cut empties it.
function resetIfEmpty(clipboard: Clipboard): void {
    if (clipboard.scrollPage?.length() === 0)
        resetToEmptyParagraph(clipboard);
}

function emptyCell(cell: Content): void {
    if (cell.text === '')
        return;

    cell.text = '';
    // The text setter only updates the json state, so the cell would keep
    // showing its old text (#5398).
    cell.update();
}

// Clear every cell content leaf from `start` up to, but not including, `end` —
// the cells the selection covers whole. The grid stays: a cut never takes a
// table apart.
function emptyCellsBefore(start: Nullable<Content>, end: TreeNode): void {
    let cellContent = start;
    while (cellContent && cellContent !== end) {
        emptyCell(cellContent);
        cellContent = cellContent.nextContentInContext();
    }
}

function removeBlocksWithinTable(before: TreeNode, after: TreeNode): void {
    emptyCellsBefore(before.nextContentInContext(), after);
    // Inside one table the end cell's tail joined the start cell, so that cell
    // is emptied as well.
    if (after.isContent())
        emptyCell(after);
}

function removePrecedingSiblings(node: TreeNode): void {
    let prev = node.prev;
    while (prev) {
        const temp = prev.prev;
        prev.remove();
        prev = temp;
    }
}

function removeFollowingSiblings(node: TreeNode): void {
    let next = node.next;
    while (next) {
        const temp = next.next;
        next.remove();
        next = temp;
    }
}

// The start-side counterpart of `pruneAfterBranch`: the blocks after `before`
// inside its own containers, below `beforeBranch`, are selected too (#5385).
// The walk starts at the whole block `before` belongs to, so the inner nodes of
// a code block (which share its json path) and a table's grid stay intact.
function pruneBeforeBranch(beforeBranch: TreeNode, before: TreeNode): void {
    let onPath: Nullable<TreeNode> = before.isContent() ? before.getAnchor() ?? before : before;
    while (onPath && onPath !== beforeBranch && !onPath.isScrollPage) {
        removeFollowingSiblings(onPath);
        onPath = onPath.parent;
    }
}

// The blocks before `node` inside its containers below `branch` are selected;
// `node` itself survives, unlike in `pruneAfterBranch`.
function prunePrecedingWithinBranch(branch: TreeNode, node: TreeNode): void {
    let onPath: Nullable<TreeNode> = node;
    while (onPath && onPath !== branch) {
        removePrecedingSiblings(onPath);
        onPath = onPath.parent;
    }
}

// `after`'s branch is removed but later siblings inside `afterBranch` survive.
// Walk up from `after` to the direct child of `afterBranch`, removing each
// on-path node's preceding siblings and any ancestor it leaves empty, stopping
// below `afterBranch`. Finally remove the on-path direct child itself; later
// siblings survive.
function pruneAfterBranch(afterBranch: TreeNode, after: TreeNode): void {
    // The inner nodes of a code, math, html, diagram or front matter block
    // share the block's json path, so walking up through them would remove
    // that json node once per level, taking the siblings after it too
    // (#4903, #5148). Start the walk at the block.
    let onPath: TreeNode = after instanceof CodeBlockContent ? after.getAnchor() ?? after : after;
    while (onPath.parent && onPath.parent !== afterBranch) {
        removePrecedingSiblings(onPath);
        const parent = onPath.parent;
        onPath.remove();
        if (parent.children.length > 0)
            return;

        onPath = parent;
    }

    removePrecedingSiblings(onPath);
    onPath.remove();
}

/**
 * Remove the document-order span between the `before` content leaf and the
 * `after` content leaf — every block strictly between them, plus `after`
 * and any container `after` leaves empty — while preserving `before`'s
 * container chain and any block that follows `after`. Equivalent to legacy
 * `contentState.removeBlocks(before, after)` (`before`'s head + `after`'s
 * tail already live in `before.text`).
 *
 * `endsWholeTable` says the selection covers every cell of the table `after`
 * sits in, so that table goes with the span instead of keeping an emptied grid.
 */
function removeBlocks(before: TreeNode, after: TreeNode, endsWholeTable = false): void {
    // A table is exempt from structural removal: empty the spanned cells in
    // place and keep the grid rather than deleting cells/rows.
    const beforeTable = before.closestBlock('table');
    const afterTable = after.closestBlock('table');

    if (beforeTable != null && beforeTable === afterTable) {
        removeBlocksWithinTable(before, after);

        return;
    }

    // `after` lands inside a table that does not also contain `before`: the
    // span stops at the table, which is then emptied rather than removed —
    // unless the selection covers all of it (#5405).
    if (afterTable != null) {
        removeSpan(before, afterTable, endsWholeTable);

        if (!endsWholeTable)
            emptyCellsBefore((afterTable as Parent).firstContentInDescendant(), after);

        return;
    }

    removeSpan(before, after, true);
}

/**
 * Remove the span between `before` and `end`: the blocks after `before` inside
 * its own containers, the blocks strictly between the two, and the blocks
 * before `end` inside its own containers. `removeEnd` also removes `end`
 * itself and the containers it leaves empty; a table that keeps its grid
 * passes `false` and is emptied by the caller instead.
 *
 * Nodes are removed children-before-parents so each dispatched json removal
 * targets a still-attached path.
 */
function removeSpan(before: TreeNode, end: TreeNode, removeEnd: boolean): void {
    const beforeAncestors = new Set<TreeNode>();
    for (let node: Nullable<TreeNode> = before; node; node = node.parent)
        beforeAncestors.add(node);

    // The shared container: the lowest ancestor of `end` that also
    // contains `before`.
    let endBranch: TreeNode = end;
    while (
        endBranch.parent
        && !endBranch.parent.isScrollPage
        && !beforeAncestors.has(endBranch.parent)
    ) {
        endBranch = endBranch.parent;
    }

    const commonParent = endBranch.parent;
    const beforeBranch = commonParent
        ? [...beforeAncestors].find(node => node.parent === commonParent)
        : null;

    if (beforeBranch)
        pruneBeforeBranch(beforeBranch, before);

    // Remove every sibling strictly between `beforeBranch` and
    // `endBranch` inside the shared container.
    let between = beforeBranch ? beforeBranch.next : endBranch.prev;
    while (between && between !== endBranch) {
        const temp = between.next;
        between.remove();
        between = temp;
    }

    if (!removeEnd) {
        prunePrecedingWithinBranch(endBranch, end);

        return;
    }

    // Does any content leaf after `end` survive inside `endBranch`? If
    // not, `endBranch` is fully consumed — remove it once (this also keeps
    // atomic blocks like code/math/html/diagram/frontmatter, whose inner
    // tree collapses to a single json node, from being double-removed).
    const endLeaf = end.isParent() ? end.lastContentInDescendant() : (end as Content);
    const nextContent = endLeaf?.nextContentInContext() ?? null;
    const endHasSurvivors
        = nextContent != null && nextContent.isInBlock(endBranch as Parent);

    if (!endHasSurvivors) {
        if (endBranch.parent)
            endBranch.remove();

        return;
    }

    pruneAfterBranch(endBranch, end);
}

/**
 * Resolve the frozen table selection to its table and the list of selected
 * body cells, reading the highlighted cell DOM nodes. Returns `null` when
 * there is no resolvable selection.
 */
function selectedTableCells(
    clipboard: Clipboard,
): Nullable<{ table: Table; cells: TableBodyCell[] }> {
    const { domNode } = clipboard.muya;
    const selectedDoms = domNode.querySelectorAll(`.${CLASS_NAMES.MU_TABLE_CELL_SELECTED}`);
    const cells: TableBodyCell[] = [];
    let table: Nullable<Table> = null;

    for (const dom of selectedDoms) {
        const block = getBlock(dom);
        if (block == null || block.blockName !== 'table.cell')
            continue;

        const cell = block as TableBodyCell;
        cells.push(cell);
        table ??= cell.table;
    }

    if (table == null || cells.length === 0)
        return null;

    return { table, cells };
}

// Remove the whole table block and seat the caret just outside it (or reset to
// a single empty paragraph when the table was the only block).
function removeWholeTable(clipboard: Clipboard, table: Table): void {
    clipboard.selection.table.clear();
    const outsideContent
        = table.nextContentInContext() ?? table.previousContentInContext();
    table.remove();
    if (clipboard.scrollPage?.length() === 0)
        resetToEmptyParagraph(clipboard);
    else
        outsideContent?.setCursor(0, 0, true);
}

// For an already-empty frozen selection: if the rectangle covers whole
// column(s), whole row(s), or the whole table, delete that structure and return
// `true`; a partial rectangle returns `false` so the caller just drops the
// selection. Multiple whole columns / rows are removed high-index-first so the
// remaining offsets stay valid.
function removeEmptyTableStructure(clipboard: Clipboard): boolean {
    const selectedCells = selectedTableCells(clipboard);
    if (selectedCells == null)
        return false;

    const { table, cells } = selectedCells;
    const rows = new Set(cells.map(cell => cell.rowOffset));
    const columns = new Set(cells.map(cell => cell.columnOffset));
    const spansAllRows = rows.size === table.rowCount;
    const spansAllColumns = columns.size === table.columnCount;

    if (spansAllRows && spansAllColumns) {
        removeWholeTable(clipboard, table);

        return true;
    }

    if (spansAllRows) {
        clipboard.selection.table.clear();
        let cursorBlock: Nullable<Content> = null;
        for (const column of [...columns].sort((a, b) => b - a))
            cursorBlock = table.removeColumn(column);
        cursorBlock?.setCursor(0, 0, true);

        return true;
    }

    if (spansAllColumns) {
        clipboard.selection.table.clear();
        let cursorBlock: Nullable<Content> = null;
        for (const row of [...rows].sort((a, b) => b - a))
            cursorBlock = table.removeRow(row);
        cursorBlock?.setCursor(0, 0, true);

        return true;
    }

    return false;
}

// Clipboard cut over a frozen table selection: a whole-table selection is
// deleted even with content; otherwise content cells fall back to an in-place
// clear, and an empty whole column/row selection deletes that structure.
function cutTableStructure(clipboard: Clipboard): boolean {
    const selectedCells = selectedTableCells(clipboard);
    if (selectedCells == null)
        return false;

    const { table, cells } = selectedCells;
    const rows = new Set(cells.map(cell => cell.rowOffset));
    const columns = new Set(cells.map(cell => cell.columnOffset));

    if (rows.size === table.rowCount && columns.size === table.columnCount) {
        removeWholeTable(clipboard, table);

        return true;
    }

    if (cells.some(cell => (cell.firstChild as Content)?.text))
        return false;

    return removeEmptyTableStructure(clipboard);
}

export function cutSelection(clipboard: Clipboard): void {
    // Cut a selected image: the copy half wrote its raw markdown; remove it here.
    const selectedImage = clipboard.selection.image;
    if (selectedImage) {
        const { block, ...imageInfo } = selectedImage;
        block.deleteImage(imageInfo);
        clipboard.selection.activate(SelectionType.TEXT);

        return;
    }

    if (clipboard.selection.table.hasSelection) {
        if (!cutTableStructure(clipboard))
            clipboard.selection.table.clearSelectedCells();

        return;
    }

    const selection = clipboard.selection.getSelection();
    if (selection == null)
        return;

    const {
        isSelectionInSameBlock,
        anchor,
        focus,
        direction,
    } = selection;
    const anchorBlock = anchor.block;
    const focusBlock = focus.block;

    // Handler `cut` event in the same block.
    if (isSelectionInSameBlock) {
        const { text } = anchorBlock;
        const startOffset
            = direction === SelectionDirection.FORWARD ? anchor.offset : focus.offset;
        const endOffset = direction === SelectionDirection.FORWARD ? focus.offset : anchor.offset;

        anchorBlock.text
            = text.substring(0, startOffset) + text.substring(endOffset);

        setCursorAndConvert(anchorBlock, startOffset);

        return;
    }

    const startBlock = direction === SelectionDirection.FORWARD ? anchorBlock : focusBlock;
    const endBlock = direction === SelectionDirection.FORWARD ? focusBlock : anchorBlock;
    const startOffset = direction === SelectionDirection.FORWARD ? anchor.offset : focus.offset;
    const endOffset = direction === SelectionDirection.FORWARD ? focus.offset : anchor.offset;

    // Whole-document selection collapses to a single empty paragraph.
    if (isSelectAll(clipboard, startBlock, startOffset, endBlock, endOffset)) {
        resetToEmptyParagraph(clipboard);

        return;
    }

    // #918: a cross-block cut that starts inside a code fence's language line
    // collapses the start code block to a paragraph holding the merged text,
    // rather than corrupting the code block's language with the merged content.
    if (startBlock.blockName === 'language-input') {
        collapseLanguageInputCut(clipboard, startBlock, endBlock, startOffset, endOffset);

        return;
    }

    // Leaf-level merge: keep the
    // start head and the end tail in the start content block, then remove
    // only the structure strictly between the two leaves (and the emptied
    // end-side containers). The start block keeps its container — a list
    // item stays a list item, a quote stays a quote.
    const { tail, lastRemoved, endsWholeTable } = resolveCutEnd(startBlock, endBlock, endOffset);
    startBlock.text = startBlock.text.substring(0, startOffset) + tail;

    if (lastRemoved)
        removeBlocks(startBlock, lastRemoved, endsWholeTable);

    setCursorAndConvert(startBlock, startOffset);
    resetIfEmpty(clipboard);
}

interface ICutEnd {
    // Text after the selection end that joins the start block.
    tail: string;
    // The last content leaf whose branch the cut removes; null when nothing
    // lies between the start block and the end.
    lastRemoved: Nullable<Content>;
    // The selection covers every cell of the table the end sits in, so the
    // table is removed instead of kept as an emptied grid (#5405).
    endsWholeTable: boolean;
}

// Where a cross-block cut stops. Normally at the end leaf, whose text after the
// caret joins the start block. A cut ending inside a code block's language
// line stops before that code block instead: the code block keeps its code and
// language input, and loses only the selected start of its language (#5371).
function resolveCutEnd(startBlock: Content, endBlock: Content, endOffset: number): ICutEnd {
    if (endBlock instanceof TableCellContent)
        return resolveTableCutEnd(startBlock, endBlock, endOffset);

    if (!(endBlock instanceof LangInputContent))
        return { tail: endBlock.text.substring(endOffset), lastRemoved: endBlock, endsWholeTable: false };

    const language = endBlock.text.substring(endOffset);
    if (language !== endBlock.text) {
        endBlock.text = language;
        endBlock.parent!.lang = language;
        endBlock.update();
    }

    const beforeCodeBlock = endBlock.previousContentInContext();

    return {
        tail: '',
        lastRemoved: beforeCodeBlock === startBlock ? null : beforeCodeBlock,
        endsWholeTable: false,
    };
}

// A cut that ends in a table cell leaves what it does not cover where it is:
// the text after the selection stays in its cell rather than joining the start
// block, which would move it out of the table (#5405).
function resolveTableCutEnd(startBlock: Content, endBlock: TableCellContent, endOffset: number): ICutEnd {
    const { table } = endBlock;

    // Both ends inside one table: the tail joins the start cell, as it does
    // between any two leaves. Nothing leaves the table that way.
    if (startBlock.isInBlock(table))
        return { tail: endBlock.text.substring(endOffset), lastRemoved: endBlock, endsWholeTable: false };

    const endsWholeTable
        = endOffset === endBlock.text.length
            && endBlock === table.lastContentInDescendant();

    const rest = endBlock.text.substring(endOffset);
    if (!endsWholeTable && rest !== endBlock.text) {
        endBlock.text = rest;
        endBlock.update();
    }

    return { tail: '', lastRemoved: endBlock, endsWholeTable };
}

// #918: collapse the start code block (whose language line begins the
// selection) into a paragraph carrying the merged head + end-tail text, then
// remove the spanned structure.
function collapseLanguageInputCut(
    clipboard: Clipboard,
    startBlock: Content,
    endBlock: Content,
    startOffset: number,
    endOffset: number,
): void {
    const { tail, lastRemoved, endsWholeTable } = resolveCutEnd(startBlock, endBlock, endOffset);
    const mergedText = startBlock.text.substring(0, startOffset) + tail;
    // The code block itself, even inside a list item or quote: replacing the
    // outermost block would take the rest of that list or quote with it (#5368).
    const codeBlock = startBlock.getAnchor();

    // Ending in this code block's own code leaves nothing between the leaves;
    // the replacement below removes that code with its block. `removeBlocks`
    // would detach the inner `code` node, which shares the code block's json
    // path, so the json state would lose the following block (#4903, #5148).
    if (lastRemoved && (codeBlock == null || !lastRemoved.isInBlock(codeBlock)))
        removeBlocks(startBlock, lastRemoved, endsWholeTable);

    const paragraph = ScrollPage.loadBlock('paragraph').create(clipboard.muya, {
        name: 'paragraph',
        text: mergedText,
    });
    codeBlock?.replaceWith(paragraph);

    paragraph.firstContentInDescendant()?.setCursor(startOffset, startOffset, true);

    resetIfEmpty(clipboard);
}

// Keyboard delete over a frozen table selection (two-stage, muyajs parity):
// the first press clears the selected cells' text but keeps the rectangle
// frozen; once the cells are empty, the next press removes whole column(s) /
// row(s) / the whole table, or drops the selection for a partial rectangle.
export function deleteTableSelection(clipboard: Clipboard): void {
    if (clipboard.selection.table.emptySelectedCells())
        return;

    if (!removeEmptyTableStructure(clipboard))
        clipboard.selection.table.clear();
}
