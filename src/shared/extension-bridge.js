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
    return new Promise((resolve) => {
      const chromeRoot = getChromeRoot();
      if (!chromeRoot?.runtime?.sendMessage) {
        resolve(null);
        return;
      }

      try {
        chromeRoot.runtime.sendMessage(message, (response) => {
          if (chromeRoot.runtime?.lastError) {
            resolve(null);
            return;
          }

          resolve(response ?? null);
        });
      } catch (_error) {
        resolve(null);
      }
    });
  }

  function tabsQuery(queryInfo) {
    return new Promise((resolve) => {
      const chromeRoot = getChromeRoot();
      if (!chromeRoot?.tabs?.query) {
        resolve([]);
        return;
      }

      try {
        chromeRoot.tabs.query(queryInfo, (tabs) => {
          if (chromeRoot.runtime?.lastError) {
            resolve([]);
            return;
          }

          resolve(Array.isArray(tabs) ? tabs : []);
        });
      } catch (_error) {
        resolve([]);
      }
    });
  }

  function tabsSendMessage(tabId, message) {
    return new Promise((resolve) => {
      const chromeRoot = getChromeRoot();
      if (!chromeRoot?.tabs?.sendMessage) {
        resolve(null);
        return;
      }

      try {
        chromeRoot.tabs.sendMessage(tabId, message, (response) => {
          if (chromeRoot.runtime?.lastError) {
            resolve(null);
            return;
          }

          resolve(response ?? null);
        });
      } catch (_error) {
        resolve(null);
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
