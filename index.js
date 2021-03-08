import { DevToolsFrontEnd } from './src/devtools-frontend/entry';


self.runtime = new Root.Runtime([]);

const createSettings = (prefs) => {
  const storagePrefix = 'custom';
  const localStorage = new Common.SettingsStorage({}, undefined, undefined, undefined, storagePrefix);
  const globalStorage = new Common.SettingsStorage(
    prefs,
    Host.InspectorFrontendHost.setPreference,
    Host.InspectorFrontendHost.removePreference,
    Host.InspectorFrontendHost.clearPreferences,
    storagePrefix
  );
  Common.settings = new Common.Settings(globalStorage, localStorage);
}

Host.InspectorFrontendHost.getPreferences(createSettings);

const createExampleUI = () => {
  UI.viewManager = new UI.ViewManager();
  UI.initializeUIUtils(document);
  UI.installComponentRootStyles(/** @type {!Element} */ (document.body));
  UI.zoomManager = new UI.ZoomManager(window, Host.InspectorFrontendHost);
  UI.inspectorView = UI.InspectorView.instance();
}
createExampleUI();

const presentUI = (document) => {
  const rootView = new UI.RootView();

  UI.inspectorView.show(rootView.element);
  rootView.attachToDocument(document);
  rootView.focus();
  UI.inspectorView.createToolbars(['hello', 'world'])
  return rootView;
}
console.log(presentUI(document));
console.log(DevToolsFrontEnd);