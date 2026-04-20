/*
 * Conversores desde HTML sanitizado a texto limpio o Markdown.
 * Se usan en el postprocesado global, compartido por todos los proveedores.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { QUOTE_DIVIDER_STYLE } = root.constants;

  const BLOCK_TAGS = new Set([
    "p",
    "pre",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "tr",
    "div",
    "section",
    "article"
  ]);

  function quotePrefix(style) {
    return style === QUOTE_DIVIDER_STYLE.TABULAR ? "| " : "> ";
  }

  function divider(style) {
    return style === QUOTE_DIVIDER_STYLE.TABULAR ? "------" : "---";
  }

  function normalizeTextOutput(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function parseHtml(html) {
    const container = document.createElement("div");
    container.innerHTML = html || "";
    return container;
  }

  function toPlainTextFromNode(node, style) {
    if (!node) {
      return "";
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();

    if (tag === "br") {
      return "\n";
    }

    if (tag === "hr") {
      return `\n${divider(style)}\n`;
    }

    if (tag === "pre") {
      const preText = node.textContent || "";
      return `\n${preText}\n`;
    }

    if (tag === "blockquote") {
      const content = Array.from(node.childNodes)
        .map((child) => toPlainTextFromNode(child, style))
        .join("");

      const lines = normalizeTextOutput(content)
        .split("\n")
        .map((line) => `${quotePrefix(style)}${line}`)
        .join("\n");

      return `${lines}\n`;
    }

    if (tag === "ul") {
      const lines = Array.from(node.querySelectorAll(":scope > li"))
        .map((li) => `- ${normalizeTextOutput(toPlainTextFromNode(li, style))}`)
        .join("\n");
      return `${lines}\n`;
    }

    if (tag === "ol") {
      const lines = Array.from(node.querySelectorAll(":scope > li"))
        .map((li, index) => `${index + 1}. ${normalizeTextOutput(toPlainTextFromNode(li, style))}`)
        .join("\n");
      return `${lines}\n`;
    }

    if (tag === "a") {
      const text = Array.from(node.childNodes)
        .map((child) => toPlainTextFromNode(child, style))
        .join("")
        .trim();
      const href = node.getAttribute("href");
      if (!href) {
        return text;
      }
      return text ? `${text} (${href})` : href;
    }

    if (tag === "table") {
      const rows = Array.from(node.querySelectorAll("tr")).map((tr) => {
        const cells = Array.from(tr.querySelectorAll("th,td")).map((cell) => normalizeTextOutput(cell.innerText || ""));
        return cells.join(" | ");
      });
      return `${rows.join("\n")}\n`;
    }

    const content = Array.from(node.childNodes)
      .map((child) => toPlainTextFromNode(child, style))
      .join("");

    if (BLOCK_TAGS.has(tag)) {
      return `${content}\n`;
    }

    return content;
  }

  function escapeMarkdownText(text) {
    return String(text || "").replace(/([*_`~\\])/g, "\\$1");
  }

  function prefixMultiline(text, prefix) {
    return text
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");
  }

  function toMarkdownFromNode(node, style, inPre = false) {
    if (!node) {
      return "";
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || "";
      return inPre ? raw : escapeMarkdownText(raw);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();

    if (tag === "br") {
      return "\n";
    }

    if (tag === "hr") {
      return `\n${divider(style)}\n\n`;
    }

    if (tag === "strong" || tag === "b") {
      return `**${Array.from(node.childNodes).map((child) => toMarkdownFromNode(child, style, inPre)).join("")}**`;
    }

    if (tag === "em" || tag === "i") {
      return `*${Array.from(node.childNodes).map((child) => toMarkdownFromNode(child, style, inPre)).join("")}*`;
    }

    if (tag === "s") {
      return `~~${Array.from(node.childNodes).map((child) => toMarkdownFromNode(child, style, inPre)).join("")}~~`;
    }

    if (tag === "code") {
      const inline = node.textContent || "";
      return `\`${inline.replace(/`/g, "\\`")}\``;
    }

    if (tag === "pre") {
      const codeText = node.textContent || "";
      return `\n\`\`\`\n${codeText}\n\`\`\`\n\n`;
    }

    if (tag === "a") {
      const text = Array.from(node.childNodes).map((child) => toMarkdownFromNode(child, style, inPre)).join("").trim();
      const href = node.getAttribute("href") || "";
      if (!href) {
        return text;
      }
      return text ? `[${text}](${href})` : href;
    }

    if (tag === "blockquote") {
      const content = Array.from(node.childNodes).map((child) => toMarkdownFromNode(child, style, inPre)).join("");
      const normalized = normalizeTextOutput(content);
      const quoted = prefixMultiline(normalized, quotePrefix(style));
      return `${quoted}\n\n`;
    }

    if (tag === "ul") {
      const lines = Array.from(node.querySelectorAll(":scope > li"))
        .map((li) => `- ${normalizeTextOutput(Array.from(li.childNodes).map((child) => toMarkdownFromNode(child, style, inPre)).join(""))}`)
        .join("\n");
      return `${lines}\n\n`;
    }

    if (tag === "ol") {
      const lines = Array.from(node.querySelectorAll(":scope > li"))
        .map((li, index) => `${index + 1}. ${normalizeTextOutput(Array.from(li.childNodes).map((child) => toMarkdownFromNode(child, style, inPre)).join(""))}`)
        .join("\n");
      return `${lines}\n\n`;
    }

    if (tag === "table") {
      const rows = Array.from(node.querySelectorAll("tr")).map((tr) => {
        const cells = Array.from(tr.querySelectorAll("th,td")).map((cell) => normalizeTextOutput(cell.innerText || ""));
        return cells.join(" | ");
      });
      return `${rows.join("\n")}\n\n`;
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const title = Array.from(node.childNodes).map((child) => toMarkdownFromNode(child, style, inPre)).join("").trim();
      return `${"#".repeat(level)} ${title}\n\n`;
    }

    const content = Array.from(node.childNodes)
      .map((child) => toMarkdownFromNode(child, style, inPre))
      .join("");

    if (tag === "p" || BLOCK_TAGS.has(tag)) {
      return `${content}\n\n`;
    }

    return content;
  }

  function htmlToPlainText(safeHtml, options = {}) {
    const style = options.quoteDividerStyle || QUOTE_DIVIDER_STYLE.MARKDOWN;
    const rootNode = parseHtml(safeHtml);
    const text = Array.from(rootNode.childNodes)
      .map((child) => toPlainTextFromNode(child, style))
      .join("");
    return normalizeTextOutput(text);
  }

  function htmlToMarkdown(safeHtml, options = {}) {
    const style = options.quoteDividerStyle || QUOTE_DIVIDER_STYLE.MARKDOWN;
    const rootNode = parseHtml(safeHtml);
    const markdown = Array.from(rootNode.childNodes)
      .map((child) => toMarkdownFromNode(child, style))
      .join("");
    return normalizeTextOutput(markdown);
  }

  root.textConverter = {
    htmlToPlainText,
    htmlToMarkdown,
    normalizeTextOutput,
    divider
  };
})();
