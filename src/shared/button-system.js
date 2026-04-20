/*
 * Shared button system used by popup, options and inline export menus.
 * One component definition keeps hover, disabled and loading states consistent.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const STYLE_ID = "ceai-shared-button-style";

  function spinnerMarkup() {
    return [
      '<svg viewBox="0 0 24 24" role="img" aria-hidden="true">',
      '  <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="3"></circle>',
      '  <path d="M12 4a8 8 0 0 1 8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="3"></path>',
      '</svg>'
    ].join("");
  }

  function downloadGlyphMarkup() {
    return [
      '<svg viewBox="0 0 24 24" role="img" aria-hidden="true">',
      '  <path d="M12 4.5v8.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>',
      '  <path d="M8.2 10.8 12 14.9l3.8-4.1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>',
      '  <path d="M7 18.25h10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"></path>',
      '</svg>'
    ].join("");
  }

  function styleText() {
    return `
.ceai-button {
  --ceai-btn-bg: #eef4ff;
  --ceai-btn-text: #10213f;
  --ceai-btn-border: #c8dafd;
  --ceai-btn-border-strong: #97b8ff;
  --ceai-btn-base: #7a99d9;
  --ceai-btn-glow: rgba(120, 166, 255, 0.34);
  --ceai-btn-disabled-bg: color-mix(in srgb, var(--ceai-btn-bg) 72%, white 28%);
  --ceai-btn-disabled-text: color-mix(in srgb, var(--ceai-btn-text) 68%, #64748b 32%);
  --ceai-btn-disabled-base: color-mix(in srgb, var(--ceai-btn-base) 62%, white 38%);
  position: relative;
  isolation: isolate;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 14px;
  background: var(--ceai-btn-bg);
  color: var(--ceai-btn-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  text-decoration: none;
  transition: transform 120ms ease, background-color 120ms ease, box-shadow 120ms ease, color 120ms ease;
}
.ceai-button::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border-left: 1px solid var(--ceai-btn-border);
  border-right: 1px solid var(--ceai-btn-border);
  border-bottom: 1px solid var(--ceai-btn-border);
  pointer-events: none;
}
.ceai-button::after {
  content: "";
  position: absolute;
  top: 7px;
  right: 0;
  bottom: -4px;
  left: 0;
  border-radius: inherit;
  background: var(--ceai-btn-base);
  z-index: -1;
}
.ceai-button:hover:not([disabled]) {
  background: color-mix(in srgb, var(--ceai-btn-bg) 82%, white 18%);
  box-shadow: 0 0 0 1px transparent, 0 0 18px var(--ceai-btn-glow);
  transform: translateY(1px);
}
.ceai-button:hover:not([disabled])::before {
  border-left-color: var(--ceai-btn-border-strong);
  border-right-color: var(--ceai-btn-border-strong);
  border-bottom-color: var(--ceai-btn-border-strong);
}
.ceai-button:active:not([disabled]) {
  transform: translateY(4px);
}
.ceai-button[disabled] {
  background: var(--ceai-btn-disabled-bg);
  color: var(--ceai-btn-disabled-text);
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
  opacity: 1;
}
.ceai-button[disabled]::before {
  border-left-color: color-mix(in srgb, var(--ceai-btn-border) 70%, white 30%);
  border-right-color: color-mix(in srgb, var(--ceai-btn-border) 70%, white 30%);
  border-bottom-color: color-mix(in srgb, var(--ceai-btn-border) 70%, white 30%);
}
.ceai-button[disabled]::after {
  background: var(--ceai-btn-disabled-base);
}
.ceai-button.is-loading {
  color: transparent !important;
}
.ceai-button.is-loading .ceai-button__content {
  opacity: 0;
}
.ceai-button.is-loading .ceai-button__spinner {
  opacity: 1;
}
.ceai-button__content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
}
.ceai-button__stack {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
}
.ceai-button__icon,
.ceai-button__spinner {
  width: 14px;
  height: 14px;
  display: block;
  flex: 0 0 auto;
}
.ceai-button__spinner {
  position: absolute;
  left: 50%;
  top: 50%;
  margin-left: -7px;
  margin-top: -7px;
  opacity: 0;
  animation: ceai-button-spin 0.85s linear infinite;
}
.ceai-button__label {
  display: block;
  line-height: 1;
}
.ceai-button--stacked .ceai-button__label {
  letter-spacing: 0.02em;
}
.ceai-button--secondary {
  --ceai-btn-bg: #d8e0ec;
  --ceai-btn-text: #223047;
  --ceai-btn-border: #b4c0d1;
  --ceai-btn-border-strong: #93a6bf;
  --ceai-btn-base: #8b9ab0;
  --ceai-btn-glow: rgba(148, 163, 184, 0.28);
}
@keyframes ceai-button-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;
  }

  function ensureDocumentStyles(doc = document) {
    if (!doc || doc.getElementById(STYLE_ID)) {
      return;
    }

    const styleNode = doc.createElement("style");
    styleNode.id = STYLE_ID;
    styleNode.textContent = styleText();
    doc.head ? doc.head.appendChild(styleNode) : doc.documentElement.appendChild(styleNode);
  }

  function buildContentMarkup(label, stacked) {
    return stacked
      ? `<span class="ceai-button__content ceai-button__stack">${downloadGlyphMarkup()}<span class="ceai-button__label">${label}</span></span>${spinnerMarkup().replace('<svg ', '<svg class="ceai-button__spinner" ')}`
      : `<span class="ceai-button__content"><span class="ceai-button__label">${label}</span></span>${spinnerMarkup().replace('<svg ', '<svg class="ceai-button__spinner" ')}`;
  }

  function decorateButton(button, options = {}) {
    if (!button) {
      return button;
    }

    const {
      label = button.textContent || "",
      stacked = false,
      secondary = false
    } = options;

    button.classList.add("ceai-button");
    button.classList.toggle("ceai-button--stacked", Boolean(stacked));
    button.classList.toggle("ceai-button--secondary", Boolean(secondary));
    button.innerHTML = buildContentMarkup(label, stacked);
    return button;
  }

  root.buttonSystem = {
    ensureDocumentStyles,
    decorateButton,
    downloadGlyphMarkup,
    spinnerMarkup,
    styleText
  };
})();
