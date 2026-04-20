/*
 * Shared theme helpers for popup, options and inline UI.
 * Keeps the extension on a coherent auto/light/dark model.
 */
(() => {
  const root = globalThis.ChatExportAi;

  function resolveThemeMode(themeSetting) {
    if (themeSetting === "light" || themeSetting === "dark") {
      return themeSetting;
    }

    if (globalThis.matchMedia && globalThis.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }

    return "light";
  }

  function syncActionIconTheme(themeSetting) {
    const resolvedTheme = resolveThemeMode(themeSetting);

    try {
      if (globalThis.chrome?.runtime?.sendMessage && root.constants?.MSG_SET_ACTION_ICON_THEME) {
        chrome.runtime.sendMessage(
          {
            type: root.constants.MSG_SET_ACTION_ICON_THEME,
            payload: { theme: resolvedTheme }
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
      }
    } catch (_error) {
      // The toolbar icon is best-effort only. Export logic must never depend on it.
    }

    return resolvedTheme;
  }

  function applyThemeDocument(themeSetting, doc = document) {
    const nextTheme = themeSetting || "auto";
    const resolvedTheme = resolveThemeMode(nextTheme);

    doc.documentElement.dataset.theme = nextTheme;
    doc.documentElement.dataset.resolvedTheme = resolvedTheme;
    syncActionIconTheme(nextTheme);

    return resolvedTheme;
  }

  root.appTheme = {
    resolveThemeMode,
    applyThemeDocument,
    syncActionIconTheme
  };
})();
