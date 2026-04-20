/*
 * Grok provider adapter.
 * It reads message rows from response-* containers and classifies user vs assistant by alignment.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { ROLES } = root.constants;

  const HOSTNAME = "grok.com";
  const THINKING_SECONDS_REGEX = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s|segundos?|seg)\b/i;
  const THINKING_DURATION_LABEL_REGEX = /(?:thought|thinking|reasoning|pensado|pensando|pensamiento|razonando|razonamiento)(?:\s*(?:for|durante))?\s+([0-9hms.: ]+)/i;
  const SHARE_LABEL_REGEX = /\b(?:share|compartir)\b/i;

  function normalizeText(value) {
    const rawValue = String(value || "").replace(/\s+/g, " ").trim();
    return rawValue.normalize ? rawValue.normalize("NFC") : rawValue;
  }

  function hostnameFromUrl(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  function matchesUrl(url) {
    return hostnameFromUrl(url) === HOSTNAME;
  }

  function isVisibleElement(element) {
    return Boolean(element && element.getClientRects && element.getClientRects().length);
  }

  function extractWindowTitle() {
    const rawTitle = normalizeText(document.title || document.querySelector("title")?.textContent);

    if (!rawTitle) {
      return "";
    }

    const cleanedTitle = rawTitle
      .replace(/\s*[-|·•]\s*grok$/i, "")
      .replace(/^grok\s*[-|·•]\s*/i, "")
      .trim();

    if (!cleanedTitle || /^grok$/i.test(cleanedTitle)) {
      return "";
    }

    return cleanedTitle;
  }

  function extractChatName() {
    return extractWindowTitle() || "Grok Chat";
  }

  function extractModelName() {
    // Grok mode/model controls are highly dynamic. Keep this conservative for now.
    return "";
  }

  function isChatPage() {
    return Boolean(document.querySelector('div[id^="response-"]'));
  }

  function dedupeByLabelAndUrl(items) {
    const seen = new Set();
    const unique = [];

    for (const item of items) {
      const key = `${normalizeText(item?.label)}::${normalizeText(item?.url)}`.toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push(item);
    }

    return unique;
  }

  function isLikelyAttachmentLabel(label) {
    return /\.[a-z0-9]{2,8}(?:\b|$)/i.test(String(label || ""));
  }

  function isLikelyAttachmentHref(href) {
    return /\/files?\//i.test(String(href || "")) || /download/i.test(String(href || ""));
  }

  function extractUserAttachments(turnNode) {
    const attachmentNodes = Array.from(turnNode.querySelectorAll("figure + span.truncate"));

    const items = attachmentNodes.map((labelNode) => {
      const label = normalizeText(labelNode.textContent);

      if (!label || !isLikelyAttachmentLabel(label)) {
        return null;
      }

      return {
        kind: "attachment",
        label,
        url: ""
      };
    }).filter(Boolean);

    return dedupeByLabelAndUrl(items);
  }

  function extractAssistantReferences(turnNode, contentRoot) {
    const anchors = Array.from((contentRoot || turnNode).querySelectorAll("a[href]"));

    const items = anchors.map((anchor) => {
      const href = normalizeText(anchor.getAttribute("href"));
      const label = normalizeText(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || anchor.textContent);

      if (!href && !label) {
        return null;
      }

      return {
        kind: isLikelyAttachmentHref(href) || isLikelyAttachmentLabel(label) ? "attachment" : "url",
        label,
        url: href || ""
      };
    }).filter(Boolean);

    return dedupeByLabelAndUrl(items);
  }

  function extractThinkingLabel(turnNode) {
    const thinkingContainer = turnNode.querySelector(".thinking-container");

    if (!thinkingContainer) {
      return "";
    }

    const explicitLabel = normalizeText(thinkingContainer.querySelector("button span:last-child")?.textContent);
    if (explicitLabel) {
      return explicitLabel;
    }

    return normalizeText(thinkingContainer.textContent);
  }

  function buildThinkingMessage(turnNode, settings, messageId) {
    if (!settings.includeThinking) {
      return null;
    }

    const thinkingLabel = extractThinkingLabel(turnNode);
    if (!thinkingLabel) {
      return null;
    }

    const secondsMatch = thinkingLabel.match(THINKING_SECONDS_REGEX);
    const durationMatch = thinkingLabel.match(THINKING_DURATION_LABEL_REGEX);

    return {
      id: `${messageId}-thinking`,
      role: ROLES.ASSISTANT,
      safeHtml: `<p>${root.sanitize.escapeHtml(thinkingLabel)}</p>`,
      hasMedia: false,
      isThinking: true,
      thinkingSeconds: secondsMatch ? secondsMatch[1] : null,
      thinkingLabel,
      thinkingDurationLabel: durationMatch ? normalizeText(durationMatch[1]) : ""
    };
  }

  function pickContentRoot(turnNode) {
    return turnNode.querySelector(".response-content-markdown") || turnNode.querySelector(".message-bubble") || turnNode;
  }

  function classifyTurnRole(turnNode) {
    if (turnNode.classList.contains("items-end")) {
      return ROLES.HUMAN;
    }

    if (turnNode.classList.contains("items-start")) {
      return ROLES.ASSISTANT;
    }

    if (turnNode.querySelector(".thinking-container")) {
      return ROLES.ASSISTANT;
    }

    return ROLES.UNKNOWN;
  }

  function extractConversation(settings) {
    const shouldExtractAssistantReferences = Boolean(
      settings.showAssistantUserAttachmentReferences
      || settings.showAssistantGeneratedAttachmentReferences
      || settings.showAssistantWebReferences
      || settings.showAssistantReferences
    );

    const turnNodes = Array.from(document.querySelectorAll('div[id^="response-"]'));
    const messages = [];

    for (let index = 0; index < turnNodes.length; index += 1) {
      const turnNode = turnNodes[index];
      const messageId = `grok-${index + 1}`;
      const role = classifyTurnRole(turnNode);

      if (role === ROLES.UNKNOWN) {
        continue;
      }

      const contentRoot = pickContentRoot(turnNode);
      const sanitized = root.sanitize.sanitizeMessageNode(contentRoot, {
        mediaHandling: settings.mediaHandling
      });
      const textContent = normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " "));

      if (role === ROLES.ASSISTANT) {
        const thinkingMessage = buildThinkingMessage(turnNode, settings, messageId);
        if (thinkingMessage) {
          messages.push(thinkingMessage);
        }

        const references = shouldExtractAssistantReferences
          ? extractAssistantReferences(turnNode, contentRoot)
          : [];

        if (!textContent && !references.length) {
          continue;
        }

        messages.push({
          id: messageId,
          role: ROLES.ASSISTANT,
          safeHtml: sanitized.safeHtml,
          hasMedia: sanitized.hasMedia,
          attachments: [],
          references
        });

        continue;
      }

      const attachments = settings.showUserAttachmentNames ? extractUserAttachments(turnNode) : [];

      if (!textContent && !attachments.length) {
        continue;
      }

      messages.push({
        id: messageId,
        role: ROLES.HUMAN,
        safeHtml: sanitized.safeHtml,
        hasMedia: sanitized.hasMedia,
        attachments,
        references: []
      });
    }

    const chatName = extractChatName();

    return {
      providerId: "grok",
      sourceUrl: location.href,
      folderName: "",
      chatName,
      title: extractWindowTitle() || chatName,
      modelName: extractModelName(),
      messages
    };
  }

  function getLiveStatus() {
    const turnNodes = Array.from(document.querySelectorAll('div[id^="response-"]'));
    const conversationTurns = turnNodes.filter((turnNode) => classifyTurnRole(turnNode) !== ROLES.UNKNOWN);

    return {
      isChatPage: isChatPage(),
      messageCount: conversationTurns.length
    };
  }

  function findInlineActionAnchor() {
    const candidates = Array.from(document.querySelectorAll("header button, header [role='button'], button[aria-label], main button"));

    for (const candidate of candidates) {
      if (!isVisibleElement(candidate)) {
        continue;
      }

      const label = normalizeText(candidate.getAttribute("aria-label") || candidate.textContent);
      if (!label || !SHARE_LABEL_REGEX.test(label)) {
        continue;
      }

      const rect = candidate.getBoundingClientRect();
      if (rect.top > 240 || rect.width < 60) {
        continue;
      }

      return {
        container: candidate.parentElement,
        referenceNode: candidate
      };
    }

    return null;
  }

  root.providers.registerProvider({
    id: "grok",
    displayName: "Grok",
    matchesUrl,
    isChatPage,
    extractConversation,
    getLiveStatus,
    findInlineActionAnchor
  });
})();
