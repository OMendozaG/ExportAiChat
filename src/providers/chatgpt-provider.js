/*
 * ChatGPT provider.
 * Uses conservative selectors based on the HTML provided by the user.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { ROLES } = root.constants;

  const MODEL_NAME_REGEX = /\b(?:ChatGPT\s*)?(?:GPT[-\s]?\d(?:\.\d+)?|GPT[-\s]?4o|GPT[-\s]?4\.1|GPT[-\s]?5|o[1345](?:-mini|-pro)?|4o(?:-mini)?|4\.1(?:-mini)?|gpt-[a-z0-9.-]+)\b/i;
  const THINKING_LABEL_REGEX = /\b(?:thinking|reasoning|reasoned|thought for|reasoned for)\b/i;
  const THINKING_SECONDS_REGEX = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i;
  const SHARE_LABEL_REGEX = /\b(?:share|compartir)\b/i;
  const TIME_TEXT_REGEX = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|A\.M\.|P\.M\.)?\b/i;
  const CONVERSATION_PATH_REGEX = /\/c\/([^/?#]+)/i;
  const PROJECT_PATH_REGEX = /(\/g\/[^/]+)\/c\/[^/?#]+/i;

  function hostnameFromUrl(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  function matchesUrl(url) {
    return hostnameFromUrl(url) === "chatgpt.com";
  }

  function isChatPage() {
    return Boolean(
      document.querySelector('[data-message-author-role="user"], [data-message-author-role="assistant"], [data-testid^="conversation-turn-"]')
    );
  }

  function mapRole(rawRole) {
    if (rawRole === "user") {
      return ROLES.HUMAN;
    }

    if (rawRole === "assistant") {
      return ROLES.ASSISTANT;
    }

    return ROLES.UNKNOWN;
  }

  function isVisibleElement(element) {
    return Boolean(element && element.getClientRects && element.getClientRects().length);
  }

  function normalizeText(value) {
    const rawValue = String(value || "").replace(/\s+/g, " ").trim();
    return rawValue.normalize ? rawValue.normalize("NFC") : rawValue;
  }

  function formatTimeFromDate(date) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  }

  function extractTimeData(value) {
    const raw = normalizeText(value);

    if (!raw) {
      return { label: "", timestampMs: null };
    }

    if (/^\d{10,13}$/.test(raw)) {
      const numericValue = Number(raw);
      const timestamp = raw.length === 13 ? numericValue : numericValue * 1000;
      const parsed = new Date(timestamp);

      if (!Number.isNaN(parsed.getTime())) {
        return {
          label: formatTimeFromDate(parsed),
          timestampMs: parsed.getTime()
        };
      }
    }

    const parsedTime = Date.parse(raw);
    if (!Number.isNaN(parsedTime)) {
      const parsed = new Date(parsedTime);
      return {
        label: formatTimeFromDate(parsed),
        timestampMs: parsed.getTime()
      };
    }

    const directMatch = raw.match(TIME_TEXT_REGEX);
    if (directMatch) {
      return {
        label: normalizeText(directMatch[0]),
        timestampMs: null
      };
    }

    return { label: "", timestampMs: null };
  }

  function pickMessageContentRoot(messageNode, rawRole) {
    if (rawRole === "assistant") {
      const markdown = messageNode.querySelector(".markdown");
      if (markdown) {
        return markdown;
      }
    }

    if (rawRole === "user") {
      const userBubble = messageNode.querySelector(".whitespace-pre-wrap");
      if (userBubble) {
        return userBubble;
      }
    }

    return messageNode;
  }

  function buildReferenceKey(item) {
    return `${item.label || ""}::${item.url || ""}`.toLowerCase();
  }

  function dedupeReferences(items) {
    const seen = new Set();
    const unique = [];

    for (const item of items) {
      const key = buildReferenceKey(item);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push(item);
    }

    return unique;
  }

  function normalizeReferenceLabel(value) {
    const text = normalizeText(value);
    return text.length > 180 ? text.slice(0, 177).trimEnd() + "..." : text;
  }

  function isLikelyAttachmentHref(href) {
    return /\/files?\//i.test(href) || /download/i.test(href);
  }

  function isLikelyAttachmentLabel(label) {
    return /\.[a-z0-9]{2,8}(?:\b|$)/i.test(label);
  }

  function extractVisibleFileTileLabel(node) {
    const candidates = [
      node.getAttribute("aria-label"),
      node.querySelector(".font-semibold")?.textContent,
      node.querySelector("[class*='font-semibold']")?.textContent,
      node.querySelector(".truncate")?.textContent,
      node.textContent
    ];

    for (const candidate of candidates) {
      const label = normalizeReferenceLabel(candidate);
      if (label && isLikelyAttachmentLabel(label)) {
        return label;
      }
    }

    return "";
  }

  function extractUserAttachmentTiles(messageNode) {
    const tileNodes = Array.from(
      messageNode.querySelectorAll('[role="group"][aria-label], [class*="file-tile"][aria-label]')
    );

    const items = tileNodes.map((node) => {
      const label = extractVisibleFileTileLabel(node);
      if (!label) {
        return null;
      }

      return {
        kind: "attachment",
        label,
        url: ""
      };
    }).filter(Boolean);

    return dedupeReferences(items);
  }

  function extractUserAttachmentReferences(messageNode) {
    const anchors = Array.from(messageNode.querySelectorAll("a[href], [download]"));
    const linkItems = anchors.map((node) => {
      const href = normalizeText(node.getAttribute("href"));
      const label = normalizeReferenceLabel(
        node.getAttribute("download")
        || node.getAttribute("aria-label")
        || node.getAttribute("title")
        || node.textContent
      );

      if (!label) {
        return null;
      }

      if (!isLikelyAttachmentHref(href) && !isLikelyAttachmentLabel(label)) {
        return null;
      }

      return {
        kind: "attachment",
        label,
        url: href || ""
      };
    }).filter(Boolean);
    const tileItems = extractUserAttachmentTiles(messageNode);

    return dedupeReferences([...linkItems, ...tileItems]);
  }

  function extractAssistantReferences(messageNode, contentRoot) {
    const anchors = Array.from((contentRoot || messageNode).querySelectorAll("a[href]"));
    const items = anchors.map((node) => {
      const href = normalizeText(node.getAttribute("href"));
      const label = normalizeReferenceLabel(
        node.getAttribute("aria-label")
        || node.getAttribute("title")
        || node.textContent
      );

      if (!href && !label) {
        return null;
      }

      return {
        kind: isLikelyAttachmentHref(href) ? "attachment" : "url",
        label,
        url: href || ""
      };
    }).filter(Boolean);

    return dedupeReferences(items);
  }

  function findFirstVisibleMatch(selectors, regex, maxLength = 80) {
    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));

      for (const element of elements) {
        if (!isVisibleElement(element)) {
          continue;
        }

        const text = normalizeText(element.textContent);
        if (!text || text.length > maxLength) {
          continue;
        }

        if (regex.test(text)) {
          return text;
        }
      }
    }

    return "";
  }

  function isExcludedTitleElement(element) {
    return Boolean(element?.closest("nav, aside, [role='navigation'], dialog"));
  }

  function getCurrentConversationId() {
    const match = location.pathname.match(CONVERSATION_PATH_REGEX);
    return match ? match[1] : "";
  }

  function getCurrentProjectPath() {
    const match = location.pathname.match(PROJECT_PATH_REGEX);
    return match ? `${match[1]}/project` : "";
  }

  function extractSidebarItemText(container) {
    if (!container) {
      return "";
    }

    // Prefer visible text nodes first so project conversations do not fall back
    // to broader aria/title strings that can include the folder label again.
    const textNodes = Array.from(container.querySelectorAll("[dir='auto'], .truncate, span, div"));

    for (const node of textNodes) {
      const nodeText = normalizeText(node.textContent);
      if (nodeText) {
        return nodeText;
      }
    }

    const titledNodes = Array.from(container.querySelectorAll("[title]"));

    for (const node of titledNodes) {
      const titleText = normalizeText(node.getAttribute?.("title"));
      if (titleText) {
        return titleText;
      }
    }

    return normalizeText(container.textContent);
  }

  function cleanConversationAriaLabel(value) {
    return normalizeText(value)
      .replace(/,\s*chat\s+en\s+el\s+proyecto\s+.+$/i, "")
      .replace(/,\s*chat\s+in\s+the\s+project\s+.+$/i, "")
      .replace(/,\s*chat\s+in\s+project\s+.+$/i, "")
      .trim();
  }

  function extractFolderFromConversationAriaLabel(value) {
    const raw = normalizeText(value);
    const match = raw.match(/,\s*chat\s+en\s+el\s+proyecto\s+(.+)$/i)
      || raw.match(/,\s*chat\s+in\s+the\s+project\s+(.+)$/i)
      || raw.match(/,\s*chat\s+in\s+project\s+(.+)$/i);

    return match ? normalizeText(match[1]) : "";
  }

  function findConversationSidebarLink(conversationId) {
    if (!conversationId) {
      return null;
    }

    const links = Array.from(document.querySelectorAll('a[data-sidebar-item][href], aside a[href], nav a[href]'));
    return links.find((link) => {
      const href = normalizeText(link.getAttribute("href"));
      return href.includes(`/c/${conversationId}`);
    }) || null;
  }

  function extractConversationTitleFromSidebar() {
    const link = findConversationSidebarLink(getCurrentConversationId());

    if (!link) {
      return "";
    }

    const text = extractSidebarItemText(link);
    if (text) {
      return text;
    }

    return cleanConversationAriaLabel(link.getAttribute("aria-label"));
  }

  function extractConversationTitle() {
    const sidebarTitle = extractConversationTitleFromSidebar();
    if (sidebarTitle) {
      return sidebarTitle;
    }

    const folderName = extractConversationFolder();
    const titleSelectors = [
      'main [data-testid*="conversation-title"]',
      'main [data-testid*="conversation"] h1',
      'main header h1',
      'main h1',
      'main h2'
    ];

    for (const selector of titleSelectors) {
      const elements = Array.from(document.querySelectorAll(selector));

      for (const element of elements) {
        if (!isVisibleElement(element) || isExcludedTitleElement(element)) {
          continue;
        }

        const text = normalizeText(element.textContent);

        if (!text || text.length > 180) {
          continue;
        }

        if (folderName && text === folderName) {
          continue;
        }

        if (MODEL_NAME_REGEX.test(text) || SHARE_LABEL_REGEX.test(text)) {
          continue;
        }

        return text;
      }
    }

    return "ChatGPT Chat";
  }

  function extractConversationFolder() {
    const projectPath = getCurrentProjectPath();

    if (!projectPath) {
      return "";
    }

    // The project folder sits on its own /project entry, separate from the chat item.
    const links = Array.from(document.querySelectorAll('a[data-sidebar-item][href], aside a[href], nav a[href]'));

    for (const link of links) {
      const href = normalizeText(link.getAttribute("href"));
      if (href !== projectPath) {
        continue;
      }

      const text = extractSidebarItemText(link);
      if (text) {
        return text;
      }
    }

    // Fallback for localized ChatGPT builds where only the conversation aria-label exposes the project name.
    const conversationLink = findConversationSidebarLink(getCurrentConversationId());
    if (conversationLink) {
      const folderFromAria = extractFolderFromConversationAriaLabel(conversationLink.getAttribute("aria-label"));
      if (folderFromAria) {
        return folderFromAria;
      }
    }

    return "";
  }

  function extractModelName() {
    return findFirstVisibleMatch(
      [
        '[data-testid*="model"]',
        'header button',
        'header [role="button"]',
        'nav button',
        'nav [role="button"]'
      ],
      MODEL_NAME_REGEX
    );
  }

  function isShareButton(element) {
    if (!isVisibleElement(element)) {
      return false;
    }

    const ariaLabel = normalizeText(element.getAttribute("aria-label"));
    const text = normalizeText(element.textContent);
    const combined = `${ariaLabel} ${text}`.trim();

    if (!combined) {
      return false;
    }

    return SHARE_LABEL_REGEX.test(combined);
  }

  function findInlineActionAnchor() {
    const candidates = Array.from(
      document.querySelectorAll('header button, header [role="button"], header a, main button, main [role="button"], main a')
    );

    for (const candidate of candidates) {
      if (!isShareButton(candidate)) {
        continue;
      }

      const rect = candidate.getBoundingClientRect();
      if (rect.top > 320 || rect.width < 20 || rect.height < 20) {
        continue;
      }

      return {
        container: candidate.parentElement,
        referenceNode: candidate
      };
    }

    const fallbackContainers = Array.from(
      document.querySelectorAll("header div, main header div, main h1, header h1")
    );

    for (const container of fallbackContainers) {
      if (!isVisibleElement(container)) {
        continue;
      }

      const rect = container.getBoundingClientRect();
      if (rect.top > 320 || rect.height < 20) {
        continue;
      }

      return {
        container: container.matches("h1") ? container.parentElement : container,
        referenceNode: null
      };
    }

    return null;
  }

  function extractMessageTimeData(messageNode) {
    const candidateNodes = Array.from(
      messageNode.querySelectorAll("time, [datetime], [data-time], [data-timestamp], [title], [aria-label]")
    );

    for (const node of candidateNodes) {
      const attributeCandidates = [
        node.getAttribute("datetime"),
        node.getAttribute("data-time"),
        node.getAttribute("data-timestamp"),
        node.getAttribute("title"),
        node.getAttribute("aria-label")
      ];

      for (const candidate of attributeCandidates) {
        const timeData = extractTimeData(candidate);

        if (timeData.label) {
          return timeData;
        }
      }

      const textData = extractTimeData(node.textContent);
      if (textData.label) {
        return textData;
      }
    }

    return {
      label: "",
      timestampMs: null
    };
  }

  function extractThinkingMessage(messageNode, settings, messageId, timeLabel, timeMs) {
    if (!settings.includeThinking) {
      return null;
    }

    const candidates = Array.from(
      messageNode.querySelectorAll('details, summary, button, [role="button"], [data-testid*="think"], [data-testid*="reason"]')
    );

    let indicatorNode = null;
    let indicatorText = "";

    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent);
      if (!text || text.length > 180) {
        continue;
      }

      if (THINKING_LABEL_REGEX.test(text)) {
        indicatorNode = candidate;
        indicatorText = text;
        break;
      }
    }

    if (!indicatorNode) {
      return null;
    }

    const thinkingRoot = indicatorNode.closest("details") || indicatorNode;
    const sanitized = root.sanitize.sanitizeMessageNode(thinkingRoot, {
      mediaHandling: settings.mediaHandling
    });

    const stripped = normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " "));
    const secondsMatch = indicatorText.match(THINKING_SECONDS_REGEX);

    if (!stripped && !indicatorText) {
      return null;
    }

    return {
      id: `${messageId}-thinking`,
      role: ROLES.ASSISTANT,
      safeHtml: stripped ? sanitized.safeHtml : `<p>${root.sanitize.escapeHtml(indicatorText)}</p>`,
      hasMedia: Boolean(sanitized.hasMedia),
      timeLabel,
      timeMs,
      isThinking: true,
      thinkingSeconds: secondsMatch ? secondsMatch[1] : null
    };
  }

  function extractConversation(settings) {
    const rawNodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
    const seenIds = new Set();
    const messages = [];

    for (let index = 0; index < rawNodes.length; index += 1) {
      const node = rawNodes[index];
      const rawRole = node.getAttribute("data-message-author-role") || "unknown";
      const messageId = node.getAttribute("data-message-id") || `chatgpt-${index + 1}`;

      if (seenIds.has(messageId)) {
        continue;
      }
      seenIds.add(messageId);

      const timeData = extractMessageTimeData(node);
      const timeLabel = timeData.label;
      const timeMs = timeData.timestampMs;
      const thinkingMessage = rawRole === "assistant"
        ? extractThinkingMessage(node, settings, messageId, timeLabel, timeMs)
        : null;

      if (thinkingMessage) {
        messages.push(thinkingMessage);
      }

      const contentRoot = pickMessageContentRoot(node, rawRole);
      const sanitized = root.sanitize.sanitizeMessageNode(contentRoot, {
        mediaHandling: settings.mediaHandling
      });
      const userAttachments = rawRole === "user" && settings.showUserAttachmentNames
        ? extractUserAttachmentReferences(node)
        : [];
      const assistantReferences = rawRole === "assistant" && settings.showAssistantReferences
        ? extractAssistantReferences(node, contentRoot)
        : [];

      const stripped = normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " "));
      if (!stripped && !userAttachments.length && !assistantReferences.length) {
        continue;
      }

      messages.push({
        id: messageId,
        role: mapRole(rawRole),
        safeHtml: sanitized.safeHtml,
        hasMedia: sanitized.hasMedia,
        timeLabel,
        timeMs,
        attachments: userAttachments,
        references: assistantReferences
      });
    }

    return {
      providerId: "chatgpt",
      sourceUrl: location.href,
      folderName: extractConversationFolder(),
      title: extractConversationTitle(),
      modelName: extractModelName(),
      messages
    };
  }

  function getLiveStatus() {
    return {
      isChatPage: isChatPage(),
      messageCount: document.querySelectorAll("[data-message-author-role]").length
    };
  }

  root.providers.registerProvider({
    id: "chatgpt",
    displayName: "ChatGPT",
    matchesUrl,
    isChatPage,
    extractConversation,
    getLiveStatus,
    findInlineActionAnchor
  });
})();
