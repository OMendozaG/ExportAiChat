/*
 * Service worker for downloads and background-only browser operations.
 */
(() => {
  const MSG_DOWNLOAD_FILE = "CHAT_EXPORT_AI_DOWNLOAD_FILE";
  const MSG_CAPTURE_TAB_MHTML = "CHAT_EXPORT_AI_CAPTURE_TAB_MHTML";
  const MSG_RENDER_HTML_TO_PDF = "CHAT_EXPORT_AI_RENDER_HTML_TO_PDF";
  const MSG_SET_ACTION_ICON_THEME = "CHAT_EXPORT_AI_SET_ACTION_ICON_THEME";
  const DEBUGGER_VERSION = "1.3";
  const DEFAULT_EXPORT_TIMEOUT_MS = 20000;
  const MAX_EXPORT_TIMEOUT_MS = 20000;
  const ACTION_ICON_PATHS = {
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
    return rawValue.normalize ? rawValue.normalize("NFC") : rawValue;
  }

  function downloadByUrl(url, filename, saveAs = false) {
    return new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url,
          filename: normalizeDownloadFilename(filename),
          saveAs: Boolean(saveAs)
        },
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

  function createInactiveTab(url) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(
        {
          url,
          active: false
        },
        (tab) => {
          const error = chrome.runtime.lastError;

          if (error) {
            reject(new Error(error.message));
            return;
          }

          if (!tab || !tab.id) {
            reject(new Error("Could not create the temporary PDF tab."));
            return;
          }

          resolve(tab);
        }
      );
    });
  }

  function waitForTabComplete(tabId) {
    return new Promise((resolve, reject) => {
      if (!tabId) {
        reject(new Error("Missing tab id while waiting for PDF tab."));
        return;
      }

      chrome.tabs.get(tabId, (tab) => {
        const immediateError = chrome.runtime.lastError;

        if (immediateError) {
          reject(new Error(immediateError.message));
          return;
        }

        if (tab?.status === "complete") {
          resolve(tab);
          return;
        }

        const handleUpdate = (updatedTabId, changeInfo, updatedTab) => {
          if (updatedTabId !== tabId || changeInfo.status !== "complete") {
            return;
          }

          chrome.tabs.onUpdated.removeListener(handleUpdate);
          resolve(updatedTab);
        };

        chrome.tabs.onUpdated.addListener(handleUpdate);
      });
    });
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

  function removeTab(tabId) {
    return new Promise((resolve) => {
      if (!tabId) {
        resolve();
        return;
      }

      chrome.tabs.remove(tabId, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  function attachDebugger(target) {
    return new Promise((resolve, reject) => {
      chrome.debugger.attach(target, DEBUGGER_VERSION, () => {
        const error = chrome.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve();
      });
    });
  }

  function detachDebugger(target) {
    return new Promise((resolve) => {
      chrome.debugger.detach(target, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  function sendDebuggerCommand(target, method, params = {}) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(target, method, params, (result) => {
        const error = chrome.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(result);
      });
    });
  }

  function waitForDebuggerEvent(target, method) {
    return new Promise((resolve) => {
      const listener = (source, eventName, params) => {
        if (source?.tabId !== target?.tabId || eventName !== method) {
          return;
        }

        chrome.debugger.onEvent.removeListener(listener);
        resolve(params || {});
      };

      chrome.debugger.onEvent.addListener(listener);
    });
  }

  async function waitForPdfDocumentReady(target) {
    await sendDebuggerCommand(target, "Runtime.enable");
    await sendDebuggerCommand(target, "Emulation.setEmulatedMedia", { media: "print" });
    await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(
        async () => {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return true;
        }
      )()`,
      awaitPromise: true,
      returnByValue: true
    });
  }

  async function renderHtmlToPdf(payload) {
    if (!payload || !payload.filename || !payload.html) {
      throw new Error("Missing HTML or filename for PDF rendering.");
    }

    const timeoutMs = normalizeTimeoutMs(payload.timeoutMs);
    const tab = await createInactiveTab("about:blank");
    const target = { tabId: tab.id };
    let debuggerAttached = false;

    try {
      await withTimeout(
        waitForTabComplete(tab.id),
        timeoutMs,
        "Timed out while opening the temporary PDF tab."
      );

      await withTimeout(
        attachDebugger(target),
        timeoutMs,
        "Timed out while attaching the PDF renderer."
      );
      debuggerAttached = true;

      await withTimeout(
        sendDebuggerCommand(target, "Page.enable"),
        timeoutMs,
        "Timed out while preparing the PDF page."
      );

      await withTimeout(
        sendDebuggerCommand(target, "Page.navigate", {
          url: textToDataUrl(payload.html, "text/html;charset=utf-8")
        }),
        timeoutMs,
        "Timed out while navigating the PDF renderer."
      );

      await withTimeout(
        waitForDebuggerEvent(target, "Page.loadEventFired"),
        timeoutMs,
        "Timed out while waiting for the PDF page to finish loading."
      );

      await withTimeout(
        waitForPdfDocumentReady(target),
        timeoutMs,
        "Timed out while waiting for the PDF document to be ready."
      );

      const result = await withTimeout(
        sendDebuggerCommand(target, "Page.printToPDF", {
          printBackground: false,
          preferCSSPageSize: true,
          displayHeaderFooter: false
        }),
        timeoutMs,
        "Timed out while rendering the PDF."
      );

      if (!result?.data) {
        throw new Error("Chrome did not return PDF data.");
      }

      return withTimeout(
        downloadByUrl("data:application/pdf;base64," + result.data, payload.filename, payload.saveAs),
        timeoutMs,
        "Timed out while saving the PDF download."
      );
    } finally {
      if (debuggerAttached) {
        await detachDebugger(target);
      }

      await removeTab(tab.id);
    }
  }

  function downloadBlobContent(payload) {
    if (!payload || !payload.filename) {
      return Promise.reject(new Error("Missing filename for download."));
    }

    return downloadByUrl(
      textToDataUrl(payload.content, payload.mimeType),
      payload.filename,
      payload.saveAs
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
    return theme === "dark" ? "dark" : "light";
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
    void setActionIconTheme("light").catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => {
    void setActionIconTheme("light").catch(() => {});
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

    if (message.type === MSG_SET_ACTION_ICON_THEME) {
      setActionIconTheme(message.payload?.theme)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    return false;
  });
})();
