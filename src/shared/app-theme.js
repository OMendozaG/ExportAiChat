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

  function applyThemeDocument(themeSetting, doc = document) {
    const nextTheme = themeSetting || "auto";
    const resolvedTheme = resolveThemeMode(nextTheme);

    doc.documentElement.dataset.theme = nextTheme;
    doc.documentElement.dataset.resolvedTheme = resolvedTheme;

    return resolvedTheme;
  }

  root.appTheme = {
    resolveThemeMode,
    applyThemeDocument
  };
})();
