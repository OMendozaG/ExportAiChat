/*
 * Persistent storage helpers for settings and filename counters.
 * All functions stay defensive and return normalized data.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const {
    SETTINGS_STORAGE_KEY,
    SETTINGS_MANUAL_KEYS_STORAGE_KEY,
    COUNTERS_STORAGE_KEY
  } = root.constants;
  const { storageGet, storageSet } = root.chromeHelpers;

  function toNonNegativeInteger(value, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return Math.max(0, Math.round(fallback));
    }

    return Math.max(0, Math.round(numericValue));
  }

  function toPositiveInteger(value, fallback = 1) {
    return Math.max(1, toNonNegativeInteger(value, fallback));
  }

  function localDayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function normalizeDayKey(value, fallbackDate = new Date()) {
    const candidate = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : localDayKey(fallbackDate);
  }

  function normalizeText(value) {
    const raw = String(value ?? "");
    const normalized = raw.normalize ? raw.normalize("NFC") : raw;
    return normalized.replace(/\s+/g, " ").trim();
  }

  function normalizeChatKeyPart(value, fallback = "unknown") {
    const normalized = normalizeText(value);
    const safe = normalized.toLowerCase();
    return safe || fallback;
  }

  function normalizeCounterMapKey(value) {
    return normalizeText(value).toLowerCase();
  }

  function extractLegacyChatNameFromKey(rawKey) {
    const normalizedRawKey = normalizeText(rawKey);
    if (!normalizedRawKey) {
      return "";
    }

    // Legacy keys used `provider::folder::chat`. Keep only the chat part now.
    const legacyParts = normalizedRawKey.split("::").map((part) => normalizeText(part)).filter(Boolean);
    if (!legacyParts.length) {
      return normalizedRawKey;
    }

    return legacyParts[legacyParts.length - 1];
  }

  function buildChatNameCounterKeyFromValues(chatNameValue, fallback = "chat") {
    const chatPart = normalizeChatKeyPart(chatNameValue, fallback);
    return chatPart;
  }

  function deriveCounterMapKey(rawKey, rawEntry) {
    const fromEntry = normalizeText(rawEntry?.chatName);
    if (fromEntry) {
      return buildChatNameCounterKeyFromValues(fromEntry);
    }

    return buildChatNameCounterKeyFromValues(extractLegacyChatNameFromKey(rawKey));
  }

  function buildChatNameCounterKey(conversation) {
    return buildChatNameCounterKeyFromValues(
      conversation?.chatName || conversation?.title,
      "chat"
    );
  }

  function defaultCounterState() {
    return {
      totalCount: 0,
      dayKey: localDayKey(new Date()),
      dayCount: 0,
      nextChatNameCount: 1,
      chatNameMap: {}
    };
  }

  function normalizeCounterEntry(rawEntry, fallbackConversation = null) {
    if (!rawEntry || typeof rawEntry !== "object") {
      return null;
    }

    const fallbackProvider = fallbackConversation?.providerName || fallbackConversation?.providerId || "Unknown";
    const fallbackFolder = fallbackConversation?.folderName || "";
    const fallbackChatName = fallbackConversation?.chatName || fallbackConversation?.title || "chat";
    const fallbackNowIso = new Date().toISOString();
    const count = toPositiveInteger(rawEntry.count, 1);
    const chatName = normalizeText(rawEntry.chatName || fallbackChatName) || "chat";
    const folderName = normalizeText(rawEntry.folderName || fallbackFolder);
    const providerName = normalizeText(rawEntry.providerName || fallbackProvider) || "Unknown";
    const createdAtIso = String(rawEntry.createdAtIso || fallbackNowIso);
    const lastUsedAtIso = String(rawEntry.lastUsedAtIso || createdAtIso);

    return {
      count,
      chatName,
      folderName,
      providerName,
      createdAtIso,
      lastUsedAtIso
    };
  }

  function normalizeCounterState(incoming) {
    const defaults = defaultCounterState();
    if (!incoming || typeof incoming !== "object") {
      return defaults;
    }

    const next = {
      totalCount: toNonNegativeInteger(incoming.totalCount, defaults.totalCount),
      dayKey: normalizeDayKey(incoming.dayKey, new Date()),
      dayCount: toNonNegativeInteger(incoming.dayCount, defaults.dayCount),
      nextChatNameCount: toPositiveInteger(incoming.nextChatNameCount, defaults.nextChatNameCount),
      chatNameMap: {}
    };

    const sourceMap = incoming.chatNameMap && typeof incoming.chatNameMap === "object"
      ? incoming.chatNameMap
      : {};

    let maxAssignedCount = 0;
    Object.entries(sourceMap).forEach(([rawKey, rawEntry]) => {
      const key = deriveCounterMapKey(rawKey, rawEntry);
      if (!key) {
        return;
      }

      const normalizedEntry = normalizeCounterEntry(rawEntry, {
        chatName: extractLegacyChatNameFromKey(rawKey)
      });
      if (!normalizedEntry) {
        return;
      }

      const existingEntry = normalizeCounterEntry(next.chatNameMap[key]);
      if (existingEntry) {
        // During migration from legacy keys, keep the smallest id for the same chat name.
        if (normalizedEntry.count < existingEntry.count) {
          next.chatNameMap[key] = normalizedEntry;
        }
      } else {
        next.chatNameMap[key] = normalizedEntry;
      }

      const savedEntry = next.chatNameMap[key];
      maxAssignedCount = Math.max(maxAssignedCount, toPositiveInteger(savedEntry?.count, 1));
    });

    next.nextChatNameCount = Math.max(next.nextChatNameCount, maxAssignedCount + 1);
    return next;
  }

  function ensureDayCounter(state, date = new Date()) {
    const expectedDayKey = localDayKey(date);
    if (state.dayKey === expectedDayKey) {
      return false;
    }

    state.dayKey = expectedDayKey;
    state.dayCount = 0;
    return true;
  }

  function upsertChatNameCounterEntry(state, conversation, date = new Date()) {
    const key = buildChatNameCounterKey(conversation);
    const nowIso = date.toISOString();
    const existing = state.chatNameMap[key];

    if (existing) {
      const normalizedExisting = normalizeCounterEntry(existing, conversation);
      normalizedExisting.lastUsedAtIso = nowIso;
      normalizedExisting.chatName = normalizeText(conversation?.chatName || conversation?.title || normalizedExisting.chatName);
      normalizedExisting.folderName = normalizeText(conversation?.folderName || normalizedExisting.folderName);
      normalizedExisting.providerName = normalizeText(
        conversation?.providerName || conversation?.providerId || normalizedExisting.providerName
      );
      state.chatNameMap[key] = normalizedExisting;
      return { key, entry: normalizedExisting };
    }

    const nextCount = toPositiveInteger(state.nextChatNameCount, 1);
    const newEntry = normalizeCounterEntry({
      count: nextCount,
      chatName: conversation?.chatName || conversation?.title || "chat",
      folderName: conversation?.folderName || "",
      providerName: conversation?.providerName || conversation?.providerId || "Unknown",
      createdAtIso: nowIso,
      lastUsedAtIso: nowIso
    }, conversation);
    state.chatNameMap[key] = newEntry;
    state.nextChatNameCount = nextCount + 1;
    return { key, entry: newEntry };
  }

  function counterValuesFromState(state, chatNameCount) {
    return {
      totalCount: toNonNegativeInteger(state.totalCount, 0),
      dayCount: toNonNegativeInteger(state.dayCount, 0),
      chatNameCount: toPositiveInteger(chatNameCount, 1),
      dayKey: normalizeDayKey(state.dayKey, new Date())
    };
  }

  function summaryFromCounterState(state) {
    const entries = Object.entries(state.chatNameMap)
      .map(([key, entry]) => {
        const normalizedEntry = normalizeCounterEntry(entry);
        if (!normalizedEntry) {
          return null;
        }

        return {
          key,
          count: normalizedEntry.count,
          providerName: normalizedEntry.providerName,
          folderName: normalizedEntry.folderName,
          chatName: normalizedEntry.chatName,
          chatPath: normalizedEntry.chatName,
          createdAtIso: normalizedEntry.createdAtIso,
          lastUsedAtIso: normalizedEntry.lastUsedAtIso
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.count - right.count);

    return {
      totalCount: toNonNegativeInteger(state.totalCount, 0),
      dayCount: toNonNegativeInteger(state.dayCount, 0),
      dayKey: normalizeDayKey(state.dayKey, new Date()),
      nextChatNameCount: toPositiveInteger(state.nextChatNameCount, 1),
      entries
    };
  }

  function settingKeys() {
    return Object.keys(root.defaults.settings || {});
  }

  function isSettingKey(key) {
    return settingKeys().includes(key);
  }

  function normalizeManualSettingKeys(rawValue) {
    if (!Array.isArray(rawValue)) {
      return [];
    }

    const seen = new Set();
    const normalized = [];
    rawValue.forEach((item) => {
      const key = String(item || "").trim();
      if (!key || !isSettingKey(key) || seen.has(key)) {
        return;
      }

      seen.add(key);
      normalized.push(key);
    });

    return normalized;
  }

  function normalizeSettingsValueMap(rawValue) {
    if (!rawValue || typeof rawValue !== "object") {
      return {};
    }

    const next = {};
    settingKeys().forEach((key) => {
      if (rawValue[key] !== undefined) {
        next[key] = rawValue[key];
      }
    });
    return next;
  }

  function isDenseLegacySettingsSnapshot(rawValue) {
    if (!rawValue || typeof rawValue !== "object") {
      return false;
    }

    const knownKeys = settingKeys().filter((key) => Object.prototype.hasOwnProperty.call(rawValue, key));
    const keyCount = knownKeys.length;
    const minimumDenseCount = Math.max(10, Math.floor(settingKeys().length * 0.6));
    return keyCount >= minimumDenseCount;
  }

  function deriveManualSettingsFromLegacy(rawValue) {
    const normalizedRaw = normalizeSettingsValueMap(rawValue);
    const mergedRaw = root.defaults.mergeSettings(normalizedRaw);
    const defaults = root.defaults.settings || {};
    const denseSnapshot = isDenseLegacySettingsSnapshot(rawValue);
    const manualKeys = denseSnapshot
      ? settingKeys().filter((key) => !Object.is(mergedRaw[key], defaults[key]))
      : settingKeys().filter((key) => Object.prototype.hasOwnProperty.call(normalizedRaw, key));
    const manualValues = {};

    manualKeys.forEach((key) => {
      manualValues[key] = mergedRaw[key];
    });

    return {
      manualKeys,
      manualValues
    };
  }

  function resolveSettingsFromManualValues(manualValues) {
    return root.defaults.mergeSettings(normalizeSettingsValueMap(manualValues));
  }

  async function saveSettingsState(manualValues, manualKeys) {
    const normalizedManualValues = normalizeSettingsValueMap(manualValues);
    const normalizedManualKeys = normalizeManualSettingKeys(manualKeys);
    const payload = {};

    payload[SETTINGS_STORAGE_KEY] = normalizedManualValues;
    payload[SETTINGS_MANUAL_KEYS_STORAGE_KEY] = normalizedManualKeys;

    try {
      await storageSet(payload);
    } catch (_error) {
      return {
        manualValues: normalizedManualValues,
        manualKeys: normalizedManualKeys
      };
    }

    return {
      manualValues: normalizedManualValues,
      manualKeys: normalizedManualKeys
    };
  }

  async function loadSettingsState() {
    try {
      const stored = await storageGet([SETTINGS_STORAGE_KEY, SETTINGS_MANUAL_KEYS_STORAGE_KEY]);
      const rawSettingsValue = stored[SETTINGS_STORAGE_KEY];
      const rawManualKeys = stored[SETTINGS_MANUAL_KEYS_STORAGE_KEY];
      const manualKeys = normalizeManualSettingKeys(rawManualKeys);
      const hasManualKeyList = Array.isArray(rawManualKeys);

      if (hasManualKeyList) {
        const normalizedValues = normalizeSettingsValueMap(rawSettingsValue);
        const manualValues = {};
        manualKeys.forEach((key) => {
          if (normalizedValues[key] !== undefined) {
            manualValues[key] = normalizedValues[key];
          }
        });
        return {
          manualValues,
          manualKeys
        };
      }

      // Legacy migration: previous versions stored a full merged snapshot.
      const derived = deriveManualSettingsFromLegacy(rawSettingsValue);
      await saveSettingsState(derived.manualValues, derived.manualKeys);
      return {
        manualValues: derived.manualValues,
        manualKeys: derived.manualKeys
      };
    } catch (_error) {
      return {
        manualValues: {},
        manualKeys: []
      };
    }
  }

  async function getSettings() {
    const state = await loadSettingsState();
    return resolveSettingsFromManualValues(state.manualValues);
  }

  async function saveSettings(partialSettings) {
    const state = await loadSettingsState();
    const current = resolveSettingsFromManualValues(state.manualValues);
    const merged = root.defaults.mergeSettings({ ...current, ...partialSettings });
    const manualKeySet = new Set(state.manualKeys);

    // Promote only values changed in this save call to manual/fixed overrides.
    settingKeys().forEach((key) => {
      if (!Object.is(current[key], merged[key])) {
        manualKeySet.add(key);
      }
    });

    const nextManualKeys = Array.from(manualKeySet);
    const nextManualValues = {};
    nextManualKeys.forEach((key) => {
      nextManualValues[key] = merged[key];
    });

    await saveSettingsState(nextManualValues, nextManualKeys);
    return merged;
  }

  async function resetSettings() {
    const defaults = root.defaults.mergeSettings({});
    await saveSettingsState({}, []);
    return defaults;
  }

  async function getCounterState() {
    try {
      const stored = await storageGet([COUNTERS_STORAGE_KEY]);
      return normalizeCounterState(stored[COUNTERS_STORAGE_KEY]);
    } catch (_error) {
      return normalizeCounterState({});
    }
  }

  async function saveCounterState(nextState) {
    const normalized = normalizeCounterState(nextState);

    try {
      await storageSet({
        [COUNTERS_STORAGE_KEY]: normalized
      });
    } catch (_error) {
      return normalized;
    }

    return normalized;
  }

  async function previewExportCounters(conversation) {
    const state = await getCounterState();
    const exportDate = new Date(conversation?.extractedAtIso || Date.now());
    const todayKey = localDayKey(exportDate);
    const isSameDay = state.dayKey === todayKey;
    const key = buildChatNameCounterKey(conversation);
    const existingEntry = state.chatNameMap[key];
    const chatNameCount = existingEntry?.count || state.nextChatNameCount;

    return {
      totalCount: state.totalCount + 1,
      dayCount: (isSameDay ? state.dayCount : 0) + 1,
      chatNameCount: toPositiveInteger(chatNameCount, 1),
      dayKey: todayKey
    };
  }

  async function reserveExportCounters(conversation) {
    const state = await getCounterState();
    const exportDate = new Date(conversation?.extractedAtIso || Date.now());
    ensureDayCounter(state, exportDate);
    state.totalCount = toNonNegativeInteger(state.totalCount, 0) + 1;
    state.dayCount = toNonNegativeInteger(state.dayCount, 0) + 1;

    const { entry } = upsertChatNameCounterEntry(state, conversation, exportDate);
    const savedState = await saveCounterState(state);
    const savedEntry = savedState.chatNameMap[buildChatNameCounterKey(conversation)] || entry;
    return counterValuesFromState(savedState, savedEntry?.count || 1);
  }

  async function getCounterSummary() {
    const state = await getCounterState();
    const didResetDay = ensureDayCounter(state, new Date());
    const normalized = didResetDay ? await saveCounterState(state) : state;
    return summaryFromCounterState(normalized);
  }

  async function updateCounterValues(patch) {
    const state = await getCounterState();

    if (patch && typeof patch === "object") {
      if (patch.dayKey !== undefined) {
        state.dayKey = normalizeDayKey(patch.dayKey, new Date());
      }

      if (patch.totalCount !== undefined) {
        state.totalCount = toNonNegativeInteger(patch.totalCount, state.totalCount);
      }

      if (patch.dayCount !== undefined) {
        state.dayCount = toNonNegativeInteger(patch.dayCount, state.dayCount);
      }

      if (patch.nextChatNameCount !== undefined) {
        state.nextChatNameCount = toPositiveInteger(patch.nextChatNameCount, state.nextChatNameCount);
      }
    }

    const savedState = await saveCounterState(state);
    return summaryFromCounterState(savedState);
  }

  async function updateChatNameCountMapping(mappingKey, nextCount) {
    const state = await getCounterState();
    const safeKey = normalizeCounterMapKey(mappingKey);

    if (!safeKey || !state.chatNameMap[safeKey]) {
      throw new Error("ChatNameCount association not found.");
    }

    const safeCount = toPositiveInteger(nextCount, state.chatNameMap[safeKey].count);
    const conflictingKey = Object.entries(state.chatNameMap).find(([key, entry]) => {
      if (key === safeKey) {
        return false;
      }

      return toPositiveInteger(entry?.count, 1) === safeCount;
    })?.[0];

    if (conflictingKey) {
      throw new Error(`ChatNameCount id ${safeCount} is already assigned.`);
    }

    const normalizedEntry = normalizeCounterEntry(state.chatNameMap[safeKey]);
    if (!normalizedEntry) {
      throw new Error("ChatNameCount association is invalid.");
    }

    normalizedEntry.count = safeCount;
    normalizedEntry.lastUsedAtIso = new Date().toISOString();
    state.chatNameMap[safeKey] = normalizedEntry;

    const savedState = await saveCounterState(state);
    return summaryFromCounterState(savedState);
  }

  async function deleteChatNameCountMapping(mappingKey) {
    const state = await getCounterState();
    const safeKey = normalizeCounterMapKey(mappingKey);

    if (!safeKey || !state.chatNameMap[safeKey]) {
      throw new Error("ChatNameCount association not found.");
    }

    delete state.chatNameMap[safeKey];
    const savedState = await saveCounterState(state);
    return summaryFromCounterState(savedState);
  }

  async function clearChatNameCountMappings() {
    const state = await getCounterState();
    state.chatNameMap = {};
    state.nextChatNameCount = 1;
    const savedState = await saveCounterState(state);
    return summaryFromCounterState(savedState);
  }

  async function resetCounterValues(scope = "all") {
    const state = await getCounterState();
    const normalizedScope = String(scope || "all").trim().toLowerCase();

    if (normalizedScope === "day") {
      state.dayKey = localDayKey(new Date());
      state.dayCount = 0;
      const savedDayState = await saveCounterState(state);
      return summaryFromCounterState(savedDayState);
    }

    if (normalizedScope === "mapping") {
      state.chatNameMap = {};
      state.nextChatNameCount = 1;
      const savedMappingState = await saveCounterState(state);
      return summaryFromCounterState(savedMappingState);
    }

    if (normalizedScope === "total") {
      state.totalCount = 0;
      const savedTotalState = await saveCounterState(state);
      return summaryFromCounterState(savedTotalState);
    }

    const resetState = await saveCounterState(defaultCounterState());
    return summaryFromCounterState(resetState);
  }

  root.storage = {
    getSettings,
    saveSettings,
    resetSettings,
    previewExportCounters,
    reserveExportCounters,
    getCounterSummary,
    updateCounterValues,
    resetCounterValues,
    updateChatNameCountMapping,
    deleteChatNameCountMapping,
    clearChatNameCountMappings
  };
})();
