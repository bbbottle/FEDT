import {SideNav} from "./side-nav";

class HelloWorldView extends UI.VBox {
  constructor() {
    super();
    UI.GlassPane.setContainer(this.element);
    this._tabbedPane = new UI.TabbedPane();
    this._tabbedPane.show(this.element);
    this.appendExampleTabs();
  }

  appendExampleTabs = () => {
    this._tabbedPane.appendTab(
      'hello',
      'hello',
      this.createHelloView(),
      'hello',
      true,
      false,
      0
    );
    this._tabbedPane.appendTab(
      'world',
      'world',
      this.createWordView(),
      'world',
      true,
      true,
      1
    );
    this._tabbedPane.selectTab('hello');
  }

  createHelloView = () => {
    const hv = new UI.VBox();
    const hvToolbarContainer = hv.element.createChild('div', 'hello-toolbar-container');
    hv.injectStyleText(`
        .hello-toolbar-container {
            display: flex;
            flex: none;
        }
        .hello-toolbar-container > .toolbar {
            background-color: var(--toolbar-bg-color);
            border-bottom: var(--divider-border);
        }
        .hello-main-toolbar {
            flex: 1 1 auto;
        }
    `);

    const mainView = new UI.EmptyWidget(':)');
    mainView.appendLink('https://google.com', 'google.com')

    const sideNav = new SideNav();
    const splitWidget = new UI.SplitWidget(
      true /* isVertical */,
      false /* secondIsSidebar */,
      'console.sidebar.width',
      200
    );
    splitWidget.setMainWidget(mainView);
    splitWidget.setSidebarWidget(sideNav);
    splitWidget.show(hv.element);

    const toolbar = new UI.Toolbar('hello-main-toolbar', hvToolbarContainer);
    const rightToolbar = new UI.Toolbar('', hvToolbarContainer);

    toolbar.appendToolbarItem(splitWidget.createShowHideSidebarButton('hello sidebar'));
    toolbar.appendSeparator();
    rightToolbar.appendSeparator();
    rightToolbar.appendToolbarItem(new UI.ToolbarMenuButton((contextMenu) => {
      contextMenu.defaultSection().appendItem('hello')
      contextMenu.defaultSection().appendItem('test')
    }));
    return hv;
  }

  createWordView = () => {
    const hv = new UI.EmptyWidget('WORLD');
    hv.appendLink('https://ones.ai', 'ones.ai')
    return hv;
  }
}

const presentHelloWorldUI = (document) => {
  const rootView = new UI.RootView();
  const hw = new HelloWorldView();

  hw.show(rootView.element);

  rootView.attachToDocument(document);
  rootView.focus();

  return rootView;
}

export {
  presentHelloWorldUI
}
