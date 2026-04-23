/*
 * Hidden PDF render tab worker.
 * Receives full HTML documents from the background service worker, applies them
 * to this tab DOM, then notifies when print layout resources are ready.
 */
(() => {
  const PORT_NAME = "CHAT_EXPORT_AI_PDF_RENDER_TAB_PORT";
  const MSG_LOAD_HTML = "CHAT_EXPORT_AI_PDF_TAB_LOAD_HTML";
  const MSG_HTML_READY = "CHAT_EXPORT_AI_PDF_TAB_HTML_READY";
  const MAX_ASSET_WAIT_MS = 1500;

  const port = chrome.runtime.connect({ name: PORT_NAME });

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeHtml(value) {
    return String(value || "");
  }

  function removeManagedNodes() {
    Array.from(document.querySelectorAll("[data-ceai-pdf-managed='1']")).forEach((node) => {
      node.remove();
    });
  }

  function cloneAsManaged(node) {
    const clone = node.cloneNode(true);
    if (clone.nodeType === Node.ELEMENT_NODE) {
      clone.setAttribute("data-ceai-pdf-managed", "1");
    }
    return clone;
  }

  async function waitForFonts() {
    const fontsReady = document.fonts?.ready;
    if (!(fontsReady instanceof Promise)) {
      return;
    }

    await Promise.race([
      fontsReady.catch(() => null),
      delay(MAX_ASSET_WAIT_MS)
    ]);
  }

  async function waitForImages() {
    const pendingImages = Array.from(document.images || []).filter((imageNode) => !imageNode.complete);
    if (!pendingImages.length) {
      return;
    }

    await Promise.race([
      Promise.all(
        pendingImages.map((imageNode) => {
          return new Promise((resolve) => {
            imageNode.addEventListener("load", resolve, { once: true });
            imageNode.addEventListener("error", resolve, { once: true });
          });
        })
      ),
      delay(MAX_ASSET_WAIT_MS)
    ]);
  }

  async function applyHtmlDocument(html) {
    const source = normalizeHtml(html);
    const parsed = new DOMParser().parseFromString(source, "text/html");

    removeManagedNodes();

    // Keep incoming root attributes to preserve provider/theme language flags.
    document.documentElement.lang = parsed.documentElement.getAttribute("lang") || "en";
    document.documentElement.className = parsed.documentElement.getAttribute("class") || "";

    const title = parsed.querySelector("title")?.textContent;
    document.title = title || "Chat Export AI";

    // Rebuild incoming head content while skipping scripts and non-element nodes.
    Array.from(parsed.head.children).forEach((node) => {
      if (node.tagName.toLowerCase() === "script") {
        return;
      }

      document.head.appendChild(cloneAsManaged(node));
    });

    // Replace body content with the provided printable document body.
    document.body.textContent = "";
    Array.from(parsed.body.childNodes).forEach((node) => {
      document.body.appendChild(cloneAsManaged(node));
    });

    await waitForFonts();
    await waitForImages();
    await delay(30);
  }

  function replyReady(payload) {
    try {
      port.postMessage({
        type: MSG_HTML_READY,
        payload
      });
    } catch (_error) {
      // Port may be gone if the render tab was closed.
    }
  }

  port.onMessage.addListener((message) => {
    if (!message || message.type !== MSG_LOAD_HTML) {
      return;
    }

    const payload = message.payload || {};
    const requestId = String(payload.requestId || "");
    if (!requestId) {
      replyReady({
        requestId,
        ok: false,
        error: "Missing PDF tab request id."
      });
      return;
    }

    void applyHtmlDocument(payload.html)
      .then(() => {
        replyReady({
          requestId,
          ok: true
        });
      })
      .catch((error) => {
        replyReady({
          requestId,
          ok: false,
          error: String(error?.message || "Failed to prepare PDF HTML in render tab.")
        });
      });
  });
})();
