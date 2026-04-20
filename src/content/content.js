/*
 * Main content-script controller.
 * It extracts chat data, responds to popup requests and can optionally mount
 * a small inline export control in the provider header.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const {
    MSG_DOWNLOAD_FILE,
    MSG_RENDER_HTML_TO_PDF,
    MSG_GET_CHAT_STATUS,
    MSG_EXPORT_CHAT,
    EXPORT_FORMATS,
    MEDIA_HANDLING
  } = root.constants;

  let activeProvider = null;
  let exportInProgress = false;
  let inlineUi = null;
  let inlineUiRefreshTimer = null;
  let domObserver = null;
  let cachedInlineUiSettings = null;

  function getProviderButtonSetting(settings, providerId) {
    if (providerId === "chatgpt") {
      return Boolean(settings.showHeaderExportButtonChatgpt ?? settings.showHeaderExportButton);
    }

    return Boolean(settings.showHeaderExportButton);
  }

  function withTimeout(promise, timeoutMs, timeoutMessage) {
    return new Promise((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      Promise.resolve(promise)
        .then((value) => {
          window.clearTimeout(timerId);
          resolve(value);
        })
        .catch((error) => {
          window.clearTimeout(timerId);
          reject(error);
        });
    });
  }

  function resolveProvider() {
    activeProvider = root.providers.findProviderForUrl(location.href);
    return activeProvider;
  }

  function getActiveProvider() {
    return activeProvider || resolveProvider();
  }

  function isProviderReadyForExport() {
    const provider = getActiveProvider();
    return Boolean(provider && provider.isChatPage());
  }

  async function requestFileDownload(payload) {
    const response = await root.chromeHelpers.runtimeSendMessage({
      type: MSG_DOWNLOAD_FILE,
      payload
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || "Unknown download error.");
    }

    return response;
  }

  function ensureInlineUi() {
    if (!root.contentUi || typeof root.contentUi.createHeaderExportUi !== "function") {
      return null;
    }

    if (!inlineUi) {
      inlineUi = root.contentUi.createHeaderExportUi({
        onExport: handleInlineExport
      });
    }

    return inlineUi;
  }

  function scheduleInlineUiRefresh() {
    if (inlineUiRefreshTimer !== null) {
      return;
    }

    inlineUiRefreshTimer = window.setTimeout(() => {
      inlineUiRefreshTimer = null;
      void refreshInlineUi();
    }, 120);
  }

  async function refreshInlineUi() {
    const provider = getActiveProvider();
    const settings = cachedInlineUiSettings || await root.storage.getSettings();
    const liveStatus = provider?.getLiveStatus ? provider.getLiveStatus() : null;
    cachedInlineUiSettings = settings;

    if (
      !provider ||
      !getProviderButtonSetting(settings, provider.id) ||
      typeof provider.findInlineActionAnchor !== "function" ||
      !provider.isChatPage() ||
      !liveStatus?.messageCount
    ) {
      if (inlineUi) {
        inlineUi.setVisible(false);
      }
      return;
    }

    const ui = ensureInlineUi();

    if (!ui) {
      return;
    }

    ui.setVisibleFormats({
      showExportPdf: Boolean(settings.showExportPdf),
      showExportMht: Boolean(settings.showExportMht),
      showExportHtml: Boolean(settings.showExportHtml),
      showExportTxt: Boolean(settings.showExportTxt)
    });

    if (!ui.hasVisibleFormats()) {
      ui.setVisible(false);
      return;
    }

    const anchor = provider.findInlineActionAnchor();
    const mounted = ui.mount(anchor);

    if (!mounted) {
      ui.setVisible(false);
      return;
    }

    ui.setVisible(true);
    ui.setEnabled(!exportInProgress && Boolean(liveStatus?.messageCount));
  }

  async function handleInlineExport(format) {
    const ui = ensureInlineUi();

    if (ui) {
      ui.setLoading(true);
    }

    try {
      await exportCurrentChat(format);
    } finally {
      if (ui) {
        ui.setLoading(false);
      }
      scheduleInlineUiRefresh();
    }
  }

  async function exportCurrentChat(format) {
    const provider = getActiveProvider();

    if (!provider) {
      throw new Error("No active provider for this page.");
    }

    if (!isProviderReadyForExport()) {
      throw new Error("No active chat detected on this page.");
    }

    if (exportInProgress) {
      throw new Error("An export is already in progress.");
    }

    exportInProgress = true;

    try {
      scheduleInlineUiRefresh();
      const settings = await root.storage.getSettings();
      const timeoutMs = settings.exportTimeoutSeconds * 1000;
      const rawConversation = provider.extractConversation(settings);
      const processedConversation = root.postProcess.processConversation(rawConversation, settings, provider);
      const exporter = root.exporters;

      if (!exporter) {
        throw new Error("Export engine is not initialized.");
      }

      if (!processedConversation.messages.length) {
        throw new Error("No exportable messages found in current chat.");
      }

      let filename = "";
      let mimeType = "text/plain;charset=utf-8";
      let content = "";
      let htmlDocument = "";

      if (format === EXPORT_FORMATS.TXT) {
        const formatter = exporter.toIrcText || exporter.toChatText;

        if (typeof formatter !== "function") {
          throw new Error("TXT formatter is not available.");
        }

        content = formatter(processedConversation);
        filename = exporter.buildFileName(processedConversation, "txt");
      } else if (format === EXPORT_FORMATS.HTML) {
        htmlDocument = exporter.toHtmlDocument(processedConversation, settings);
        content = htmlDocument;
        filename = exporter.buildFileName(processedConversation, "html");
        mimeType = "text/html;charset=utf-8";
      } else if (format === EXPORT_FORMATS.MHT) {
        htmlDocument = exporter.toHtmlDocument(processedConversation, settings);
        content = exporter.toMhtDocument(htmlDocument, processedConversation);
        filename = exporter.buildFileName(processedConversation, "mht");
        mimeType = "message/rfc822;charset=utf-8";
      } else if (format === EXPORT_FORMATS.PDF) {
        htmlDocument = exporter.toHtmlDocument(processedConversation, settings);
        filename = exporter.buildFileName(processedConversation, "pdf");
      } else {
        throw new Error("Unsupported format: " + format);
      }

      if (format === EXPORT_FORMATS.PDF) {
        const response = await withTimeout(
          root.chromeHelpers.runtimeSendMessage({
            type: MSG_RENDER_HTML_TO_PDF,
            payload: {
              filename,
              html: htmlDocument,
              saveAs: settings.saveMode === "ask",
              timeoutMs
            }
          }),
          timeoutMs + 1000,
          `The PDF export exceeded the ${settings.exportTimeoutSeconds}s timeout.`
        );

        if (!response || !response.ok) {
          throw new Error(response?.error || "Unknown PDF render error.");
        }
      } else {
        await withTimeout(
          requestFileDownload({
            filename,
            mimeType,
            content,
            saveAs: settings.saveMode === "ask"
          }),
          timeoutMs,
          `The ${format.toUpperCase()} export exceeded the ${settings.exportTimeoutSeconds}s timeout.`
        );
      }

      if (
        settings.mediaHandling === MEDIA_HANDLING.MHT &&
        settings.companionMhtOnMedia &&
        processedConversation.hasMedia &&
        format !== EXPORT_FORMATS.MHT
      ) {
        const htmlDoc = htmlDocument || exporter.toHtmlDocument(processedConversation, settings);
        const mhtContent = exporter.toMhtDocument(htmlDoc, processedConversation);

        await withTimeout(
          requestFileDownload({
            filename: exporter.buildFileName(processedConversation, "mht"),
            mimeType: "message/rfc822;charset=utf-8",
            content: mhtContent,
            saveAs: settings.saveMode === "ask"
          }),
          timeoutMs,
          `The companion MHT export exceeded the ${settings.exportTimeoutSeconds}s timeout.`
        );
      }

      return {
        ok: true,
        format,
        messageCount: processedConversation.messages.length,
        filename
      };
    } finally {
      exportInProgress = false;
      scheduleInlineUiRefresh();
    }
  }

  function getChatStatus() {
    const provider = getActiveProvider();

    if (!provider) {
      return {
        supported: false,
        providerId: null,
        providerName: null,
        isChatPage: false,
        messageCount: 0
      };
    }

    const liveStatus = provider.getLiveStatus ? provider.getLiveStatus() : {
      isChatPage: provider.isChatPage(),
      messageCount: document.querySelectorAll("[data-message-author-role]").length
    };

    return {
      supported: true,
      providerId: provider.id,
      providerName: provider.displayName,
      isChatPage: Boolean(liveStatus.isChatPage),
      messageCount: Number(liveStatus.messageCount || 0)
    };
  }

  function setupRuntimeListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") {
        return false;
      }

      if (message.type === MSG_GET_CHAT_STATUS) {
        sendResponse(getChatStatus());
        return false;
      }

      if (message.type === MSG_EXPORT_CHAT) {
        exportCurrentChat(message.payload?.format)
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));

        return true;
      }

      return false;
    });
  }

  function setupStorageListener() {
    chrome.storage.onChanged.addListener((_changes, areaName) => {
      if (areaName === "local") {
        cachedInlineUiSettings = null;
        scheduleInlineUiRefresh();
      }
    });
  }

  function setupDomObserver() {
    if (domObserver || !document.documentElement) {
      return;
    }

    domObserver = new MutationObserver(() => {
      scheduleInlineUiRefresh();
    });

    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("popstate", scheduleInlineUiRefresh);
    window.addEventListener("focus", scheduleInlineUiRefresh);
  }

  function bootstrap() {
    resolveProvider();
    setupRuntimeListener();
    setupStorageListener();
    setupDomObserver();
    scheduleInlineUiRefresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
