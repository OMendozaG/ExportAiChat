/*
 * DeepSeek provider adapter.
 * It is resilient to hash-like class names by relying on list-item markers first.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { ROLES } = root.constants;

  const HOSTNAME = "chat.deepseek.com";
  const THINKING_SECONDS_REGEX = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s|segundos?|seg)\b/i;
  const THINKING_DURATION_LABEL_REGEX = /(?:thought|thinking|reasoning|pensado|pensando|pensamiento|razonando|razonamiento)(?:\s*(?:for|durante))?\s+([0-9hms.: ]+)/i;
  const THINKING_LABEL_REGEX = /\b(?:pens[oó]\s+durante|thinking|reasoning)\b/i;
  const THINKING_ONLY_TEXT_REGEX = /^(?:pens[oó]\s+por\s+.+|thought(?:\s+for)?\s+.+|thinking(?:\s+for)?\s+.+|reasoning(?:\s+for)?\s+.+)$/i;
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

  function getHeaderRightBoundary() {
    // Focus on the main chat area controls (share/actions), not the sidebar or app shell.
    if (window.innerWidth <= 960) {
      return window.innerWidth * 0.46;
    }

    return window.innerWidth * 0.55;
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

    if (rect.right < getHeaderRightBoundary()) {
      return false;
    }

    return true;
  }

  function scoreActionCandidate(element) {
    const rect = normalizeRect(element.getBoundingClientRect());
    const preferredTop = window.innerWidth <= 960 ? 84 : 112;
    const topPenalty = Math.abs(rect.top - preferredTop);

    return (
      (rect.right * 0.022)
      + (rect.width * 0.28)
      + (rect.height * 0.18)
      - (topPenalty * 0.55)
    );
  }

  function isHorizontalActionContainer(element) {
    if (!element || !isVisibleElement(element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const display = normalizeText(style.display).toLowerCase();
    const flexDirection = normalizeText(style.flexDirection).toLowerCase();
    const flexWrap = normalizeText(style.flexWrap).toLowerCase();

    if (display !== "flex" && display !== "inline-flex") {
      return false;
    }

    if (flexDirection.startsWith("column")) {
      return false;
    }

    // Wrapped rows can place the export button above/below Share.
    // Keep climbing until we find a non-wrapping row.
    if (flexWrap && flexWrap !== "nowrap") {
      return false;
    }

    return element.children.length >= 2;
  }

  function resolveInlineInsertionTarget(referenceNode) {
    if (!referenceNode) {
      return {
        container: null,
        referenceNode: null
      };
    }

    // Walk up to find a real horizontal action row; this avoids attaching
    // to an inner wrapper that stacks siblings vertically.
    let current = referenceNode;
    for (let depth = 0; depth < 5 && current && current.parentElement; depth += 1) {
      const parent = current.parentElement;

      if (isHorizontalActionContainer(parent)) {
        return {
          container: parent,
          referenceNode: current
        };
      }

      current = parent;
    }

    return {
      container: referenceNode.parentElement || null,
      referenceNode
    };
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
    return Boolean(
      document.querySelector(
        "[data-virtual-list-item-key], .ds-virtual-list, textarea[placeholder*='DeepSeek' i]"
      )
    );
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
    const durationMatch = (thinkingLabel || "").match(THINKING_DURATION_LABEL_REGEX);

    return {
      id: `${messageId}-thinking`,
      role: ROLES.ASSISTANT,
      safeHtml,
      hasMedia,
      isThinking: true,
      thinkingSeconds: secondsMatch ? secondsMatch[1] : null,
      thinkingLabel: thinkingLabel || "",
      thinkingDurationLabel: durationMatch ? normalizeText(durationMatch[1]) : ""
    };
  }

  function isThinkingOnlyAssistantText(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return false;
    }

    if (normalized.length > 120) {
      return false;
    }

    return THINKING_ONLY_TEXT_REGEX.test(normalized);
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

    // Fallback for non-markdown assistant replies (for example media-only turns)
    // while ignoring elements nested inside the thinking container.
    const mediaNode = Array.from(turnNode.querySelectorAll("img, video, canvas, figure, picture"))
      .find((node) => !node.closest(".ds-think-content"));
    if (mediaNode) {
      return mediaNode.closest("figure, picture, div") || mediaNode;
    }

    // If there is no answer content outside thinking, avoid duplicating
    // the thinking note as a separate assistant message.
    return null;
  }

  function parsePositiveNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
  }

  function isLikelyDecorativeSvg(svgNode) {
    if (!svgNode || String(svgNode.tagName || "").toLowerCase() !== "svg") {
      return false;
    }

    const label = normalizeText(
      svgNode.getAttribute?.("aria-label")
      || svgNode.getAttribute?.("title")
      || svgNode.querySelector?.("title")?.textContent
      || svgNode.querySelector?.("desc")?.textContent
    );
    if (label) {
      return false;
    }

    const inlineText = normalizeText(svgNode.textContent);
    if (inlineText) {
      return false;
    }

    const width = parsePositiveNumber(svgNode.getAttribute?.("width"));
    const height = parsePositiveNumber(svgNode.getAttribute?.("height"));
    const viewBox = String(svgNode.getAttribute?.("viewBox") || "").trim();
    const viewBoxParts = viewBox.split(/\s+/).map((part) => Number(part));
    const viewBoxWidth = Number.isFinite(viewBoxParts[2]) ? Math.abs(viewBoxParts[2]) : 0;
    const viewBoxHeight = Number.isFinite(viewBoxParts[3]) ? Math.abs(viewBoxParts[3]) : 0;

    // Keep clearly large SVG illustrations and discard tiny icon-like vectors.
    const largestDimension = Math.max(width, height, viewBoxWidth, viewBoxHeight);
    if (largestDimension >= 120) {
      return false;
    }

    return true;
  }

  function prepareContentRootForSanitize(contentRoot) {
    const clone = contentRoot?.cloneNode?.(true);
    if (!clone) {
      return contentRoot;
    }

    // Drop decorative SVG icons (citation/action glyphs) that would otherwise
    // become repeated "[SVG: non-textual content]" placeholders.
    Array.from(clone.querySelectorAll("svg")).forEach((svgNode) => {
      if (isLikelyDecorativeSvg(svgNode)) {
        svgNode.remove();
      }
    });

    return clone;
  }

  function hasAssistantRenderableContent(turnNode) {
    return Boolean(
      turnNode.querySelector(
        [
          ".ds-markdown",
          ".ds-think-content",
          ".ds-markdown-image",
          "img",
          "video",
          "canvas",
          ".katex",
          ".ds-markdown-code-block"
        ].join(", ")
      )
    );
  }

  function isAssistantTurn(turnNode) {
    if (!turnNode) {
      return false;
    }

    if (turnNode.classList?.contains("_4f9bf79") || turnNode.querySelector("._4f9bf79")) {
      return true;
    }

    return hasAssistantRenderableContent(turnNode) && !turnNode.querySelector(".fbb737a4");
  }

  function pickUserContentRoot(turnNode) {
    return turnNode.querySelector(".fbb737a4, [class*='fbb737a4'], ._72b6158") || turnNode;
  }

  function hasUserRenderableContent(turnNode) {
    const userRoot = pickUserContentRoot(turnNode);
    if (!userRoot) {
      return false;
    }

    const text = normalizeText(userRoot.textContent);
    return Boolean(text || userRoot.querySelector("img, video, audio, canvas"));
  }

  function isUserTurn(turnNode) {
    if (!turnNode) {
      return false;
    }

    if (turnNode.classList?.contains("_9663006") || turnNode.querySelector("._9663006")) {
      return true;
    }

    return hasUserRenderableContent(turnNode) && !turnNode.querySelector(".ds-markdown");
  }

  function extractTurnOrder(turnNode, fallbackIndex) {
    const key = normalizeText(turnNode.getAttribute("data-virtual-list-item-key"));
    const numericFromKey = Number(key);
    if (Number.isFinite(numericFromKey)) {
      return numericFromKey;
    }

    return fallbackIndex + 1;
  }

  function entryWeight(turnNode) {
    if (!turnNode) {
      return 0;
    }

    const textWeight = normalizeText(turnNode.textContent).length;
    const mediaWeight = turnNode.querySelectorAll("img, video, audio, canvas").length * 30;
    const richWeight = turnNode.querySelectorAll("p, li, pre, blockquote, table").length * 8;
    return textWeight + mediaWeight + richWeight;
  }

  function readVisibleTurnEntries() {
    const nodes = Array.from(document.querySelectorAll("[data-virtual-list-item-key]"));
    return nodes.map((node, index) => {
      const key = normalizeText(node.getAttribute("data-virtual-list-item-key")) || `idx-${index + 1}`;
      return {
        key,
        order: extractTurnOrder(node, index),
        weight: entryWeight(node),
        node: node.cloneNode(true)
      };
    });
  }

  function getConversationScrollContainer() {
    const probe = document.querySelector("[data-virtual-list-item-key]");
    let current = probe?.parentElement || null;

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
      // Keep both assignment paths because some host layouts only honor one.
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

  function captureScrollPosition(container) {
    return {
      top: scrollTopOf(container),
      left: scrollLeftOf(container)
    };
  }

  async function restoreScrollPosition(container, snapshot) {
    if (!container || !snapshot) {
      return;
    }

    // Restore repeatedly because virtualization/repaint may override first write.
    setScrollPosition(container, snapshot.top, snapshot.left);
    await waitForRender(24);
    setScrollPosition(container, snapshot.top, snapshot.left);
    await waitForRender(96);
    setScrollPosition(container, snapshot.top, snapshot.left);
  }

  function waitForRender(ms = 84) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        window.requestAnimationFrame(() => resolve());
      }, ms);
    });
  }

  async function collectTurnEntries(options = {}) {
    const visibleEntries = readVisibleTurnEntries();

    if (
      options.hydrateVirtualized === false
      || visibleEntries.length <= 0
    ) {
      return visibleEntries;
    }

    const scrollContainer = getConversationScrollContainer();
    if (!scrollContainer) {
      return visibleEntries;
    }

    const originalScroll = captureScrollPosition(scrollContainer);
    const collectedByKey = new Map();
    const mergeEntries = (entries) => {
      entries.forEach((entry) => {
        const key = String(entry.key || "");
        if (!key) {
          return;
        }

        const existing = collectedByKey.get(key);
        if (!existing || entry.weight > existing.weight) {
          collectedByKey.set(key, entry);
        }
      });
    };

    try {
      mergeEntries(visibleEntries);
      setScrollTop(scrollContainer, scrollHeightOf(scrollContainer));
      await waitForRender();
      mergeEntries(readVisibleTurnEntries());

      const stepSize = Math.max(420, Math.round(clientHeightOf(scrollContainer) * 0.78));
      let stagnantPasses = 0;
      let previousCount = collectedByKey.size;

      for (let guard = 0; guard < 120; guard += 1) {
        const currentTop = scrollTopOf(scrollContainer);
        if (currentTop <= 0) {
          break;
        }

        setScrollTop(scrollContainer, Math.max(0, currentTop - stepSize));
        await waitForRender();
        mergeEntries(readVisibleTurnEntries());

        if (collectedByKey.size === previousCount) {
          stagnantPasses += 1;
          if (stagnantPasses >= 5) {
            break;
          }
        } else {
          previousCount = collectedByKey.size;
          stagnantPasses = 0;
        }
      }

      const merged = Array.from(collectedByKey.values())
        .sort((left, right) => left.order - right.order);
      return merged.length ? merged : visibleEntries;
    } finally {
      await restoreScrollPosition(scrollContainer, originalScroll);
    }
  }

  async function extractConversation(settings) {
    const shouldExtractAssistantReferences = Boolean(
      settings.showAssistantUserAttachmentReferences
      || settings.showAssistantGeneratedAttachmentReferences
      || settings.showAssistantWebReferences
      || settings.showAssistantReferences
    );

    const turnEntries = await collectTurnEntries({ hydrateVirtualized: true });
    const messages = [];

    for (let index = 0; index < turnEntries.length; index += 1) {
      const turnNode = turnEntries[index].node;
      const messageId = `deepseek-${index + 1}`;
      const hasAssistantContent = hasAssistantRenderableContent(turnNode);
      const hasUserContent = hasUserRenderableContent(turnNode);
      const assistantTurn = isAssistantTurn(turnNode);
      const userTurn = isUserTurn(turnNode);

      if (!hasAssistantContent && !hasUserContent) {
        continue;
      }

      if (assistantTurn || (hasAssistantContent && !userTurn)) {
        const thinkingMessage = buildThinkingMessage(turnNode, settings, messageId);
        if (thinkingMessage) {
          messages.push(thinkingMessage);
        }

        const contentRoot = pickAssistantContentRoot(turnNode);
        if (!contentRoot) {
          continue;
        }

        const sanitizeRoot = prepareContentRootForSanitize(contentRoot);
        const sanitized = root.sanitize.sanitizeMessageNode(sanitizeRoot, {
          mediaHandling: settings.mediaHandling
        });
        const references = shouldExtractAssistantReferences
          ? extractAssistantReferences(turnNode, contentRoot)
          : [];
        const textContent = normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " "));

        // Avoid generating a separate assistant message for the thinking label
        // when DeepSeek exposes it outside the answer body.
        if (isThinkingOnlyAssistantText(textContent) && !sanitized.hasMedia && !references.length) {
          continue;
        }

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
      const sanitizeRoot = prepareContentRootForSanitize(contentRoot);
      const sanitized = root.sanitize.sanitizeMessageNode(sanitizeRoot, {
        mediaHandling: settings.mediaHandling
      });
      const textContent = normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " "));

      if (!textContent && !sanitized.hasMedia) {
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
    const conversationTurns = turnNodes.filter((turnNode) => (
      hasAssistantRenderableContent(turnNode) || hasUserRenderableContent(turnNode)
    ));

    return {
      isChatPage: isChatPage(),
      messageCount: conversationTurns.length
    };
  }

  function findInlineActionAnchor() {
    const candidates = collectTopHeaderControls();
    const buildAnchor = (referenceNode) => {
      if (!referenceNode) {
        return null;
      }

      const insertionTarget = resolveInlineInsertionTarget(referenceNode);

      return {
        container: insertionTarget.container,
        referenceNode: insertionTarget.referenceNode,
        styleReferenceNode: referenceNode,
        // DeepSeek integration requirement: place export ahead of the share icon.
        preferBefore: true
      };
    };
    const pickBestCandidate = (list) => {
      if (!list.length) {
        return null;
      }

      const sorted = [...list].sort((left, right) => scoreActionCandidate(right) - scoreActionCandidate(left));
      return sorted[0];
    };

    const shareByText = candidates.filter((candidate) => {
      const label = normalizeText(
        candidate.getAttribute("aria-label")
        || candidate.getAttribute("title")
        || candidate.textContent
      );
      return Boolean(label && SHARE_LABEL_REGEX.test(label));
    });

    const shareLabelButton = pickBestCandidate(shareByText);
    if (shareLabelButton) {
      return buildAnchor(shareLabelButton);
    }

    // Fallback 1: DeepSeek often renders share as an icon-only control.
    const shareIconButton = pickBestCandidate(candidates.filter((candidate) => hasShareIconGlyph(candidate)));
    if (shareIconButton) {
      return buildAnchor(shareIconButton);
    }

    // Fallback 2: use the nearest top-right action row and attach before its first control.
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
      if (
        containerRect.top < -8
        || containerRect.top > 340
        || containerRect.left < getHeaderLeftBoundary()
        || containerRect.right < getHeaderRightBoundary()
      ) {
        return;
      }

      const leftMostButton = buttons.reduce((currentBest, candidate) => {
        if (!currentBest) {
          return candidate;
        }

        const bestRect = normalizeRect(currentBest.getBoundingClientRect());
        const nextRect = normalizeRect(candidate.getBoundingClientRect());
        return nextRect.left < bestRect.left ? candidate : currentBest;
      }, null);

      if (!leftMostButton) {
        return;
      }

      // Prefer richer action rows in the chat title/header zone.
      const leftMostRect = normalizeRect(leftMostButton.getBoundingClientRect());
      const score = (
        buttons.length * 10
        + containerRect.right * 0.012
        - Math.abs(containerRect.top - 112) * 0.3
        + Math.max(0, leftMostRect.left - getHeaderLeftBoundary()) * 0.004
      );

      if (score > bestScore) {
        bestScore = score;
        bestGroup = {
          container,
          referenceNode: leftMostButton,
          preferBefore: true
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
