import { DevToolsFrontEnd } from './src/devtools-frontend/entry';
import { presentHelloWorldUI } from "./examples/hello-world";

// init
{
  self.runtime = new Root.Runtime([]);
  const createSettings = (prefs) => {
    const storagePrefix = 'custom';

    const localStorage = new Common.SettingsStorage(
      {},
      undefined,
      undefined,
      undefined,
      storagePrefix
    );

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

  UI.initializeUIUtils(document);
  UI.installComponentRootStyles(/** @type {!Element} */ (document.body));

  UI.viewManager = new UI.ViewManager();
  UI.zoomManager = new UI.ZoomManager(window, Host.InspectorFrontendHost);

  console.log(DevToolsFrontEnd);
}

// example
presentHelloWorldUI(document);
