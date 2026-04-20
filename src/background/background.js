/*
 * Service worker for downloads and background-only browser operations.
 */
(() => {
  const MSG_DOWNLOAD_FILE = "CHAT_EXPORT_AI_DOWNLOAD_FILE";
  const MSG_CAPTURE_TAB_MHTML = "CHAT_EXPORT_AI_CAPTURE_TAB_MHTML";
  const MSG_RENDER_HTML_TO_PDF = "CHAT_EXPORT_AI_RENDER_HTML_TO_PDF";
  const DEBUGGER_VERSION = "1.3";

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

  function downloadByUrl(url, filename, saveAs = false) {
    return new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url,
          filename,
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
      chrome.tabs.get(tabId, (tab) => {
        const initialError = chrome.runtime.lastError;

        if (initialError) {
          reject(new Error(initialError.message));
          return;
        }

        if (tab?.status === "complete") {
          resolve();
          return;
        }

        const timeoutId = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(handleUpdated);
          reject(new Error("Timed out while waiting for the PDF tab to load."));
        }, 15000);

        function handleUpdated(updatedTabId, changeInfo) {
          if (updatedTabId !== tabId || changeInfo.status !== "complete") {
            return;
          }

          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(handleUpdated);
          resolve();
        }

        chrome.tabs.onUpdated.addListener(handleUpdated);
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

  async function waitForPdfDocumentReady(target) {
    await sendDebuggerCommand(target, "Runtime.enable");
    await sendDebuggerCommand(target, "Emulation.setEmulatedMedia", { media: "print" });
    await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(
        async () => {
          if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
          }

          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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

    const tab = await createInactiveTab("about:blank");
    const target = { tabId: tab.id };
    let debuggerAttached = false;

    try {
      await attachDebugger(target);
      debuggerAttached = true;

      await sendDebuggerCommand(target, "Page.enable");
      const frameTree = await sendDebuggerCommand(target, "Page.getFrameTree");
      const frameId = frameTree?.frameTree?.frame?.id;

      if (!frameId) {
        throw new Error("Could not resolve the PDF frame id.");
      }

      await sendDebuggerCommand(target, "Page.setDocumentContent", {
        frameId,
        html: payload.html
      });

      await waitForPdfDocumentReady(target);

      const result = await sendDebuggerCommand(target, "Page.printToPDF", {
        printBackground: false,
        preferCSSPageSize: true,
        displayHeaderFooter: false
      });

      if (!result?.data) {
        throw new Error("Chrome did not return PDF data.");
      }

      return downloadByUrl("data:application/pdf;base64," + result.data, payload.filename, payload.saveAs);
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

    return false;
  });
})();
