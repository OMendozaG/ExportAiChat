/*
 * Stable export engine for TXT, HTML and MHT.
 * PDF rendering is handled separately by Chrome printing the generated HTML.
 */
(() => {
  const root = globalThis.ChatExportAi;

  function normalizeReplacement(value) {
    const rawValue = String(value ?? ".");
    const candidate = (rawValue.normalize ? rawValue.normalize("NFC") : rawValue)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
      .trim();

    return candidate || ".";
  }

  function compactName(value, replacementValue, fallbackValue = "chat") {
    const replacement = normalizeReplacement(replacementValue);
    const rawValue = String(value ?? "");
    const normalizedValue = rawValue.normalize ? rawValue.normalize("NFC") : rawValue;
    const sourceValue = normalizedValue || fallbackValue;

    return String(sourceValue)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, replacement)
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim() || fallbackValue;
  }

  function timestampParts(date) {
    const currentDate = date || new Date();
    const year = currentDate.getFullYear();
    const shortYear = String(year).slice(-2);
    const monthNumber = currentDate.getMonth() + 1;
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" }).format(currentDate);
    const monthLong = new Intl.DateTimeFormat(undefined, { month: "long" }).format(currentDate);
    const dayNumber = currentDate.getDate();
    const day = String(currentDate.getDate()).padStart(2, "0");
    const hourNumber = currentDate.getHours();
    const hours = String(currentDate.getHours()).padStart(2, "0");
    const minuteNumber = currentDate.getMinutes();
    const minutes = String(currentDate.getMinutes()).padStart(2, "0");
    const secondNumber = currentDate.getSeconds();
    const seconds = String(currentDate.getSeconds()).padStart(2, "0");

    return {
      YYYY: String(year),
      YY: shortYear,
      MMMM: monthLong,
      MMM: monthShort,
      MM: month,
      M: String(monthNumber),
      DD: day,
      D: String(dayNumber),
      HH: hours,
      H: String(hourNumber),
      mm: minutes,
      m: String(minuteNumber),
      ss: seconds,
      s: String(secondNumber),
      date: `${year}-${month}-${day}`,
      time: `${hours}-${minutes}-${seconds}`
    };
  }

  function applyDateTokens(template, timeParts) {
    const tokenMap = {
      YYYY: timeParts.YYYY,
      MMMM: timeParts.MMMM,
      MMM: timeParts.MMM,
      YY: timeParts.YY,
      MM: timeParts.MM,
      DD: timeParts.DD,
      HH: timeParts.HH,
      mm: timeParts.mm,
      ss: timeParts.ss,
      M: timeParts.M,
      D: timeParts.D,
      H: timeParts.H,
      m: timeParts.m,
      s: timeParts.s
    };

    return String(template).replace(/YYYY|MMMM|MMM|YY|MM|DD|HH|mm|ss|M|D|H|m|s/g, (token) => {
      return tokenMap[token] ?? token;
    });
  }

  function normalizeCounterValue(value, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return Math.max(0, Math.round(fallback));
    }

    return Math.max(0, Math.round(numericValue));
  }

  function resolveCounterSnapshot(conversation) {
    const snapshot = conversation?.exportCounters && typeof conversation.exportCounters === "object"
      ? conversation.exportCounters
      : {};

    return {
      totalCount: normalizeCounterValue(snapshot.totalCount, 0),
      dayCount: normalizeCounterValue(snapshot.dayCount, 0),
      chatNameCount: Math.max(1, normalizeCounterValue(snapshot.chatNameCount, 1))
    };
  }

  function keywordValueMap(conversation, counters) {
    const timeParts = timestampParts(new Date(conversation.extractedAtIso || Date.now()));
    const replacement = conversation.settings?.invalidFileNameReplacement;

    return {
      WindowTitle: compactName(conversation.title || conversation.chatName || "chat", replacement),
      ChatName: compactName(conversation.chatName || conversation.title || "chat", replacement),
      ChatFolder: compactName(conversation.folderName || "", replacement, ""),
      Model: compactName(conversation.modelName || "", replacement, ""),
      Provider: compactName(conversation.providerName || "", replacement, ""),
      Date: timeParts.date,
      Time: timeParts.time,
      TotalCount: String(counters.totalCount),
      DayCount: String(counters.dayCount),
      ChatNameCount: String(counters.chatNameCount)
    };
  }

  function applyNumericPadding(value, rawPaddingLength) {
    const paddingLength = Number(rawPaddingLength);
    if (!Number.isFinite(paddingLength) || paddingLength <= 0) {
      return String(value ?? "");
    }

    const normalized = String(value ?? "");
    if (!/^\d+$/.test(normalized)) {
      return normalized;
    }

    return normalized.padStart(paddingLength, "0");
  }

  function protectKeywordMarkers(template, keywords) {
    let protectedTemplate = String(template);
    const replacements = [];
    let index = 0;
    const keywordLookup = new Map(
      Object.entries(keywords).map(([keyword, value]) => [keyword.toLowerCase(), String(value ?? "")])
    );

    protectedTemplate = protectedTemplate.replace(/<([A-Za-z][A-Za-z0-9]*)(?:\*(\d+))?>/g, (match, rawKeyword, rawPaddingLength) => {
      const normalizedKeyword = String(rawKeyword || "").toLowerCase();
      if (!normalizedKeyword) {
        return match;
      }
      const resolvedKeywordValue = keywordLookup.get(normalizedKeyword);

      if (resolvedKeywordValue === undefined || resolvedKeywordValue === null) {
        return match;
      }

      const marker = `[[${index}]]`;
      const paddedValue = applyNumericPadding(resolvedKeywordValue, rawPaddingLength);
      replacements.push([marker, paddedValue]);
      index += 1;
      return marker;
    });

    return { protectedTemplate, replacements };
  }

  function resolveFileBaseName(conversation) {
    const settings = conversation.settings || root.defaults.settings;
    const timeParts = timestampParts(new Date(conversation.extractedAtIso || Date.now()));
    const counters = resolveCounterSnapshot(conversation);
    const templateSource = settings.autoFileName
      ? (settings.fileNameTemplate || "<ChatNameCount*3>. <ChatName>")
      : (settings.fileNameTemplate || "chat");
    const keywords = keywordValueMap(conversation, counters);
    const { protectedTemplate, replacements } = protectKeywordMarkers(templateSource, keywords);
    let resolved = applyDateTokens(protectedTemplate, timeParts);

    for (const [marker, value] of replacements) {
      resolved = resolved.split(marker).join(value);
    }

    resolved = compactName(resolved, settings.invalidFileNameReplacement);

    const normalizedResolved = resolved && resolved.normalize ? resolved.normalize("NFC") : resolved;
    return normalizedResolved || compactName(
      conversation.chatName || conversation.title || "chat",
      settings.invalidFileNameReplacement
    );
  }

  function buildFileName(conversation, format) {
    const fileName = `${resolveFileBaseName(conversation)}.${format}`;
    return fileName.normalize ? fileName.normalize("NFC") : fileName;
  }

  function messageIdPrefix(message, settings) {
    if (!settings?.includeMessageId) {
      return "";
    }

    const numericId = Number(message?.messageNumber);
    if (!Number.isFinite(numericId) || numericId < 1) {
      return "";
    }

    return `#${Math.round(numericId)} `;
  }

  function rolePrefix(message, settings) {
    let prefix = `<${message.speakerLabel}>`;

    if (message.timeLabel) {
      prefix += ` [${message.timeLabel}]`;
    }

    return `${messageIdPrefix(message, settings)}${prefix}`;
  }

  function continuationPrefix(prefix, settings, isFirstLine) {
    const applyFirstLineStyle = settings?.txtApplyMultilineOnFirstLine !== false;

    if (isFirstLine) {
      if (!applyFirstLineStyle) {
        return prefix ? `${prefix} ` : "";
      }

      if (settings.multilineFormat === root.constants.MULTILINE_FORMAT.NAME) {
        return prefix ? `${prefix} ` : "";
      }

      if (settings.multilineFormat === root.constants.MULTILINE_FORMAT.NONE) {
        return "";
      }

      return "\t";
    }

    if (settings.multilineFormat === root.constants.MULTILINE_FORMAT.NAME) {
      return prefix ? `${prefix} ` : "";
    }

    if (settings.multilineFormat === root.constants.MULTILINE_FORMAT.NONE) {
      return "";
    }

    return "\t";
  }

  function ensureParenthesizedThinkingLine(value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) {
      return "";
    }

    if (/^\(.*\)$/s.test(cleaned)) {
      return cleaned;
    }

    return `(${cleaned})`;
  }

  function normalizeSeparator(settings) {
    const rawValue = settings.messageSeparator ?? root.defaults.settings.messageSeparator;
    return String(rawValue).replace(/\r\n/g, "\n");
  }

  function normalizeTemplateValue(value) {
    return String(value ?? "").replace(/\r\n/g, "\n");
  }

  function resolveTxtHeaderTemplateByRole(message, settings) {
    const role = String(message?.role || "");
    if (role === root.constants.ROLES.HUMAN) {
      return settings.txtHumanMessageHeaderTemplate ?? root.defaults.settings.txtHumanMessageHeaderTemplate;
    }

    if (role === root.constants.ROLES.ASSISTANT || role === root.constants.ROLES.SYSTEM) {
      return settings.txtAiMessageHeaderTemplate ?? root.defaults.settings.txtAiMessageHeaderTemplate;
    }

    return "";
  }

  function applyTxtTemplateTokens(template, conversation) {
    const names = conversation?.names || {};
    const humanName = String(names.human || conversation?.settings?.humanName || "Human");
    const aiName = String(names.ai || conversation?.settings?.aiCustomName || conversation?.providerName || "AI");

    return normalizeTemplateValue(template)
      .replace(/<HumanName>/gi, humanName)
      .replace(/<AiName>/gi, aiName);
  }

  function resolveTxtMessageHeader(message, settings, conversation) {
    const rawTemplate = resolveTxtHeaderTemplateByRole(message, settings);
    if (!rawTemplate) {
      return "";
    }

    return applyTxtTemplateTokens(rawTemplate, conversation);
  }

  function resolveExportTitle(conversation) {
    return String(conversation.chatName || conversation.title || "chat").trim() || "chat";
  }

  function buildMetadataText(conversation) {
    const metadata = (conversation.metadata || []).filter((item) => {
      const label = String(item?.label || "").trim();
      const value = String(item?.value || "").trim();
      return Boolean(label && value);
    });

    if (!metadata.length) {
      return "";
    }

    const lines = ["[Metadata]"];

    for (const item of metadata) {
      lines.push(`- ${item.label}: ${item.value}`);
    }

    return lines.join("\n");
  }

  function isLikelyUrlValue(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return false;
    }

    return /^(?:https?:\/\/|www\.|blob:https?:\/\/)/i.test(normalized);
  }

  function wrapAttachmentLabel(label) {
    const normalized = String(label || "").trim();
    if (!normalized) {
      return "";
    }

    if (/^\[.*\]$/s.test(normalized)) {
      return normalized;
    }

    return `[${normalized}]`;
  }

  function parseReferenceLine(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return {
        kind: "unknown",
        label: ""
      };
    }

    const descriptorMatch = normalized.match(/^(.+?)\s+-\s+(\S+)$/);
    if (descriptorMatch) {
      const left = String(descriptorMatch[1] || "").trim();
      const right = String(descriptorMatch[2] || "").trim();
      if (left && isLikelyUrlValue(right)) {
        return {
          kind: "attachment",
          label: left
        };
      }
    }

    if (isLikelyUrlValue(normalized)) {
      return {
        kind: "web",
        label: normalized
      };
    }

    return {
      kind: "attachment",
      label: normalized
    };
  }

  function buildAttachedLine(referenceLines) {
    const attachments = (referenceLines || [])
      .map((line) => String(line || "").trim())
      .filter(Boolean);

    if (!attachments.length) {
      return "";
    }

    const payload = attachments.map((line) => wrapAttachmentLabel(line)).filter(Boolean).join(", ");
    return `(Attached: ${payload})`;
  }

  function buildReferenceOutputLines(referenceLines) {
    const references = (referenceLines || [])
      .map((line) => String(line || "").trim())
      .filter(Boolean);
    if (!references.length) {
      return [];
    }

    const attachmentLines = [];
    const nonAttachmentLines = [];

    references.forEach((line) => {
      const parsed = parseReferenceLine(line);
      if (parsed.kind === "web") {
        nonAttachmentLines.push(`[${parsed.label}]`);
        return;
      }

      if (parsed.kind === "attachment" && parsed.label) {
        attachmentLines.push(parsed.label);
        return;
      }
    });

    const outputLines = [];
    const attachedLine = buildAttachedLine(attachmentLines);
    if (attachedLine) {
      outputLines.push(attachedLine);
    }

    outputLines.push(...nonAttachmentLines);
    return outputLines;
  }

  function isAttachedOutputLine(value) {
    return /^\(Attached:\s*/i.test(String(value || "").trim());
  }

  function buildTextMessageBlock(message, settings, conversation) {
    const contentLines = [];
    const messageHeader = resolveTxtMessageHeader(message, settings, conversation);
    // Always keep the role prefix on the first real content line.
    // TXT header templates are visual separators, not replacements for `<Role>`.
    const prefix = rolePrefix(message, settings);
    const thinkingNoteLines = String(message.thinkingNote || "")
      .split("\n")
      .map((line) => String(line || "").trim())
      .filter(Boolean);
    const normalizedThinkingLines = thinkingNoteLines
      .map((line) => ensureParenthesizedThinkingLine(line))
      .filter(Boolean);
    const leadingLines = buildReferenceOutputLines(message.leadingReferenceLines);
    const messageLines = String(message.text || "").split("\n");
    const trailingLines = buildReferenceOutputLines(message.trailingReferenceLines);
    contentLines.push(...leadingLines);

    if (message.text) {
      contentLines.push(...messageLines);
    }

    contentLines.push(...trailingLines);

    const outputLines = [];

    // Thinking labels are rendered as a hint below the header but do not consume
    // the role prefix position for the actual message content.
    for (const line of normalizedThinkingLines) {
      outputLines.push(line.trimEnd());
    }

    if (normalizedThinkingLines.length) {
      // Keep a guaranteed line break after the closing ")" of the thinking note.
      // This applies to every provider because thinking is normalized upstream.
      outputLines.push("");
    }

    for (let index = 0; index < contentLines.length; index += 1) {
      const line = contentLines[index];
      const linePrefix = continuationPrefix(prefix, settings, index === 0);
      outputLines.push(`${linePrefix}${line}`.trimEnd());
    }

    const blockBody = outputLines.join("\n");
    const blockWithHeader = `${messageHeader}${blockBody}`;
    return blockWithHeader;
  }

  function toChatText(conversation) {
    const settings = conversation.settings || root.defaults.settings;
    const metadataBlock = buildMetadataText(conversation).trimEnd();
    const messageBlocks = (conversation.messages || []).map((message) => buildTextMessageBlock(message, settings, conversation));
    const separator = normalizeSeparator(settings);
    const sections = [];

    if (metadataBlock) {
      sections.push(metadataBlock);
      sections.push("[Content]");
    }

    if (messageBlocks.length) {
      // Respect an explicit empty-string separator (no gap between message blocks).
      const messageText = messageBlocks.join(separator);
      sections.push(messageText);
    }

    return `${sections.join("\n\n").trimEnd()}\n`;
  }

  function buildHtmlHeader(conversation, settings) {
    if (!settings?.includeExportTitle) {
      return "";
    }

    const escapeHtml = root.sanitize.escapeHtml;
    const exportTitle = resolveExportTitle(conversation);

    return [
      "<header class=\"ceai-header\">",
      `  <h1>${escapeHtml(exportTitle)}</h1>`,
      "</header>"
    ].join("\n");
  }

  function buildMetadataHtml(conversation) {
    const escapeHtml = root.sanitize.escapeHtml;
    const metadata = conversation.metadata || [];

    if (!metadata.length) {
      return "";
    }

    const rows = metadata.map((item) => {
      return [
        "    <div class=\"ceai-meta-row\">",
        `      <dt>${escapeHtml(item.label)}</dt>`,
        `      <dd>${escapeHtml(item.value)}</dd>`,
        "    </div>"
      ].join("\n");
    }).join("\n");

    return [
      "<section class=\"ceai-meta\">",
      "  <h2>Metadata</h2>",
      "  <dl>",
      rows,
      "  </dl>",
      "</section>"
    ].join("\n");
  }

  function buildMessageHeader(message, settings) {
    const escapeHtml = root.sanitize.escapeHtml;
    const speaker = escapeHtml(message.speakerLabel || "Unknown");
    const timeLabel = escapeHtml(message.timeLabel || "");
    const messageId = escapeHtml(messageIdPrefix(message, settings).trim());
    const thinkingNote = escapeHtml(String(message.thinkingNote || "").trim());

    return [
      "  <div class=\"ceai-message-head\">",
      "    <div class=\"ceai-message-head-main\">",
      messageId ? `      <span class=\"ceai-message-id\">${messageId}</span>` : "",
      `      <h2>${speaker}</h2>`,
      "    </div>",
      timeLabel ? `    <span class=\"ceai-message-time\">${timeLabel}</span>` : "",
      "  </div>",
      thinkingNote ? `  <p class="ceai-thinking-note">${thinkingNote}</p>` : ""
    ].filter(Boolean).join("\n");
  }

  function normalizeRoleColor(value, fallback) {
    const raw = String(value || "").trim();
    if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw)) {
      return raw.toLowerCase();
    }

    return fallback;
  }

  function resolveRoleBorderColors(settings) {
    const safeSettings = settings || root.defaults.settings;
    return {
      ai: normalizeRoleColor(safeSettings.htmlPdfAiBorderColor, "#2563eb"),
      human: normalizeRoleColor(safeSettings.htmlPdfHumanBorderColor, "#f59e0b"),
      system: "#7c3aed"
    };
  }

  function buildReferenceBlockHtml(lines, className) {
    const escapeHtml = root.sanitize.escapeHtml;
    const displayLines = buildReferenceOutputLines(lines);
    if (!displayLines.length) {
      return "";
    }

    const markup = displayLines
      .map((line) => {
        const className = isAttachedOutputLine(line)
          ? "ceai-reference-line ceai-reference-line--attached"
          : "ceai-reference-line";
        return `    <p class="${className}">${escapeHtml(line)}</p>`;
      })
      .join("\n");

    return [
      `  <div class="ceai-reference-block ${className}">`,
      markup,
      "  </div>"
    ].join("\n");
  }

  function messageHtml(message, settings) {
    const escapeHtml = root.sanitize.escapeHtml;
    const roleClass = `role-${escapeHtml(message.role || "unknown")}`;
    const headerMarkup = buildMessageHeader(message, settings);
    const leadingReferencesMarkup = buildReferenceBlockHtml(message.leadingReferenceLines, "ceai-reference-block--leading");
    const trailingReferencesMarkup = buildReferenceBlockHtml(message.trailingReferenceLines, "ceai-reference-block--trailing");
    const plainTextMarkup = message.text ? `  <pre>${escapeHtml(message.text || "")}</pre>` : "";
    const richMarkup = message.safeHtml ? `  <div class="ceai-rich">${message.safeHtml || ""}</div>` : "";

    if (settings.textFormatting === root.constants.TEXT_FORMATTING.CLEAN) {
      return [
        `<section class="ceai-message ${roleClass}">`,
        headerMarkup,
        leadingReferencesMarkup,
        plainTextMarkup,
        trailingReferencesMarkup,
        "</section>"
      ].filter(Boolean).join("\n");
    }

    return [
      `<section class="ceai-message ${roleClass}">`,
      headerMarkup,
      leadingReferencesMarkup,
      richMarkup,
      trailingReferencesMarkup,
      "</section>"
    ].filter(Boolean).join("\n");
  }

  function messagePdfHtml(message, settings) {
    const escapeHtml = root.sanitize.escapeHtml;
    const roleClass = `role-${escapeHtml(message.role || "unknown")}`;
    const text = escapeHtml(message.text || "");
    const leadingReferencesMarkup = buildReferenceBlockHtml(message.leadingReferenceLines, "ceai-reference-block--leading");
    const trailingReferencesMarkup = buildReferenceBlockHtml(message.trailingReferenceLines, "ceai-reference-block--trailing");
    const textMarkup = message.text ? `  <pre>${text}</pre>` : "";
    const richMarkup = message.safeHtml ? `  <div class="ceai-rich">${message.safeHtml || ""}</div>` : "";
    const bodyMarkup = settings.textFormatting === root.constants.TEXT_FORMATTING.CLEAN
      ? textMarkup
      : (richMarkup || textMarkup);

    return [
      `<section class="ceai-message ${roleClass}">`,
      buildMessageHeader(message, settings),
      leadingReferencesMarkup,
      bodyMarkup,
      trailingReferencesMarkup,
      "</section>"
    ].filter(Boolean).join("\n");
  }

  function buildHtmlStyle(settings) {
    const roleColors = resolveRoleBorderColors(settings);
    return [
      "@page { size: A4; margin: 14mm; }",
      ":root { color-scheme: light; }",
      "* { box-sizing: border-box; }",
      "html { background: #f4f6fb; }",
      "body { margin: 0; font-family: \"Segoe UI Emoji\", \"Apple Color Emoji\", \"Segoe UI\", Tahoma, sans-serif; background: #f4f6fb; color: #111827; }",
      "main { max-width: 980px; margin: 0 auto; padding: 28px 22px 40px; }",
      ".ceai-header, .ceai-meta, .ceai-message { background: #ffffff; border: 1px solid #d6d9e0; border-radius: 16px; }",
      ".ceai-header, .ceai-meta, .ceai-message { box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08); }",
      ".ceai-header { padding: 20px 22px; margin-bottom: 16px; }",
      ".ceai-header h1 { margin: 0; font-size: 1.5rem; line-height: 1.2; }",
      ".ceai-meta { padding: 16px 18px; margin-bottom: 16px; }",
      ".ceai-meta h2 { margin: 0 0 10px; font-size: 1rem; }",
      ".ceai-meta dl { margin: 0; }",
      ".ceai-meta-row { display: grid; grid-template-columns: 180px 1fr; gap: 10px; padding: 6px 0; border-top: 1px solid #edf1f5; }",
      ".ceai-meta-row:first-child { border-top: 0; }",
      ".ceai-meta dt { font-weight: 700; color: #334155; }",
      ".ceai-meta dd { margin: 0; color: #0f172a; word-break: break-word; }",
      ".ceai-message { padding: 16px; margin-bottom: 12px; }",
      ".ceai-message-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }",
      ".ceai-message-head-main { display: flex; align-items: center; gap: 10px; min-width: 0; }",
      ".ceai-message h2 { margin: 0; font-size: 1rem; }",
      ".ceai-message-id { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; padding: 0.2rem 0.55rem; border-radius: 999px; background: #e7eefc; color: #1d4ed8; font-size: 0.78rem; font-weight: 700; line-height: 1; }",
      ".ceai-message-time { color: #64748b; font-size: 0.82rem; white-space: nowrap; }",
      ".ceai-thinking-note { margin: -2px 0 10px; color: #475569; font-size: 0.84rem; font-style: italic; }",
      ".ceai-reference-block { margin: 0 0 10px; }",
      ".ceai-reference-block p { margin: 0 0 6px; color: #334155; font-size: 0.92rem; font-weight: 600; }",
      ".ceai-reference-line--attached { color: #64748b; font-size: 0.84rem; font-weight: 400; white-space: nowrap; }",
      ".ceai-reference-block--trailing { margin-top: 10px; margin-bottom: 0; }",
      ".ceai-reference-block--trailing p:last-child, .ceai-reference-block--leading p:last-child { margin-bottom: 0; }",
      `.ceai-message.role-human { border-left: 6px solid ${roleColors.human}; }`,
      `.ceai-message.role-assistant { border-left: 6px solid ${roleColors.ai}; }`,
      `.ceai-message.role-system { border-left: 6px solid ${roleColors.system}; }`,
      ".ceai-message pre { white-space: pre-wrap; margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }",
      ".ceai-rich p { margin: 0 0 0.9em; }",
      ".ceai-rich figure, .ceai-rich picture { display: block; max-width: 100%; margin: 0 0 0.9em; }",
      ".ceai-rich img, .ceai-rich video, .ceai-rich canvas, .ceai-rich svg { display: block; max-width: 100%; width: auto !important; height: auto !important; max-height: 70vh; object-fit: contain; border-radius: 12px; }",
      ".ceai-rich iframe { max-width: 100%; width: 100%; }",
      ".ceai-rich blockquote { margin: 0.7em 0; padding: 0.45em 0.8em; border-left: 3px solid #8a94a6; background: #f8fafc; }",
      ".ceai-rich hr { border: 0; border-top: 1px dashed #9ba4b3; margin: 1em 0; }",
      ".ceai-rich code { background: #eef1f6; padding: 0.08em 0.3em; border-radius: 4px; }",
      ".ceai-rich pre { background: #f8fafc; color: #111827; border: 1px solid #d6d9e0; padding: 12px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; }",
      ".ceai-rich a { color: #1d4ed8; }",
      "@media print { html, body { background: #ffffff !important; } main { max-width: none; padding: 0; } .ceai-header, .ceai-meta, .ceai-message { box-shadow: none; background: #ffffff !important; } .ceai-message { break-inside: auto; page-break-inside: auto; } .ceai-rich pre, .ceai-message pre { overflow: visible; } .ceai-rich img, .ceai-rich video, .ceai-rich canvas, .ceai-rich svg { max-height: 60vh; } }"
    ].join("\n");
  }

  function buildPdfHtmlStyle(settings) {
    const roleColors = resolveRoleBorderColors(settings);
    return [
      "@page { size: A4; margin: 12mm; }",
      ":root { color-scheme: light; }",
      "* { box-sizing: border-box; }",
      "html, body { background: #ffffff; color: #101828; margin: 0; }",
      "body { font-family: \"Segoe UI Emoji\", \"Apple Color Emoji\", \"Segoe UI\", Tahoma, sans-serif; }",
      "main { padding: 0; }",
      ".ceai-header, .ceai-meta, .ceai-message { border: 1px solid #d7deea; border-radius: 12px; background: #ffffff; }",
      ".ceai-header { padding: 16px 18px; margin: 0 0 12px; }",
      ".ceai-header h1 { margin: 0; font-size: 20px; line-height: 1.2; }",
      ".ceai-meta { padding: 12px 14px; margin: 0 0 12px; }",
      ".ceai-meta h2 { margin: 0 0 8px; font-size: 14px; }",
      ".ceai-meta dl { margin: 0; }",
      ".ceai-meta-row { display: grid; grid-template-columns: 150px 1fr; gap: 10px; padding: 4px 0; border-top: 1px solid #edf1f5; }",
      ".ceai-meta-row:first-child { border-top: 0; }",
      ".ceai-meta dt { font-weight: 700; color: #475467; }",
      ".ceai-meta dd { margin: 0; word-break: break-word; }",
      ".ceai-message { padding: 12px 14px; margin: 0 0 10px; break-inside: auto; page-break-inside: auto; }",
      ".ceai-message-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; }",
      ".ceai-message-head-main { display: flex; align-items: center; gap: 8px; min-width: 0; }",
      ".ceai-message h2 { margin: 0; font-size: 14px; }",
      ".ceai-message-id { display: inline-flex; align-items: center; justify-content: center; min-width: 38px; padding: 0.15rem 0.45rem; border-radius: 999px; background: #e7eefc; color: #1d4ed8; font-size: 10px; font-weight: 700; line-height: 1; }",
      ".ceai-message-time { color: #667085; font-size: 11px; white-space: nowrap; }",
      ".ceai-thinking-note { margin: -2px 0 8px; color: #475467; font-size: 11px; font-style: italic; }",
      ".ceai-reference-block { margin: 0 0 8px; }",
      ".ceai-reference-block p { margin: 0 0 4px; color: #475467; font-size: 11px; font-weight: 600; }",
      ".ceai-reference-line--attached { color: #667085; font-size: 10px; font-weight: 400; white-space: nowrap; }",
      ".ceai-reference-block--trailing { margin-top: 8px; margin-bottom: 0; }",
      ".ceai-reference-block--trailing p:last-child, .ceai-reference-block--leading p:last-child { margin-bottom: 0; }",
      `.ceai-message.role-human { border-left: 5px solid ${roleColors.human}; }`,
      `.ceai-message.role-assistant { border-left: 5px solid ${roleColors.ai}; }`,
      `.ceai-message.role-system { border-left: 5px solid ${roleColors.system}; }`,
      ".ceai-message pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: \"Segoe UI Emoji\", \"Apple Color Emoji\", \"Segoe UI\", Tahoma, sans-serif; line-height: 1.45; }",
      ".ceai-rich p { margin: 0 0 0.75em; }",
      ".ceai-rich figure, .ceai-rich picture { display: block; max-width: 100%; margin: 0 0 0.75em; }",
      ".ceai-rich img, .ceai-rich video, .ceai-rich canvas, .ceai-rich svg { display: block; max-width: 100%; width: auto !important; height: auto !important; max-height: 58vh; object-fit: contain; border-radius: 10px; }",
      ".ceai-rich iframe { max-width: 100%; width: 100%; }",
      ".ceai-rich blockquote { margin: 0.55em 0; padding: 0.4em 0.7em; border-left: 3px solid #8a94a6; background: #f8fafc; }",
      ".ceai-rich hr { border: 0; border-top: 1px dashed #9ba4b3; margin: 0.8em 0; }",
      ".ceai-rich code { background: #eef1f6; padding: 0.05em 0.24em; border-radius: 4px; }",
      ".ceai-rich pre { background: #f8fafc; color: #111827; border: 1px solid #d6d9e0; padding: 10px; border-radius: 8px; overflow-wrap: anywhere; white-space: pre-wrap; }",
      ".ceai-rich a { color: #1d4ed8; }"
    ].join("\n");
  }

  function toHtmlDocument(conversation, settings) {
    const escapeHtml = root.sanitize.escapeHtml;
    const exportTitle = resolveExportTitle(conversation);
    const htmlDocumentTitle = settings?.includeExportTitle ? exportTitle : "Chat Export AI";
    const messageMarkup = (conversation.messages || [])
      .map((message) => messageHtml(message, settings))
      .join("\n");

    return [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "  <meta charset=\"utf-8\">",
      "  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
      `  <title>${escapeHtml(htmlDocumentTitle)}</title>`,
      `  <style>${buildHtmlStyle(settings)}</style>`,
      "</head>",
      "<body>",
      "  <main>",
      buildHtmlHeader(conversation, settings),
      buildMetadataHtml(conversation),
      messageMarkup,
      "  </main>",
      "</body>",
      "</html>"
    ].join("\n");
  }

  function toPdfDocument(conversation) {
    const escapeHtml = root.sanitize.escapeHtml;
    const settings = conversation.settings || root.defaults.settings;
    const exportTitle = resolveExportTitle(conversation);
    const htmlDocumentTitle = settings.includeExportTitle ? exportTitle : "Chat Export AI";
    const messageMarkup = (conversation.messages || [])
      .map((message) => messagePdfHtml(message, settings))
      .join("\n");

    return [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "  <meta charset=\"utf-8\">",
      "  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
      `  <title>${escapeHtml(htmlDocumentTitle)}</title>`,
      `  <style>${buildPdfHtmlStyle(settings)}</style>`,
      "</head>",
      "<body>",
      "  <main>",
      buildHtmlHeader(conversation, settings),
      buildMetadataHtml(conversation),
      messageMarkup,
      "  </main>",
      "</body>",
      "</html>"
    ].join("\n");
  }

  function toBase64Utf8(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function toMhtDocument(htmlDocument, conversation) {
    const boundary = `----=_NextPart_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    const encodedHtml = toBase64Utf8(htmlDocument);
    const safeTitle = String(conversation.title || "chat").replace(/[\r\n]+/g, " ").trim() || "chat";

    return [
      "From: <Saved by Chat Export AI>",
      `Subject: ${safeTitle}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/related; type=text/html; boundary=${boundary}`,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "Content-Location: file:///chat-export.html",
      "",
      encodedHtml,
      "",
      `--${boundary}--`,
      ""
    ].join("\r\n");
  }

  root.exporters = {
    buildFileName,
    resolveFileBaseName,
    toIrcText: toChatText,
    toChatText,
    toHtmlDocument,
    toPdfDocument,
    toMhtDocument
  };
})();
