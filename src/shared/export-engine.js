/*
 * Stable export engine for TXT, HTML and MHT.
 * PDF rendering is handled separately by Chrome printing the generated HTML.
 */
(() => {
  const root = globalThis.ChatExportAi;

  function compactName(value) {
    return String(value || "chat")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "chat";
  }

  function timestampParts(date) {
    const currentDate = date || new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const day = String(currentDate.getDate()).padStart(2, "0");
    const hours = String(currentDate.getHours()).padStart(2, "0");
    const minutes = String(currentDate.getMinutes()).padStart(2, "0");
    const seconds = String(currentDate.getSeconds()).padStart(2, "0");

    return {
      date: `${year}-${month}-${day}`,
      time: `${hours}-${minutes}-${seconds}`
    };
  }

  function keywordValueMap(conversation) {
    const timeParts = timestampParts(new Date(conversation.extractedAtIso || Date.now()));

    return {
      "<ChatName>": compactName(conversation.title || "chat"),
      "<ChatFolder>": compactName(conversation.folderName || ""),
      "<Model>": compactName(conversation.modelName || ""),
      "<Provider>": compactName(conversation.providerName || ""),
      "<Date>": timeParts.date,
      "<Time>": timeParts.time
    };
  }

  function resolveFileBaseName(conversation) {
    const settings = conversation.settings || root.defaults.settings;
    const keywords = keywordValueMap(conversation);
    const templateSource = settings.autoFileName
      ? (settings.fileNameTemplate || "<ChatName>")
      : (settings.fileNameTemplate || "chat");

    let resolved = String(templateSource);

    for (const [keyword, value] of Object.entries(keywords)) {
      resolved = resolved.split(keyword).join(value);
    }

    resolved = compactName(resolved);

    return resolved || compactName(conversation.title || "chat");
  }

  function buildFileName(conversation, format) {
    return `${resolveFileBaseName(conversation)}.${format}`;
  }

  function rolePrefix(message) {
    let prefix = `<${message.speakerLabel}>`;

    if (message.timeLabel) {
      prefix += ` [${message.timeLabel}]`;
    }

    return prefix;
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
      lines.push(`${item.label}: ${item.value}`);
    }

    return `${lines.join("\n")}\n`;
  }

  function buildTextMessageBlock(message, settings) {
    const prefix = rolePrefix(message);
    const messageLines = String(message.text || "").split("\n");
    const outputLines = [];

    for (let index = 0; index < messageLines.length; index += 1) {
      const line = messageLines[index];
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

  function buildMessageHeader(message) {
    const escapeHtml = root.sanitize.escapeHtml;
    const speaker = escapeHtml(message.speakerLabel || "Unknown");
    const timeLabel = escapeHtml(message.timeLabel || "");

    return [
      "  <div class=\"ceai-message-head\">",
      `    <h2>${speaker}</h2>`,
      timeLabel ? `    <span class=\"ceai-message-time\">${timeLabel}</span>` : "",
      "  </div>"
    ].filter(Boolean).join("\n");
  }

  function messageHtml(message, settings) {
    const escapeHtml = root.sanitize.escapeHtml;
    const roleClass = `role-${escapeHtml(message.role || "unknown")}`;
    const headerMarkup = buildMessageHeader(message);

    if (settings.textFormatting === root.constants.TEXT_FORMATTING.CLEAN) {
      return [
        `<section class="ceai-message ${roleClass}">`,
        headerMarkup,
        `  <pre>${escapeHtml(message.text || "")}</pre>`,
        "</section>"
      ].join("\n");
    }

    return [
      `<section class="ceai-message ${roleClass}">`,
      headerMarkup,
      `  <div class="ceai-rich">${message.safeHtml || ""}</div>`,
      "</section>"
    ].join("\n");
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
      ".ceai-message h2 { margin: 0; font-size: 1rem; }",
      ".ceai-message-time { color: #64748b; font-size: 0.82rem; white-space: nowrap; }",
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
    toIrcText: toChatText,
    toChatText,
    toHtmlDocument,
    toMhtDocument
  };
})();
