/*
 * Capa de persistencia de configuración.
 * Siempre devuelve settings completos con defaults aplicados.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { SETTINGS_STORAGE_KEY } = root.constants;
  const { storageGet, storageSet } = root.chromeHelpers;

  async function getSettings() {
    const stored = await storageGet([SETTINGS_STORAGE_KEY]);
    return root.defaults.mergeSettings(stored[SETTINGS_STORAGE_KEY]);
  }

  async function saveSettings(partialSettings) {
    const current = await getSettings();
    const merged = root.defaults.mergeSettings({ ...current, ...partialSettings });

    await storageSet({
      [SETTINGS_STORAGE_KEY]: merged
    });

    return merged;
  }

  async function resetSettings() {
    const defaults = root.defaults.mergeSettings({});
    await storageSet({
      [SETTINGS_STORAGE_KEY]: defaults
    });
    return defaults;
  }

  root.storage = {
    getSettings,
    saveSettings,
    resetSettings
  };
})();
