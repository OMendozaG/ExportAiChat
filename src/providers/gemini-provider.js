/*
 * Gemini provider adapter.
 * It uses stable data-test-id hooks from Gemini's Angular chat DOM.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { ROLES } = root.constants;

  const HOSTNAME = "gemini.google.com";
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
      .replace(/\s*[-|·•]\s*gemini$/i, "")
      .replace(/^gemini\s*[-|·•]\s*/i, "")
      .trim();

    if (!cleanedTitle || /^gemini$/i.test(cleanedTitle)) {
      return "";
    }

    return cleanedTitle;
  }

  function extractChatName() {
    const titleFromHeader = normalizeText(document.querySelector('[data-test-id="conversation-title"]')?.textContent);

    if (titleFromHeader) {
      return titleFromHeader;
    }

    return extractWindowTitle() || "Gemini Chat";
  }

  function extractModelName() {
    const modelButton = document.querySelector('[data-test-id="bard-mode-menu-button"]');
    const modelText = normalizeText(modelButton?.textContent);

    return modelText;
  }

  function isChatPage() {
    return Boolean(document.querySelector("user-query, model-response"));
  }

  function getConversationScrollContainer(probeNode) {
    let current = probeNode?.parentElement || null;

    while (current) {
      const style = window.getComputedStyle(current);
      const overflowY = String(style.overflowY || "").toLowerCase();
      const canScroll = (overflowY.includes("auto") || overflowY.includes("scroll") || overflowY.includes("overlay"))
        && current.scrollHeight > current.clientHeight + 60;

      if (canScroll) {
        return current;
      }

      current = current.parentElement;
    }

    const scrollingRoot = document.scrollingElement || document.documentElement;
    return scrollingRoot instanceof HTMLElement ? scrollingRoot : null;
  }

  function scrollTopOf(container) {
    return Number(container?.scrollTop || 0);
  }

  function scrollLeftOf(container) {
    return Number(container?.scrollLeft || 0);
  }

  function scrollHeightOf(container) {
    return Number(container?.scrollHeight || 0);
  }

  function clientHeightOf(container) {
    return Number(container?.clientHeight || window.innerHeight || 0);
  }

  function setScrollTop(container, value) {
    if (!container) {
      return;
    }

    container.scrollTop = Number(value || 0);
  }

  function isDocumentScrollContainer(container) {
    const root = document.scrollingElement || document.documentElement;
    return container === root || container === document.documentElement || container === document.body;
  }

  function setScrollPosition(container, top, left) {
    if (!container) {
      return;
    }

    const safeTop = Number(top || 0);
    const safeLeft = Number(left || 0);

    if (isDocumentScrollContainer(container)) {
      window.scrollTo(safeLeft, safeTop);
      const root = document.scrollingElement || document.documentElement;
      if (root) {
        root.scrollTop = safeTop;
        root.scrollLeft = safeLeft;
      }
      if (document.body) {
        document.body.scrollTop = safeTop;
        document.body.scrollLeft = safeLeft;
      }
      return;
    }

    container.scrollTop = safeTop;
    container.scrollLeft = safeLeft;
  }

  function scrollToTopAnimated(container) {
    if (!container) {
      return;
    }

    const safeLeft = scrollLeftOf(container);

    try {
      if (isDocumentScrollContainer(container)) {
        window.scrollTo({
          top: 0,
          left: safeLeft,
          behavior: "smooth"
        });
        return;
      }

      if (typeof container.scrollTo === "function") {
        container.scrollTo({
          top: 0,
          left: safeLeft,
          behavior: "smooth"
        });
        return;
      }
    } catch (_error) {
      // Fall back to immediate positioning for hosts that reject smooth scroll.
    }

    setScrollPosition(container, 0, safeLeft);
  }

  function captureScrollPosition(container) {
    return {
      top: scrollTopOf(container),
      left: scrollLeftOf(container)
    };
  }

  function waitForRender(ms = 84) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        window.requestAnimationFrame(() => resolve());
      }, ms);
    });
  }

  async function restoreScrollPosition(container, snapshot) {
    if (!container || !snapshot) {
      return;
    }

    setScrollPosition(container, snapshot.top, snapshot.left);
    await waitForRender(24);
    setScrollPosition(container, snapshot.top, snapshot.left);
    await waitForRender(96);
    setScrollPosition(container, snapshot.top, snapshot.left);
  }

  async function runWithHydratedMessageNodes(selector, options, worker) {
    const readNodes = () => Array.from(document.querySelectorAll(selector));
    let messageNodes = readNodes();

    if (!messageNodes.length && options?.hydrateVirtualized !== false) {
      await waitForRender(140);
      messageNodes = readNodes();
    }

    if (options?.hydrateVirtualized === false || !messageNodes.length) {
      return worker(messageNodes);
    }

    const scrollContainer = getConversationScrollContainer(messageNodes[0]);
    if (!scrollContainer) {
      return worker(messageNodes);
    }

    const originalScroll = captureScrollPosition(scrollContainer);

    try {
      scrollToTopAnimated(scrollContainer);
      await waitForRender(260);
      scrollToTopAnimated(scrollContainer);

      let stablePasses = 0;
      let previousCount = messageNodes.length;

      // Simplified hydration strategy: move to top once and wait for
      // virtualized history to mount without incremental sweeping.
      for (let pass = 0; pass < 8; pass += 1) {
        await waitForRender(220);
        messageNodes = readNodes();

        const currentCount = messageNodes.length;
        const atTop = scrollTopOf(scrollContainer) <= 2;
        if (currentCount === previousCount && atTop) {
          stablePasses += 1;
          if (stablePasses >= 2) {
            break;
          }
        } else {
          stablePasses = 0;
        }

        previousCount = currentCount;
      }

      return worker(messageNodes);
    } finally {
      await restoreScrollPosition(scrollContainer, originalScroll);
    }
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

  function extractUserAttachments(userNode) {
    const uploadNodes = Array.from(userNode.querySelectorAll('[data-test-id="uploaded-file"]'));

    const items = uploadNodes.map((uploadNode) => {
      const uploadButton = uploadNode.querySelector("button[aria-label]");
      const explicitLabel = normalizeText(uploadButton?.getAttribute("aria-label"));
      const fileName = normalizeText(uploadNode.querySelector(".new-file-name")?.textContent);
      const fileType = normalizeText(uploadNode.querySelector(".new-file-type")?.textContent);

      const label = explicitLabel || normalizeText(`${fileName}${fileType ? `.${fileType.toLowerCase()}` : ""}`);

      if (!label) {
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

  function extractAssistantReferences(containerNode, contentRoot) {
    const anchorNodes = Array.from((contentRoot || containerNode).querySelectorAll("a[href]"));

    const items = anchorNodes.map((anchor) => {
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

  function pickUserContentRoot(userNode) {
    return userNode.querySelector(".query-text") || userNode;
  }

  function pickAssistantContentRoot(assistantNode) {
    const markdownNode = assistantNode.querySelector(".markdown");
    return markdownNode || assistantNode;
  }

  async function extractConversation(settings, options = {}) {
    const shouldExtractAssistantReferences = Boolean(
      settings.showAssistantUserAttachmentReferences
      || settings.showAssistantGeneratedAttachmentReferences
      || settings.showAssistantWebReferences
      || settings.showAssistantReferences
    );

    return runWithHydratedMessageNodes(
      "user-query, model-response",
      options,
      (messageNodes) => {
        const messages = [];

        for (let index = 0; index < messageNodes.length; index += 1) {
          const node = messageNodes[index];
          const isUserNode = node.matches("user-query");
          const messageId = `${isUserNode ? "gemini-user" : "gemini-assistant"}-${index + 1}`;

          if (isUserNode) {
            const contentRoot = pickUserContentRoot(node);
            const sanitized = root.sanitize.sanitizeMessageNode(contentRoot, {
              mediaHandling: settings.mediaHandling
            });
            const attachments = settings.showUserAttachmentNames ? extractUserAttachments(node) : [];
            const textContent = normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " "));

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

            continue;
          }

          const contentRoot = pickAssistantContentRoot(node);
          const sanitized = root.sanitize.sanitizeMessageNode(contentRoot, {
            mediaHandling: settings.mediaHandling
          });
          const references = shouldExtractAssistantReferences
            ? extractAssistantReferences(node, contentRoot)
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
        }

        const chatName = extractChatName();

        return {
          providerId: "gemini",
          sourceUrl: location.href,
          folderName: "",
          chatName,
          title: extractWindowTitle() || chatName,
          modelName: extractModelName(),
          messages
        };
      }
    );
  }

  function getLiveStatus() {
    return {
      isChatPage: isChatPage(),
      messageCount: document.querySelectorAll("user-query, model-response").length
    };
  }

  function findInlineActionAnchor() {
    const directShareButton = document.querySelector('[data-test-id="share-button"]');

    if (directShareButton && isVisibleElement(directShareButton)) {
      return {
        container: directShareButton.parentElement,
        referenceNode: directShareButton
      };
    }

    const candidates = Array.from(document.querySelectorAll("header button, header [role='button']"));

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
    id: "gemini",
    displayName: "Gemini",
    matchesUrl,
    isChatPage,
    extractConversation,
    getLiveStatus,
    findInlineActionAnchor
  });
})();
