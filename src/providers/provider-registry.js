/*
 * Registro modular de proveedores LLM.
 * Cada proveedor aporta: match URL, detectar chat, extraer mensajes.
 */
(() => {
  const root = globalThis.ChatExportAi;

  const providers = [];

  function registerProvider(provider) {
    if (!provider || !provider.id) {
      throw new Error("Invalid provider: 'id' is required.");
    }

    providers.push(provider);
  }

  function getProviders() {
    return [...providers];
  }

  function findProviderForUrl(url) {
    if (!url) {
      return null;
    }

    return providers.find((provider) => {
      try {
        return provider.matchesUrl(url);
      } catch (_error) {
        return false;
      }
    }) || null;
  }

  root.providers = {
    registerProvider,
    getProviders,
    findProviderForUrl
  };
})();
