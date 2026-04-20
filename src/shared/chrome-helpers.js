/*
 * Legacy compatibility shim.
 * New builds load extension-bridge.js instead of this file.
 */
(() => {
  const root = globalThis.ChatExportAi;

  root.chromeHelpers = root.chromeHelpers || {
    storageGet: async () => ({}),
    storageSet: async () => false,
    runtimeSendMessage: async () => {
      throw new Error("Chrome runtime messaging is unavailable in this context.");
    },
    tabsQuery: async () => {
      throw new Error("Chrome tabs query is unavailable in this context.");
    },
    tabsSendMessage: async () => {
      throw new Error("Chrome tabs messaging is unavailable in this context.");
    }
  };
})();
