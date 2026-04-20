/*
 * Wrappers de Promesa sobre APIs callback de Chrome.
 * Evita repetir boilerplate de runtime.lastError en toda la extensión.
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
        ensureChromeApi(["storage", "local", "get"]);
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
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
        ensureChromeApi(["storage", "local", "set"]);
        chrome.storage.local.set(value, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
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
        ensureChromeApi(["runtime", "sendMessage"]);
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
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
        ensureChromeApi(["tabs", "query"]);
        chrome.tabs.query(queryInfo, (tabs) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
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
        ensureChromeApi(["tabs", "sendMessage"]);
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
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
