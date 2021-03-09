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
    const hv = new UI.EmptyWidget('HELLO');
    hv.appendLink('https://google.com', 'google.com')
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
