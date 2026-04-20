/*
 * Promise wrappers around callback-based Chrome APIs.
 * Missing APIs are handled defensively so pages without extension APIs
 * do not crash shared logic that only needs default settings.
 */
(() => {
  const root = globalThis.ChatExportAi;

  function getChromeRoot() {
    return globalThis.chrome && typeof globalThis.chrome === "object"
      ? globalThis.chrome
      : null;
  }

  function getChromeApi(path) {
    const chromeRoot = getChromeRoot();
    return path.reduce((acc, key) => (acc ? acc[key] : undefined), chromeRoot);
  }

  function ensureChromeApi(path) {
    const target = getChromeApi(path);
    if (!target) {
      throw new Error(`Chrome API unavailable in this context: ${path.join(".")}`);
    }
    return target;
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        const chromeRoot = getChromeRoot();
        if (!chromeRoot?.storage?.local?.get) {
          resolve({});
          return;
        }

        chromeRoot.storage.local.get(keys, (result) => {
          if (chromeRoot.runtime?.lastError) {
            reject(new Error(chromeRoot.runtime.lastError.message));
            return;
          }
          resolve(result || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      try {
        const chromeRoot = getChromeRoot();
        if (!chromeRoot?.storage?.local?.set) {
          resolve(false);
          return;
        }

        chromeRoot.storage.local.set(value, () => {
          if (chromeRoot.runtime?.lastError) {
            reject(new Error(chromeRoot.runtime.lastError.message));
            return;
          }
          resolve(true);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function runtimeSendMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        const chromeRoot = getChromeRoot();
        ensureChromeApi(["runtime", "sendMessage"]);
        chromeRoot.runtime.sendMessage(message, (response) => {
          if (chromeRoot.runtime?.lastError) {
            reject(new Error(chromeRoot.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function tabsQuery(queryInfo) {
    return new Promise((resolve, reject) => {
      try {
        const chromeRoot = getChromeRoot();
        ensureChromeApi(["tabs", "query"]);
        chromeRoot.tabs.query(queryInfo, (tabs) => {
          if (chromeRoot.runtime?.lastError) {
            reject(new Error(chromeRoot.runtime.lastError.message));
            return;
          }
          resolve(tabs || []);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function tabsSendMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      try {
        const chromeRoot = getChromeRoot();
        ensureChromeApi(["tabs", "sendMessage"]);
        chromeRoot.tabs.sendMessage(tabId, message, (response) => {
          if (chromeRoot.runtime?.lastError) {
            reject(new Error(chromeRoot.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  root.chromeHelpers = {
    storageGet,
    storageSet,
    runtimeSendMessage,
    tabsQuery,
    tabsSendMessage
  };
})();
