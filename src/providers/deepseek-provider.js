/*
 * DeepSeek provider adapter.
 * It is resilient to hash-like class names by relying on list-item markers first.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { ROLES } = root.constants;

  const HOSTNAME = "chat.deepseek.com";
  const THINKING_SECONDS_REGEX = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s|segundos?|seg)\b/i;
  const THINKING_LABEL_REGEX = /\b(?:pens[oó]\s+durante|thinking|reasoning)\b/i;
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

  function isChatPage() {
    return Boolean(document.querySelector("[data-virtual-list-item-key]"));
  }

  function extractWindowTitle() {
    const rawTitle = normalizeText(document.title || document.querySelector("title")?.textContent);

    if (!rawTitle) {
      return "";
    }

    const cleanedTitle = rawTitle
      .replace(/\s*[-|·•]\s*deepseek$/i, "")
      .replace(/^deepseek\s*[-|·•]\s*/i, "")
      .trim();

    if (!cleanedTitle || /^deepseek$/i.test(cleanedTitle)) {
      return "";
    }

    return cleanedTitle;
  }

  function extractChatName() {
    // In current DeepSeek logs, the active sidebar conversation link has class b64fb9ae.
    const activeSidebarItem = document.querySelector('a._546d736.b64fb9ae[href*="/a/chat/s/"]');

    const sidebarText = normalizeText(activeSidebarItem?.textContent);
    if (sidebarText) {
      return sidebarText;
    }

    return extractWindowTitle() || "DeepSeek Chat";
  }

  function extractThinkingLabel(turnNode) {
    const candidates = Array.from(turnNode.querySelectorAll("span, button, summary, [aria-label], [title]"));

    for (const candidate of candidates) {
      const text = normalizeText(
        candidate.getAttribute?.("aria-label")
        || candidate.getAttribute?.("title")
        || candidate.textContent
      );

      if (!text) {
        continue;
      }

      if (THINKING_LABEL_REGEX.test(text) || THINKING_SECONDS_REGEX.test(text)) {
        return text;
      }
    }

    return "";
  }

  function buildThinkingMessage(turnNode, settings, messageId) {
    if (!settings.includeThinking) {
      return null;
    }

    const thinkingRoot = turnNode.querySelector(".ds-think-content");
    const thinkingLabel = extractThinkingLabel(turnNode);

    if (!thinkingRoot && !thinkingLabel) {
      return null;
    }

    let safeHtml = "";
    let hasMedia = false;

    if (thinkingRoot) {
      const thinkingSanitized = root.sanitize.sanitizeMessageNode(thinkingRoot, {
        mediaHandling: settings.mediaHandling
      });
      safeHtml = thinkingSanitized.safeHtml;
      hasMedia = thinkingSanitized.hasMedia;
    }

    if (!safeHtml) {
      const fallbackLabel = thinkingLabel || "Thinking";
      safeHtml = `<p>${root.sanitize.escapeHtml(fallbackLabel)}</p>`;
    }

    const secondsMatch = (thinkingLabel || "").match(THINKING_SECONDS_REGEX);

    return {
      id: `${messageId}-thinking`,
      role: ROLES.ASSISTANT,
      safeHtml,
      hasMedia,
      isThinking: true,
      thinkingSeconds: secondsMatch ? secondsMatch[1] : null
    };
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

  function extractAssistantReferences(turnNode, contentRoot) {
    const anchors = Array.from((contentRoot || turnNode).querySelectorAll("a[href]"));

    const linkItems = anchors.map((anchor) => {
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

    const citationItems = Array.from((contentRoot || turnNode).querySelectorAll(".ds-markdown-cite"))
      .map((cite) => {
        const label = normalizeText(cite.textContent);
        if (!label) {
          return null;
        }

        return {
          kind: "reference",
          label,
          url: ""
        };
      })
      .filter(Boolean);

    return dedupeByLabelAndUrl([...linkItems, ...citationItems]);
  }

  function pickAssistantContentRoot(turnNode) {
    const markdownNodes = Array.from(turnNode.querySelectorAll(".ds-markdown"));

    const answerMarkdownNodes = markdownNodes.filter((markdownNode) => !markdownNode.closest(".ds-think-content"));
    if (answerMarkdownNodes.length) {
      return answerMarkdownNodes[answerMarkdownNodes.length - 1];
    }

    return markdownNodes[markdownNodes.length - 1] || turnNode;
  }

  function pickUserContentRoot(turnNode) {
    return turnNode.querySelector(".fbb737a4") || turnNode;
  }

  function extractConversation(settings) {
    const shouldExtractAssistantReferences = Boolean(
      settings.showAssistantUserAttachmentReferences
      || settings.showAssistantGeneratedAttachmentReferences
      || settings.showAssistantWebReferences
      || settings.showAssistantReferences
    );

    const turnNodes = Array.from(document.querySelectorAll("[data-virtual-list-item-key]"));
    const messages = [];

    for (let index = 0; index < turnNodes.length; index += 1) {
      const turnNode = turnNodes[index];
      const messageId = `deepseek-${index + 1}`;
      const hasAssistantContent = Boolean(turnNode.querySelector(".ds-markdown"));
      const hasUserContent = Boolean(turnNode.querySelector(".fbb737a4"));

      if (!hasAssistantContent && !hasUserContent) {
        continue;
      }

      if (hasAssistantContent) {
        const thinkingMessage = buildThinkingMessage(turnNode, settings, messageId);
        if (thinkingMessage) {
          messages.push(thinkingMessage);
        }

        const contentRoot = pickAssistantContentRoot(turnNode);
        const sanitized = root.sanitize.sanitizeMessageNode(contentRoot, {
          mediaHandling: settings.mediaHandling
        });
        const references = shouldExtractAssistantReferences
          ? extractAssistantReferences(turnNode, contentRoot)
          : [];
        const textContent = normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " "));

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

      const contentRoot = pickUserContentRoot(turnNode);
      const sanitized = root.sanitize.sanitizeMessageNode(contentRoot, {
        mediaHandling: settings.mediaHandling
      });
      const textContent = normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " "));

      if (!textContent) {
        continue;
      }

      messages.push({
        id: messageId,
        role: ROLES.HUMAN,
        safeHtml: sanitized.safeHtml,
        hasMedia: sanitized.hasMedia,
        attachments: [],
        references: []
      });
    }

    const chatName = extractChatName();

    return {
      providerId: "deepseek",
      sourceUrl: location.href,
      folderName: "",
      chatName,
      title: extractWindowTitle() || chatName,
      modelName: "",
      messages
    };
  }

  function getLiveStatus() {
    const turnNodes = Array.from(document.querySelectorAll("[data-virtual-list-item-key]"));
    const conversationTurns = turnNodes.filter((turnNode) => turnNode.querySelector(".ds-markdown, .fbb737a4"));

    return {
      isChatPage: isChatPage(),
      messageCount: conversationTurns.length
    };
  }

  function findInlineActionAnchor() {
    const candidates = Array.from(document.querySelectorAll("button, [role='button'], a"));

    for (const candidate of candidates) {
      if (!isVisibleElement(candidate)) {
        continue;
      }

      const label = normalizeText(candidate.getAttribute("aria-label") || candidate.textContent);
      if (!label || !SHARE_LABEL_REGEX.test(label)) {
        continue;
      }

      const rect = candidate.getBoundingClientRect();
      if (rect.top > 320) {
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
    id: "deepseek",
    displayName: "DeepSeek",
    matchesUrl,
    isChatPage,
    extractConversation,
    getLiveStatus,
    findInlineActionAnchor
  });
})();
