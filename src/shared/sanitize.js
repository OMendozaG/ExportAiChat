/*
 * Sanitizador HTML seguro y tolerante.
 * Objetivo: extraer texto y formato útil sin arrastrar "basura" de UI.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const { MEDIA_HANDLING } = root.constants;

  const ALLOWED_TAGS = new Set([
    "p",
    "br",
    "span",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "a",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td"
  ]);

  const SELF_CLOSING_TAGS = new Set(["br", "hr"]);
  const MEDIA_TAGS = new Set(["img", "video", "audio", "picture", "source", "figure", "figcaption", "iframe", "canvas", "svg"]);

  // Whitelist mínima de tags de bloque para reconstruir saltos coherentes.
  const BLOCK_HINT_TAGS = new Set([
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

  // Span classes are restricted to extension-owned semantic markers.
  const ALLOWED_SPAN_CLASSES = new Set([
    "ceai-inline-reference-chip"
  ]);

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(text) {
    return escapeHtml(text).replace(/\n/g, " ").trim();
  }

  function isSafeUrl(input) {
    if (!input || typeof input !== "string") {
      return false;
    }

    const trimmed = input.trim();

    // Permitimos URLs relativas del propio sitio para preservar enlaces internos.
    if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("#")) {
      return true;
    }

    try {
      const parsed = new URL(trimmed, location.href);
      return ["http:", "https:", "mailto:", "data:", "blob:"].includes(parsed.protocol);
    } catch (_error) {
      return false;
    }
  }

  function mediaPlaceholder(node) {
    const tag = (node.tagName || "MEDIA").toUpperCase();
    const alt = node.getAttribute?.("alt") || node.getAttribute?.("aria-label") || "non-textual content";
    return `<p>[${tag}: ${escapeHtml(alt)}]</p>`;
  }

  function sanitizeMediaNode(node, options, state) {
    state.hasMedia = true;

    const mode = options.mediaHandling || MEDIA_HANDLING.PLACEHOLDER;

    if (mode === MEDIA_HANDLING.IGNORE) {
      return "";
    }

    if (mode === MEDIA_HANDLING.PLACEHOLDER) {
      return mediaPlaceholder(node);
    }

    // Modo MHT: conservamos una versión limitada de media cuando sea razonablemente segura.
    const tag = (node.tagName || "").toLowerCase();

    if (tag === "img") {
      const src = node.getAttribute("src");
      const alt = node.getAttribute("alt") || "image";
      if (!isSafeUrl(src)) {
        return mediaPlaceholder(node);
      }
      return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}">`;
    }

    if (tag === "video" || tag === "audio") {
      const src = node.getAttribute("src");
      if (!isSafeUrl(src)) {
        return mediaPlaceholder(node);
      }
      return `<${tag} controls src="${escapeAttribute(src)}"></${tag}>`;
    }

    if (tag === "source") {
      const src = node.getAttribute("src");
      if (!isSafeUrl(src)) {
        return "";
      }
      const type = node.getAttribute("type") || "";
      const typeAttr = type ? ` type="${escapeAttribute(type)}"` : "";
      return `<source src="${escapeAttribute(src)}"${typeAttr}>`;
    }

    if (tag === "figure" || tag === "figcaption" || tag === "picture") {
      // Para contenedores media intentamos preservar hijos sanitizados.
      const children = Array.from(node.childNodes)
        .map((child) => sanitizeNode(child, options, state))
        .join("");
      if (!children.trim()) {
        return mediaPlaceholder(node);
      }
      return `<${tag}>${children}</${tag}>`;
    }

    return mediaPlaceholder(node);
  }

  function sanitizeElement(node, options, state) {
    const tag = node.tagName.toLowerCase();

    if (MEDIA_TAGS.has(tag)) {
      return sanitizeMediaNode(node, options, state);
    }

    // Ignoramos tags claramente de ejecución/UI y seguimos con el resto del árbol.
    if (["script", "style", "noscript", "button", "form", "input", "textarea", "select", "option"].includes(tag)) {
      return "";
    }

    // Tags no permitidos: extraemos hijos para no perder texto útil.
    if (!ALLOWED_TAGS.has(tag)) {
      const extractedChildren = Array.from(node.childNodes)
        .map((child) => sanitizeNode(child, options, state))
        .join("");

      // Si el nodo era de bloque y quedó texto, añadimos separación mínima.
      if (BLOCK_HINT_TAGS.has(tag) && extractedChildren.trim()) {
        return `<p>${extractedChildren}</p>`;
      }

      return extractedChildren;
    }

    // Sanitizado de atributos por tag (whitelist muy corta).
    let attrs = "";

    if (tag === "a") {
      const href = node.getAttribute("href");
      if (isSafeUrl(href)) {
        attrs += ` href="${escapeAttribute(href)}"`;
      }
    }

    let keepSpanTag = true;

    if (tag === "span") {
      const classTokens = String(node.getAttribute("class") || "")
        .split(/\s+/)
        .map((token) => String(token || "").trim())
        .filter((token) => ALLOWED_SPAN_CLASSES.has(token));
      if (classTokens.length) {
        attrs += ` class="${escapeAttribute(Array.from(new Set(classTokens)).join(" "))}"`;
      } else {
        // Flatten regular spans to keep previous sanitize behavior.
        keepSpanTag = false;
      }
    }

    if (SELF_CLOSING_TAGS.has(tag)) {
      return `<${tag}${attrs}>`;
    }

    const children = Array.from(node.childNodes)
      .map((child) => sanitizeNode(child, options, state))
      .join("");

    if (tag === "span" && !keepSpanTag) {
      return children;
    }

    return `<${tag}${attrs}>${children}</${tag}>`;
  }

  function sanitizeNode(node, options, state) {
    if (!node) {
      return "";
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent || "");
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      return sanitizeElement(node, options, state);
    }

    return "";
  }

  function normalizeEmptyResult(resultHtml, sourceNode) {
    if (resultHtml && resultHtml.replace(/<[^>]+>/g, "").trim()) {
      return resultHtml;
    }

    const fallbackText = sourceNode?.innerText || sourceNode?.textContent || "";
    const trimmed = fallbackText.trim();

    if (!trimmed) {
      return "";
    }

    return `<p>${escapeHtml(trimmed)}</p>`;
  }

  function sanitizeMessageNode(sourceNode, options = {}) {
    const state = {
      hasMedia: false
    };

    const safeOptions = {
      mediaHandling: options.mediaHandling || MEDIA_HANDLING.PLACEHOLDER
    };

    const html = Array.from(sourceNode.childNodes)
      .map((child) => sanitizeNode(child, safeOptions, state))
      .join("");

    const safeHtml = normalizeEmptyResult(html, sourceNode);

    return {
      safeHtml,
      hasMedia: state.hasMedia
    };
  }

  root.sanitize = {
    escapeHtml,
    sanitizeMessageNode
  };
})();
