import { sideNavStyle } from "./side-nav-style";

export class SideNav extends UI.VBox {
  constructor() {
    super(true); // use web component
    this.setMinimumSize(200, 0);
    this._tree = new UI.TreeOutlineInShadow();
    this._tree.injectStyle(sideNavStyle);
    this.contentElement.appendChild(this._tree.element);
    /** @type {?UI.TreeElement} */
    this._selectedTreeElement = null;
    /** @type {!Array<!Console.ConsoleSidebar.FilterTreeElement>} */
    this._tree.appendChild(new UI.TreeElement('test1'));
    this._tree.appendChild(new UI.TreeElement('test2'));
  }
}