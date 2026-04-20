/*
 * Options page controller.
 * Handles loading, editing and saving persistent settings.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { AI_NAME_MODE } = root.constants;
  const { MAX_EXPORT_TIMEOUT_SECONDS } = root.constants;

  const form = document.getElementById("settingsForm");
  const statusNode = document.getElementById("status");
  const resetButton = document.getElementById("resetButton");

  const humanNameInput = document.getElementById("humanName");
  const aiCustomNameInput = document.getElementById("aiCustomName");
  const textFormattingSelect = document.getElementById("textFormatting");
  const quoteDividerStyleSelect = document.getElementById("quoteDividerStyle");
  const multilineFormatSelect = document.getElementById("multilineFormat");
  const htmlPdfAiBorderColorInput = document.getElementById("htmlPdfAiBorderColor");
  const htmlPdfHumanBorderColorInput = document.getElementById("htmlPdfHumanBorderColor");
  const messageSeparatorTextarea = document.getElementById("messageSeparator");
  const txtHumanMessageHeaderTemplateTextarea = document.getElementById("txtHumanMessageHeaderTemplate");
  const txtAiMessageHeaderTemplateTextarea = document.getElementById("txtAiMessageHeaderTemplate");
  const appThemeSelect = document.getElementById("appTheme");
  const autoFileNameCheckbox = document.getElementById("autoFileName");
  const fileNameTemplateInput = document.getElementById("fileNameTemplate");
  const invalidFileNameReplacementInput = document.getElementById("invalidFileNameReplacement");
  const customDownloadFolderInput = document.getElementById("customDownloadFolder");
  const autosaveConflictActionSelect = document.getElementById("autosaveConflictAction");
  const mediaHandlingSelect = document.getElementById("mediaHandling");
  const companionMhtOnMediaCheckbox = document.getElementById("companionMhtOnMedia");
  const includeExportTitleCheckbox = document.getElementById("includeExportTitle");
  const metadataEnabledCheckbox = document.getElementById("metadataEnabled");
  const metadataExportedAtCheckbox = document.getElementById("metadataExportedAt");
  const metadataDeviceUserCheckbox = document.getElementById("metadataDeviceUser");
  const metadataFolderCheckbox = document.getElementById("metadataFolder");
  const metadataTitleCheckbox = document.getElementById("metadataTitle");
  const metadataModelCheckbox = document.getElementById("metadataModel");
  const metadataUrlCheckbox = document.getElementById("metadataUrl");
  const metadataSummaryProviderCheckbox = document.getElementById("metadataSummaryProvider");
  const metadataSummaryChatNameCheckbox = document.getElementById("metadataSummaryChatName");
  const metadataSummaryMessagesCheckbox = document.getElementById("metadataSummaryMessages");
  const metadataStartTimeCheckbox = document.getElementById("metadataStartTime");
  const metadataEndTimeCheckbox = document.getElementById("metadataEndTime");
  const metadataDurationCheckbox = document.getElementById("metadataDuration");
  const includeThinkingCheckbox = document.getElementById("includeThinking");
  const includeThinkingDurationCheckbox = document.getElementById("includeThinkingDuration");
  const includeMessageTimeCheckbox = document.getElementById("includeMessageTime");
  const includeMessageIdCheckbox = document.getElementById("includeMessageId");
  const showUserAttachmentNamesCheckbox = document.getElementById("showUserAttachmentNames");
  const showAssistantUserAttachmentReferencesCheckbox = document.getElementById("showAssistantUserAttachmentReferences");
  const showAssistantGeneratedAttachmentReferencesCheckbox = document.getElementById("showAssistantGeneratedAttachmentReferences");
  const showAssistantWebReferencesCheckbox = document.getElementById("showAssistantWebReferences");
  const showHeaderExportButtonChatgptCheckbox = document.getElementById("showHeaderExportButtonChatgpt");
  const showHeaderExportButtonClaudeCheckbox = document.getElementById("showHeaderExportButtonClaude");
  const showHeaderExportButtonGeminiCheckbox = document.getElementById("showHeaderExportButtonGemini");
  const showHeaderExportButtonDeepseekCheckbox = document.getElementById("showHeaderExportButtonDeepseek");
  const showHeaderExportButtonGrokCheckbox = document.getElementById("showHeaderExportButtonGrok");
  const exportTimeoutSecondsInput = document.getElementById("exportTimeoutSeconds");
  const showExportPdfCheckbox = document.getElementById("showExportPdf");
  const showExportMhtCheckbox = document.getElementById("showExportMht");
  const showExportHtmlCheckbox = document.getElementById("showExportHtml");
  const showExportTxtCheckbox = document.getElementById("showExportTxt");
  const counterTotalCountInput = document.getElementById("counterTotalCount");
  const counterDayCountInput = document.getElementById("counterDayCount");
  const counterNextChatNameCountInput = document.getElementById("counterNextChatNameCount");
  const counterDayKeyNode = document.getElementById("counterDayKey");
  const counterMapBodyNode = document.getElementById("counterMapBody");
  const applyCounterValuesButton = document.getElementById("applyCounterValues");
  const resetDayCounterButton = document.getElementById("resetDayCounter");
  const resetAllCountersButton = document.getElementById("resetAllCounters");
  const clearChatNameMappingsButton = document.getElementById("clearChatNameMappings");

  const aiNameModeRadios = Array.from(form.querySelectorAll('input[name="aiNameMode"]'));
  const saveModeRadios = Array.from(form.querySelectorAll('input[name="saveMode"]'));
  const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
  const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
  let autoSaveTimer = null;
  let lastCounterSummary = null;

  function showStatus(message, isError = false) {
    statusNode.textContent = message;
    statusNode.style.color = isError ? "#991b1b" : "#0f5132";
  }

  function getAiNameModeFromForm() {
    const checked = aiNameModeRadios.find((radio) => radio.checked);
    return checked ? checked.value : AI_NAME_MODE.PROVIDER;
  }

  function updateAiCustomFieldState() {
    const mode = getAiNameModeFromForm();
    const isCustom = mode === AI_NAME_MODE.CUSTOM;
    aiCustomNameInput.disabled = !isCustom;
  }

  function getSaveModeFromForm() {
    const checked = saveModeRadios.find((radio) => radio.checked);
    return checked ? checked.value : "autosave";
  }

  function updateFileNameFieldState() {
    const isAutomatic = autoFileNameCheckbox.checked;
    fileNameTemplateInput.disabled = false;
    fileNameTemplateInput.placeholder = isAutomatic ? "YY.MM-<ChatNameCount*3> <ChatName>" : "chat";
  }

  function updateDownloadModeFieldState() {
    const mode = getSaveModeFromForm();
    const directSave = mode === "autosave" || mode === "custom";
    autosaveConflictActionSelect.disabled = !directSave;
    customDownloadFolderInput.disabled = mode !== "custom";
  }

  function updateMetadataFieldState() {
    const enabled = metadataEnabledCheckbox.checked;
    [
      metadataExportedAtCheckbox,
      metadataDeviceUserCheckbox,
      metadataFolderCheckbox,
      metadataTitleCheckbox,
      metadataModelCheckbox,
      metadataUrlCheckbox,
      metadataSummaryProviderCheckbox,
      metadataSummaryChatNameCheckbox,
      metadataSummaryMessagesCheckbox,
      metadataStartTimeCheckbox,
      metadataEndTimeCheckbox,
      metadataDurationCheckbox
    ].forEach((input) => {
      input.disabled = !enabled;
    });
  }

  function activateTab(tabId) {
    tabButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === tabId);
    });

    tabPanels.forEach((panel) => {
      const isActive = panel.dataset.panel === tabId;
      panel.hidden = !isActive;
      panel.classList.toggle("is-active", isActive);
    });
  }

  function clampTimeoutSeconds(value) {
    const numericValue = Number(value);
    const safeValue = Number.isFinite(numericValue) ? numericValue : MAX_EXPORT_TIMEOUT_SECONDS;
    return Math.min(MAX_EXPORT_TIMEOUT_SECONDS, Math.max(1, Math.round(safeValue)));
  }

  function clampNonNegativeInteger(value, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return Math.max(0, Math.round(fallback));
    }

    return Math.max(0, Math.round(numericValue));
  }

  function clampPositiveInteger(value, fallback = 1) {
    return Math.max(1, clampNonNegativeInteger(value, fallback));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function applyCounterSummary(summary) {
    if (!summary || typeof summary !== "object") {
      return;
    }

    if (
      !counterTotalCountInput
      || !counterDayCountInput
      || !counterNextChatNameCountInput
      || !counterDayKeyNode
      || !counterMapBodyNode
    ) {
      return;
    }

    lastCounterSummary = summary;
    counterTotalCountInput.value = String(clampNonNegativeInteger(summary.totalCount, 0));
    counterDayCountInput.value = String(clampNonNegativeInteger(summary.dayCount, 0));
    counterNextChatNameCountInput.value = String(clampPositiveInteger(summary.nextChatNameCount, 1));
    counterDayKeyNode.textContent = String(summary.dayKey || "-");

    const entries = Array.isArray(summary.entries) ? summary.entries : [];
    if (!entries.length) {
      counterMapBodyNode.innerHTML = "<tr><td colspan=\"4\">No mappings yet.</td></tr>";
      return;
    }

    counterMapBodyNode.innerHTML = entries.map((entry) => {
      const safeMappingKey = escapeHtml(entry.key || "");
      return [
        "<tr>",
        `  <td><input class="counter-id-input" type="number" min="1" step="1" value="${escapeHtml(entry.count)}" data-counter-key="${safeMappingKey}" aria-label="ChatNameCount id"></td>`,
        `  <td>${escapeHtml(entry.providerName || "-")}</td>`,
        `  <td>${escapeHtml(entry.chatPath || "-")}</td>`,
        `  <td><button type="button" class="counter-inline-delete" data-counter-key="${safeMappingKey}" aria-label="Delete ChatNameCount association">Delete</button></td>`,
        "</tr>"
      ].join("");
    }).join("");
  }

  async function loadCounterSummary() {
    if (!root.storage || typeof root.storage.getCounterSummary !== "function") {
      return;
    }

    if (!counterTotalCountInput || !counterDayCountInput || !counterNextChatNameCountInput) {
      return;
    }

    const summary = await root.storage.getCounterSummary();
    applyCounterSummary(summary);
  }

  async function applyCounterValues() {
    if (!root.storage || typeof root.storage.updateCounterValues !== "function") {
      return;
    }

    if (!counterTotalCountInput || !counterDayCountInput || !counterNextChatNameCountInput) {
      return;
    }

    const summary = await root.storage.updateCounterValues({
      totalCount: clampNonNegativeInteger(counterTotalCountInput.value, lastCounterSummary?.totalCount ?? 0),
      dayCount: clampNonNegativeInteger(counterDayCountInput.value, lastCounterSummary?.dayCount ?? 0),
      nextChatNameCount: clampPositiveInteger(
        counterNextChatNameCountInput.value,
        lastCounterSummary?.nextChatNameCount ?? 1
      ),
      dayKey: String(lastCounterSummary?.dayKey || "")
    });
    applyCounterSummary(summary);
    showStatus("Counter values updated.");
  }

  async function resetDayCounter() {
    if (!root.storage || typeof root.storage.resetCounterValues !== "function") {
      return;
    }

    const summary = await root.storage.resetCounterValues("day");
    applyCounterSummary(summary);
    showStatus("Day counter reset.");
  }

  async function resetAllCounters() {
    if (!root.storage || typeof root.storage.resetCounterValues !== "function") {
      return;
    }

    const summary = await root.storage.resetCounterValues("all");
    applyCounterSummary(summary);
    showStatus("All counters reset.");
  }

  async function updateChatNameCountMapping(mappingKey, nextCount) {
    if (!root.storage || typeof root.storage.updateChatNameCountMapping !== "function") {
      throw new Error("ChatNameCount mapping updates are not available.");
    }

    const summary = await root.storage.updateChatNameCountMapping(mappingKey, nextCount);
    applyCounterSummary(summary);
    showStatus("ChatNameCount id updated.");
  }

  async function deleteChatNameCountMapping(mappingKey) {
    if (!root.storage || typeof root.storage.deleteChatNameCountMapping !== "function") {
      throw new Error("ChatNameCount mapping deletion is not available.");
    }

    const summary = await root.storage.deleteChatNameCountMapping(mappingKey);
    applyCounterSummary(summary);
    showStatus("ChatNameCount association deleted.");
  }

  async function clearChatNameMappings() {
    if (!root.storage || typeof root.storage.clearChatNameCountMappings !== "function") {
      throw new Error("Clearing ChatNameCount associations is not available.");
    }

    const summary = await root.storage.clearChatNameCountMappings();
    applyCounterSummary(summary);
    showStatus("All ChatNameCount associations were cleared.");
  }

  function applySettingsToForm(settings) {
    humanNameInput.value = settings.humanName || "";
    aiCustomNameInput.value = settings.aiCustomName || "";
    textFormattingSelect.value = settings.textFormatting;
    quoteDividerStyleSelect.value = settings.quoteDividerStyle;
    multilineFormatSelect.value = settings.multilineFormat;
    htmlPdfAiBorderColorInput.value = settings.htmlPdfAiBorderColor || "#2563eb";
    htmlPdfHumanBorderColorInput.value = settings.htmlPdfHumanBorderColor || "#f59e0b";
    messageSeparatorTextarea.value = settings.messageSeparator || "";
    txtHumanMessageHeaderTemplateTextarea.value = settings.txtHumanMessageHeaderTemplate || "\n\n----- <HumanName>\n\n";
    txtAiMessageHeaderTemplateTextarea.value = settings.txtAiMessageHeaderTemplate || "\n\n----- <AiName>\n\n";
    appThemeSelect.value = settings.appTheme || "auto";
    autoFileNameCheckbox.checked = Boolean(settings.autoFileName);
    fileNameTemplateInput.value = settings.fileNameTemplate || "";
    invalidFileNameReplacementInput.value = settings.invalidFileNameReplacement || ".";
    customDownloadFolderInput.value = settings.customDownloadFolder || "Chat Export AI";
    autosaveConflictActionSelect.value = settings.autosaveConflictAction || "overwrite";
    mediaHandlingSelect.value = settings.mediaHandling;
    companionMhtOnMediaCheckbox.checked = Boolean(settings.companionMhtOnMedia);
    includeExportTitleCheckbox.checked = Boolean(settings.includeExportTitle ?? true);
    metadataEnabledCheckbox.checked = Boolean(settings.metadataEnabled ?? true);
    metadataExportedAtCheckbox.checked = Boolean(settings.metadataExportedAt);
    metadataDeviceUserCheckbox.checked = Boolean(settings.metadataDeviceUser);
    metadataFolderCheckbox.checked = Boolean(settings.metadataFolder);
    metadataTitleCheckbox.checked = Boolean(settings.metadataTitle);
    metadataModelCheckbox.checked = Boolean(settings.metadataModel);
    metadataUrlCheckbox.checked = Boolean(settings.metadataUrl);
    metadataSummaryProviderCheckbox.checked = Boolean(settings.metadataSummaryProvider);
    metadataSummaryChatNameCheckbox.checked = Boolean(settings.metadataSummaryChatName);
    metadataSummaryMessagesCheckbox.checked = Boolean(settings.metadataSummaryMessages);
    metadataStartTimeCheckbox.checked = Boolean(settings.metadataStartTime);
    metadataEndTimeCheckbox.checked = Boolean(settings.metadataEndTime);
    metadataDurationCheckbox.checked = Boolean(settings.metadataDuration);
    includeThinkingCheckbox.checked = Boolean(settings.includeThinking);
    includeThinkingDurationCheckbox.checked = Boolean(settings.includeThinkingDuration);
    includeMessageTimeCheckbox.checked = Boolean(settings.includeMessageTime);
    includeMessageIdCheckbox.checked = Boolean(settings.includeMessageId);
    showUserAttachmentNamesCheckbox.checked = Boolean(settings.showUserAttachmentNames);
    showAssistantUserAttachmentReferencesCheckbox.checked = Boolean(settings.showAssistantUserAttachmentReferences);
    showAssistantGeneratedAttachmentReferencesCheckbox.checked = Boolean(settings.showAssistantGeneratedAttachmentReferences);
    showAssistantWebReferencesCheckbox.checked = Boolean(settings.showAssistantWebReferences);
    showHeaderExportButtonChatgptCheckbox.checked = Boolean(
      settings.showHeaderExportButtonChatgpt ?? settings.showHeaderExportButton
    );
    showHeaderExportButtonClaudeCheckbox.checked = Boolean(
      settings.showHeaderExportButtonClaude ?? settings.showHeaderExportButton
    );
    showHeaderExportButtonGeminiCheckbox.checked = Boolean(
      settings.showHeaderExportButtonGemini ?? settings.showHeaderExportButton
    );
    showHeaderExportButtonDeepseekCheckbox.checked = Boolean(
      settings.showHeaderExportButtonDeepseek ?? settings.showHeaderExportButton
    );
    showHeaderExportButtonGrokCheckbox.checked = Boolean(
      settings.showHeaderExportButtonGrok ?? settings.showHeaderExportButton
    );
    exportTimeoutSecondsInput.value = String(clampTimeoutSeconds(settings.exportTimeoutSeconds));
    showExportPdfCheckbox.checked = Boolean(settings.showExportPdf);
    showExportMhtCheckbox.checked = Boolean(settings.showExportMht);
    showExportHtmlCheckbox.checked = Boolean(settings.showExportHtml);
    showExportTxtCheckbox.checked = Boolean(settings.showExportTxt);
    saveModeRadios.forEach((radio) => {
      radio.checked = radio.value === settings.saveMode;
    });

    aiNameModeRadios.forEach((radio) => {
      radio.checked = radio.value === settings.aiNameMode;
    });

    updateAiCustomFieldState();
    updateFileNameFieldState();
    updateDownloadModeFieldState();
    updateMetadataFieldState();
  }

  function readSettingsFromForm() {
    return {
      humanName: humanNameInput.value.trim() || "Human",
      aiNameMode: getAiNameModeFromForm(),
      aiCustomName: aiCustomNameInput.value.trim() || "AI",
      textFormatting: textFormattingSelect.value,
      quoteDividerStyle: quoteDividerStyleSelect.value,
      multilineFormat: multilineFormatSelect.value,
      htmlPdfAiBorderColor: htmlPdfAiBorderColorInput.value,
      htmlPdfHumanBorderColor: htmlPdfHumanBorderColorInput.value,
      messageSeparator: messageSeparatorTextarea.value,
      txtHumanMessageHeaderTemplate: txtHumanMessageHeaderTemplateTextarea.value,
      txtAiMessageHeaderTemplate: txtAiMessageHeaderTemplateTextarea.value,
      appTheme: appThemeSelect.value,
      autoFileName: autoFileNameCheckbox.checked,
      fileNameTemplate: fileNameTemplateInput.value,
      invalidFileNameReplacement: invalidFileNameReplacementInput.value,
      saveMode: getSaveModeFromForm(),
      customDownloadFolder: customDownloadFolderInput.value,
      autosaveConflictAction: autosaveConflictActionSelect.value,
      mediaHandling: mediaHandlingSelect.value,
      companionMhtOnMedia: companionMhtOnMediaCheckbox.checked,
      includeExportTitle: includeExportTitleCheckbox.checked,
      metadataEnabled: metadataEnabledCheckbox.checked,
      metadataExportedAt: metadataExportedAtCheckbox.checked,
      metadataDeviceUser: metadataDeviceUserCheckbox.checked,
      metadataFolder: metadataFolderCheckbox.checked,
      metadataTitle: metadataTitleCheckbox.checked,
      metadataModel: metadataModelCheckbox.checked,
      metadataUrl: metadataUrlCheckbox.checked,
      metadataSummaryProvider: metadataSummaryProviderCheckbox.checked,
      metadataSummaryChatName: metadataSummaryChatNameCheckbox.checked,
      metadataSummaryMessages: metadataSummaryMessagesCheckbox.checked,
      metadataStartTime: metadataStartTimeCheckbox.checked,
      metadataEndTime: metadataEndTimeCheckbox.checked,
      metadataDuration: metadataDurationCheckbox.checked,
      includeThinking: includeThinkingCheckbox.checked,
      includeThinkingDuration: includeThinkingDurationCheckbox.checked,
      includeMessageTime: includeMessageTimeCheckbox.checked,
      includeMessageId: includeMessageIdCheckbox.checked,
      showUserAttachmentNames: showUserAttachmentNamesCheckbox.checked,
      showAssistantUserAttachmentReferences: showAssistantUserAttachmentReferencesCheckbox.checked,
      showAssistantGeneratedAttachmentReferences: showAssistantGeneratedAttachmentReferencesCheckbox.checked,
      showAssistantWebReferences: showAssistantWebReferencesCheckbox.checked,
      showHeaderExportButton: showHeaderExportButtonChatgptCheckbox.checked,
      showHeaderExportButtonChatgpt: showHeaderExportButtonChatgptCheckbox.checked,
      showHeaderExportButtonClaude: showHeaderExportButtonClaudeCheckbox.checked,
      showHeaderExportButtonGemini: showHeaderExportButtonGeminiCheckbox.checked,
      showHeaderExportButtonDeepseek: showHeaderExportButtonDeepseekCheckbox.checked,
      showHeaderExportButtonGrok: showHeaderExportButtonGrokCheckbox.checked,
      exportTimeoutSeconds: clampTimeoutSeconds(exportTimeoutSecondsInput.value),
      showExportPdf: showExportPdfCheckbox.checked,
      showExportMht: showExportMhtCheckbox.checked,
      showExportHtml: showExportHtmlCheckbox.checked,
      showExportTxt: showExportTxtCheckbox.checked
    };
  }

  async function loadSettings() {
    const settings = await root.storage.getSettings();
    root.appTheme.applyThemeDocument(settings.appTheme);
    root.buttonSystem.ensureDocumentStyles(document);
    applySettingsToForm(settings);
    root.buttonSystem.decorateButton(resetButton, {
      label: "Reset defaults",
      secondary: true
    });
    if (applyCounterValuesButton) {
      root.buttonSystem.decorateButton(applyCounterValuesButton, {
        label: "Apply counter values"
      });
    }
    if (resetDayCounterButton) {
      root.buttonSystem.decorateButton(resetDayCounterButton, {
        label: "Reset day counter",
        secondary: true
      });
    }
    if (resetAllCountersButton) {
      root.buttonSystem.decorateButton(resetAllCountersButton, {
        label: "Reset all counters",
        secondary: true
      });
    }
    if (clearChatNameMappingsButton) {
      root.buttonSystem.decorateButton(clearChatNameMappingsButton, {
        label: "Clear ChatNameCount associations",
        secondary: true
      });
    }
    await loadCounterSummary();
    showStatus("Settings loaded.");
  }

  async function saveSettings() {
    const next = readSettingsFromForm();

    await root.storage.saveSettings(next);
    root.appTheme.applyThemeDocument(next.appTheme);
    showStatus("Saved automatically.");
  }

  async function resetSettings() {
    const settings = await root.storage.resetSettings();
    root.appTheme.applyThemeDocument(settings.appTheme);
    applySettingsToForm(settings);
    showStatus("Settings reset to defaults.");
  }

  function scheduleAutoSave() {
    if (autoSaveTimer !== null) {
      window.clearTimeout(autoSaveTimer);
    }

    autoSaveTimer = window.setTimeout(() => {
      autoSaveTimer = null;
      saveSettings().catch((error) => {
        showStatus(`Error saving settings: ${error.message}`, true);
      });
    }, 120);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  metadataEnabledCheckbox.addEventListener("change", () => {
    updateMetadataFieldState();
  });

  resetButton.addEventListener("click", () => {
    const confirmed = window.confirm("Reset all settings to their default values?");
    if (!confirmed) {
      return;
    }

    resetSettings().catch((error) => {
      showStatus(`Error resetting settings: ${error.message}`, true);
    });
  });

  if (applyCounterValuesButton) {
    applyCounterValuesButton.addEventListener("click", () => {
      applyCounterValues().catch((error) => {
        showStatus(`Error updating counters: ${error.message}`, true);
      });
    });
  }

  if (resetDayCounterButton) {
    resetDayCounterButton.addEventListener("click", () => {
      resetDayCounter().catch((error) => {
        showStatus(`Error resetting day counter: ${error.message}`, true);
      });
    });
  }

  if (resetAllCountersButton) {
    resetAllCountersButton.addEventListener("click", () => {
      const confirmed = window.confirm("Reset all filename counters and ChatNameCount associations?");
      if (!confirmed) {
        return;
      }

      resetAllCounters().catch((error) => {
        showStatus(`Error resetting all counters: ${error.message}`, true);
      });
    });
  }

  if (clearChatNameMappingsButton) {
    clearChatNameMappingsButton.addEventListener("click", () => {
      const confirmed = window.confirm("Clear all ChatNameCount associations?");
      if (!confirmed) {
        return;
      }

      clearChatNameMappings().catch((error) => {
        showStatus(`Error clearing ChatNameCount associations: ${error.message}`, true);
      });
    });
  }

  aiNameModeRadios.forEach((radio) => {
    radio.addEventListener("change", updateAiCustomFieldState);
  });

  autoFileNameCheckbox.addEventListener("change", updateFileNameFieldState);
  saveModeRadios.forEach((radio) => {
    radio.addEventListener("change", updateDownloadModeFieldState);
  });
  appThemeSelect.addEventListener("change", () => {
    root.appTheme.applyThemeDocument(appThemeSelect.value);
  });
  exportTimeoutSecondsInput.addEventListener("change", () => {
    exportTimeoutSecondsInput.value = String(clampTimeoutSeconds(exportTimeoutSecondsInput.value));
  });
  if (counterTotalCountInput) {
    counterTotalCountInput.addEventListener("change", () => {
      counterTotalCountInput.value = String(clampNonNegativeInteger(counterTotalCountInput.value, 0));
    });
  }
  if (counterDayCountInput) {
    counterDayCountInput.addEventListener("change", () => {
      counterDayCountInput.value = String(clampNonNegativeInteger(counterDayCountInput.value, 0));
    });
  }
  if (counterNextChatNameCountInput) {
    counterNextChatNameCountInput.addEventListener("change", () => {
      counterNextChatNameCountInput.value = String(clampPositiveInteger(counterNextChatNameCountInput.value, 1));
    });
  }
  if (counterMapBodyNode) {
    counterMapBodyNode.addEventListener("input", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.classList.contains("counter-id-input")) {
        event.stopPropagation();
      }
    });

    counterMapBodyNode.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.classList.contains("counter-id-input")) {
        return;
      }

      event.stopPropagation();
      const mappingKey = target.dataset.counterKey || "";
      const nextCount = clampPositiveInteger(target.value, 1);
      target.value = String(nextCount);
      updateChatNameCountMapping(mappingKey, nextCount).catch((error) => {
        showStatus(`Error updating ChatNameCount id: ${error.message}`, true);
        void loadCounterSummary();
      });
    });

    counterMapBodyNode.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || !target.classList.contains("counter-inline-delete")) {
        return;
      }

      const mappingKey = target.dataset.counterKey || "";
      const confirmed = window.confirm("Delete this ChatNameCount association?");
      if (!confirmed) {
        return;
      }

      deleteChatNameCountMapping(mappingKey).catch((error) => {
        showStatus(`Error deleting ChatNameCount association: ${error.message}`, true);
      });
    });
  }
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.tab);
    });
  });

  form.addEventListener("input", scheduleAutoSave);
  form.addEventListener("change", scheduleAutoSave);
  activateTab("general");

  loadSettings().catch((error) => {
    showStatus(`Error loading settings: ${error.message}`, true);
  });
})();
