/*
 * Offscreen PDF renderer.
 * Receives HTML payloads, renders them with html2pdf.js and returns base64 PDF.
 */
(() => {
  const MSG_OFFSCREEN_RENDER_HTML_TO_PDF = "CHAT_EXPORT_AI_OFFSCREEN_RENDER_HTML_TO_PDF";
  const MSG_OFFSCREEN_PDF_RENDER_RESULT = "CHAT_EXPORT_AI_OFFSCREEN_PDF_RENDER_RESULT";
  const DEFAULT_TIMEOUT_MS = 20000;
  const rootNode = document.getElementById("offscreen-pdf-root");

  function normalizeTimeoutMs(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return DEFAULT_TIMEOUT_MS;
    }

    return Math.max(1000, Math.round(numericValue));
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sendRenderResult(requestId, ok, payload = {}) {
    try {
      chrome.runtime.sendMessage({
        type: MSG_OFFSCREEN_PDF_RENDER_RESULT,
        payload: {
          requestId,
          ok: Boolean(ok),
          ...payload
        }
      });
    } catch (_error) {
      // If the service worker is not listening momentarily, next request will retry.
    }
  }

  async function htmlToPdfBase64(html, timeoutMs) {
    if (!rootNode) {
      throw new Error("Offscreen PDF root node is missing.");
    }

    if (typeof globalThis.html2pdf !== "function") {
      throw new Error("html2pdf library is not loaded.");
    }

    const safeTimeoutMs = normalizeTimeoutMs(timeoutMs);
    let timeoutId = null;
    let iframe = null;

    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Offscreen HTML-to-PDF conversion timed out."));
        }, safeTimeoutMs);
      });

      const conversionPromise = (async () => {
        iframe = document.createElement("iframe");
        iframe.setAttribute("sandbox", "allow-same-origin");
        iframe.setAttribute("aria-hidden", "true");
        iframe.style.position = "fixed";
        iframe.style.left = "-240vw";
        iframe.style.top = "0";
        iframe.style.width = "1240px";
        iframe.style.height = "1754px";
        iframe.style.border = "0";
        iframe.style.opacity = "0";
        rootNode.appendChild(iframe);

        await new Promise((resolve, reject) => {
          const onLoad = () => {
            iframe.removeEventListener("load", onLoad);
            resolve();
          };
          const onError = () => {
            iframe.removeEventListener("error", onError);
            reject(new Error("Could not load offscreen HTML document."));
          };

          iframe.addEventListener("load", onLoad, { once: true });
          iframe.addEventListener("error", onError, { once: true });
          iframe.srcdoc = String(html || "");
        });

        // Give fonts/styles one frame to settle before rasterization.
        await delay(40);

        const sourceDocument = iframe.contentDocument;
        if (!sourceDocument) {
          throw new Error("Offscreen iframe content is not available.");
        }

        if (sourceDocument.fonts?.ready instanceof Promise) {
          try {
            await Promise.race([
              sourceDocument.fonts.ready.catch(() => null),
              delay(300)
            ]);
          } catch (_error) {
            // Keep exporting even if font readiness fails.
          }
        }

        const sourceNode = sourceDocument.documentElement || sourceDocument.body;
        if (!sourceNode) {
          throw new Error("Offscreen source node is empty.");
        }

        const dataUri = await globalThis.html2pdf()
          .set({
            // Leave printable whitespace around the page (top/sides/bottom).
            margin: [14, 12, 12, 12],
            image: { type: "jpeg", quality: 0.96 },
            html2canvas: {
              scale: 1.35,
              useCORS: true,
              logging: false,
              backgroundColor: "#ffffff"
            },
            jsPDF: {
              unit: "mm",
              format: "a4",
              orientation: "portrait",
              compress: true
            },
            pagebreak: {
              mode: ["css", "legacy"]
            }
          })
          .from(sourceNode)
          .outputPdf("datauristring");

        const base64Data = String(dataUri || "").split(",")[1] || "";
        if (!base64Data) {
          throw new Error("html2pdf returned empty PDF data.");
        }

        return base64Data;
      })();

      return await Promise.race([conversionPromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (iframe && iframe.parentElement) {
        iframe.remove();
      }
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MSG_OFFSCREEN_RENDER_HTML_TO_PDF) {
      return false;
    }

    const payload = message.payload || {};
    const requestId = String(payload.requestId || "");
    if (!requestId) {
      sendResponse?.({ ok: false, error: "Missing offscreen request id." });
      return false;
    }

    sendResponse?.({ ok: true });

    void htmlToPdfBase64(payload.html, payload.timeoutMs)
      .then((base64Data) => {
        sendRenderResult(requestId, true, { base64Data });
      })
      .catch((error) => {
        sendRenderResult(requestId, false, {
          error: String(error?.message || "Unknown offscreen PDF error.")
        });
      });

    return false;
  });
})();
