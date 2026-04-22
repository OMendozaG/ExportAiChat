/*
 * Popup controller for quick page status and manual export actions.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { MSG_GET_CHAT_STATUS, MSG_EXPORT_CHAT, EXPORT_FORMATS } = root.constants;

  const statusNode = document.getElementById("status");
  const summaryNode = document.getElementById("summary");
  const actionsNode = document.getElementById("actions");
  const summaryProviderNode = document.getElementById("summaryProvider");
  const summaryChatNameNode = document.getElementById("summaryChatName");

  const exportMultiButton = document.getElementById("exportMulti");
  const exportPdfButton = document.getElementById("exportPdf");
  const exportTxtButton = document.getElementById("exportTxt");
  const exportHtmlButton = document.getElementById("exportHtml");
  const exportMhtButton = document.getElementById("exportMht");
  const openOptionsButton = document.getElementById("openOptions");

  let activeTabId = null;
  let popupSettings = null;
  let exportInProgress = false;
  const exportButtons = [exportMultiButton, exportPdfButton, exportMhtButton, exportHtmlButton, exportTxtButton];
  const exportButtonByFormat = {
    [EXPORT_FORMATS.MULTI]: exportMultiButton,
    [EXPORT_FORMATS.PDF]: exportPdfButton,
    [EXPORT_FORMATS.MHT]: exportMhtButton,
    [EXPORT_FORMATS.HTML]: exportHtmlButton,
    [EXPORT_FORMATS.TXT]: exportTxtButton
  };

  function setStatus(message) {
    const text = String(message || "").trim();
    statusNode.textContent = text;
    statusNode.hidden = !text;
  }

  function setActionsVisible(visible) {
    actionsNode.hidden = !visible;
  }

  function setSummaryVisible(visible) {
    summaryNode.hidden = !visible;
  }

  function setSummary(summary) {
    if (!summary) {
      setSummaryVisible(false);
      return;
    }

    summaryProviderNode.textContent = summary.providerName || "-";
    summaryChatNameNode.textContent = summary.fileName || summary.fileNameBase || "-";
    setSummaryVisible(true);
  }

  function setButtonsEnabled(enabled) {
    exportButtons.forEach((button) => {
      button.disabled = !enabled || button.hidden || exportInProgress;
    });
  }

  function setOnlyButtonState(activeButton, state) {
    exportButtons.forEach((button) => {
      root.buttonSystem.setButtonState(button, button === activeButton ? state : "idle");
    });
  }

  function applyExportStates(stateByFormat) {
    Object.entries(exportButtonByFormat).forEach(([format, button]) => {
      const isSuccess = Boolean(stateByFormat && stateByFormat[format]);
      root.buttonSystem.setButtonState(button, isSuccess ? "success" : "idle");
    });
  }

  function visibleExportButtons(settings) {
    return [
      settings.showExportMulti,
      settings.showExportPdf,
      settings.showExportMht,
      settings.showExportHtml,
      settings.showExportTxt
    ].some(Boolean);
  }

  function applyButtonVisibility(settings) {
    popupSettings = settings;
    [
      [exportMultiButton, settings.showExportMulti],
      [exportPdfButton, settings.showExportPdf],
      [exportMhtButton, settings.showExportMht],
      [exportHtmlButton, settings.showExportHtml],
      [exportTxtButton, settings.showExportTxt]
    ].forEach(([button, visible]) => {
      button.hidden = !visible;
      button.style.display = visible ? "" : "none";
      button.setAttribute("aria-hidden", visible ? "false" : "true");
    });
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
    setSummaryVisible(false);
    setButtonsEnabled(false);
    const settings = await root.storage.getSettings();
    root.appTheme.applyThemeDocument(settings.appTheme);
    root.buttonSystem.ensureDocumentStyles(document);
    applyButtonVisibility(settings);
    root.buttonSystem.decorateButton(exportMultiButton, { label: "Multi", stacked: true });
    root.buttonSystem.decorateButton(exportPdfButton, { label: ".PDF", stacked: true });
    root.buttonSystem.decorateButton(exportMhtButton, { label: ".MHT", stacked: true });
    root.buttonSystem.decorateButton(exportHtmlButton, { label: ".HTML", stacked: true });
    root.buttonSystem.decorateButton(exportTxtButton, { label: ".TXT", stacked: true });

    const tab = await queryActiveTab();

    if (!tab || typeof tab.id !== "number") {
      setStatus("Could not detect the active tab.");
      setSummaryVisible(false);
      return;
    }

    activeTabId = tab.id;

    try {
      const response = await root.chromeHelpers.tabsSendMessage(activeTabId, {
        type: MSG_GET_CHAT_STATUS
      });

      if (!response || !response.supported) {
      setActionsVisible(false);
      setStatus("This tab does not contain a LLM Chat.");
      setSummaryVisible(false);
      applyExportStates(null);
      return;
    }

      if (!response.isChatPage || !response.messageCount) {
      setActionsVisible(false);
      setStatus("This tab does not contain a LLM Chat.");
      setSummaryVisible(false);
      applyExportStates(null);
      return;
    }

      if (!visibleExportButtons(popupSettings)) {
      setStatus("No export formats are enabled in Settings.");
      setActionsVisible(false);
      setSummary(response.summary || null);
      applyExportStates(response.exportStates || null);
      return;
    }

      setSummary(response.summary || null);
      setStatus("");
      setActionsVisible(true);
      applyExportStates(response.exportStates || null);
      setButtonsEnabled(true);
    } catch (_error) {
      setActionsVisible(false);
      setStatus("This tab does not contain a LLM Chat.");
      setSummaryVisible(false);
      applyExportStates(null);
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
    setOnlyButtonState(buttonNode, "loading");
    setButtonsEnabled(false);
    setStatus("");

    try {
      const response = await root.chromeHelpers.tabsSendMessage(activeTabId, {
        type: MSG_EXPORT_CHAT,
        payload: { format }
      });

      if (!response || !response.ok) {
        throw new Error(response?.error || "Export error.");
      }

      const exportStates = response.result?.exportStates;
      if (exportStates && typeof exportStates === "object") {
        applyExportStates(exportStates);
      } else {
        setOnlyButtonState(buttonNode, "success");
      }
      setStatus("");
    } catch (error) {
      setOnlyButtonState(buttonNode, "idle");
      setStatus(`Error: ${error.message}`);
    } finally {
      exportInProgress = false;
      setButtonsEnabled(true);
    }
  }

  exportMultiButton.addEventListener("click", () => runExport(EXPORT_FORMATS.MULTI, exportMultiButton));
  exportPdfButton.addEventListener("click", () => runExport(EXPORT_FORMATS.PDF, exportPdfButton));
  exportMhtButton.addEventListener("click", () => runExport(EXPORT_FORMATS.MHT, exportMhtButton));
  exportHtmlButton.addEventListener("click", () => runExport(EXPORT_FORMATS.HTML, exportHtmlButton));
  exportTxtButton.addEventListener("click", () => runExport(EXPORT_FORMATS.TXT, exportTxtButton));

  openOptionsButton.addEventListener("click", () => {
    const optionsUrl = globalThis.chrome?.runtime?.getURL
      ? globalThis.chrome.runtime.getURL("src/options/options.html")
      : "src/options/options.html";

    if (globalThis.chrome?.tabs?.create) {
      globalThis.chrome.tabs.create({ url: optionsUrl });
      return;
    }

    if (globalThis.chrome?.runtime?.openOptionsPage) {
      globalThis.chrome.runtime.openOptionsPage();
    }
  });

  loadStatus().catch((error) => {
    setStatus(`Popup error: ${error.message}`);
  });
})();
