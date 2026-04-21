/*
 * ChatGPT provider.
 * Uses conservative selectors based on the HTML provided by the user.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { ROLES } = root.constants;

  const MODEL_NAME_REGEX = /\b(?:ChatGPT\s*)?(?:GPT[-\s]?\d(?:\.\d+)?|GPT[-\s]?4o|GPT[-\s]?4\.1|GPT[-\s]?5|o[1345](?:-mini|-pro)?|4o(?:-mini)?|4\.1(?:-mini)?|gpt-[a-z0-9.-]+)\b/i;
  const THINKING_LABEL_REGEX = /\b(?:thinking|reasoning|reasoned|thought for|reasoned for|pensando|pens[oó]|pensamiento|razonando|razonamiento|reflexionando|reflexi[oó]n)\b/i;
  const THINKING_SECONDS_REGEX = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s|segundos?|seg)\b/i;
  const THINKING_DURATION_LABEL_REGEX = /(?:thought|thinking|reasoned|reasoning|pensado|pensando|pensamiento|razonando|razonamiento)(?:\s*(?:for|durante))?\s+([0-9hms.: ]+)/i;
  const SHARE_LABEL_REGEX = /\b(?:share|compartir)\b/i;
  const SOURCES_LABEL_REGEX = /^(?:fuentes?|sources?)$/i;
  const IGNORED_ASSISTANT_ACTION_LABEL_REGEX = /^(?:edit(?: image)?|editar(?: imagen)?|share(?: this image)?|compartir(?: esta imagen)?|copy(?: response)?|copiar(?: respuesta)?|like(?: this image)?|me gusta(?: esta imagen)?|dislike(?: this image)?|no me gusta(?: esta imagen)?|regenerate|regenerar|retry|reintentar|thumbs?\s*up|thumbs?\s*down|more actions?|m[aá]s acciones?|more options?|opciones?)$/i;
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

  function normalizeRole(rawRole) {
    return normalizeText(rawRole).toLowerCase();
  }

  function mapRole(rawRole) {
    const normalizedRole = normalizeRole(rawRole);
    if (normalizedRole === "user") {
      return ROLES.HUMAN;
    }

    if (normalizedRole === "assistant") {
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
    const normalizedRole = normalizeRole(rawRole);

    if (normalizedRole === "assistant") {
      const agentTurn = messageNode.querySelector(".agent-turn");
      if (agentTurn) {
        return agentTurn;
      }

      const markdown = messageNode.querySelector(".markdown");
      if (markdown) {
        return markdown;
      }

      const imageContainer = messageNode.querySelector(".group\\/imagegen-image, [id^='image-']");
      if (imageContainer) {
        return imageContainer;
      }
    }

    if (normalizedRole === "user") {
      const userBubble = messageNode.querySelector(".whitespace-pre-wrap");
      if (userBubble) {
        return userBubble;
      }
    }

    return messageNode;
  }

  function parseTurnOrder(section, fallback) {
    const dataTestId = normalizeText(section?.getAttribute?.("data-testid"));
    const orderMatch = dataTestId.match(/conversation-turn-(\d+)/i);
    if (orderMatch) {
      return Number(orderMatch[1]);
    }

    return Number(fallback || 0);
  }

  function hasRenderableTurnContent(section) {
    if (!section) {
      return false;
    }

    return Boolean(
      section.querySelector(
        [
          "[data-message-author-role]",
          ".agent-turn",
          ".markdown",
          ".whitespace-pre-wrap",
          ".user-message-bubble-color",
          "img",
          "video"
        ].join(", ")
      )
    );
  }

  function getEntryWeight(entryNode) {
    if (!entryNode) {
      return 0;
    }

    const textWeight = normalizeText(entryNode.textContent).length;
    const mediaWeight = entryNode.querySelectorAll("img, video, audio, canvas").length * 30;
    const richWeight = entryNode.querySelectorAll("p, li, pre, blockquote, table").length * 6;

    return textWeight + mediaWeight + richWeight;
  }

  function readEntryFromTurnSection(section, fallbackIndex) {
    const rawRole = normalizeRole(
      section.getAttribute("data-turn")
      || section.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role")
      || "unknown"
    );

    if (!rawRole) {
      return null;
    }

    const messageNode = section.querySelector("[data-message-author-role][data-message-id]")
      || section.querySelector("[data-message-author-role]");
    const messageId = messageNode?.getAttribute("data-message-id")
      || section.getAttribute("data-turn-id")
      || section.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container")
      || `chatgpt-turn-${fallbackIndex + 1}`;
    const clonedNode = section.cloneNode(true);

    return {
      node: clonedNode,
      rawRole,
      messageId,
      order: parseTurnOrder(section, fallbackIndex + 1),
      weight: getEntryWeight(clonedNode)
    };
  }

  function collectVisibleConversationEntries() {
    const entries = [];
    const turnSections = Array.from(
      document.querySelectorAll("section[data-testid^='conversation-turn-'][data-turn]")
    );

    for (let index = 0; index < turnSections.length; index += 1) {
      const section = turnSections[index];
      if (!hasRenderableTurnContent(section)) {
        continue;
      }

      const entry = readEntryFromTurnSection(section, index);
      if (!entry) {
        continue;
      }

      entries.push(entry);
    }

    const legacyNodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
    for (let index = 0; index < legacyNodes.length; index += 1) {
      const node = legacyNodes[index];
      if (node.closest("section[data-testid^='conversation-turn-'][data-turn]")) {
        continue;
      }

      const rawRole = normalizeRole(node.getAttribute("data-message-author-role") || "unknown");
      if (!rawRole) {
        continue;
      }

      const clonedNode = node.cloneNode(true);
      entries.push({
        node: clonedNode,
        rawRole,
        messageId: node.getAttribute("data-message-id") || `chatgpt-legacy-${index + 1}`,
        order: Number.MAX_SAFE_INTEGER - 1000 + index,
        weight: getEntryWeight(clonedNode)
      });
    }

    return entries.sort((left, right) => left.order - right.order);
  }

  function getScrollContainerFromSection(section) {
    let current = section?.parentElement || null;

    while (current) {
      const style = window.getComputedStyle(current);
      const overflowY = String(style.overflowY || "").toLowerCase();
      const canScroll = (overflowY.includes("auto") || overflowY.includes("scroll") || overflowY.includes("overlay"))
        && current.scrollHeight > current.clientHeight + 40;

      if (canScroll) {
        return current;
      }

      current = current.parentElement;
    }

    const fallbackRoot = document.scrollingElement || document.documentElement;
    return fallbackRoot instanceof HTMLElement ? fallbackRoot : null;
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
      // Some hosts bind scrolling to the root and ignore direct `scrollTop`
      // assignments intermittently during reflow, so set both APIs.
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

    // Restore repeatedly because virtualized list reflow can fight the first set.
    setScrollPosition(container, snapshot.top, snapshot.left);
    await waitForRender(24);
    setScrollPosition(container, snapshot.top, snapshot.left);
    await waitForRender(96);
    setScrollPosition(container, snapshot.top, snapshot.left);
  }

  function waitForRender(ms = 72) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        window.requestAnimationFrame(() => resolve());
      }, ms);
    });
  }

  async function collectConversationEntries(options = {}) {
    const initialSections = Array.from(
      document.querySelectorAll("section[data-testid^='conversation-turn-'][data-turn]")
    );
    let visibleEntries = collectVisibleConversationEntries();

    if (!visibleEntries.length && options.hydrateVirtualized !== false) {
      // Give ChatGPT one extra paint cycle when sections are still mounting.
      await waitForRender(132);
      visibleEntries = collectVisibleConversationEntries();
    }

    if (
      options.hydrateVirtualized === false
      || !visibleEntries.length
    ) {
      return visibleEntries;
    }

    const scrollContainer = getScrollContainerFromSection(initialSections[0]);
    if (!scrollContainer) {
      return visibleEntries;
    }

    const originalScroll = captureScrollPosition(scrollContainer);
    const collectedById = new Map();
    const mergeEntries = (entries) => {
      for (const entry of entries) {
        const key = String(entry.messageId || "");
        if (!key) {
          continue;
        }

        const existing = collectedById.get(key);
        if (!existing || entry.weight > existing.weight) {
          collectedById.set(key, entry);
        }
      }
    };

    try {
      mergeEntries(visibleEntries);
      setScrollTop(scrollContainer, scrollHeightOf(scrollContainer));
      for (let settlePass = 0; settlePass < 3; settlePass += 1) {
        await waitForRender(116 + (settlePass * 32));
        mergeEntries(collectVisibleConversationEntries());
      }

      let topHydrated = false;
      let topStablePasses = 0;
      let topPreviousCount = collectedById.size;
      let topPreviousHeight = scrollHeightOf(scrollContainer);

      // Phase 1 (preferred): force jump to top and wait until the virtualized
      // history stabilizes. This is the most reliable path on very long chats.
      for (let guard = 0; guard < 36; guard += 1) {
        const beforeTop = scrollTopOf(scrollContainer);

        setScrollTop(scrollContainer, 0);
        await waitForRender(132);
        mergeEntries(collectVisibleConversationEntries());
        setScrollTop(scrollContainer, 0);
        await waitForRender(208);
        mergeEntries(collectVisibleConversationEntries());

        const afterTop = scrollTopOf(scrollContainer);
        const afterCount = collectedById.size;
        const afterHeight = scrollHeightOf(scrollContainer);
        const discoveredNew = afterCount > topPreviousCount;
        const heightExpanded = Math.abs(afterHeight - topPreviousHeight) > 4;

        topPreviousCount = afterCount;
        topPreviousHeight = afterHeight;

        if (afterTop <= 1) {
          if (!discoveredNew && !heightExpanded) {
            topStablePasses += 1;
            if (topStablePasses >= 3) {
              topHydrated = true;
              break;
            }
          } else {
            topStablePasses = 0;
          }
          continue;
        }

        // If the container does not move towards top at all, fallback to step mode.
        if (Math.abs(afterTop - beforeTop) <= 2) {
          break;
        }
      }

      if (topHydrated) {
        const mergedEntries = Array.from(collectedById.values()).sort((left, right) => left.order - right.order);
        return mergedEntries.length ? mergedEntries : visibleEntries;
      }

      // Phase 2 (fallback): incremental sweep for hosts where direct top jumps
      // are throttled or partially ignored during hydration.
      let stepSize = Math.max(260, Math.round(clientHeightOf(scrollContainer) * 0.72));
      let stagnantPasses = 0;
      let noMovementPasses = 0;
      topStablePasses = 0;
      let previousCount = collectedById.size;

      for (let guard = 0; guard < 140; guard += 1) {
        const currentTop = scrollTopOf(scrollContainer);
        const beforeHeight = scrollHeightOf(scrollContainer);

        if (currentTop > 0) {
          setScrollTop(scrollContainer, Math.max(0, currentTop - stepSize));
        }

        await waitForRender(116);
        mergeEntries(collectVisibleConversationEntries());
        await waitForRender(164);
        mergeEntries(collectVisibleConversationEntries());

        const afterTop = scrollTopOf(scrollContainer);
        const afterHeight = scrollHeightOf(scrollContainer);
        const currentCount = collectedById.size;
        const discoveredNew = currentCount > previousCount;
        const heightExpanded = Math.abs(afterHeight - beforeHeight) > 4;
        const moved = Math.abs(afterTop - currentTop) > 2;

        if (discoveredNew || heightExpanded) {
          stagnantPasses = 0;
        } else {
          stagnantPasses += 1;
        }

        if (!moved && !discoveredNew && !heightExpanded) {
          noMovementPasses += 1;
        } else {
          noMovementPasses = 0;
        }

        previousCount = currentCount;

        const reachedTop = afterTop <= 1;
        if (reachedTop) {
          const countBeforeTopSettle = collectedById.size;
          // ChatGPT can prepend older turns asynchronously once top is reached.
          await waitForRender(208);
          mergeEntries(collectVisibleConversationEntries());
          await waitForRender(208);
          mergeEntries(collectVisibleConversationEntries());

          if (collectedById.size === countBeforeTopSettle) {
            topStablePasses += 1;
            if (topStablePasses >= 3) {
              break;
            }
          } else {
            topStablePasses = 0;
          }
        } else {
          topStablePasses = 0;
        }

        if (stagnantPasses >= 10) {
          // Back off with smaller jumps when lazy rendering is slow.
          stepSize = Math.max(180, Math.round(stepSize * 0.82));
          await waitForRender(248);
          mergeEntries(collectVisibleConversationEntries());
          stagnantPasses = 0;
        }

        if (noMovementPasses >= 8) {
          // Safety valve for unexpected containers that ignore scroll writes.
          if (scrollTopOf(scrollContainer) <= 1) {
            break;
          }
          noMovementPasses = 0;
        }
      }

      const mergedEntries = Array.from(collectedById.values()).sort((left, right) => left.order - right.order);
      return mergedEntries.length ? mergedEntries : visibleEntries;
    } finally {
      await restoreScrollPosition(scrollContainer, originalScroll);
    }
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

  function isLikelyUrlLabel(label) {
    return /^(?:https?:\/\/|www\.)/i.test(label);
  }

  function isCitationOnlyLabel(label) {
    const normalized = normalizeText(label).replace(/[\[\]().,:;#]/g, "");
    if (!normalized) {
      return false;
    }

    if (/^\d{1,4}$/.test(normalized)) {
      return true;
    }

    // ChatGPT web pills can be exported as labels like "arXiv+1".
    return /^.+\+\d{1,4}$/i.test(normalized);
  }

  function stripAssistantWebLinksFromNode(node, settings = {}) {
    if (!node || settings.showAssistantWebReferences) {
      return;
    }

    const anchors = Array.from(node.querySelectorAll("a[href]"));
    for (const anchor of anchors) {
      const href = normalizeText(anchor.getAttribute("href"));
      const label = normalizeReferenceLabel(
        anchor.getAttribute("aria-label")
        || anchor.getAttribute("title")
        || anchor.textContent
      );

      if (!href) {
        continue;
      }

      // Preserve file-like links; dedicated reference settings control visibility.
      if (isLikelyAttachmentHref(href) || isLikelyAttachmentLabel(label)) {
        continue;
      }

      const isCitationLink = isCitationOnlyLabel(label)
        || Boolean(anchor.querySelector("[data-testid*='citation-pill']"));

      if (isCitationLink || !label || isLikelyUrlLabel(label)) {
        anchor.remove();
        continue;
      }

      // Keep readable wording while removing outbound URL behavior.
      anchor.replaceWith(node.ownerDocument.createTextNode(label));
    }

    // Remove citation chips/pills that are rendered outside direct anchor text.
    const citationNodes = Array.from(
      node.querySelectorAll(
        [
          "[data-testid='webpage-citation-pill']",
          "[data-testid*='citation-pill']"
        ].join(", ")
      )
    );

    for (const citationNode of citationNodes) {
      const linkedWrapper = citationNode.closest("a[href]");
      if (linkedWrapper) {
        linkedWrapper.remove();
        continue;
      }

      citationNode.remove();
    }
  }

  function extractVisibleFileTileLabel(node) {
    const candidates = [
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.querySelector(".font-semibold")?.textContent,
      node.querySelector("[class*='font-semibold']")?.textContent,
      node.querySelector("p.truncate")?.textContent,
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

  function isIgnoredReferenceLabel(label) {
    return !label
      || SOURCES_LABEL_REGEX.test(label)
      || /^(\+\d+|pdf|documento|document)$/i.test(label);
  }

  function extractButtonReferenceLabel(node) {
    if (!node) {
      return "";
    }

    const candidates = [
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.querySelector("p.truncate")?.textContent,
      node.querySelector(".truncate")?.textContent,
      node.querySelector(".font-semibold")?.textContent,
      node.querySelector("[class*='font-semibold']")?.textContent,
      node.querySelector(".not-prose")?.textContent,
      node.textContent
    ];

    for (const candidate of candidates) {
      const label = normalizeReferenceLabel(candidate);
      if (!label || isIgnoredReferenceLabel(label) || label.length > 180) {
        continue;
      }

      if (IGNORED_ASSISTANT_ACTION_LABEL_REGEX.test(label)) {
        continue;
      }

      // Keep only content-bearing reference labels (file/url like) to avoid UI action text.
      if (isLikelyAttachmentLabel(label) || isLikelyUrlLabel(label)) {
        return label;
      }
    }

    return "";
  }

  function extractUserAttachmentTiles(messageNode) {
    const tileNodes = Array.from(
      messageNode.querySelectorAll(
        [
          '[role="group"][aria-label]',
          '[class*="file-tile"][aria-label]',
          '[class*="group/file-tile"]',
          '[data-default-action="true"] button[aria-label]',
          '[data-default-action="true"] button',
          'button[aria-haspopup="dialog"]',
          '.font-semibold',
          '[class*="font-semibold"]'
        ].join(", ")
      )
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

  function extractAssistantButtonReferences(messageNode, contentRoot) {
    const scope = contentRoot || messageNode;
    const buttons = Array.from(
      scope.querySelectorAll(
        [
          'button[aria-haspopup="dialog"]',
          'button .truncate',
          'button .not-prose',
          'button [class*="truncate"]',
          'button [class*="font-semibold"]'
        ].join(", ")
      )
    ).map((node) => node.closest("button")).filter(Boolean);

    const items = buttons.map((button) => {
      const label = extractButtonReferenceLabel(button);
      if (!label) {
        return null;
      }

      return {
        kind: isLikelyAttachmentLabel(label) ? "attachment" : "url",
        label,
        url: ""
      };
    }).filter(Boolean);

    return dedupeReferences(items);
  }

  function isLikelyThinkingLabelText(value) {
    const text = normalizeText(value);
    if (!text || text.length > 220) {
      return false;
    }

    if (!THINKING_LABEL_REGEX.test(text)) {
      return false;
    }

    if (THINKING_SECONDS_REGEX.test(text) || THINKING_DURATION_LABEL_REGEX.test(text)) {
      return true;
    }

    return /^(?:thought|thinking|reasoning|reasoned|pensado|pensando|pens[oó]|pensamiento|razonando|razonamiento)\b/i.test(text);
  }

  function findThinkingIndicatorInNode(node) {
    if (!node) {
      return null;
    }

    const probes = [
      node,
      ...Array.from(node.querySelectorAll(
        [
          ".text-token-text-tertiary",
          "summary",
          "details",
          '[aria-label*="think" i]',
          '[aria-label*="reason" i]',
          '[aria-label*="pens" i]',
          '[aria-label*="razon" i]',
          '[title*="think" i]',
          '[title*="reason" i]',
          '[title*="pens" i]',
          '[title*="razon" i]'
        ].join(", ")
      ))
    ];

    for (const probe of probes) {
      const candidateTexts = [
        probe.getAttribute?.("aria-label"),
        probe.getAttribute?.("title"),
        probe.textContent
      ]
        .map((value) => normalizeText(value))
        .filter(Boolean);

      const label = candidateTexts.find((text) => isLikelyThinkingLabelText(text));
      if (label) {
        return {
          indicatorNode: probe,
          indicatorText: label
        };
      }
    }

    return null;
  }

  function findStructuredThinkingBlock(turnNode) {
    if (!turnNode) {
      return null;
    }

    const assistantMessageNode = turnNode.querySelector("[data-message-author-role='assistant']");
    if (!assistantMessageNode) {
      return null;
    }

    // ChatGPT currently renders the "Thought for ..." block immediately
    // before the assistant message container inside the assistant turn.
    let sibling = assistantMessageNode.previousElementSibling;
    while (sibling) {
      if (!sibling.querySelector("[data-message-author-role]")) {
        const siblingIndicator = findThinkingIndicatorInNode(sibling);
        if (siblingIndicator) {
          return {
            thinkingRoot: sibling,
            indicatorNode: siblingIndicator.indicatorNode,
            indicatorText: siblingIndicator.indicatorText
          };
        }
      }

      sibling = sibling.previousElementSibling;
    }

    // Fallback for minor DOM variants where the thinking block is rendered
    // as a standalone details/summary node that still precedes assistant text.
    const fallbackCandidates = Array.from(
      turnNode.querySelectorAll("details, summary, [data-testid*='think'], [data-testid*='reason']")
    );

    for (const candidate of fallbackCandidates) {
      if (assistantMessageNode.contains(candidate) || candidate.contains(assistantMessageNode)) {
        continue;
      }

      if (!(candidate.compareDocumentPosition(assistantMessageNode) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        continue;
      }

      const candidateIndicator = findThinkingIndicatorInNode(candidate);
      if (!candidateIndicator) {
        continue;
      }

      return {
        thinkingRoot: candidate.closest("details") || candidate,
        indicatorNode: candidateIndicator.indicatorNode,
        indicatorText: candidateIndicator.indicatorText
      };
    }

    return null;
  }

  function removeStructuredThinkingFromAssistantRoot(contentRoot) {
    const thinkingBlock = findStructuredThinkingBlock(contentRoot);
    if (!thinkingBlock?.thinkingRoot?.parentElement) {
      return;
    }

    thinkingBlock.thinkingRoot.remove();
  }

  function prepareAssistantContentRootForSanitize(contentRoot, settings = {}) {
    const clone = contentRoot?.cloneNode?.(true);
    if (!clone) {
      return contentRoot;
    }

    // Ensure thought labels/blocks do not leak into assistant plain text output.
    removeStructuredThinkingFromAssistantRoot(clone);

    // Remove assistant web links from message body when web references are disabled.
    stripAssistantWebLinksFromNode(clone, settings);

    // Remove UI-only action surfaces that are not part of the assistant content.
    const uiOnlyNodes = Array.from(clone.querySelectorAll(
      [
        "[data-testid='image-gen-overlay-actions']",
        "[data-testid$='turn-action-button']",
        "[aria-label*='copy response' i]",
        "[aria-label*='copiar respuesta' i]",
        "[aria-label*='edit image' i]",
        "[aria-label*='editar imagen' i]",
        "[aria-label*='share this image' i]",
        "[aria-label*='compartir esta imagen' i]",
        "[aria-label*='like this image' i]",
        "[aria-label*='me gusta esta imagen' i]",
        "[aria-label*='dislike this image' i]",
        "[aria-label*='no me gusta esta imagen' i]"
      ].join(", ")
    ));
    uiOnlyNodes.forEach((node) => node.remove());

    // Keep only the primary generated image instance.
    Array.from(clone.querySelectorAll("img[aria-hidden='true']")).forEach((node) => node.remove());

    const buttons = Array.from(clone.querySelectorAll("button"));
    for (const button of buttons) {
      const label = extractButtonReferenceLabel(button);

      if (!label) {
        button.remove();
        continue;
      }

      const replacement = clone.ownerDocument.createElement("span");
      replacement.textContent = `[${label}]`;
      button.replaceWith(replacement);
    }

    return clone;
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

    const textNodes = Array.from(container.querySelectorAll("[dir='auto'], .truncate, span, div"));
    const candidateTexts = [];

    for (const node of textNodes) {
      const nodeText = normalizeText(node.textContent);
      if (!nodeText || nodeText.length > 180) {
        continue;
      }

      candidateTexts.push(nodeText);
    }

    const uniqueCandidates = Array.from(new Set(candidateTexts))
      .sort((left, right) => left.length - right.length);

    for (const candidate of uniqueCandidates) {
      if (candidate) {
        return candidate;
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

  function extractConversationNameFromSidebar() {
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

    const sidebarTitle = extractConversationNameFromSidebar();
    if (sidebarTitle) {
      return sidebarTitle;
    }

    return "ChatGPT Chat";
  }

  function extractWindowTitle() {
    const rawTitle = normalizeText(document.title || document.querySelector("title")?.textContent);

    if (!rawTitle) {
      return "";
    }

    const cleanedTitle = rawTitle
      .replace(/\s*[-|·•]\s*chatgpt$/i, "")
      .replace(/^chatgpt\s*[-|·•]\s*/i, "")
      .trim();

    if (!cleanedTitle || /^chatgpt$/i.test(cleanedTitle)) {
      return "";
    }

    return cleanedTitle;
  }

  function extractConversationName() {
    return extractConversationNameFromSidebar() || extractConversationTitle();
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
    // Keep extraction available when either reasoning text or thinking time is enabled.
    if (!settings.includeThinking && !settings.includeThinkingDuration) {
      return null;
    }

    const thinkingBlock = findStructuredThinkingBlock(messageNode);
    if (!thinkingBlock) {
      return null;
    }

    const indicatorText = normalizeText(thinkingBlock.indicatorText);
    const thinkingRoot = thinkingBlock.thinkingRoot?.closest?.("details")
      || thinkingBlock.thinkingRoot
      || thinkingBlock.indicatorNode;
    const sanitized = root.sanitize.sanitizeMessageNode(thinkingRoot, {
      mediaHandling: settings.mediaHandling
    });

    const stripped = normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " "));
    const secondsMatch = (
      indicatorText.match(THINKING_SECONDS_REGEX)
      || normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " ")).match(THINKING_SECONDS_REGEX)
    );
    const durationMatch = (
      indicatorText.match(THINKING_DURATION_LABEL_REGEX)
      || normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " ")).match(THINKING_DURATION_LABEL_REGEX)
    );
    const thinkingDurationLabel = durationMatch ? normalizeText(durationMatch[1]) : "";

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
      thinkingSeconds: secondsMatch ? secondsMatch[1] : null,
      thinkingLabel: normalizeText(indicatorText),
      thinkingDurationLabel
    };
  }

  async function extractConversation(settings, options = {}) {
    const rawEntries = await collectConversationEntries(options);
    const seenIds = new Set();
    const messages = [];

    const shouldExtractAssistantReferences = Boolean(
      settings.showAssistantUserAttachmentReferences
      || settings.showAssistantGeneratedAttachmentReferences
      || settings.showAssistantWebReferences
      || settings.showAssistantReferences
    );

    for (let index = 0; index < rawEntries.length; index += 1) {
      const entry = rawEntries[index];
      const node = entry.node;
      const rawRole = entry.rawRole || "unknown";
      const messageId = entry.messageId || `chatgpt-${index + 1}`;

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
      const sanitizeRoot = rawRole === "assistant"
        ? prepareAssistantContentRootForSanitize(contentRoot, settings)
        : contentRoot;
      const sanitized = root.sanitize.sanitizeMessageNode(sanitizeRoot, {
        mediaHandling: settings.mediaHandling
      });
      const userAttachments = rawRole === "user" && settings.showUserAttachmentNames
        ? extractUserAttachmentReferences(node)
        : [];
      const assistantReferences = rawRole === "assistant" && shouldExtractAssistantReferences
        ? dedupeReferences([
            ...extractAssistantReferences(node, contentRoot),
            ...extractAssistantButtonReferences(node, contentRoot)
          ])
        : [];

      const stripped = normalizeText((sanitized.safeHtml || "").replace(/<[^>]*>/g, " "));
      if (!stripped && !sanitized.hasMedia && !userAttachments.length && !assistantReferences.length) {
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
      chatName: extractConversationName(),
      title: extractWindowTitle() || extractConversationTitle(),
      modelName: extractModelName(),
      messages
    };
  }

  function getLiveStatus() {
    const roleCount = document.querySelectorAll("[data-message-author-role]").length;
    const turnCount = document.querySelectorAll("section[data-testid^='conversation-turn-'][data-turn]").length;
    return {
      isChatPage: isChatPage(),
      messageCount: Math.max(roleCount, turnCount)
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
