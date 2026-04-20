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

  function formatDateTime(timestampMs) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(timestampMs));
  }

  function formatDuration(durationMs) {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];

    if (hours) {
      parts.push(`${hours}h`);
    }

    if (hours || minutes) {
      parts.push(`${String(minutes).padStart(hours ? 2 : 1, "0")}m`);
    }

    parts.push(`${String(seconds).padStart(hours || minutes ? 2 : 1, "0")}s`);
    return parts.join(" ");
  }

  function escapeReferenceLine(value) {
    return root.sanitize.escapeHtml(String(value || ""));
  }

  function buildReferenceDescriptor(reference) {
    const label = String(reference?.label || "").trim();
    const url = String(reference?.url || "").trim();

    if (label && url && label !== url) {
      return `${label} - ${url}`;
    }

    return label || url;
  }

  function prependUserAttachmentLines(safeHtml, attachments) {
    const visibleAttachments = dedupeVisibleReferences(attachments);

    if (!visibleAttachments.length) {
      return safeHtml;
    }

    const lines = visibleAttachments
      .map((attachment) => buildReferenceDescriptor(attachment))
      .filter(Boolean)
      .map((text) => `<p>[${escapeReferenceLine(text)}]</p>`)
      .join("");

    return `${lines}${safeHtml}`;
  }

  function appendAssistantReferenceLines(safeHtml, references) {
    const hiddenReferences = filterHiddenReferences(safeHtml, references);

    if (!hiddenReferences.length) {
      return safeHtml;
    }

    const lines = hiddenReferences
      .map((reference) => buildReferenceDescriptor(reference))
      .filter(Boolean)
      .map((text) => `<p>[${escapeReferenceLine(text)}]</p>`)
      .join("");

    return `${safeHtml}${lines}`;
  }

  function filterHiddenReferences(safeHtml, references) {
    const haystack = String(safeHtml || "").toLowerCase();

    return (references || []).filter((reference) => {
      const label = String(reference?.label || "").trim().toLowerCase();
      const url = String(reference?.url || "").trim().toLowerCase();

      if (label && haystack.includes(label)) {
        return false;
      }

      if (url && haystack.includes(url)) {
        return false;
      }

      return Boolean(label || url);
    });
  }

  function dedupeVisibleReferences(references) {
    const seen = new Set();

    return (references || []).filter((reference) => {
      const descriptor = buildReferenceDescriptor(reference).toLowerCase();
      if (!descriptor || seen.has(descriptor)) {
        return false;
      }

      seen.add(descriptor);
      return true;
    });
  }

  function resolveSpeakerLabel(message, names, settings) {
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

    if (settings.includeThinkingDuration && message.thinkingSeconds) {
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

  function countMessages(messages) {
    const totalMessages = messages.length;
    const userMessages = messages.filter((message) => message.role === ROLES.HUMAN).length;
    const llmMessages = totalMessages - userMessages;

    return {
      totalMessages,
      userMessages,
      llmMessages
    };
  }

  function buildChatPath(rawConversation) {
    const chatName = rawConversation.chatName || rawConversation.title || "chat";
    return rawConversation.folderName ? `${rawConversation.folderName}/${chatName}` : chatName;
  }

  function extractTimeline(messages) {
    const timestamps = messages
      .map((message) => Number(message.timeMs))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);

    if (!timestamps.length) {
      return {
        hasTimeline: false,
        startTimeMs: null,
        endTimeMs: null,
        durationMs: null,
        startTimeLabel: "",
        endTimeLabel: "",
        durationLabel: ""
      };
    }

    const startTimeMs = timestamps[0];
    const endTimeMs = timestamps[timestamps.length - 1];
    const durationMs = Math.max(0, endTimeMs - startTimeMs);

    return {
      hasTimeline: true,
      startTimeMs,
      endTimeMs,
      durationMs,
      startTimeLabel: formatDateTime(startTimeMs),
      endTimeLabel: formatDateTime(endTimeMs),
      durationLabel: formatDuration(durationMs)
    };
  }

  function buildConversationSummary(rawConversation, processedMessages, provider) {
    const counts = countMessages(processedMessages);
    const timeline = extractTimeline(processedMessages);
    const conversationLike = {
      extractedAtIso: new Date().toISOString(),
      title: rawConversation.title || "chat",
      chatName: rawConversation.chatName || rawConversation.title || "chat",
      folderName: rawConversation.folderName || "",
      modelName: rawConversation.modelName || provider?.displayName || "Unknown",
      providerName: provider?.displayName || "Unknown Provider",
      settings: rawConversation.settings || null
    };

    const fileNameBase = typeof root.exporters?.resolveFileBaseName === "function"
      ? root.exporters.resolveFileBaseName(conversationLike)
      : (rawConversation.title || "chat");

    return {
      providerName: provider?.displayName || "Unknown Provider",
      chatTitle: rawConversation.title || "chat",
      chatName: rawConversation.chatName || rawConversation.title || "chat",
      chatPath: buildChatPath(rawConversation),
      fileNameBase,
      fileName: fileNameBase,
      messagesDisplay: `${counts.totalMessages} (H: ${counts.userMessages} AI: ${counts.llmMessages})`,
      ...counts,
      ...timeline
    };
  }

  function pushMetadata(items, label, value) {
    if (value === null || value === undefined || value === "") {
      return;
    }

    items.push({ label, value: String(value) });
  }

  function buildMetadata(rawConversation, summary, settings, provider, extractedAtIso) {
    const items = [];
    const extractedAt = new Date(extractedAtIso);

    if (settings.metadataExportedAt) {
      pushMetadata(items, METADATA_LABELS.EXPORTED_AT, new Intl.DateTimeFormat(undefined, {
        dateStyle: "short"
      }).format(extractedAt));
    }

    if (settings.metadataDeviceUser) {
      pushMetadata(items, METADATA_LABELS.DEVICE_USER, getBrowserLabel());
    }

    if (settings.metadataFolder) {
      pushMetadata(items, METADATA_LABELS.FOLDER, rawConversation.folderName || "");
    }

    if (settings.metadataTitle) {
      pushMetadata(items, METADATA_LABELS.TITLE, rawConversation.title || "chat");
    }

    if (settings.metadataModel) {
      pushMetadata(items, METADATA_LABELS.MODEL, rawConversation.modelName || provider?.displayName || "Unknown");
    }

    if (settings.metadataUrl) {
      pushMetadata(items, METADATA_LABELS.URL, rawConversation.sourceUrl || location.href);
    }

    if (settings.metadataSummaryProvider) {
      pushMetadata(items, METADATA_LABELS.PROVIDER, summary.providerName);
    }

    if (settings.metadataSummaryChatName) {
      pushMetadata(items, METADATA_LABELS.CHAT_NAME, summary.chatPath);
    }

    if (settings.metadataSummaryMessages) {
      pushMetadata(items, METADATA_LABELS.MESSAGE_TOTAL, summary.messagesDisplay);
    }

    if (settings.metadataStartTime && summary.hasTimeline) {
      pushMetadata(items, METADATA_LABELS.START_TIME, summary.startTimeLabel);
    }

    if (settings.metadataEndTime && summary.hasTimeline) {
      pushMetadata(items, METADATA_LABELS.END_TIME, summary.endTimeLabel);
    }

    if (settings.metadataDuration && summary.hasTimeline) {
      pushMetadata(items, METADATA_LABELS.DURATION, summary.durationLabel);
    }

    return items;
  }

  function upsertMetadata(metadata, label, value) {
    const existingIndex = metadata.findIndex((item) => item.label === label);
    const nextItem = { label, value: String(value) };

    if (existingIndex >= 0) {
      metadata[existingIndex] = nextItem;
      return;
    }

    metadata.push(nextItem);
  }

  function setResolvedFileNameMetadata(conversation, filename) {
    if (!conversation || !filename) {
      return conversation;
    }

    conversation.summary = conversation.summary || {};
    conversation.summary.fileName = filename;

    return conversation;
  }

  function processConversation(rawConversation, settings, provider) {
    const names = resolveNames(settings, provider);
    const extractedAtIso = new Date().toISOString();

    rawConversation.settings = settings;

    const processedMessages = (rawConversation.messages || [])
      .map((message, index) => {
        const safeHtml = message.safeHtml || "";
        const enrichedSafeHtml = message.role === ROLES.HUMAN
          ? prependUserAttachmentLines(safeHtml, message.attachments)
          : appendAssistantReferenceLines(safeHtml, message.references);
        const text = settings.textFormatting === TEXT_FORMATTING.MARKDOWN
          ? root.textConverter.htmlToMarkdown(enrichedSafeHtml, settings)
          : root.textConverter.htmlToPlainText(enrichedSafeHtml, settings);

        return {
          id: message.id || `msg-${index + 1}`,
          messageNumber: index + 1,
          role: message.role || ROLES.UNKNOWN,
          speakerLabel: resolveSpeakerLabel(message, names, settings),
          timeLabel: resolveMessageTimeLabel(message, settings),
          timeMs: Number.isFinite(Number(message.timeMs)) ? Number(message.timeMs) : null,
          safeHtml: enrichedSafeHtml,
          text,
          hasMedia: Boolean(message.hasMedia),
          isThinking: Boolean(message.isThinking),
          thinkingSeconds: message.thinkingSeconds || null
        };
      })
      .filter((message) => message.text || message.safeHtml);

    const summary = buildConversationSummary(rawConversation, processedMessages, provider);

    return {
      providerId: rawConversation.providerId,
      providerName: provider?.displayName || "Unknown Provider",
      sourceUrl: rawConversation.sourceUrl || location.href,
      folderName: rawConversation.folderName || "",
      chatName: rawConversation.chatName || rawConversation.title || "chat",
      title: rawConversation.title || "chat",
      modelName: rawConversation.modelName || provider?.displayName || "Unknown",
      extractedAtIso,
      settings,
      metadata: buildMetadata(rawConversation, summary, settings, provider, extractedAtIso),
      summary,
      names,
      hasMedia: processedMessages.some((message) => message.hasMedia),
      messages: processedMessages
    };
  }

  root.postProcess = {
    processConversation,
    setResolvedFileNameMetadata
  };
})();
