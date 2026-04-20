/*
 * Popup controller for quick page status and manual export actions.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { MSG_GET_CHAT_STATUS, MSG_EXPORT_CHAT, EXPORT_FORMATS } = root.constants;

  const statusNode = document.getElementById("status");
  const actionsNode = document.getElementById("actions");

  const exportPdfButton = document.getElementById("exportPdf");
  const exportTxtButton = document.getElementById("exportTxt");
  const exportHtmlButton = document.getElementById("exportHtml");
  const exportMhtButton = document.getElementById("exportMht");
  const openOptionsButton = document.getElementById("openOptions");

  let activeTabId = null;
  let popupSettings = null;
  let exportInProgress = false;

  function setStatus(message) {
    statusNode.textContent = message;
  }

  function setActionsVisible(visible) {
    actionsNode.hidden = !visible;
  }

  function setButtonsEnabled(enabled) {
    [exportPdfButton, exportMhtButton, exportHtmlButton, exportTxtButton].forEach((button) => {
      button.disabled = !enabled || button.hidden || exportInProgress;
    });
  }

  function setLoadingButton(activeButton) {
    [exportPdfButton, exportMhtButton, exportHtmlButton, exportTxtButton].forEach((button) => {
      button.classList.toggle("is-loading", button === activeButton && exportInProgress);
    });
  }

  function visibleExportButtons(settings) {
    return [
      settings.showExportPdf,
      settings.showExportMht,
      settings.showExportHtml,
      settings.showExportTxt
    ].some(Boolean);
  }

  function applyButtonVisibility(settings) {
    popupSettings = settings;
    exportPdfButton.hidden = !settings.showExportPdf;
    exportMhtButton.hidden = !settings.showExportMht;
    exportHtmlButton.hidden = !settings.showExportHtml;
    exportTxtButton.hidden = !settings.showExportTxt;
  }

  async function queryActiveTab() {
    const tabs = await root.chromeHelpers.tabsQuery({
      active: true,
      currentWindow: true
    });

    return tabs[0] || null;
  }

  async function loadStatus() {
    setActionsVisible(false);
    setButtonsEnabled(false);
    const settings = await root.storage.getSettings();
    root.appTheme.applyThemeDocument(settings.appTheme);
    applyButtonVisibility(settings);

    const tab = await queryActiveTab();

    if (!tab || typeof tab.id !== "number") {
      setStatus("Could not detect the active tab.");
      return;
    }

    activeTabId = tab.id;

    try {
      const response = await root.chromeHelpers.tabsSendMessage(activeTabId, {
        type: MSG_GET_CHAT_STATUS
      });

      if (!response || !response.supported) {
        setStatus("Current page is not supported yet (ChatGPT only).");
        return;
      }

      if (!response.isChatPage || !response.messageCount) {
        setStatus(`Provider: ${response.providerName}. Open a chat to export.`);
        return;
      }

      if (!visibleExportButtons(popupSettings)) {
        setStatus("No export formats are enabled in Settings.");
        return;
      }

      setStatus(`Provider: ${response.providerName}. Messages: ${response.messageCount}.`);
      setActionsVisible(true);
      setButtonsEnabled(true);
    } catch (_error) {
      setStatus("This tab does not have an active content script.");
    }
  }

  async function runExport(format, buttonNode) {
    if (activeTabId === null) {
      setStatus("No active tab selected.");
      return;
    }

    if (exportInProgress) {
      setStatus("An export is already in progress.");
      return;
    }

    exportInProgress = true;
    setLoadingButton(buttonNode);
    setButtonsEnabled(false);
    setStatus(`Exporting ${format.toUpperCase()}...`);

    try {
      const response = await root.chromeHelpers.tabsSendMessage(activeTabId, {
        type: MSG_EXPORT_CHAT,
        payload: { format }
      });

      if (!response || !response.ok) {
        throw new Error(response?.error || "Export error.");
      }

      setStatus(`Download started (${format.toUpperCase()}).`);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    } finally {
      exportInProgress = false;
      setLoadingButton(null);
      setButtonsEnabled(true);
    }
  }

  exportPdfButton.addEventListener("click", () => runExport(EXPORT_FORMATS.PDF, exportPdfButton));
  exportMhtButton.addEventListener("click", () => runExport(EXPORT_FORMATS.MHT, exportMhtButton));
  exportHtmlButton.addEventListener("click", () => runExport(EXPORT_FORMATS.HTML, exportHtmlButton));
  exportTxtButton.addEventListener("click", () => runExport(EXPORT_FORMATS.TXT, exportTxtButton));

  openOptionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  loadStatus().catch((error) => {
    setStatus(`Popup error: ${error.message}`);
  });
})();
