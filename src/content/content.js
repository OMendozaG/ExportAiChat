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
  const exportSnapshotsByConversation = new Map();

  function getProviderButtonSetting(settings, providerId) {
    const providerSettingById = {
      chatgpt: "showHeaderExportButtonChatgpt",
      claude: "showHeaderExportButtonClaude",
      gemini: "showHeaderExportButtonGemini",
      deepseek: "showHeaderExportButtonDeepseek",
      grok: "showHeaderExportButtonGrok"
    };

    const providerSettingKey = providerSettingById[providerId];
    if (providerSettingKey) {
      return Boolean(settings[providerSettingKey] ?? settings.showHeaderExportButton);
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

  function buildProcessedConversation(provider, settings) {
    const rawConversation = provider.extractConversation(settings);
    return root.postProcess.processConversation(rawConversation, settings, provider);
  }

  function settingsForRichMediaExport(settings) {
    return {
      ...settings,
      mediaHandling: MEDIA_HANDLING.MHT
    };
  }

  function applyCounterSnapshotToConversation(conversation, counterSnapshot) {
    if (!conversation || !counterSnapshot || typeof counterSnapshot !== "object") {
      return conversation;
    }

    conversation.exportCounters = {
      totalCount: Number(counterSnapshot.totalCount || 0),
      dayCount: Number(counterSnapshot.dayCount || 0),
      chatNameCount: Number(counterSnapshot.chatNameCount || 1),
      dayKey: String(counterSnapshot.dayKey || "")
    };

    // Keep popup summary/file-name preview aligned with the same counter snapshot.
    if (conversation.summary && typeof root.exporters?.resolveFileBaseName === "function") {
      const fileNameBase = root.exporters.resolveFileBaseName(conversation);
      conversation.summary.fileNameBase = fileNameBase;
      conversation.summary.fileName = fileNameBase;
    }

    return conversation;
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

  function normalizeCustomDownloadFolder(value) {
    const rawValue = String(value || "").trim();
    if (!rawValue) {
      return "";
    }

    const normalizedValue = rawValue.normalize ? rawValue.normalize("NFC") : rawValue;
    const pathSegments = normalizedValue
      .replace(/\\/g, "/")
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .filter((segment) => segment !== "." && segment !== "..")
      .map((segment) => segment
        .replace(/[<>:"|?*\u0000-\u001F]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
      )
      .filter(Boolean);

    return pathSegments.join("/");
  }

  function resolveDownloadFilename(baseFilename, settings) {
    const safeBaseFileName = String(baseFilename || "chat-export");
    if (settings?.saveMode !== "custom") {
      return safeBaseFileName;
    }

    const safeFolder = normalizeCustomDownloadFolder(settings.customDownloadFolder);
    if (!safeFolder) {
      return safeBaseFileName;
    }

    return `${safeFolder}/${safeBaseFileName}`;
  }

  function shouldAskForDownloadLocation(settings) {
    return settings?.saveMode === "ask";
  }

  function shouldInlineMediaSource(rawSource) {
    const source = String(rawSource || "").trim();
    if (!source) {
      return false;
    }

    if (/^data:/i.test(source)) {
      return false;
    }

    if (/^(?:javascript|about|chrome-extension):/i.test(source)) {
      return false;
    }

    return true;
  }

  function withSignalTimeout(timeoutMs) {
    const controller = new AbortController();
    const timerId = window.setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    return {
      signal: controller.signal,
      clear: () => window.clearTimeout(timerId)
    };
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not convert image blob to data URL."));
      reader.readAsDataURL(blob);
    });
  }

  async function fetchImageAsDataUrl(url) {
    const timeoutHandle = withSignalTimeout(6000);

    try {
      const response = await fetch(url, {
        credentials: "include",
        cache: "force-cache",
        signal: timeoutHandle.signal
      });

      if (!response.ok) {
        throw new Error(`Image request failed (${response.status})`);
      }

      const imageBlob = await response.blob();
      if (!imageBlob || !imageBlob.size) {
        throw new Error("Image payload is empty.");
      }

      return await blobToDataUrl(imageBlob);
    } finally {
      timeoutHandle.clear();
    }
  }

  async function inlineImagesInHtmlDocument(htmlDocument) {
    const htmlSource = String(htmlDocument || "");
    if (!htmlSource || !/<img\b/i.test(htmlSource)) {
      return htmlSource;
    }

    const parser = new DOMParser();
    const parsed = parser.parseFromString(htmlSource, "text/html");
    const images = Array.from(parsed.querySelectorAll("img[src]"));

    if (!images.length) {
      return htmlSource;
    }

    const dataUrlCache = new Map();

    await Promise.all(images.map(async (image) => {
      const source = image.getAttribute("src") || "";
      if (!shouldInlineMediaSource(source)) {
        return;
      }

      let absoluteUrl = "";
      try {
        absoluteUrl = new URL(source, location.href).href;
      } catch (_error) {
        return;
      }

      if (!shouldInlineMediaSource(absoluteUrl)) {
        return;
      }

      if (!dataUrlCache.has(absoluteUrl)) {
        dataUrlCache.set(absoluteUrl, fetchImageAsDataUrl(absoluteUrl).catch(() => ""));
      }

      const resolvedDataUrl = await dataUrlCache.get(absoluteUrl);
      if (!resolvedDataUrl) {
        return;
      }

      image.setAttribute("src", resolvedDataUrl);
      image.removeAttribute("srcset");
    }));

    return "<!doctype html>\n" + parsed.documentElement.outerHTML;
  }

  function allFormats() {
    return Object.values(EXPORT_FORMATS);
  }

  function getConversationKey(provider) {
    return `${provider?.id || "unknown"}:${location.pathname}`;
  }

  function getLiveMessageCount(provider) {
    if (!provider) {
      return 0;
    }

    const liveStatus = provider.getLiveStatus ? provider.getLiveStatus() : null;
    return Number(liveStatus?.messageCount || 0);
  }

  function getExportStates(provider, liveMessageCount) {
    const key = getConversationKey(provider);
    const snapshot = exportSnapshotsByConversation.get(key) || {};
    const currentCount = Number(liveMessageCount || 0);
    const next = {};

    allFormats().forEach((format) => {
      const savedCount = Number(snapshot[format]);
      next[format] = Number.isFinite(savedCount) && currentCount > 0 && currentCount <= savedCount;
    });

    return next;
  }

  function markExportSuccess(provider, format, liveMessageCount) {
    const key = getConversationKey(provider);
    const current = exportSnapshotsByConversation.get(key) || {};
    const safeCount = Math.max(0, Number(liveMessageCount || 0));
    current[format] = safeCount;
    exportSnapshotsByConversation.set(key, current);
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
      refreshInlineUi().catch(() => {});
    }, 120);
  }

  async function refreshInlineUi() {
    const provider = getActiveProvider();
    const settings = cachedInlineUiSettings || await root.storage.getSettings();
    const liveStatus = provider?.getLiveStatus ? provider.getLiveStatus() : null;
    cachedInlineUiSettings = settings;

    if (root.appTheme?.syncActionIconTheme) {
      root.appTheme.syncActionIconTheme(settings.appTheme);
    }

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

    if (root.appTheme && typeof ui.setTheme === "function") {
      ui.setTheme(root.appTheme.resolveThemeMode(settings.appTheme));
    }
    if (typeof ui.setProvider === "function") {
      ui.setProvider(provider.id || "");
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
    if (typeof ui.setFormatStates === "function") {
      ui.setFormatStates(getExportStates(provider, Number(liveStatus?.messageCount || 0)));
    }
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
      const liveMessageCountBeforeExport = getLiveMessageCount(provider);
      const shouldForceRichMedia = format === EXPORT_FORMATS.MHT || format === EXPORT_FORMATS.PDF;
      const extractionSettings = shouldForceRichMedia
        ? settingsForRichMediaExport(settings)
        : settings;
      const processedConversation = buildProcessedConversation(provider, extractionSettings);
      const exporter = root.exporters;

      if (!exporter) {
        throw new Error("Export engine is not initialized.");
      }

      if (!processedConversation.messages.length) {
        throw new Error("No exportable messages found in current chat.");
      }

      if (typeof root.storage.reserveExportCounters === "function") {
        try {
          const counterSnapshot = await root.storage.reserveExportCounters(processedConversation);
          applyCounterSnapshotToConversation(processedConversation, counterSnapshot);
        } catch (_error) {
          // Keep exporting even if counter persistence fails unexpectedly.
        }
      }

      let filename = "";
      let mimeType = "text/plain;charset=utf-8";
      let content = "";
      let htmlDocument = "";

      if (format === EXPORT_FORMATS.TXT) {
        filename = resolveDownloadFilename(exporter.buildFileName(processedConversation, "txt"), settings);
        root.postProcess.setResolvedFileNameMetadata(processedConversation, filename);
        const formatter = exporter.toIrcText || exporter.toChatText;

        if (typeof formatter !== "function") {
          throw new Error("TXT formatter is not available.");
        }

        content = formatter(processedConversation);
      } else if (format === EXPORT_FORMATS.HTML) {
        filename = resolveDownloadFilename(exporter.buildFileName(processedConversation, "html"), settings);
        root.postProcess.setResolvedFileNameMetadata(processedConversation, filename);
        htmlDocument = exporter.toHtmlDocument(processedConversation, settings);
        content = htmlDocument;
        mimeType = "text/html;charset=utf-8";
      } else if (format === EXPORT_FORMATS.MHT) {
        filename = resolveDownloadFilename(exporter.buildFileName(processedConversation, "mht"), settings);
        root.postProcess.setResolvedFileNameMetadata(processedConversation, filename);
        htmlDocument = exporter.toHtmlDocument(processedConversation, settings);
        htmlDocument = await inlineImagesInHtmlDocument(htmlDocument);
        content = exporter.toMhtDocument(htmlDocument, processedConversation);
        mimeType = "application/octet-stream";
      } else if (format === EXPORT_FORMATS.PDF) {
        filename = resolveDownloadFilename(exporter.buildFileName(processedConversation, "pdf"), settings);
        root.postProcess.setResolvedFileNameMetadata(processedConversation, filename);
        htmlDocument = typeof exporter.toPdfDocument === "function"
          ? exporter.toPdfDocument(processedConversation, settings)
          : exporter.toHtmlDocument(processedConversation, settings);
        htmlDocument = await inlineImagesInHtmlDocument(htmlDocument);
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
              saveAs: shouldAskForDownloadLocation(settings),
              conflictAction: settings.autosaveConflictAction,
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
            saveAs: shouldAskForDownloadLocation(settings),
            conflictAction: settings.autosaveConflictAction
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
        const conversationForCompanion = buildProcessedConversation(
          provider,
          settingsForRichMediaExport(settings)
        );
        if (processedConversation.exportCounters) {
          applyCounterSnapshotToConversation(conversationForCompanion, processedConversation.exportCounters);
        }
        const htmlDoc = await inlineImagesInHtmlDocument(
          exporter.toHtmlDocument(conversationForCompanion, settingsForRichMediaExport(settings))
        );
        const companionFilename = resolveDownloadFilename(
          exporter.buildFileName(conversationForCompanion, "mht"),
          settings
        );
        root.postProcess.setResolvedFileNameMetadata(conversationForCompanion, companionFilename);
        const mhtContent = exporter.toMhtDocument(htmlDoc, conversationForCompanion);

        await withTimeout(
          requestFileDownload({
            filename: companionFilename,
            mimeType: "application/octet-stream",
            content: mhtContent,
            saveAs: shouldAskForDownloadLocation(settings),
            conflictAction: settings.autosaveConflictAction
          }),
          timeoutMs,
          `The companion MHT export exceeded the ${settings.exportTimeoutSeconds}s timeout.`
        );
      }

      markExportSuccess(
        provider,
        format,
        liveMessageCountBeforeExport > 0 ? liveMessageCountBeforeExport : processedConversation.messages.length
      );

      const liveMessageCountAfterExport = getLiveMessageCount(provider);
      const exportStates = getExportStates(
        provider,
        liveMessageCountAfterExport > 0 ? liveMessageCountAfterExport : liveMessageCountBeforeExport
      );

      return {
        ok: true,
        format,
        messageCount: processedConversation.messages.length,
        filename,
        exportStates
      };
    } finally {
      exportInProgress = false;
      scheduleInlineUiRefresh();
    }
  }

  async function getChatStatus() {
    const provider = getActiveProvider();

    if (!provider) {
      return {
        supported: false,
        providerId: null,
        providerName: null,
        isChatPage: false,
        messageCount: 0,
        exportStates: {}
      };
    }

    const settings = await root.storage.getSettings();
    const liveStatus = provider.getLiveStatus ? provider.getLiveStatus() : {
      isChatPage: provider.isChatPage(),
      messageCount: document.querySelectorAll("[data-message-author-role]").length
    };

    let summary = null;

    if (liveStatus.isChatPage && Number(liveStatus.messageCount || 0) > 0) {
      try {
        const processedConversation = buildProcessedConversation(provider, settings);
        if (typeof root.storage.previewExportCounters === "function") {
          try {
            const previewSnapshot = await root.storage.previewExportCounters(processedConversation);
            applyCounterSnapshotToConversation(processedConversation, previewSnapshot);
          } catch (_error) {
            // Keep status available even when counter preview fails.
          }
        }
        summary = processedConversation.summary || null;
        if (summary && summary.fileName) {
          summary.fileName = resolveDownloadFilename(summary.fileName, settings);
        }
      } catch (_error) {
        summary = null;
      }
    }

    return {
      supported: true,
      providerId: provider.id,
      providerName: provider.displayName,
      isChatPage: Boolean(liveStatus.isChatPage),
      messageCount: Number(summary?.totalMessages || liveStatus.messageCount || 0),
      summary,
      exportStates: getExportStates(provider, Number(liveStatus.messageCount || 0))
    };
  }

  function setupRuntimeListener() {
    if (!globalThis.chrome?.runtime?.onMessage?.addListener) {
      return;
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") {
        return false;
      }

      if (message.type === MSG_GET_CHAT_STATUS) {
        getChatStatus()
          .then((status) => sendResponse(status))
          .catch((error) => sendResponse({
            supported: false,
            error: error.message
          }));
        return true;
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
    if (!globalThis.chrome?.storage?.onChanged?.addListener) {
      return;
    }

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
