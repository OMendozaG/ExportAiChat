/*
 * Shared post-processing for all providers.
 * It applies naming, metadata and final text conversion independently of provider DOM.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { ROLES, TEXT_FORMATTING, AI_NAME_MODE, METADATA_LABELS } = root.constants;

  function resolveNames(settings, provider) {
    const human = (settings.humanName || "Human").trim() || "Human";

    let ai = provider?.displayName || "AI";
    if (settings.aiNameMode === AI_NAME_MODE.CUSTOM) {
      ai = (settings.aiCustomName || "AI").trim() || "AI";
    }

    return { human, ai };
  }

  function getBrowserLabel() {
    const platform = navigator.userAgentData?.platform || navigator.platform || "Unknown";
    const brand = navigator.userAgentData?.brands?.map((item) => item.brand).join(", ");
    const userAgent = navigator.userAgent || "";
    const browser = brand || (userAgent.match(/(Chrome\/[0-9.]+|Firefox\/[0-9.]+|Safari\/[0-9.]+|Edg\/[0-9.]+)/) || [])[1] || userAgent || "Unknown";
    return `${platform} / ${browser}`;
  }

  function resolveSpeakerLabel(message, names) {
    let baseLabel = "Unknown";

    if (message.role === ROLES.HUMAN) {
      baseLabel = names.human;
    } else if (message.role === ROLES.ASSISTANT) {
      baseLabel = names.ai;
    } else if (message.role === ROLES.SYSTEM) {
      baseLabel = "System";
    }

    if (!message.isThinking) {
      return baseLabel;
    }

    if (message.thinkingSeconds) {
      return `${baseLabel} (Thinking+${message.thinkingSeconds}s)`;
    }

    return `${baseLabel} (Thinking)`;
  }

  function resolveMessageTimeLabel(message, settings) {
    if (!settings.includeMessageTime) {
      return "";
    }

    return String(message.timeLabel || "").trim();
  }

  function buildMetadata(rawConversation, settings, provider, extractedAtIso) {
    const items = [];
    const extractedAt = new Date(extractedAtIso);

    if (settings.metadataExportedAt) {
      items.push({
        label: METADATA_LABELS.EXPORTED_AT,
        value: new Intl.DateTimeFormat(undefined, {
          dateStyle: "short",
          timeStyle: "short"
        }).format(extractedAt)
      });
    }

    if (settings.metadataDeviceUser) {
      items.push({
        label: METADATA_LABELS.DEVICE_USER,
        value: getBrowserLabel()
      });
    }

    if (settings.metadataFolder) {
      items.push({
        label: METADATA_LABELS.FOLDER,
        value: rawConversation.folderName || ""
      });
    }

    if (settings.metadataTitle) {
      items.push({
        label: METADATA_LABELS.TITLE,
        value: rawConversation.title || document.title || "chat"
      });
    }

    if (settings.metadataModel) {
      items.push({
        label: METADATA_LABELS.MODEL,
        value: rawConversation.modelName || provider?.displayName || "Unknown"
      });
    }

    if (settings.metadataUrl) {
      items.push({
        label: METADATA_LABELS.URL,
        value: rawConversation.sourceUrl || location.href
      });
    }

    return items.filter((item) => item.value);
  }

  function processConversation(rawConversation, settings, provider) {
    const names = resolveNames(settings, provider);
    const extractedAtIso = new Date().toISOString();

    const processedMessages = (rawConversation.messages || [])
      .map((message, index) => {
        const safeHtml = message.safeHtml || "";
        const text = settings.textFormatting === TEXT_FORMATTING.MARKDOWN
          ? root.textConverter.htmlToMarkdown(safeHtml, settings)
          : root.textConverter.htmlToPlainText(safeHtml, settings);

        return {
          id: message.id || `msg-${index + 1}`,
          role: message.role || ROLES.UNKNOWN,
          speakerLabel: resolveSpeakerLabel(message, names),
          timeLabel: resolveMessageTimeLabel(message, settings),
          safeHtml,
          text,
          hasMedia: Boolean(message.hasMedia),
          isThinking: Boolean(message.isThinking),
          thinkingSeconds: message.thinkingSeconds || null
        };
      })
      .filter((message) => message.text || message.safeHtml);

    return {
      providerId: rawConversation.providerId,
      providerName: provider?.displayName || "Unknown Provider",
      sourceUrl: rawConversation.sourceUrl || location.href,
      folderName: rawConversation.folderName || "",
      title: rawConversation.title || document.title || "chat",
      modelName: rawConversation.modelName || provider?.displayName || "Unknown",
      extractedAtIso,
      settings,
      metadata: buildMetadata(rawConversation, settings, provider, extractedAtIso),
      names,
      hasMedia: processedMessages.some((message) => message.hasMedia),
      messages: processedMessages
    };
  }

  root.postProcess = {
    processConversation
  };
})();
