/*
 * Persistent settings storage.
 * It always returns a full settings object with defaults applied.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { SETTINGS_STORAGE_KEY } = root.constants;
  const { storageGet, storageSet } = root.chromeHelpers;

  async function getSettings() {
    try {
      const stored = await storageGet([SETTINGS_STORAGE_KEY]);
      return root.defaults.mergeSettings(stored[SETTINGS_STORAGE_KEY]);
    } catch (_error) {
      return root.defaults.mergeSettings({});
    }
  }

  async function saveSettings(partialSettings) {
    const current = await getSettings();
    const merged = root.defaults.mergeSettings({ ...current, ...partialSettings });

    try {
      await storageSet({
        [SETTINGS_STORAGE_KEY]: merged
      });
    } catch (_error) {
      return merged;
    }

    return merged;
  }

  async function resetSettings() {
    const defaults = root.defaults.mergeSettings({});

    try {
      await storageSet({
        [SETTINGS_STORAGE_KEY]: defaults
      });
    } catch (_error) {
      return defaults;
    }

    return defaults;
  }

  root.storage = {
    getSettings,
    saveSettings,
    resetSettings
  };
})();
