/*
 * Service worker for downloads and background-only browser operations.
 * PDF rendering uses a hidden extension tab + Chrome's print engine
 * so the exported PDF keeps HTML styling and selectable text.
 */
(() => {
  const MSG_DOWNLOAD_FILE = "CHAT_EXPORT_AI_DOWNLOAD_FILE";
  const MSG_CAPTURE_TAB_MHTML = "CHAT_EXPORT_AI_CAPTURE_TAB_MHTML";
  const MSG_RENDER_HTML_TO_PDF = "CHAT_EXPORT_AI_RENDER_HTML_TO_PDF";
  const MSG_WARMUP_PDF_RENDERER = "CHAT_EXPORT_AI_WARMUP_PDF_RENDERER";
  const MSG_SET_ACTION_ICON_THEME = "CHAT_EXPORT_AI_SET_ACTION_ICON_THEME";

  const PORT_PDF_RENDER_TAB = "CHAT_EXPORT_AI_PDF_RENDER_TAB_PORT";
  const MSG_PDF_TAB_LOAD_HTML = "CHAT_EXPORT_AI_PDF_TAB_LOAD_HTML";
  const MSG_PDF_TAB_HTML_READY = "CHAT_EXPORT_AI_PDF_TAB_HTML_READY";

  const PDF_RENDER_TAB_PATH = "src/background/pdf-render-tab.html";
  const DEFAULT_EXPORT_TIMEOUT_MS = 20000;
  const MAX_EXPORT_TIMEOUT_MS = 20000;
  const PDF_RENDER_TAB_IDLE_CLOSE_MS = 45000;

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

  let pdfRenderQueue = Promise.resolve();
  let pdfRenderTabId = null;
  let pdfRenderTabPort = null;
  let pdfRenderTabInitPromise = null;
  let pdfRenderTabIdleTimerId = null;
  let pdfRenderTabPortWaiters = [];

  const pendingPdfTabLoads = new Map();

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

      chrome.downloads.download(downloadOptions, (downloadId) => {
        const error = chrome.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve({
          ok: true,
          downloadId
        });
      });
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

  function buildPdfRequestId() {
    return `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function createTab(options) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(options, (tab) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(tab);
      });
    });
  }

  function getTab(tabId) {
    return new Promise((resolve) => {
      if (!Number.isInteger(tabId)) {
        resolve(null);
        return;
      }

      chrome.tabs.get(tabId, (tab) => {
        const error = chrome.runtime.lastError;
        if (error || !tab) {
          resolve(null);
          return;
        }

        resolve(tab);
      });
    });
  }

  function removeTab(tabId) {
    return new Promise((resolve) => {
      if (!Number.isInteger(tabId)) {
        resolve();
        return;
      }

      chrome.tabs.remove(tabId, () => {
        // Ignore races where the tab has already closed.
        resolve();
      });
    });
  }

  function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId = null;

      const finalize = (fn, value) => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        chrome.tabs.onUpdated.removeListener(onUpdated);
        fn(value);
      };

      const onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") {
          return;
        }

        finalize(resolve);
      };

      timeoutId = setTimeout(() => {
        finalize(reject, new Error("Timed out while loading the hidden PDF render tab."));
      }, timeoutMs);

      chrome.tabs.get(tabId, (tab) => {
        const getError = chrome.runtime.lastError;
        if (getError || !tab) {
          finalize(reject, new Error("PDF render tab is not available."));
          return;
        }

        if (tab.status === "complete") {
          finalize(resolve);
          return;
        }

        chrome.tabs.onUpdated.addListener(onUpdated);
      });
    });
  }

  function rejectPdfTabPortWaiters(error) {
    const waiters = pdfRenderTabPortWaiters.slice();
    pdfRenderTabPortWaiters = [];

    waiters.forEach((waiter) => {
      try {
        waiter.reject(error);
      } catch (_ignored) {
        // Ignore waiter listener failures.
      }
    });
  }

  function resolvePdfTabPortWaiters(port, tabId) {
    const remaining = [];

    pdfRenderTabPortWaiters.forEach((waiter) => {
      if (waiter.tabId !== tabId) {
        remaining.push(waiter);
        return;
      }

      try {
        waiter.resolve(port);
      } catch (_ignored) {
        // Ignore waiter listener failures.
      }
    });

    pdfRenderTabPortWaiters = remaining;
  }

  function waitForPdfRenderTabPort(tabId, timeoutMs) {
    if (pdfRenderTabPort && pdfRenderTabId === tabId) {
      return Promise.resolve(pdfRenderTabPort);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pdfRenderTabPortWaiters = pdfRenderTabPortWaiters.filter((waiter) => waiter !== entry);
        reject(new Error("Timed out while connecting to hidden PDF render tab."));
      }, timeoutMs);

      const entry = {
        tabId,
        resolve: (port) => {
          clearTimeout(timeoutId);
          resolve(port);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      };

      pdfRenderTabPortWaiters.push(entry);
    });
  }

  function rejectPendingPdfTabLoads(error) {
    const pending = Array.from(pendingPdfTabLoads.values());
    pendingPdfTabLoads.clear();

    pending.forEach((entry) => {
      clearTimeout(entry.timeoutId);
      entry.reject(error);
    });
  }

  function clearPdfRenderTabIdleTimer() {
    if (!pdfRenderTabIdleTimerId) {
      return;
    }

    clearTimeout(pdfRenderTabIdleTimerId);
    pdfRenderTabIdleTimerId = null;
  }

  async function closePdfRenderTab() {
    clearPdfRenderTabIdleTimer();

    const tabIdToClose = pdfRenderTabId;
    pdfRenderTabId = null;
    pdfRenderTabPort = null;

    rejectPendingPdfTabLoads(new Error("Hidden PDF render tab closed before completion."));
    rejectPdfTabPortWaiters(new Error("Hidden PDF render tab closed before connection."));

    if (Number.isInteger(tabIdToClose)) {
      await removeTab(tabIdToClose);
    }
  }

  function schedulePdfRenderTabIdleClose() {
    clearPdfRenderTabIdleTimer();
    pdfRenderTabIdleTimerId = setTimeout(() => {
      void closePdfRenderTab();
    }, PDF_RENDER_TAB_IDLE_CLOSE_MS);
  }

  async function ensurePdfRenderTab(timeoutMs) {
    clearPdfRenderTabIdleTimer();

    if (pdfRenderTabInitPromise) {
      return withTimeout(
        pdfRenderTabInitPromise,
        timeoutMs,
        "Timed out while preparing hidden PDF render tab."
      );
    }

    pdfRenderTabInitPromise = (async () => {
      if (Number.isInteger(pdfRenderTabId)) {
        const existingTab = await getTab(pdfRenderTabId);
        if (existingTab) {
          if (existingTab.status !== "complete") {
            await waitForTabComplete(pdfRenderTabId, timeoutMs);
          }

          await waitForPdfRenderTabPort(pdfRenderTabId, timeoutMs);
          return pdfRenderTabId;
        }

        pdfRenderTabId = null;
        pdfRenderTabPort = null;
      }

      const renderTabUrl = chrome.runtime.getURL(PDF_RENDER_TAB_PATH);
      const createdTab = await createTab({
        url: renderTabUrl,
        active: false
      });

      const createdTabId = Number(createdTab?.id);
      if (!Number.isInteger(createdTabId)) {
        throw new Error("Could not create hidden PDF render tab.");
      }

      pdfRenderTabId = createdTabId;
      pdfRenderTabPort = null;

      await waitForTabComplete(createdTabId, timeoutMs);
      await waitForPdfRenderTabPort(createdTabId, timeoutMs);
      return createdTabId;
    })();

    try {
      return await withTimeout(
        pdfRenderTabInitPromise,
        timeoutMs,
        "Timed out while creating hidden PDF render tab."
      );
    } finally {
      pdfRenderTabInitPromise = null;
    }
  }

  function requestPdfTabHtmlLoad(html, timeoutMs) {
    const requestId = buildPdfRequestId();

    return new Promise((resolve, reject) => {
      const port = pdfRenderTabPort;
      if (!port || !Number.isInteger(pdfRenderTabId)) {
        reject(new Error("Hidden PDF render tab is not connected."));
        return;
      }

      const timeoutId = setTimeout(() => {
        pendingPdfTabLoads.delete(requestId);
        reject(new Error("Timed out while preparing HTML inside hidden PDF render tab."));
      }, timeoutMs);

      pendingPdfTabLoads.set(requestId, {
        timeoutId,
        resolve,
        reject
      });

      try {
        port.postMessage({
          type: MSG_PDF_TAB_LOAD_HTML,
          payload: {
            requestId,
            html: String(html || "")
          }
        });
      } catch (error) {
        clearTimeout(timeoutId);
        pendingPdfTabLoads.delete(requestId);
        reject(new Error(String(error?.message || "Failed to send HTML to hidden PDF render tab.")));
      }
    });
  }

  function debuggerAttach(tabId) {
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, "1.3", () => {
        const error = chrome.runtime.lastError;
        if (error) {
          if (/already attached/i.test(String(error.message || ""))) {
            resolve();
            return;
          }

          reject(new Error(error.message));
          return;
        }

        resolve();
      });
    });
  }

  function debuggerDetach(tabId) {
    return new Promise((resolve) => {
      chrome.debugger.detach({ tabId }, () => {
        resolve();
      });
    });
  }

  function debuggerSendCommand(tabId, method, params = {}) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(result || {});
      });
    });
  }

  async function printPdfFromRenderTab(tabId, timeoutMs) {
    return withTimeout(
      (async () => {
        let attached = false;

        try {
          await debuggerAttach(tabId);
          attached = true;

          await debuggerSendCommand(tabId, "Page.enable");
          await debuggerSendCommand(tabId, "Emulation.setEmulatedMedia", {
            media: "print"
          });

          const result = await debuggerSendCommand(tabId, "Page.printToPDF", {
            printBackground: true,
            preferCSSPageSize: true,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            transferMode: "ReturnAsBase64"
          });

          const base64Data = String(result?.data || "");
          if (!base64Data) {
            throw new Error("Page.printToPDF returned empty data.");
          }

          return base64Data;
        } finally {
          if (attached) {
            await debuggerDetach(tabId).catch(() => {});
          }
        }
      })(),
      timeoutMs,
      "Timed out while rendering PDF with the hidden print tab."
    );
  }

  async function renderHtmlToPdf(payload) {
    if (!payload || !payload.filename || !payload.html) {
      throw new Error("Missing HTML or filename for PDF rendering.");
    }

    const timeoutMs = normalizeTimeoutMs(payload.timeoutMs);
    return enqueuePdfTask(async () => {
      try {
        const tabId = await ensurePdfRenderTab(timeoutMs);
        await requestPdfTabHtmlLoad(payload.html, timeoutMs);
        const base64Data = await printPdfFromRenderTab(tabId, timeoutMs);

        return downloadPdfData(
          base64Data,
          payload.filename,
          payload.saveAs,
          payload.conflictAction
        );
      } finally {
        schedulePdfRenderTabIdleClose();
      }
    });
  }

  async function warmupPdfRenderer(payload) {
    const timeoutMs = normalizeTimeoutMs(payload?.timeoutMs);

    return enqueuePdfTask(async () => {
      await ensurePdfRenderTab(timeoutMs);
      schedulePdfRenderTabIdleClose();
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

  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== PORT_PDF_RENDER_TAB) {
      return;
    }

    const senderTabId = Number(port.sender?.tab?.id);
    if (!Number.isInteger(senderTabId)) {
      port.disconnect();
      return;
    }

    pdfRenderTabId = senderTabId;
    pdfRenderTabPort = port;
    resolvePdfTabPortWaiters(port, senderTabId);

    port.onMessage.addListener((message) => {
      if (!message || message.type !== MSG_PDF_TAB_HTML_READY) {
        return;
      }

      const payload = message.payload || {};
      const requestId = String(payload.requestId || "");
      if (!requestId) {
        return;
      }

      const pending = pendingPdfTabLoads.get(requestId);
      if (!pending) {
        return;
      }

      pendingPdfTabLoads.delete(requestId);
      clearTimeout(pending.timeoutId);

      if (!payload.ok) {
        pending.reject(new Error(payload.error || "Hidden PDF render tab failed to apply HTML."));
        return;
      }

      pending.resolve();
    });

    port.onDisconnect.addListener(() => {
      if (pdfRenderTabPort === port) {
        pdfRenderTabPort = null;
      }

      rejectPendingPdfTabLoads(new Error("Hidden PDF render tab disconnected."));
      rejectPdfTabPortWaiters(new Error("Hidden PDF render tab disconnected."));
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId !== pdfRenderTabId) {
      return;
    }

    pdfRenderTabId = null;
    pdfRenderTabPort = null;
    rejectPendingPdfTabLoads(new Error("Hidden PDF render tab was closed."));
    rejectPdfTabPortWaiters(new Error("Hidden PDF render tab was closed."));
  });

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
