/*
 * Service worker for downloads and background-only browser operations.
 */
(() => {
  const MSG_DOWNLOAD_FILE = "CHAT_EXPORT_AI_DOWNLOAD_FILE";
  const MSG_CAPTURE_TAB_MHTML = "CHAT_EXPORT_AI_CAPTURE_TAB_MHTML";
  const MSG_RENDER_HTML_TO_PDF = "CHAT_EXPORT_AI_RENDER_HTML_TO_PDF";
  const MSG_WARMUP_PDF_RENDERER = "CHAT_EXPORT_AI_WARMUP_PDF_RENDERER";
  const MSG_SET_ACTION_ICON_THEME = "CHAT_EXPORT_AI_SET_ACTION_ICON_THEME";
  const DEBUGGER_VERSION = "1.3";
  const DEFAULT_EXPORT_TIMEOUT_MS = 20000;
  const MAX_EXPORT_TIMEOUT_MS = 20000;
  const PDF_RENDERER_IDLE_CLOSE_MS = 45000;
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

  const pdfRenderer = {
    tabId: null,
    target: null,
    frameId: null,
    debuggerAttached: false,
    warmupPromise: null,
    idleTimerId: null
  };
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

  function base64ToBlob(base64, mimeType) {
    const binary = atob(String(base64 || ""));
    const chunkSize = 0x8000;
    const chunks = [];

    for (let offset = 0; offset < binary.length; offset += chunkSize) {
      const slice = binary.slice(offset, offset + chunkSize);
      const bytes = new Uint8Array(slice.length);

      for (let index = 0; index < slice.length; index += 1) {
        bytes[index] = slice.charCodeAt(index);
      }

      chunks.push(bytes);
    }

    return new Blob(chunks, { type: mimeType || "application/octet-stream" });
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
    // Use a direct data URL for PDF downloads.
    // This avoids blob-URL lifecycle races in service workers.
    return downloadByUrl(
      "data:application/pdf;base64," + base64Data,
      filename,
      saveAs,
      conflictAction
    );
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

  async function getMainFrameId(target) {
    const frameTree = await sendDebuggerCommand(target, "Page.getFrameTree");
    return frameTree?.frameTree?.frame?.id || null;
  }

  function clearPdfRendererIdleTimer() {
    if (!pdfRenderer.idleTimerId) {
      return;
    }

    clearTimeout(pdfRenderer.idleTimerId);
    pdfRenderer.idleTimerId = null;
  }

  function schedulePdfRendererIdleClose() {
    clearPdfRendererIdleTimer();
    pdfRenderer.idleTimerId = setTimeout(() => {
      void disposePdfRenderer();
    }, PDF_RENDERER_IDLE_CLOSE_MS);
  }

  function resetPdfRendererState() {
    pdfRenderer.tabId = null;
    pdfRenderer.target = null;
    pdfRenderer.frameId = null;
    pdfRenderer.debuggerAttached = false;
    pdfRenderer.warmupPromise = null;
  }

  function getTab(tabId) {
    return new Promise((resolve) => {
      if (!tabId) {
        resolve(null);
        return;
      }

      chrome.tabs.get(tabId, (tab) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve(null);
          return;
        }

        resolve(tab || null);
      });
    });
  }

  async function disposePdfRenderer() {
    clearPdfRendererIdleTimer();

    const currentTabId = pdfRenderer.tabId;
    const currentTarget = pdfRenderer.target;
    const wasAttached = pdfRenderer.debuggerAttached;
    resetPdfRendererState();

    if (wasAttached && currentTarget) {
      try {
        await detachDebugger(currentTarget);
      } catch (_error) {
        // Renderer detach can fail if the tab was already destroyed.
      }
    }

    if (currentTabId) {
      await removeTab(currentTabId);
    }
  }

  async function ensurePdfRenderer(timeoutMs) {
    clearPdfRendererIdleTimer();

    if (pdfRenderer.warmupPromise) {
      await withTimeout(
        pdfRenderer.warmupPromise,
        timeoutMs,
        "Timed out while preparing the shared PDF renderer."
      );
      return;
    }

    pdfRenderer.warmupPromise = (async () => {
      let reusableTab = await getTab(pdfRenderer.tabId);

      if (!reusableTab) {
        if (pdfRenderer.debuggerAttached && pdfRenderer.target) {
          try {
            await detachDebugger(pdfRenderer.target);
          } catch (_error) {
            // Ignore stale detach failures; renderer state is reset below.
          }
        }

        resetPdfRendererState();

        const createdTab = await createInactiveTab("about:blank");
        await waitForTabComplete(createdTab.id);
        reusableTab = createdTab;
        pdfRenderer.tabId = createdTab.id;
        pdfRenderer.target = { tabId: createdTab.id };
      } else {
        pdfRenderer.tabId = reusableTab.id;
        if (!pdfRenderer.target || pdfRenderer.target.tabId !== reusableTab.id) {
          pdfRenderer.target = { tabId: reusableTab.id };
        }
      }

      if (!pdfRenderer.debuggerAttached) {
        await attachDebugger(pdfRenderer.target);
        pdfRenderer.debuggerAttached = true;

        await sendDebuggerCommand(pdfRenderer.target, "Page.enable");
        await sendDebuggerCommand(pdfRenderer.target, "Runtime.enable");
        await sendDebuggerCommand(pdfRenderer.target, "Emulation.setEmulatedMedia", { media: "print" });
      }

      const frameId = await getMainFrameId(pdfRenderer.target);
      if (!frameId) {
        throw new Error("Could not resolve the PDF frame.");
      }

      pdfRenderer.frameId = frameId;
    })();

    try {
      await withTimeout(
        pdfRenderer.warmupPromise,
        timeoutMs,
        "Timed out while preparing the shared PDF renderer."
      );
    } finally {
      pdfRenderer.warmupPromise = null;
    }
  }

  async function waitForPdfDocumentReady(target) {
    await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(
        async () => {
          if (document.readyState !== "complete") {
            try {
              await Promise.race([
                new Promise((resolve) => window.addEventListener("load", () => resolve(), { once: true })),
                new Promise((resolve) => setTimeout(resolve, 350))
              ]);
            } catch (_error) {
              // Continue; print pipeline can still complete on partial load.
            }
          }

          if (document.fonts?.ready instanceof Promise) {
            try {
              await Promise.race([
                document.fonts.ready.catch(() => null),
                new Promise((resolve) => setTimeout(resolve, 350))
              ]);
            } catch (_error) {
              // Ignore font readiness errors and keep rendering.
            }
          }

          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

          return {
            readyState: document.readyState,
            hasBody: Boolean(document.body),
            textLength: document.body?.innerText?.length || 0
          };
        }
      )()`,
      awaitPromise: true,
      returnByValue: true
    });
  }

  function enqueuePdfTask(task) {
    const queued = pdfRenderQueue.then(task, task);
    pdfRenderQueue = queued.catch(() => {});
    return queued;
  }

  async function renderHtmlToPdfOnce(payload) {
    if (!payload || !payload.filename || !payload.html) {
      throw new Error("Missing HTML or filename for PDF rendering.");
    }

    const timeoutMs = normalizeTimeoutMs(payload.timeoutMs);
    await withTimeout(
      ensurePdfRenderer(timeoutMs),
      timeoutMs,
      "Timed out while preparing the shared PDF renderer."
    );

    const target = pdfRenderer.target;
    if (!target) {
      throw new Error("Could not prepare a PDF target.");
    }

    const frameId = await withTimeout(
      getMainFrameId(target),
      timeoutMs,
      "Timed out while locating the PDF frame."
    );

    if (!frameId) {
      throw new Error("Could not resolve the PDF frame.");
    }
    pdfRenderer.frameId = frameId;

    await withTimeout(
      sendDebuggerCommand(target, "Page.setDocumentContent", {
        frameId,
        html: String(payload.html || "")
      }),
      timeoutMs,
      "Timed out while setting the PDF document content."
    );

    await withTimeout(
      waitForPdfDocumentReady(target),
      timeoutMs,
      "Timed out while waiting for the PDF document to be ready."
    );

    const result = await withTimeout(
      sendDebuggerCommand(target, "Page.printToPDF", {
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false
      }),
      timeoutMs,
      "Timed out while rendering the PDF."
    );

    if (!result?.data) {
      throw new Error("Chrome did not return PDF data.");
    }

    const downloadResult = await withTimeout(
      downloadPdfData(
        result.data,
        payload.filename,
        payload.saveAs,
        payload.conflictAction
      ),
      timeoutMs,
      "Timed out while saving the PDF download."
    );

    schedulePdfRendererIdleClose();
    return downloadResult;
  }

  async function renderHtmlToPdf(payload) {
    return enqueuePdfTask(async () => {
      try {
        return await renderHtmlToPdfOnce(payload);
      } catch (error) {
        const message = String(error?.message || "");
        const isRecoverable = /no tab with id|target closed|target not found|detached|cannot access|inspected target navigated/i.test(message);
        if (!isRecoverable) {
          throw error;
        }

        await disposePdfRenderer();
        return renderHtmlToPdfOnce(payload);
      }
    });
  }

  async function warmupPdfRenderer(payload) {
    const timeoutMs = normalizeTimeoutMs(payload?.timeoutMs);
    return enqueuePdfTask(async () => {
      await withTimeout(
        ensurePdfRenderer(timeoutMs),
        timeoutMs,
        "Timed out while warming up the PDF renderer."
      );
      schedulePdfRendererIdleClose();
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
