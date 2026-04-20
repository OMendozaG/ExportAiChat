/*
 * Valores por defecto centralizados.
 * Se usan tanto en options como en content para garantizar comportamiento consistente.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { TEXT_FORMATTING, QUOTE_DIVIDER_STYLE, MEDIA_HANDLING, AI_NAME_MODE, MULTILINE_FORMAT } = root.constants;
  const { MAX_EXPORT_TIMEOUT_SECONDS } = root.constants;

  root.defaults = {
    settings: {
      // Nombre visible en el export para mensajes del usuario.
      humanName: "Human",

      // Nombre visible para IA: por nombre del proveedor o personalizado.
      aiNameMode: AI_NAME_MODE.PROVIDER,
      aiCustomName: "AI",

      // Formato de texto: limpiar formato o mantenerlo en Markdown.
      textFormatting: TEXT_FORMATTING.MARKDOWN,

      // Estilo común para blockquotes y líneas de separación.
      quoteDividerStyle: QUOTE_DIVIDER_STYLE.MARKDOWN,

      // Continuation style for multiline TXT/PDF exports.
      multilineFormat: MULTILINE_FORMAT.TAB,

      // Separator inserted between TXT message blocks.
      messageSeparator: "\n-----------------------------------\n",

      // Automatic file naming and default naming template.
      autoFileName: true,
      fileNameTemplate: "YY.MM.DD <ChatTitle>",
      invalidFileNameReplacement: ".",

      // Download mode: autosave directly or ask for location every time.
      saveMode: "autosave",

      // App chrome theme: auto follows the browser/system preference.
      appTheme: "auto",

      // Shared metadata toggles for TXT, HTML, MHT and PDF exports.
      metadataExportedAt: true,
      metadataDeviceUser: true,
      metadataFolder: false,
      metadataTitle: true,
      metadataModel: true,
      metadataUrl: false,

      // Include visible reasoning/thinking blocks when the provider exposes them.
      includeThinking: true,

      // Include the message time when the provider can extract it reliably.
      includeMessageTime: false,

      // Show the inline "Export To..." button in supported chat headers.
      showHeaderExportButton: true,
      showHeaderExportButtonChatgpt: true,

      // Per-export timeout in seconds. Clamped to MAX_EXPORT_TIMEOUT_SECONDS.
      exportTimeoutSeconds: MAX_EXPORT_TIMEOUT_SECONDS,

      // Visible export format buttons across popup and inline export menu.
      showExportPdf: true,
      showExportMht: true,
      showExportHtml: true,
      showExportTxt: true,

      // Gestión global de media/no texto.
      mediaHandling: MEDIA_HANDLING.PLACEHOLDER,

      // Si true y hay media con modo MHT, al exportar TXT/HTML genera MHT adicional.
      companionMhtOnMedia: true
    }
  };

  // Función de merge defensivo: rellena faltantes sin perder settings existentes.
  root.defaults.mergeSettings = (incoming) => {
    const next = { ...root.defaults.settings };

    if (!incoming || typeof incoming !== "object") {
      return next;
    }

    for (const [key, value] of Object.entries(incoming)) {
      if (value !== undefined) {
        next[key] = value;
      }
    }

    // Backward compatibility: the old global toggle becomes the ChatGPT toggle
    // if the provider-specific setting is not present in storage yet.
    if (
      incoming.showHeaderExportButtonChatgpt === undefined &&
      incoming.showHeaderExportButton !== undefined
    ) {
      next.showHeaderExportButtonChatgpt = Boolean(incoming.showHeaderExportButton);
    }

    const numericTimeout = Number(next.exportTimeoutSeconds);
    const safeTimeout = Number.isFinite(numericTimeout) ? numericTimeout : MAX_EXPORT_TIMEOUT_SECONDS;
    next.exportTimeoutSeconds = Math.min(
      MAX_EXPORT_TIMEOUT_SECONDS,
      Math.max(1, Math.round(safeTimeout))
    );

    return next;
  };
})();
