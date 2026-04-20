/*
 * Shared post-processing for all providers.
 * It applies naming, metadata and final text conversion independently of provider DOM.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { ROLES, TEXT_FORMATTING, AI_NAME_MODE, METADATA_LABELS } = root.constants;
  const THINKING_LABEL_ONLY_REGEX = /^(?:thought|thinking|reasoning|reasoned|pensado|pensando|pensamiento|razonando|razonamiento)(?:\s*(?:for|durante)\s*.+)?$/i;

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

  function getPreferredLocales() {
    if (Array.isArray(navigator.languages) && navigator.languages.length) {
      return navigator.languages;
    }

    if (navigator.language) {
      return [navigator.language];
    }

    return undefined;
  }

  function formatMetadataExportedAt(timestampMs) {
    // Keep system locale ordering/separators, but force a full year and include time.
    return new Intl.DateTimeFormat(getPreferredLocales(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestampMs));
  }

  function formatDateTime(timestampMs) {
    return new Intl.DateTimeFormat(getPreferredLocales(), {
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

  function collectReferenceLines(references) {
    return dedupeVisibleReferences(references)
      .map((reference) => buildReferenceDescriptor(reference))
      .filter(Boolean);
  }

  function collectHiddenReferenceLines(safeHtml, references) {
    return filterHiddenReferences(safeHtml, references)
      .map((reference) => buildReferenceDescriptor(reference))
      .filter(Boolean);
  }

  function referenceKey(reference) {
    const label = String(reference?.label || "").trim().toLowerCase();
    const url = String(reference?.url || "").trim().toLowerCase();
    return `${label}::${url}`;
  }

  function collectKnownUserAttachmentKeys(messages) {
    const keys = new Set();

    for (const message of messages || []) {
      if (message?.role !== ROLES.HUMAN || !Array.isArray(message.attachments)) {
        continue;
      }

      for (const attachment of message.attachments) {
        const key = referenceKey(attachment);
        if (key !== "::") {
          keys.add(key);
        }
      }
    }

    return keys;
  }

  function filterAssistantReferencesBySettings(references, knownUserAttachmentKeys, settings) {
    const includeUserAttachmentRefs = Boolean(settings.showAssistantUserAttachmentReferences);
    const includeGeneratedAttachmentRefs = Boolean(settings.showAssistantGeneratedAttachmentReferences);
    const includeWebRefs = Boolean(settings.showAssistantWebReferences);

    return (references || []).filter((reference) => {
      const kind = String(reference?.kind || "").toLowerCase();
      const key = referenceKey(reference);
      const isKnownUserAttachment = knownUserAttachmentKeys.has(key);

      if (kind === "url") {
        return includeWebRefs;
      }

      if (isKnownUserAttachment) {
        return includeUserAttachmentRefs;
      }

      return includeGeneratedAttachmentRefs;
    });
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

    return baseLabel;
  }

  function compactThinkingText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function compactThinkingLabel(value) {
    return compactThinkingText(value).replace(/\s*\n+\s*/g, " ").trim();
  }

  function thinkingDurationFromLabel(rawLabel) {
    const label = String(rawLabel || "").trim();
    if (!label) {
      return "";
    }

    const normalized = label.replace(/\s+/g, " ").trim();
    const durationMatch = normalized.match(
      /(?:thought|thinking|reasoned|reasoning|pensado|pensando|pensamiento|razonando|razonamiento)(?:\s*(?:for|durante))?\s+(.+)$/i
    );

    return durationMatch ? durationMatch[1].trim() : "";
  }

  function isLabelOnlyThinking(text) {
    const normalized = String(text || "")
      .trim()
      .replace(/^\((.*)\)$/s, "$1")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return true;
    }

    return THINKING_LABEL_ONLY_REGEX.test(normalized);
  }

  function stripOuterParentheses(text) {
    return String(text || "")
      .trim()
      .replace(/^\((.*)\)$/s, "$1")
      .trim();
  }

  function toParenthesizedLabel(text) {
    const innerLabel = stripOuterParentheses(text);
    return innerLabel ? `(${innerLabel})` : "";
  }

  function normalizeThinkingText(rawText, message, settings) {
    // Prefer explicit provider labels (for example, "Pensó por 18s")
    // to keep wording consistent with the source chat language.
    const explicitLabel = compactThinkingLabel(message?.thinkingLabel);
    if (explicitLabel) {
      return toParenthesizedLabel(explicitLabel);
    }

    const cleanedText = compactThinkingLabel(rawText);
    if (cleanedText) {
      return toParenthesizedLabel(cleanedText);
    }

    if (settings.includeThinkingDuration) {
      const fromMessage = String(message?.thinkingDurationLabel || "").trim();
      const fromIndicator = thinkingDurationFromLabel(message?.thinkingLabel);
      const fromSeconds = message?.thinkingSeconds ? `${message.thinkingSeconds}s` : "";
      const duration = fromMessage || fromIndicator || fromSeconds;

      if (duration) {
        return toParenthesizedLabel(compactThinkingLabel(duration));
      }
    }

    return "(Thought)";
  }

  function mergeThinkingIntoAssistantMessages(messages) {
    const mergedMessages = [];
    let pendingThinking = "";

    for (const message of messages) {
      if (message.isThinking) {
        const note = compactThinkingText(message.thinkingNote || message.text);
        if (note) {
          pendingThinking = pendingThinking
            ? `${pendingThinking}\n${note}`
            : note;
        }
        continue;
      }

      const nextMessage = { ...message };
      if (pendingThinking && nextMessage.role === ROLES.ASSISTANT) {
        nextMessage.thinkingNote = pendingThinking;
        pendingThinking = "";
      }

      mergedMessages.push(nextMessage);
    }

    // Defensive fallback: if a thinking label was detected but there is no next
    // assistant entry, append it to the latest assistant already collected.
    if (pendingThinking) {
      for (let index = mergedMessages.length - 1; index >= 0; index -= 1) {
        if (mergedMessages[index].role !== ROLES.ASSISTANT) {
          continue;
        }

        const currentNote = compactThinkingText(mergedMessages[index].thinkingNote);
        mergedMessages[index] = {
          ...mergedMessages[index],
          thinkingNote: currentNote
            ? `${currentNote}\n${pendingThinking}`
            : pendingThinking
        };
        break;
      }
    }

    return mergedMessages;
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
    if (!settings.metadataEnabled) {
      return [];
    }

    const items = [];
    const extractedAt = new Date(extractedAtIso);

    if (settings.metadataExportedAt) {
      pushMetadata(items, METADATA_LABELS.EXPORTED_AT, formatMetadataExportedAt(extractedAt));
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
      // Keep Chat Name independent from Chat Folder in metadata output.
      pushMetadata(items, METADATA_LABELS.CHAT_NAME, summary.chatName);
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

    const knownUserAttachmentKeys = collectKnownUserAttachmentKeys(rawConversation.messages || []);
    const mappedMessages = (rawConversation.messages || [])
      .map((message, index) => {
        const safeHtml = message.safeHtml || "";
        const text = settings.textFormatting === TEXT_FORMATTING.MARKDOWN
          ? root.textConverter.htmlToMarkdown(safeHtml, settings)
          : root.textConverter.htmlToPlainText(safeHtml, settings);
        const normalizedThinkingNote = message.isThinking
          ? normalizeThinkingText(text, message, settings)
          : "";
        const normalizedText = message.isThinking
          ? normalizedThinkingNote
          : text;
        const normalizedSafeHtml = message.isThinking
          ? (normalizedThinkingNote ? `<p>${root.sanitize.escapeHtml(normalizedThinkingNote)}</p>` : "")
          : safeHtml;
        const leadingReferenceLines = message.role === ROLES.HUMAN
          ? collectReferenceLines(message.attachments)
          : [];
        const filteredAssistantReferences = message.role === ROLES.ASSISTANT
          ? filterAssistantReferencesBySettings(message.references, knownUserAttachmentKeys, settings)
          : [];
        const trailingReferenceLines = message.role === ROLES.ASSISTANT
          ? collectHiddenReferenceLines(safeHtml, filteredAssistantReferences)
          : [];

        return {
          id: message.id || `msg-${index + 1}`,
          messageNumber: index + 1,
          role: message.role || ROLES.UNKNOWN,
          speakerLabel: resolveSpeakerLabel(message, names),
          timeLabel: resolveMessageTimeLabel(message, settings),
          timeMs: Number.isFinite(Number(message.timeMs)) ? Number(message.timeMs) : null,
          safeHtml: normalizedSafeHtml,
          text: normalizedText,
          leadingReferenceLines,
          trailingReferenceLines,
          hasMedia: Boolean(message.hasMedia),
          isThinking: Boolean(message.isThinking),
          thinkingNote: normalizedThinkingNote,
          thinkingSeconds: message.thinkingSeconds || null,
          thinkingLabel: message.thinkingLabel || "",
          thinkingDurationLabel: message.thinkingDurationLabel || ""
        };
      })
      .filter((message) => {
        return message.text
          || message.safeHtml
          || (Array.isArray(message.leadingReferenceLines) && message.leadingReferenceLines.length)
          || (Array.isArray(message.trailingReferenceLines) && message.trailingReferenceLines.length);
      });

    const processedMessages = mergeThinkingIntoAssistantMessages(mappedMessages)
      .map((message, index) => {
        return {
          ...message,
          messageNumber: index + 1
        };
      });

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
