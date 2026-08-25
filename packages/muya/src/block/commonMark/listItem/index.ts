import type { Muya } from '../../../muya';
import type { IListItemState } from '../../../state/types';
import { CLASS_NAMES } from '../../../config';
import { mixins } from '../../../utils';
import { LinkedList } from '../../base/linkedList/linkedList';
import Parent from '../../base/parent';
import IContainerQueryBlock from '../../mixins/containerQueryBlock';
import { ScrollPage } from '../../scrollPage';

@mixins(IContainerQueryBlock)
class ListItem extends Parent {
    public override children: LinkedList<Parent> = new LinkedList();

    static override blockName = 'list-item';

    static create(muya: Muya, state: IListItemState) {
        const listItem = new ListItem(muya, state);

        listItem.append(
            ...state.children.map(child =>
                ScrollPage.loadBlock(child.name).create(muya, child),
            ),
        );

        return listItem;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset, 'children'];
    }

    private _blankLinesBefore: number;

    constructor(muya: Muya, state: IListItemState) {
        super(muya);
        this.tagName = 'li';
        this._blankLinesBefore = state.meta?.blankLinesBefore ?? 0;
        this.classList = [CLASS_NAMES.MU_LIST_ITEM];
        if (this._blankLinesBefore)
            this.attributes.style = `margin-top: ${this._blankLinesBefore}lh`;
        this.createDomNode();
    }

    override getState(): IListItemState {
        const state: IListItemState = {
            name: 'list-item',
            ...(this._blankLinesBefore
                ? { meta: { blankLinesBefore: this._blankLinesBefore } }
                : {}),
            children: this.children.map(child => child.getState()),
        };

        return state;
    }
}

export default ListItem;
