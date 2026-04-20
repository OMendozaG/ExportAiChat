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

  function keywordValueMap(conversation) {
    const timeParts = timestampParts(new Date(conversation.extractedAtIso || Date.now()));
    const replacement = conversation.settings?.invalidFileNameReplacement;

    return {
      "<ChatTitle>": compactName(conversation.title || conversation.chatName || "chat", replacement),
      "<WindowTitle>": compactName(conversation.title || conversation.chatName || "chat", replacement),
      "<ChatName>": compactName(conversation.chatName || conversation.title || "chat", replacement),
      "<ChatFolder>": compactName(conversation.folderName || "", replacement, ""),
      "<Model>": compactName(conversation.modelName || "", replacement, ""),
      "<Provider>": compactName(conversation.providerName || "", replacement, ""),
      "<Date>": timeParts.date,
      "<Time>": timeParts.time
    };
  }

  function protectKeywordMarkers(template, keywords) {
    let protectedTemplate = String(template);
    const replacements = [];
    let index = 0;

    for (const [keyword, value] of Object.entries(keywords)) {
      const marker = `[[${index}]]`;
      protectedTemplate = protectedTemplate.split(keyword).join(marker);
      replacements.push([marker, value]);
      index += 1;
    }

    return { protectedTemplate, replacements };
  }

  function resolveFileBaseName(conversation) {
    const settings = conversation.settings || root.defaults.settings;
    const timeParts = timestampParts(new Date(conversation.extractedAtIso || Date.now()));
    const templateSource = settings.autoFileName
      ? (settings.fileNameTemplate || "YY.MM.DD <ChatTitle>")
      : (settings.fileNameTemplate || "chat");
    const keywords = keywordValueMap(conversation);
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
    if (isFirstLine) {
      return `${prefix} `;
    }

    if (settings.multilineFormat === root.constants.MULTILINE_FORMAT.NAME) {
      return `${prefix} `;
    }

    if (settings.multilineFormat === root.constants.MULTILINE_FORMAT.NONE) {
      return "";
    }

    return "\t";
  }

  function normalizeSeparator(settings) {
    const rawValue = settings.messageSeparator ?? root.defaults.settings.messageSeparator;
    return String(rawValue).replace(/\r\n/g, "\n");
  }

  function buildMetadataText(conversation) {
    const metadata = conversation.metadata || [];

    if (!metadata.length) {
      return "";
    }

    const lines = ["[Metadata]"];

    for (const item of metadata) {
      lines.push(`- ${item.label}: ${item.value}`);
    }

    lines.push("-----------");
    return `${lines.join("\n")}\n`;
  }

  function buildTextMessageBlock(message, settings) {
    const prefix = rolePrefix(message, settings);
    const contentLines = [];
    const leadingLines = Array.isArray(message.leadingReferenceLines)
      ? message.leadingReferenceLines.map((line) => `[${line}]`)
      : [];
    const messageLines = String(message.text || "").split("\n");
    const trailingLines = Array.isArray(message.trailingReferenceLines)
      ? message.trailingReferenceLines.map((line) => `[${line}]`)
      : [];
    contentLines.push(...leadingLines);

    if (message.text) {
      contentLines.push(...messageLines);
    }

    contentLines.push(...trailingLines);

    const outputLines = [];

    for (let index = 0; index < contentLines.length; index += 1) {
      const line = contentLines[index];
      const linePrefix = continuationPrefix(prefix, settings, index === 0);
      outputLines.push(`${linePrefix}${line}`.trimEnd());
    }

    return outputLines.join("\n");
  }

  function toChatText(conversation) {
    const settings = conversation.settings || root.defaults.settings;
    const metadataBlock = buildMetadataText(conversation).trimEnd();
    const messageBlocks = (conversation.messages || []).map((message) => buildTextMessageBlock(message, settings));
    const separator = normalizeSeparator(settings);
    const sections = [];

    if (metadataBlock) {
      sections.push(metadataBlock);
    }

    if (messageBlocks.length) {
      sections.push(messageBlocks.join(separator || "\n\n"));
    }

    return `${sections.join("\n\n").trimEnd()}\n`;
  }

  function buildHtmlHeader(conversation) {
    const escapeHtml = root.sanitize.escapeHtml;

    return [
      "<header class=\"ceai-header\">",
      `  <h1>${escapeHtml(conversation.title)}</h1>`,
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

    return [
      "  <div class=\"ceai-message-head\">",
      "    <div class=\"ceai-message-head-main\">",
      messageId ? `      <span class=\"ceai-message-id\">${messageId}</span>` : "",
      `      <h2>${speaker}</h2>`,
      "    </div>",
      timeLabel ? `    <span class=\"ceai-message-time\">${timeLabel}</span>` : "",
      "  </div>"
    ].filter(Boolean).join("\n");
  }

  function buildReferenceBlockHtml(lines, className) {
    const escapeHtml = root.sanitize.escapeHtml;
    if (!Array.isArray(lines) || !lines.length) {
      return "";
    }

    const markup = lines
      .map((line) => `    <p>[${escapeHtml(line)}]</p>`)
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

    return [
      `<section class="ceai-message ${roleClass}">`,
      buildMessageHeader(message, settings),
      leadingReferencesMarkup,
      textMarkup,
      trailingReferencesMarkup,
      "</section>"
    ].filter(Boolean).join("\n");
  }

  function buildHtmlStyle() {
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
      ".ceai-reference-block { margin: 0 0 10px; }",
      ".ceai-reference-block p { margin: 0 0 6px; color: #334155; font-size: 0.92rem; font-weight: 600; }",
      ".ceai-reference-block--trailing { margin-top: 10px; margin-bottom: 0; }",
      ".ceai-reference-block--trailing p:last-child, .ceai-reference-block--leading p:last-child { margin-bottom: 0; }",
      ".ceai-message.role-human { border-left: 6px solid #2166f3; }",
      ".ceai-message.role-assistant { border-left: 6px solid #0f9d58; }",
      ".ceai-message.role-system { border-left: 6px solid #7c3aed; }",
      ".ceai-message pre { white-space: pre-wrap; margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }",
      ".ceai-rich p { margin: 0 0 0.9em; }",
      ".ceai-rich blockquote { margin: 0.7em 0; padding: 0.45em 0.8em; border-left: 3px solid #8a94a6; background: #f8fafc; }",
      ".ceai-rich hr { border: 0; border-top: 1px dashed #9ba4b3; margin: 1em 0; }",
      ".ceai-rich code { background: #eef1f6; padding: 0.08em 0.3em; border-radius: 4px; }",
      ".ceai-rich pre { background: #f8fafc; color: #111827; border: 1px solid #d6d9e0; padding: 12px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; }",
      ".ceai-rich a { color: #1d4ed8; }",
      "@media print { html, body { background: #ffffff !important; } main { max-width: none; padding: 0; } .ceai-header, .ceai-meta, .ceai-message { box-shadow: none; background: #ffffff !important; } .ceai-message { break-inside: auto; page-break-inside: auto; } .ceai-rich pre, .ceai-message pre { overflow: visible; } }"
    ].join("\n");
  }

  function buildPdfHtmlStyle() {
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
      ".ceai-reference-block { margin: 0 0 8px; }",
      ".ceai-reference-block p { margin: 0 0 4px; color: #475467; font-size: 11px; font-weight: 600; }",
      ".ceai-reference-block--trailing { margin-top: 8px; margin-bottom: 0; }",
      ".ceai-reference-block--trailing p:last-child, .ceai-reference-block--leading p:last-child { margin-bottom: 0; }",
      ".ceai-message.role-human { border-left: 5px solid #2563eb; }",
      ".ceai-message.role-assistant { border-left: 5px solid #16a34a; }",
      ".ceai-message.role-system { border-left: 5px solid #7c3aed; }",
      ".ceai-message pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: \"Segoe UI Emoji\", \"Apple Color Emoji\", \"Segoe UI\", Tahoma, sans-serif; line-height: 1.45; }"
    ].join("\n");
  }

  function toHtmlDocument(conversation, settings) {
    const escapeHtml = root.sanitize.escapeHtml;
    const messageMarkup = (conversation.messages || [])
      .map((message) => messageHtml(message, settings))
      .join("\n");

    return [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "  <meta charset=\"utf-8\">",
      "  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
      `  <title>${escapeHtml(conversation.title)}</title>`,
      `  <style>${buildHtmlStyle()}</style>`,
      "</head>",
      "<body>",
      "  <main>",
      buildHtmlHeader(conversation),
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
    const messageMarkup = (conversation.messages || [])
      .map((message) => messagePdfHtml(message, settings))
      .join("\n");

    return [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "  <meta charset=\"utf-8\">",
      "  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
      `  <title>${escapeHtml(conversation.title)}</title>`,
      `  <style>${buildPdfHtmlStyle()}</style>`,
      "</head>",
      "<body>",
      "  <main>",
      buildHtmlHeader(conversation),
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
