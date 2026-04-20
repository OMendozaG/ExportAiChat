/*
 * Promise wrappers around Chrome extension APIs.
 * This bridge is loaded by current extension contexts and stays defensive
 * when a shared script is evaluated somewhere without extension privileges.
 */
(() => {
  const root = globalThis.ChatExportAi;

  function getChromeRoot() {
    const chromeRoot = globalThis?.chrome;
    return chromeRoot && typeof chromeRoot === "object" ? chromeRoot : null;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      const chromeRoot = getChromeRoot();
      if (!chromeRoot?.storage?.local?.get) {
        resolve({});
        return;
      }

      try {
        chromeRoot.storage.local.get(keys, (result) => {
          if (chromeRoot.runtime?.lastError) {
            resolve({});
            return;
          }

          resolve(result || {});
        });
      } catch (_error) {
        resolve({});
      }
    });
  }

  function storageSet(value) {
    return new Promise((resolve) => {
      const chromeRoot = getChromeRoot();
      if (!chromeRoot?.storage?.local?.set) {
        resolve(false);
        return;
      }

      try {
        chromeRoot.storage.local.set(value, () => {
          if (chromeRoot.runtime?.lastError) {
            resolve(false);
            return;
          }

          resolve(true);
        });
      } catch (_error) {
        resolve(false);
      }
    });
  }

  function runtimeSendMessage(message) {
    return new Promise((resolve, reject) => {
      const chromeRoot = getChromeRoot();
      if (!chromeRoot?.runtime?.sendMessage) {
        reject(new Error("Chrome runtime messaging is unavailable in this context."));
        return;
      }

      try {
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
      const chromeRoot = getChromeRoot();
      if (!chromeRoot?.tabs?.query) {
        reject(new Error("Chrome tabs query is unavailable in this context."));
        return;
      }

      try {
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
      const chromeRoot = getChromeRoot();
      if (!chromeRoot?.tabs?.sendMessage) {
        reject(new Error("Chrome tabs messaging is unavailable in this context."));
        return;
      }

      try {
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
