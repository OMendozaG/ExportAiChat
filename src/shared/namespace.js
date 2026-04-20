/*
 * Namespace global para evitar colisiones entre scripts clásicos (sin bundler).
 * Toda la extensión comparte el objeto ChatExportAi en cada contexto (content/popup/options).
 */
(() => {
  if (!globalThis.ChatExportAi) {
    globalThis.ChatExportAi = {};
  }

  // Metadatos de runtime útiles para debugging rápido.
  if (!globalThis.ChatExportAi.runtime) {
    globalThis.ChatExportAi.runtime = {
      namespace: "ChatExportAi",
      createdAt: Date.now()
    };
  }
})();
