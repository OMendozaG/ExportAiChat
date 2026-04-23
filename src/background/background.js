/*
 * Service worker for downloads and background-only browser operations.
 * PDF rendering is delegated to an offscreen document so no visible tabs are opened.
 */
(() => {
  const MSG_DOWNLOAD_FILE = "CHAT_EXPORT_AI_DOWNLOAD_FILE";
  const MSG_CAPTURE_TAB_MHTML = "CHAT_EXPORT_AI_CAPTURE_TAB_MHTML";
  const MSG_RENDER_HTML_TO_PDF = "CHAT_EXPORT_AI_RENDER_HTML_TO_PDF";
  const MSG_WARMUP_PDF_RENDERER = "CHAT_EXPORT_AI_WARMUP_PDF_RENDERER";
  const MSG_SET_ACTION_ICON_THEME = "CHAT_EXPORT_AI_SET_ACTION_ICON_THEME";

  const MSG_OFFSCREEN_RENDER_HTML_TO_PDF = "CHAT_EXPORT_AI_OFFSCREEN_RENDER_HTML_TO_PDF";
  const MSG_OFFSCREEN_PDF_RENDER_RESULT = "CHAT_EXPORT_AI_OFFSCREEN_PDF_RENDER_RESULT";

  const OFFSCREEN_DOCUMENT_PATH = "src/background/offscreen-pdf.html";
  const DEFAULT_EXPORT_TIMEOUT_MS = 20000;
  const MAX_EXPORT_TIMEOUT_MS = 20000;
  const OFFSCREEN_IDLE_CLOSE_MS = 45000;

  const ACTION_ICON_PATHS = {
    default: {
      16: "src/assets/robot-download-16.png",
      32: "src/assets/robot-download-32.png",
      48: "src/assets/robot-download-48.png",
      128: "src/assets/robot-download-128.png"
    },
    light: {
      16: "src/assets/robot-download-light-16.png",
      32: "src/assets/robot-download-light-32.png",
      48: "src/assets/robot-download-light-48.png",
      128: "src/assets/robot-download-light-128.png"
    },
    dark: {
      16: "src/assets/robot-download-dark-16.png",
      32: "src/assets/robot-download-dark-32.png",
      48: "src/assets/robot-download-dark-48.png",
      128: "src/assets/robot-download-dark-128.png"
    }
  };

  let offscreenInitPromise = null;
  let offscreenIdleTimerId = null;
  let pdfRenderQueue = Promise.resolve();

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }

  function textToDataUrl(content, mimeType) {
    const safeMimeType = mimeType || "application/octet-stream";
    const bytes = new TextEncoder().encode(String(content || ""));
    return "data:" + safeMimeType + ";base64," + bytesToBase64(bytes);
  }

  async function blobToDataUrl(blob) {
    const buffer = await blob.arrayBuffer();
    const safeMimeType = blob.type || "application/octet-stream";
    return "data:" + safeMimeType + ";base64," + bytesToBase64(new Uint8Array(buffer));
  }

  function normalizeDownloadFilename(filename) {
    const rawValue = String(filename || "chat-export");
    const normalized = rawValue.normalize ? rawValue.normalize("NFC") : rawValue;
    const pathSegments = normalized
      .replace(/\\/g, "/")
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .filter((segment) => segment !== "." && segment !== "..")
      .map((segment) => {
        return segment
          .replace(/[<>:"|?*\u0000-\u001F]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      })
      .filter(Boolean);

    if (!pathSegments.length) {
      return "chat-export";
    }

    return pathSegments.join("/");
  }

  function normalizeConflictAction(value) {
    return value === "uniquify" ? "uniquify" : "overwrite";
  }

  function downloadByUrl(url, filename, saveAs = false, conflictAction = "overwrite") {
    return new Promise((resolve, reject) => {
      const downloadOptions = {
        url,
        filename: normalizeDownloadFilename(filename),
        saveAs: Boolean(saveAs)
      };

      if (!saveAs) {
        downloadOptions.conflictAction = normalizeConflictAction(conflictAction);
      }

      chrome.downloads.download(
        downloadOptions,
        (downloadId) => {
          const error = chrome.runtime.lastError;

          if (error) {
            reject(new Error(error.message));
            return;
          }

          resolve({
            ok: true,
            downloadId
          });
        }
      );
    });
  }

  async function downloadPdfData(base64Data, filename, saveAs = false, conflictAction = "overwrite") {
    return downloadByUrl(
      "data:application/pdf;base64," + base64Data,
      filename,
      saveAs,
      conflictAction
    );
  }

  function normalizeTimeoutMs(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return DEFAULT_EXPORT_TIMEOUT_MS;
    }

    return Math.min(MAX_EXPORT_TIMEOUT_MS, Math.max(1000, Math.round(numericValue)));
  }

  function withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      const timerId = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);

      Promise.resolve(promise)
        .then((value) => {
          clearTimeout(timerId);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timerId);
          reject(error);
        });
    });
  }

  function enqueuePdfTask(task) {
    const queued = pdfRenderQueue.then(task, task);
    pdfRenderQueue = queued.catch(() => {});
    return queued;
  }

  function getOffscreenDocumentUrl() {
    return chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  }

  async function getOffscreenContexts() {
    if (!chrome.runtime.getContexts) {
      return [];
    }

    return chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [getOffscreenDocumentUrl()]
    });
  }

  async function hasOffscreenDocument() {
    try {
      const contexts = await getOffscreenContexts();
      return Array.isArray(contexts) && contexts.length > 0;
    } catch (_error) {
      return false;
    }
  }

  function clearOffscreenIdleTimer() {
    if (!offscreenIdleTimerId) {
      return;
    }

    clearTimeout(offscreenIdleTimerId);
    offscreenIdleTimerId = null;
  }

  async function closeOffscreenDocument() {
    clearOffscreenIdleTimer();

    if (!chrome.offscreen?.closeDocument) {
      return;
    }

    try {
      if (await hasOffscreenDocument()) {
        await chrome.offscreen.closeDocument();
      }
    } catch (_error) {
      // Ignore close races.
    }
  }

  function scheduleOffscreenIdleClose() {
    clearOffscreenIdleTimer();
    offscreenIdleTimerId = setTimeout(() => {
      void closeOffscreenDocument();
    }, OFFSCREEN_IDLE_CLOSE_MS);
  }

  async function ensureOffscreenDocument(timeoutMs) {
    clearOffscreenIdleTimer();

    if (!chrome.offscreen?.createDocument) {
      throw new Error("Chrome offscreen API is not available.");
    }

    if (offscreenInitPromise) {
      await withTimeout(
        offscreenInitPromise,
        timeoutMs,
        "Timed out while preparing the offscreen PDF renderer."
      );
      return;
    }

    offscreenInitPromise = (async () => {
      if (await hasOffscreenDocument()) {
        return;
      }

      try {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_DOCUMENT_PATH,
          reasons: ["DOM_PARSER"],
          justification: "Render chat HTML to PDF without opening visible tabs."
        });
      } catch (error) {
        const message = String(error?.message || "");
        // Older Chrome builds may not expose runtime.getContexts, so tolerate
        // duplicate-create races for an already-open offscreen document.
        if (!/single offscreen|already exists/i.test(message)) {
          throw error;
        }
      }
    })();

    try {
      await withTimeout(
        offscreenInitPromise,
        timeoutMs,
        "Timed out while creating the offscreen PDF renderer."
      );
    } finally {
      offscreenInitPromise = null;
    }
  }

  function buildPdfRequestId() {
    return `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function requestPdfBase64FromOffscreen(html, timeoutMs) {
    const requestId = buildPdfRequestId();
    const safeTimeoutMs = normalizeTimeoutMs(timeoutMs);

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        chrome.runtime.onMessage.removeListener(handleMessage);
        reject(new Error("Timed out while rendering PDF in offscreen document."));
      }, safeTimeoutMs);

      const finalize = (fn) => (value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        chrome.runtime.onMessage.removeListener(handleMessage);
        fn(value);
      };

      const resolveOnce = finalize(resolve);
      const rejectOnce = finalize(reject);

      const handleMessage = (message) => {
        if (!message || message.type !== MSG_OFFSCREEN_PDF_RENDER_RESULT) {
          return;
        }

        const payload = message.payload || {};
        if (payload.requestId !== requestId) {
          return;
        }

        if (!payload.ok) {
          rejectOnce(new Error(payload.error || "Offscreen PDF rendering failed."));
          return;
        }

        const base64Data = String(payload.base64Data || "");
        if (!base64Data) {
          rejectOnce(new Error("Offscreen PDF renderer returned empty data."));
          return;
        }

        resolveOnce(base64Data);
      };

      chrome.runtime.onMessage.addListener(handleMessage);

      chrome.runtime.sendMessage({
        type: MSG_OFFSCREEN_RENDER_HTML_TO_PDF,
        payload: {
          requestId,
          html: String(html || ""),
          timeoutMs: safeTimeoutMs
        }
      }, () => {
        const error = chrome.runtime.lastError;
        if (!error) {
          return;
        }

        rejectOnce(new Error(error.message));
      });
    });
  }

  async function renderHtmlToPdf(payload) {
    if (!payload || !payload.filename || !payload.html) {
      throw new Error("Missing HTML or filename for PDF rendering.");
    }

    const timeoutMs = normalizeTimeoutMs(payload.timeoutMs);
    return enqueuePdfTask(async () => {
      await ensureOffscreenDocument(timeoutMs);
      const base64Data = await requestPdfBase64FromOffscreen(payload.html, timeoutMs);
      const result = await downloadPdfData(
        base64Data,
        payload.filename,
        payload.saveAs,
        payload.conflictAction
      );
      scheduleOffscreenIdleClose();
      return result;
    });
  }

  async function warmupPdfRenderer(payload) {
    const timeoutMs = normalizeTimeoutMs(payload?.timeoutMs);
    return enqueuePdfTask(async () => {
      await ensureOffscreenDocument(timeoutMs);
      scheduleOffscreenIdleClose();
      return { ok: true };
    });
  }

  function downloadBlobContent(payload) {
    if (!payload || !payload.filename) {
      return Promise.reject(new Error("Missing filename for download."));
    }

    return downloadByUrl(
      textToDataUrl(payload.content, payload.mimeType),
      payload.filename,
      payload.saveAs,
      payload.conflictAction
    );
  }

  function captureCurrentTabAsMhtml(senderTabId, filename) {
    return new Promise((resolve, reject) => {
      if (!senderTabId) {
        reject(new Error("No tabId received to capture MHTML."));
        return;
      }

      chrome.pageCapture.saveAsMHTML({ tabId: senderTabId }, (blob) => {
        const error = chrome.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
          return;
        }

        if (!blob) {
          reject(new Error("Could not generate the MHTML blob."));
          return;
        }

        blobToDataUrl(blob)
          .then((dataUrl) => downloadByUrl(dataUrl, filename || ("chat-export-capture-" + Date.now() + ".mht")))
          .then(resolve)
          .catch(reject);
      });
    });
  }

  function normalizeActionTheme(theme) {
    if (theme === "dark" || theme === "light") {
      return theme;
    }

    return "default";
  }

  function setActionIconTheme(theme) {
    return new Promise((resolve, reject) => {
      chrome.action.setIcon(
        { path: ACTION_ICON_PATHS[normalizeActionTheme(theme)] },
        () => {
          const error = chrome.runtime.lastError;

          if (error) {
            reject(new Error(error.message));
            return;
          }

          resolve({ ok: true });
        }
      );
    });
  }

  chrome.runtime.onInstalled.addListener(() => {
    void setActionIconTheme("default").catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => {
    void setActionIconTheme("default").catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === MSG_DOWNLOAD_FILE) {
      downloadBlobContent(message.payload)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    if (message.type === MSG_CAPTURE_TAB_MHTML) {
      captureCurrentTabAsMhtml(sender?.tab?.id, message.payload?.filename)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    if (message.type === MSG_RENDER_HTML_TO_PDF) {
      renderHtmlToPdf(message.payload)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    if (message.type === MSG_WARMUP_PDF_RENDERER) {
      warmupPdfRenderer(message.payload)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    if (message.type === MSG_SET_ACTION_ICON_THEME) {
      setActionIconTheme(message.payload?.theme)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    return false;
  });
})();
