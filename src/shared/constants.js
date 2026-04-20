/*
 * Constantes compartidas para mantener contratos estables entre módulos.
 */
(() => {
  const root = globalThis.ChatExportAi;

  root.constants = {
    // Clave única para guardar configuración persistente.
    SETTINGS_STORAGE_KEY: "chatExportAi.settings.v1",

    // Hard cap for export timeout while the PDF pipeline is still conservative.
    MAX_EXPORT_TIMEOUT_SECONDS: 20,

    // Contrato de mensajes entre content/popup/background.
    MSG_DOWNLOAD_FILE: "CHAT_EXPORT_AI_DOWNLOAD_FILE",
    MSG_RENDER_HTML_TO_PDF: "CHAT_EXPORT_AI_RENDER_HTML_TO_PDF",
    MSG_CAPTURE_TAB_MHTML: "CHAT_EXPORT_AI_CAPTURE_TAB_MHTML",
    MSG_GET_CHAT_STATUS: "CHAT_EXPORT_AI_GET_CHAT_STATUS",
    MSG_EXPORT_CHAT: "CHAT_EXPORT_AI_EXPORT_CHAT",
    MSG_SET_ACTION_ICON_THEME: "CHAT_EXPORT_AI_SET_ACTION_ICON_THEME",

    // Export format contracts shared across content and popup.
    EXPORT_FORMATS: {
      PDF: "pdf",
      TXT: "txt",
      HTML: "html",
      MHT: "mht"
    },

    // Roles normalizados internos para desacoplar cada proveedor.
    ROLES: {
      HUMAN: "human",
      ASSISTANT: "assistant",
      SYSTEM: "system",
      UNKNOWN: "unknown"
    },

    // Estrategias de formato de texto.
    TEXT_FORMATTING: {
      CLEAN: "clean",
      MARKDOWN: "markdown"
    },

    // How TXT/PDF exports should format continuation lines in multiline messages.
    MULTILINE_FORMAT: {
      TAB: "tab",
      NAME: "name",
      NONE: "none"
    },

    // Shared metadata labels used in all export formats.
    METADATA_LABELS: {
      EXPORTED_AT: "Date",
      DEVICE_USER: "PC / User",
      FOLDER: "Chat Folder",
      TITLE: "Chat Title",
      MODEL: "Chat Model",
      URL: "Chat URL",
      PROVIDER: "Provider",
      CHAT_NAME: "Chat Name",
      MESSAGE_TOTAL: "Messages",
      START_TIME: "Start Time",
      END_TIME: "End Time",
      DURATION: "Duration"
    },

    // Estilo global para quotes y divisores en el postprocesado común.
    QUOTE_DIVIDER_STYLE: {
      MARKDOWN: "markdown",
      TABULAR: "tabular"
    },

    // Política global para media/elementos no textuales.
    MEDIA_HANDLING: {
      IGNORE: "ignore",
      PLACEHOLDER: "placeholder",
      MHT: "mht"
    },

    // Resolución del nombre mostrado para la IA.
    AI_NAME_MODE: {
      PROVIDER: "provider",
      CUSTOM: "custom"
    },

    // Theme mode for popup/options and extension-owned controls.
    APP_THEME: {
      AUTO: "auto",
      LIGHT: "light",
      DARK: "dark"
    }
  };
})();
