/*
 * Claude provider adapter.
 * It extracts user/assistant turns and normalizes them into the shared pipeline.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { ROLES } = root.constants;

  const HOSTNAME = "claude.ai";
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
      .replace(/\s*[-|·•]\s*claude$/i, "")
      .replace(/^claude\s*[-|·•]\s*/i, "")
      .trim();

    if (!cleanedTitle || /^claude$/i.test(cleanedTitle)) {
      return "";
    }

    return cleanedTitle;
  }

  function extractChatName() {
    const titleFromHeader = normalizeText(
      document.querySelector('[data-testid="chat-title-button"] .truncate')?.textContent
      || document.querySelector('[data-testid="chat-title-button"]')?.textContent
    );

    if (titleFromHeader) {
      return titleFromHeader;
    }

    return extractWindowTitle() || "Claude Chat";
  }

  function extractModelName() {
    return normalizeText(document.querySelector('[data-testid="model-selector-dropdown"]')?.textContent);
  }

  function isChatPage() {
    return Boolean(document.querySelector('[data-testid="user-message"], div[data-is-streaming]'));
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
    const requestedBudgetMs = Number(options?.maxHydrationMs);
    const maxHydrationMs = Number.isFinite(requestedBudgetMs)
      ? Math.max(1200, Math.round(requestedBudgetMs))
      : 120000;
    const hydrationStartedAt = Date.now();
    const hydrationBudgetExceeded = () => (Date.now() - hydrationStartedAt) >= maxHydrationMs;
    const topReachThreshold = 2;

    const ensureScrolledToTop = async () => {
      let reachedTopPasses = 0;

      while (!hydrationBudgetExceeded()) {
        scrollToTopAnimated(scrollContainer);
        await waitForRender(180);
        messageNodes = readNodes();

        const atTop = scrollTopOf(scrollContainer) <= topReachThreshold;
        if (atTop) {
          reachedTopPasses += 1;
          if (reachedTopPasses >= 2) {
            return true;
          }
        } else {
          reachedTopPasses = 0;
        }
      }

      return false;
    };

    try {
      const reachedTop = await ensureScrolledToTop();
      if (!reachedTop) {
        throw new Error("HYDRATION_TOP_REACH_FAILED: Claude history did not reach top within timeout.");
      }

      const requiredQuietMs = Math.min(6000, Math.max(2500, Math.round(maxHydrationMs * 0.04)));
      let maxCountSeen = messageNodes.length;
      let maxHeightSeen = scrollHeightOf(scrollContainer);
      let lastGrowthAt = Date.now();

      // Keep top anchored and wait for a continuous quiet window. Some
      // virtualized hosts prepend more messages after first hitting top.
      while (!hydrationBudgetExceeded()) {
        await waitForRender(260);
        messageNodes = readNodes();

        let atTop = scrollTopOf(scrollContainer) <= topReachThreshold;
        if (!atTop) {
          const reachedTopAgain = await ensureScrolledToTop();
          if (!reachedTopAgain) {
            throw new Error("HYDRATION_TOP_REACH_FAILED: Claude history lost top position before completion.");
          }
          atTop = true;
        }

        const currentCount = messageNodes.length;
        const currentHeight = scrollHeightOf(scrollContainer);
        const discoveredGrowth = currentCount > maxCountSeen || currentHeight > (maxHeightSeen + 4);
        if (discoveredGrowth) {
          lastGrowthAt = Date.now();
        }

        maxCountSeen = Math.max(maxCountSeen, currentCount);
        maxHeightSeen = Math.max(maxHeightSeen, currentHeight);

        if (atTop && (Date.now() - lastGrowthAt) >= requiredQuietMs) {
          break;
        }
      }

      if (hydrationBudgetExceeded()) {
        throw new Error("HYDRATION_TOP_REACH_FAILED: Claude history kept growing until hydration timeout.");
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
    // Claude renders upload tiles in the same turn container as the user bubble.
    const turnRoot = userNode.closest('[data-test-render-count]') || userNode.closest('.group') || userNode;
    const tileNodes = Array.from(turnRoot.querySelectorAll('[data-testid="file-thumbnail"]'));

    const items = tileNodes.map((tileNode) => {
      const label = normalizeText(
        tileNode.querySelector("h3")?.textContent
        || tileNode.querySelector('[aria-label]')?.getAttribute("aria-label")
        || tileNode.textContent
      );

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

  function pickAssistantContentRoot(containerNode) {
    return containerNode.querySelector(".response-content-markdown, .standard-markdown, .progressive-markdown, .markdown") || containerNode;
  }

  async function extractConversation(settings, options = {}) {
    const shouldExtractAssistantReferences = Boolean(
      settings.showAssistantUserAttachmentReferences
      || settings.showAssistantGeneratedAttachmentReferences
      || settings.showAssistantWebReferences
      || settings.showAssistantReferences
    );

    return runWithHydratedMessageNodes(
      '[data-testid="user-message"], div[data-is-streaming]',
      options,
      (messageNodes) => {
        const messages = [];

        for (let index = 0; index < messageNodes.length; index += 1) {
          const node = messageNodes[index];
          const isUserNode = node.matches('[data-testid="user-message"]');
          const messageId = `${isUserNode ? "claude-user" : "claude-assistant"}-${index + 1}`;

          if (isUserNode) {
            const sanitized = root.sanitize.sanitizeMessageNode(node, {
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
          providerId: "claude",
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
      messageCount: document.querySelectorAll('[data-testid="user-message"], div[data-is-streaming]').length
    };
  }

  function findInlineActionAnchor() {
    const directShareButton = document.querySelector('[data-testid="wiggle-controls-actions-share"]');

    if (directShareButton && isVisibleElement(directShareButton)) {
      return {
        container: directShareButton.parentElement,
        referenceNode: directShareButton
      };
    }

    const candidates = Array.from(document.querySelectorAll("header button, header [role='button'], main header button"));

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
    id: "claude",
    displayName: "Claude",
    matchesUrl,
    isChatPage,
    extractConversation,
    getLiveStatus,
    findInlineActionAnchor
  });
})();
