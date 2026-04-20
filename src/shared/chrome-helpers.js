/*
 * Promise wrappers around callback-based Chrome APIs.
 * They degrade gracefully when a shared script runs without extension APIs.
 */
(() => {
  const root = globalThis.ChatExportAi;

  function getChromeRoot() {
    try {
      if (!("chrome" in globalThis)) {
        return null;
      }

      const chromeRoot = globalThis.chrome;
      return chromeRoot && typeof chromeRoot === "object" ? chromeRoot : null;
    } catch (_error) {
      return null;
    }
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
        if (!chromeRoot?.runtime?.sendMessage) {
          reject(new Error("Chrome runtime messaging is unavailable in this context."));
          return;
        }

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
        if (!chromeRoot?.tabs?.query) {
          reject(new Error("Chrome tabs query is unavailable in this context."));
          return;
        }

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
        if (!chromeRoot?.tabs?.sendMessage) {
          reject(new Error("Chrome tabs messaging is unavailable in this context."));
          return;
        }

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
