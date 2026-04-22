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
  const TURN_SECTION_SELECTOR = "section[data-testid^='conversation-turn-']";

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

  function inferRoleFromTurnSection(section) {
    if (!section) {
      return "";
    }

    if (section.querySelector("[data-message-author-role='user'], .user-message-bubble-color")) {
      return "user";
    }

    if (section.querySelector("[data-message-author-role='assistant'], .agent-turn, .markdown")) {
      return "assistant";
    }

    const srOnlyHeading = normalizeText(section.querySelector("h4.sr-only")?.textContent);
    if (/^(?:you said|t[úu]\s+dijiste)\b/i.test(srOnlyHeading)) {
      return "user";
    }

    if (/\b(?:chatgpt|assistant)\b/i.test(srOnlyHeading)) {
      return "assistant";
    }

    return "";
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
          ".prose",
          ".text-message",
          ".whitespace-pre-wrap",
          ".user-message-bubble-color",
          "[data-message-id]",
          "[data-message-model-slug]",
          "[data-turn-start-message]",
          "[data-turn-message-id]",
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

  function isSyntheticEntryId(value) {
    const normalized = normalizeText(value);
    return /^chatgpt-(?:turn|legacy)-\d+$/i.test(normalized);
  }

  function fingerprintEntryNode(entryNode) {
    if (!entryNode) {
      return "";
    }

    const normalizedText = normalizeText(entryNode.textContent).toLowerCase();
    const head = normalizedText.slice(0, 220);
    const tail = normalizedText.length > 220 ? normalizedText.slice(-120) : "";
    const mediaSignature = [
      entryNode.querySelectorAll("img").length,
      entryNode.querySelectorAll("video").length,
      entryNode.querySelectorAll("audio").length,
      entryNode.querySelectorAll("canvas").length,
      entryNode.querySelectorAll("a[href]").length
    ].join(":");
    const raw = `${head}|${tail}|${normalizedText.length}|${mediaSignature}`;

    // Lightweight stable hash for merge-key fallback when real turn/message ids
    // are missing in virtualized DOM variants.
    let hash = 2166136261;
    for (let index = 0; index < raw.length; index += 1) {
      hash ^= raw.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function entryMergeKey(entry) {
    const roleKey = normalizeRole(entry?.rawRole || "unknown") || "unknown";
    const fingerprint = normalizeText(entry?.contentFingerprint);
    const turnId = normalizeText(entry?.turnId);
    if (turnId) {
      if (isSyntheticEntryId(turnId) && fingerprint) {
        return `${turnId}::${roleKey}::${fingerprint}`;
      }
      return `${turnId}::${roleKey}`;
    }

    const messageId = normalizeText(entry?.messageId);
    if (messageId) {
      if (isSyntheticEntryId(messageId) && fingerprint) {
        return `${messageId}::${roleKey}::${fingerprint}`;
      }
      return `${messageId}::${roleKey}`;
    }

    const dataTestId = normalizeText(entry?.dataTestId);
    if (dataTestId) {
      return fingerprint
        ? `${dataTestId}::${roleKey}::${fingerprint}`
        : `${dataTestId}::${roleKey}`;
    }

    const order = Number(entry?.order || 0);
    return fingerprint
      ? `chatgpt-order-${order}::${roleKey}::${fingerprint}`
      : `chatgpt-order-${order}::${roleKey}::w${Number(entry?.weight || 0)}`;
  }

  function readEntryFromTurnSection(section, fallbackIndex) {
    const rawRole = normalizeRole(
      section.getAttribute("data-turn")
      || section.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role")
      || inferRoleFromTurnSection(section)
      || "unknown"
    );

    if (!rawRole) {
      return null;
    }

    const messageNode = section.querySelector("[data-message-author-role][data-message-id]")
      || section.querySelector("[data-message-author-role]")
      || section.querySelector("[data-message-id]")
      || section.querySelector("[data-turn-start-message]")
      || section.querySelector(".text-message")
      || section.querySelector(".agent-turn")
      || section;
    const dataTestId = normalizeText(section.getAttribute("data-testid"));
    const explicitTurnId = section.getAttribute("data-turn-id")
      || section.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container")
      || section.getAttribute("data-turn-start-message")
      || section.querySelector("[data-turn-start-message]")?.getAttribute("data-turn-start-message")
      || "";
    const explicitMessageId = messageNode?.getAttribute("data-message-id")
      || section.getAttribute("data-message-id")
      || section.getAttribute("data-turn-message-id")
      || section.querySelector("[data-turn-message-id]")?.getAttribute("data-turn-message-id")
      || "";
    const turnId = normalizeText(
      explicitTurnId
      || explicitMessageId
      || dataTestId
      || `chatgpt-turn-${fallbackIndex + 1}`
    );
    const messageId = normalizeText(
      explicitMessageId
      || explicitTurnId
      || dataTestId
      || turnId
    );
    const clonedNode = section.cloneNode(true);

    return {
      node: clonedNode,
      rawRole,
      turnId,
      messageId,
      dataTestId,
      order: parseTurnOrder(section, fallbackIndex + 1),
      weight: getEntryWeight(clonedNode),
      contentFingerprint: fingerprintEntryNode(clonedNode)
    };
  }

  function collectVisibleConversationEntries() {
    const entries = [];
    const turnSections = Array.from(
      document.querySelectorAll(TURN_SECTION_SELECTOR)
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
      if (node.closest(TURN_SECTION_SELECTOR)) {
        continue;
      }

      const rawRole = normalizeRole(node.getAttribute("data-message-author-role") || "unknown");
      if (!rawRole) {
        continue;
      }

      const clonedNode = node.cloneNode(true);
      const dataTestId = normalizeText(node.getAttribute("data-testid"));
      const explicitMessageId = normalizeText(node.getAttribute("data-message-id"));

      entries.push({
        node: clonedNode,
        rawRole,
        turnId: explicitMessageId || dataTestId || `chatgpt-legacy-${index + 1}`,
        messageId: explicitMessageId || dataTestId || `chatgpt-legacy-${index + 1}`,
        dataTestId,
        order: Number.MAX_SAFE_INTEGER - 1000 + index,
        weight: getEntryWeight(clonedNode),
        contentFingerprint: fingerprintEntryNode(clonedNode)
      });
    }

    return entries.sort((left, right) => left.order - right.order);
  }

  function shouldRunTurnHydrationSweep(totalTurns, collectedCount) {
    const total = Number(totalTurns || 0);
    const collected = Number(collectedCount || 0);
    if (!total || total < 12 || collected >= total) {
      return false;
    }

    const missing = total - collected;
    // Run an extra targeted hydration sweep when virtualized turns are much
    // higher than currently rendered entries (common in long ChatGPT threads).
    return missing >= 8 || collected < Math.ceil(total * 0.72);
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
    const hydrationStartedAt = Date.now();
    const requestedBudgetMs = Number(options.maxHydrationMs);
    const maxHydrationMs = Number.isFinite(requestedBudgetMs)
      ? Math.max(1200, Math.round(requestedBudgetMs))
      : 120000;
    const hydrationBudgetExceeded = () => (Date.now() - hydrationStartedAt) >= maxHydrationMs;

    const initialSections = Array.from(
      document.querySelectorAll(TURN_SECTION_SELECTOR)
    );
    const initialTurnCount = initialSections.length;
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
    const collectedByTurn = new Map();
    const mergeEntries = (entries) => {
      for (const entry of entries) {
        // Keep role in the merge key to avoid collisions when model variants
        // reuse turn containers with slightly different internal structures.
        const key = entryMergeKey(entry);
        if (!key) {
          continue;
        }

        const existing = collectedByTurn.get(key);
        if (!existing || entry.weight > existing.weight) {
          collectedByTurn.set(key, entry);
        }
      }
    };

    const topReachThreshold = 2;
    const ensureScrolledToTop = async () => {
      let reachedTopPasses = 0;

      while (!hydrationBudgetExceeded()) {
        scrollToTopAnimated(scrollContainer);
        await waitForRender(180);
        mergeEntries(collectVisibleConversationEntries());

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
      mergeEntries(visibleEntries);
      const reachedTop = await ensureScrolledToTop();
      if (!reachedTop) {
        throw new Error("HYDRATION_TOP_REACH_FAILED: ChatGPT history did not reach top within timeout.");
      }

      const requiredQuietMs = Math.min(6000, Math.max(2500, Math.round(maxHydrationMs * 0.04)));
      let maxCountSeen = collectedByTurn.size;
      let maxHeightSeen = scrollHeightOf(scrollContainer);
      let lastGrowthAt = Date.now();

      // Keep top anchored and wait until prepending settles for a continuous
      // quiet window. Some hosts keep adding older turns after reaching top.
      while (!hydrationBudgetExceeded()) {
        await waitForRender(260);
        mergeEntries(collectVisibleConversationEntries());

        let atTop = scrollTopOf(scrollContainer) <= topReachThreshold;
        if (!atTop) {
          const reachedTopAgain = await ensureScrolledToTop();
          if (!reachedTopAgain) {
            throw new Error("HYDRATION_TOP_REACH_FAILED: ChatGPT history lost top position before completion.");
          }
          atTop = true;
        }

        const currentCount = collectedByTurn.size;
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
        throw new Error("HYDRATION_TOP_REACH_FAILED: ChatGPT history kept growing until hydration timeout.");
      }

      const mergedEntries = Array.from(collectedByTurn.values()).sort((left, right) => left.order - right.order);
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
    const requestedHydrationBudgetMs = Number(options.maxHydrationMs);
    const fallbackHydrationBudgetMs = Math.max(
      120000,
      Math.round(Number(settings?.exportTimeoutSeconds || 20) * 1000 * 0.65)
    );
    const rawEntries = await collectConversationEntries({
      ...options,
      maxHydrationMs: Number.isFinite(requestedHydrationBudgetMs)
        ? requestedHydrationBudgetMs
        : fallbackHydrationBudgetMs
    });
    const seenTurns = new Set();
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
      const dedupeKey = entryMergeKey(entry);
      const messageId = entry.messageId || entry.turnId || `chatgpt-${index + 1}`;

      if (seenTurns.has(dedupeKey)) {
        continue;
      }
      seenTurns.add(dedupeKey);

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
    const turnCount = document.querySelectorAll(TURN_SECTION_SELECTOR).length;
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
