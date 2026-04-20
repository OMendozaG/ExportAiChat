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
  const SHARE_ICON_PATH_MARKERS = [
    // DeepSeek "share" glyph markers captured from the provided HTML logs.
    "M7.95889 1.52285",
    "7.95888 0.826234",
    "L15.1317 7.18358"
  ];

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

  function isInConversationTurn(element) {
    return Boolean(element && element.closest && element.closest("[data-virtual-list-item-key]"));
  }

  function normalizeRect(rect) {
    return {
      top: Number(rect?.top || 0),
      right: Number(rect?.right || 0),
      left: Number(rect?.left || 0),
      width: Number(rect?.width || 0),
      height: Number(rect?.height || 0)
    };
  }

  function getHeaderLeftBoundary() {
    // Keep the heuristic adaptable: on narrow viewports, allow controls closer to the left.
    if (window.innerWidth <= 960) {
      return window.innerWidth * 0.08;
    }

    return window.innerWidth * 0.2;
  }

  function isLikelyTopHeaderControl(element) {
    if (!isVisibleElement(element) || isInConversationTurn(element)) {
      return false;
    }

    const rect = normalizeRect(element.getBoundingClientRect());

    if (rect.top < -8 || rect.top > 320 || rect.width < 18 || rect.height < 18) {
      return false;
    }

    if (rect.left < getHeaderLeftBoundary()) {
      return false;
    }

    return true;
  }

  function hasShareIconGlyph(element) {
    const pathNodes = Array.from(element.querySelectorAll("svg path[d]"));

    for (const pathNode of pathNodes) {
      const pathValue = normalizeText(pathNode.getAttribute("d"));

      if (!pathValue) {
        continue;
      }

      if (SHARE_ICON_PATH_MARKERS.some((marker) => pathValue.includes(marker))) {
        return true;
      }
    }

    return false;
  }

  function collectTopHeaderControls() {
    const candidates = Array.from(document.querySelectorAll("button, [role='button'], a[role='button']"));

    return candidates.filter((candidate) => isLikelyTopHeaderControl(candidate));
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
    const candidates = collectTopHeaderControls();

    for (const candidate of candidates) {
      const label = normalizeText(
        candidate.getAttribute("aria-label")
        || candidate.getAttribute("title")
        || candidate.textContent
      );
      if (!label || !SHARE_LABEL_REGEX.test(label)) {
        continue;
      }

      return {
        container: candidate.parentElement,
        referenceNode: candidate
      };
    }

    // Fallback: DeepSeek sometimes renders share as an icon-only control.
    const shareIconButtons = candidates.filter((candidate) => hasShareIconGlyph(candidate));
    if (shareIconButtons.length) {
      const sortedByTopThenRight = shareIconButtons.sort((left, right) => {
        const leftRect = normalizeRect(left.getBoundingClientRect());
        const rightRect = normalizeRect(right.getBoundingClientRect());

        if (Math.abs(leftRect.top - rightRect.top) > 6) {
          return leftRect.top - rightRect.top;
        }

        return rightRect.right - leftRect.right;
      });

      const shareButton = sortedByTopThenRight[0];

      return {
        container: shareButton.parentElement,
        referenceNode: shareButton
      };
    }

    // Last fallback: locate the top action row and attach after its right-most control.
    const groups = new Map();

    for (const candidate of candidates) {
      const parent = candidate.parentElement;

      if (!parent || isInConversationTurn(parent) || !isVisibleElement(parent)) {
        continue;
      }

      const existing = groups.get(parent) || [];
      existing.push(candidate);
      groups.set(parent, existing);
    }

    let bestGroup = null;
    let bestScore = -Infinity;

    groups.forEach((buttons, container) => {
      if (buttons.length < 2) {
        return;
      }

      const containerRect = normalizeRect(container.getBoundingClientRect());
      if (containerRect.top < -8 || containerRect.top > 340 || containerRect.left < getHeaderLeftBoundary()) {
        return;
      }

      const rightMostButton = buttons.reduce((currentBest, candidate) => {
        if (!currentBest) {
          return candidate;
        }

        const bestRect = normalizeRect(currentBest.getBoundingClientRect());
        const nextRect = normalizeRect(candidate.getBoundingClientRect());
        return nextRect.right > bestRect.right ? candidate : currentBest;
      }, null);

      if (!rightMostButton) {
        return;
      }

      // Prefer richer action rows near the top-right.
      const rightMostRect = normalizeRect(rightMostButton.getBoundingClientRect());
      const score = (
        buttons.length * 10
        + rightMostRect.right * 0.01
        - containerRect.top * 0.05
      );

      if (score > bestScore) {
        bestScore = score;
        bestGroup = {
          container,
          referenceNode: rightMostButton
        };
      }
    });

    if (bestGroup) {
      return bestGroup;
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
