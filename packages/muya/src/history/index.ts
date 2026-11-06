import type { JSONOpList } from 'ot-json1';
import type { Muya } from '../muya';
import type { IAnchorFocusInfo, IHistorySelection } from '../selection/types';
import type { TState } from '../state/types';
import type { Nullable } from '../types';
import * as json1 from 'ot-json1';
import { asDoc } from '../state';
import { deepClone } from '../utils';

interface IOptions {
    delay: number;
    maxStack: number;
    userOnly: boolean;
}

interface IOperation {
    operation: JSONOpList;
    selection: Nullable<IHistorySelection>;
    // Missing on histories saved by older versions. New entries carry both
    // endpoints so navigating before undo/redo cannot change the return caret.
    selectionAfter?: Nullable<IHistorySelection>;
    // A `rebuild` entry is applied on undo/redo by dispatching its op to the
    // authoritative json state and rebuilding the live block tree wholesale
    // (ScrollPage.updateState) — NOT through `Editor.updateContents`'
    // incremental pick/drop DOM walker. The walker only handles a few op shapes
    // (single block insert at an index, text edit, checked/meta) and desyncs the
    // DOM from the json state for whole-document ops, so bulk replacements
    // (e.g. exiting source-code mode) are recorded as rebuild entries. The op
    // itself is a normal, fully-invertible ot-json1 op, so compose / transform /
    // invert continue to work unchanged.
    rebuild?: boolean;
}

interface IStack {
    undo: IOperation[];
    redo: IOperation[];
}

// A JSON-serializable view of an ISelection. The live endpoint `block`
// references are dropped — they are an in-memory optimization only.
// `Editor._restoreSelection` resolves each endpoint's path in the current
// block tree, so a snapshot remains valid after undo has replaced those blocks.
type ISerializableAnchorFocusInfo = Pick<IAnchorFocusInfo, 'offset' | 'path'>;

interface ISerializableSelection {
    anchor: ISerializableAnchorFocusInfo;
    focus: ISerializableAnchorFocusInfo;
    isCollapsed: IHistorySelection['isCollapsed'];
    isSelectionInSameBlock: IHistorySelection['isSelectionInSameBlock'];
    direction: IHistorySelection['direction'];
    type: IHistorySelection['type'];
}

interface ISerializableOperation {
    operation: JSONOpList;
    selection: Nullable<ISerializableSelection>;
    selectionAfter?: Nullable<ISerializableSelection>;
    rebuild?: boolean;
}

// The public, JSON-serializable shape returned by `getHistory` and accepted by
// `setHistory`. Mirrors the private `_stack` plus the bookkeeping pointers
// (`lastRecorded`, `selectionStack`) needed to round-trip the recording state.
export interface ISerializedHistory {
    stack: {
        undo: ISerializableOperation[];
        redo: ISerializableOperation[];
    };
    lastRecorded: number;
    selectionStack: (Nullable<ISerializableSelection>)[];
}

enum HistoryAction {
    UNDO = 'undo',
    REDO = 'redo',
}

const DEFAULT_OPTIONS = {
    delay: 1000,
    maxStack: 100,
    userOnly: false,
};

export type TInputKind = 'insert' | 'delete';

// Undo grouping is otherwise purely time-based (`delay`), so a fast typed
// sentence coalesces into a single entry. These helpers let the input pipeline
// hint a boundary: a switch between inserting and deleting, or typing a
// whitespace (word boundary), starts a fresh undo entry.
export function classifyInputKind(inputType: string): Nullable<TInputKind> {
    if (inputType.startsWith('insert'))
        return 'insert';
    if (inputType.startsWith('delete'))
        return 'delete';
    return null;
}

export function shouldBreakUndoGroup(
    prevKind: Nullable<TInputKind>,
    kind: Nullable<TInputKind>,
    data: Nullable<string>,
): boolean {
    if (kind == null)
        return false;
    const isWordBoundary = kind === 'insert' && data != null && /\s/.test(data);
    const switchedKind = prevKind != null && prevKind !== kind;
    return isWordBoundary || switchedKind;
}

class History {
    private _lastRecorded: number = 0;
    private _lastInputKind: Nullable<TInputKind> = null;
    private _ignoreChange: boolean = false;
    private _composing: boolean = false;
    private _selectionStack: (Nullable<IHistorySelection>)[] = [];
    private _stack: IStack = {
        undo: [],
        redo: [],
    };

    private get _selection() {
        return this._muya.editor.selection;
    }

    constructor(private _muya: Muya, private _options: IOptions = DEFAULT_OPTIONS) {
        this._listen();
    }

    private _listen() {
        const { eventCenter, domNode } = this._muya;
        // Selection changes before a model mutation describe the next edit's
        // starting point. Once edits are queued, setCursor describes their
        // result instead and must not overwrite that starting snapshot.
        eventCenter.on('selection-change', () => this._rememberSelection());

        const capture = () => {
            if (this._ignoreChange || this._composing || !this._muya.hasFocus())
                return;
            // Finish the preceding edit before another key/pointer action can
            // move its native selection. Typing still coalesces in _record.
            this._muya.editor.jsonState.flush();
            this._rememberSelection();
        };
        for (const type of ['keydown', 'beforeinput', 'mousedown'])
            eventCenter.attachDOMEvent(domNode, type, capture, true);
        for (const type of ['cut', 'paste'])
            eventCenter.attachDOMEvent(document, type, capture, true);
        eventCenter.attachDOMEvent(domNode, 'compositionstart', () => {
            capture();
            this._composing = true;
        }, true);
        eventCenter.attachDOMEvent(domNode, 'compositionend', () => {
            // The block commits the IME text later in this same event dispatch.
            // Keep its original selection through caret-anchor cleanup too.
            queueMicrotask(() => {
                this._composing = false;
            });
        }, true);

        this._muya.eventCenter.on(
            'json-change',
            ({
                op,
                source,
                prevDoc,
            }: {
                op: Nullable<JSONOpList>;
                source: string;
                prevDoc: TState[];
                doc: TState[];
            }) => {
                if (this._ignoreChange)
                    return;

                // The identity op (`null`) carries no change to record or
                // transform. It can still reach here through `json-change` when
                // queued ops compose away (e.g. IME edits, #4806); `_record`
                // would otherwise crash reading `op.length`.
                if (op == null)
                    return;

                if (!this._options.userOnly || source === 'user')
                    this._record(op, prevDoc);
                else
                    this._transform(op);
            },
        );
    }

    private _change(source: HistoryAction, dest: HistoryAction) {
        // `JSONState` batches edits and applies them on the next animation
        // frame, so the json state can lag behind the text the user already
        // sees. Undo/redo inverts its entry against that state, and inverting
        // against a document the entry was never built from corrupts the text
        // (`hello world` undid to `helld`) with a result that depends on frame
        // timing. Apply the queue first — the same handoff a tab switch
        // performs (#2938) — which also records the pending edit, so the undo
        // reverts exactly what the user last did.
        this._muya.editor.jsonState.flush();

        if (this._stack[source].length === 0)
            return;

        const { operation, selection, selectionAfter, rebuild } = this._stack[source].pop()!;
        const inverseOperation = json1.type.invertWithDoc(
            operation,
            asDoc(this._muya.editor.jsonState.getState()),
        );

        this._stack[dest].push({
            operation: inverseOperation as JSONOpList,
            selection: selectionAfter === undefined ? this._snapshotSelection() : selectionAfter,
            selectionAfter: selection,
            rebuild,
        });

        this._lastRecorded = 0;
        this._ignoreChange = true;
        try {
            if (rebuild)
                this._muya.editor.rebuildContents(operation, selection, 'user');
            else
                this._muya.editor.updateContents(operation, selection, 'user');
        }
        finally {
            this._ignoreChange = false;
        }

        this._rememberSelection();
    }

    clear() {
        this._stack = { undo: [], redo: [] };
        this._selectionStack = [];
        this._lastRecorded = 0;
        this._lastInputKind = null;
        this._ignoreChange = false;
        this._composing = false;
        this._rememberSelection();
    }

    getHistory(): ISerializedHistory {
        return {
            stack: {
                undo: this._stack.undo.map(op => this._toSerializableOperation(op)),
                redo: this._stack.redo.map(op => this._toSerializableOperation(op)),
            },
            lastRecorded: this._lastRecorded,
            selectionStack: this._selectionStack.map(sel =>
                this._toSerializableSelection(sel),
            ),
        };
    }

    setHistory(history: ISerializedHistory) {
        this._stack = {
            undo: history.stack.undo.map(op => this._fromSerializableOperation(op)),
            redo: history.stack.redo.map(op => this._fromSerializableOperation(op)),
        };
        this._lastRecorded = history.lastRecorded ?? 0;
        this._selectionStack = (history.selectionStack ?? []).map(sel =>
            this._fromSerializableSelection(sel),
        );
    }

    private _toSerializableOperation(op: IOperation): ISerializableOperation {
        return {
            operation: deepClone(op.operation),
            selection: this._toSerializableSelection(op.selection),
            ...(op.selectionAfter !== undefined
                ? { selectionAfter: this._toSerializableSelection(op.selectionAfter) }
                : {}),
            ...(op.rebuild ? { rebuild: true } : {}),
        };
    }

    private _fromSerializableOperation(op: ISerializableOperation): IOperation {
        return {
            operation: deepClone(op.operation),
            selection: this._fromSerializableSelection(op.selection),
            ...(op.selectionAfter !== undefined
                ? { selectionAfter: this._fromSerializableSelection(op.selectionAfter) }
                : {}),
            ...(op.rebuild ? { rebuild: true } : {}),
        };
    }

    // Strip the live block references and keep only plain paths + offsets.
    private _toSerializableSelection(
        selection: Nullable<IHistorySelection>,
    ): Nullable<ISerializableSelection> {
        if (selection == null)
            return selection;

        return {
            anchor: { offset: selection.anchor.offset, path: deepClone(selection.anchor.path) },
            focus: { offset: selection.focus.offset, path: deepClone(selection.focus.path) },
            isCollapsed: selection.isCollapsed,
            isSelectionInSameBlock: selection.isSelectionInSameBlock,
            direction: selection.direction,
            type: selection.type,
        };
    }

    // Rebuild a selection without live block references. The block instances
    // are intentionally omitted: the only consumers of a restored selection
    // are `editor.updateContents` and `editor.rebuildContents`, both of which
    // re-resolve the target block from each endpoint's `path` via
    // `scrollPage.queryBlock` when no block instance is present. The return
    // type is `IHistorySelection`, whose endpoint `block` references are
    // optional, so the missing block fields are part of the contract rather
    // than an unsound cast over fabricated `ContentBlock` instances.
    private _fromSerializableSelection(
        selection: Nullable<ISerializableSelection>,
    ): Nullable<IHistorySelection> {
        if (selection == null)
            return selection;

        return {
            anchor: { offset: selection.anchor.offset, path: deepClone(selection.anchor.path) },
            focus: { offset: selection.focus.offset, path: deepClone(selection.focus.path) },
            isCollapsed: selection.isCollapsed,
            isSelectionInSameBlock: selection.isSelectionInSameBlock,
            direction: selection.direction,
            type: selection.type,
        };
    }

    cutoff() {
        this._lastRecorded = 0;
    }

    markInputBoundary(inputType: string, data: Nullable<string>): void {
        const kind = classifyInputKind(inputType);
        if (kind == null)
            return;
        if (shouldBreakUndoGroup(this._lastInputKind, kind, data))
            this.cutoff();
        this._lastInputKind = kind;
    }

    private _snapshotSelection(): Nullable<IHistorySelection> {
        const selection = this._selection.getSelection();
        if (selection && (selection.anchor.block.muya !== this._muya || selection.focus.block.muya !== this._muya))
            return null;
        return this._toSerializableSelection(selection);
    }

    private _rememberSelection() {
        if (this._ignoreChange || this._composing || this._muya.editor.jsonState.hasPendingOperations)
            return;
        const selection = this._snapshotSelection();
        const previous = this._selectionStack.at(-1);
        if (previous && selection && (['anchor', 'focus'] as const).some((endpoint) => {
            const before = previous[endpoint];
            const after = selection[endpoint];
            return before.offset !== after.offset
                || before.path.length !== after.path.length
                || before.path.some((part, index) => part !== after.path[index]);
        })) {
            this.cutoff();
        }
        this._selectionStack = [selection];
    }

    private _getLastSelection() {
        this._selectionStack.push(this._snapshotSelection());

        if (this._selectionStack.length > 2)
            this._selectionStack.shift();

        return this._selectionStack.length === 2 ? this._selectionStack[0] : null;
    }

    private _record(op: JSONOpList, doc: TState[]) {
        if (op.length === 0)
            return;

        let selection = this._getLastSelection();
        this._stack.redo = [];
        let undoOperation = json1.type.invertWithDoc(op, asDoc(doc));

        const timestamp = Date.now();
        if (
            this._lastRecorded + this._options.delay > timestamp
            && this._stack.undo.length > 0
        ) {
            const { operation: lastOperation, selection: lastSelection }
                = this._stack.undo.pop()!;
            selection = lastSelection;
            undoOperation = json1.type.compose(undoOperation, lastOperation);
        }
        else {
            this._lastRecorded = timestamp;
        }

        if (!undoOperation || undoOperation.length === 0)
            return;

        this._stack.undo.push({
            operation: undoOperation,
            selection,
            selectionAfter: this._selectionStack.at(-1) ?? null,
        });

        if (this._stack.undo.length > this._options.maxStack)
            this._stack.undo.shift();
    }

    /**
     * Record a whole-document replacement (e.g. exiting source-code mode) as a
     * single, standalone undo boundary that is applied via a full block-tree
     * rebuild rather than the incremental DOM walker.
     *
     * The forward op (`prevDoc` -> current state) is dispatched to the json
     * state by the caller; here we only record its lossless inverse so the first
     * undo reverts the entire bulk change in one step. The entry never coalesces
     * with neighbouring edits: `_lastRecorded` is reset so the next ordinary
     * edit also starts its own boundary, and the redo stack is cleared.
     */
    recordRebuild(op: JSONOpList, prevDoc: TState[], selection: Nullable<IHistorySelection>) {
        if (op.length === 0)
            return;

        const undoOperation = json1.type.invertWithDoc(op, asDoc(prevDoc));

        if (!undoOperation || undoOperation.length === 0)
            return;

        this._stack.redo = [];
        this._stack.undo.push({ operation: undoOperation, selection, rebuild: true });
        // Force the next ordinary edit into its own undo entry — the bulk
        // replacement must not absorb a later keystroke (or vice versa).
        this._lastRecorded = 0;

        if (this._stack.undo.length > this._options.maxStack)
            this._stack.undo.shift();
    }

    /**
     * Run `fn` (which dispatches a json-change) WITHOUT recording it on the undo
     * stack. The caller has already recorded the corresponding boundary itself
     * (see `recordRebuild`), so the forward apply must not be double-recorded.
     */
    suppressRecording(fn: () => void) {
        const previous = this._ignoreChange;
        this._ignoreChange = true;
        try {
            fn();
        }
        finally {
            this._ignoreChange = previous;
        }
    }

    canRedo() {
        return this._stack.redo.length > 0;
    }

    redo() {
        this._change(HistoryAction.REDO, HistoryAction.UNDO);
    }

    private _transform(op: JSONOpList) {
        transformStack(this._stack.undo, op);
        transformStack(this._stack.redo, op);
    }

    canUndo() {
        return this._stack.undo.length > 0;
    }

    undo() {
        this._change(HistoryAction.UNDO, HistoryAction.REDO);
    }
}

function transformStack(stack: IOperation[], operation: JSONOpList) {
    let remoteOperation = operation;

    for (let i = stack.length - 1; i >= 0; i -= 1) {
        const { operation: oldOperation } = stack[i];
        // TODO: need test.
        stack[i] = Object.assign(stack[i], {
            operation: json1.type.transform(oldOperation, remoteOperation, 'left'),
        });
        remoteOperation = json1.type.transform(
            remoteOperation,
            oldOperation,
            'right',
        )!;
        if (stack[i].operation.length === 0)
            stack.splice(i, 1);
    }
}

export default History;
