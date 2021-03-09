class HelloWorldView extends UI.VBox {
  constructor() {
    super();
    UI.GlassPane.setContainer(this.element);
    this._tabbedPane = new UI.TabbedPane();
    this._tabbedPane.appendTab(
      'hello',
      'hello',
      new UI.Widget(),
      'hello',
      true,
      false,
      0
    );
    this._tabbedPane.appendTab(
      'world',
      'world',
      new UI.Widget(),
      'world',
      true,
      false,
      1
    );
    this._tabbedPane.show(this.element);
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
