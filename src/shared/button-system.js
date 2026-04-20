/*
 * Shared button system used by popup, options and inline export menus.
 * One component definition keeps hover, disabled and loading states consistent.
 */
(() => {
  const root = globalThis.ChatExportAi;
  const STYLE_ID = "ceai-shared-button-style";

  function spinnerMarkup(className = "ceai-button__spinner") {
    return [
      `<svg class="${className}" viewBox="0 0 24 24" role="img" aria-hidden="true">`,
      '  <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="3"></circle>',
      '  <path d="M12 4a8 8 0 0 1 8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="3"></path>',
      '</svg>'
    ].join("");
  }

  function downloadGlyphMarkup(className = "ceai-button__icon") {
    return [
      `<svg class="${className}" viewBox="0 0 24 24" role="img" aria-hidden="true">`,
      '  <path d="M12 7.5v5.1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.85"></path>',
      '  <path d="M9.8 11.5 12 13.9l2.2-2.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.85"></path>',
      '  <path d="M9.2 16.2h5.6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.85"></path>',
      '</svg>'
    ].join("");
  }

  function styleText() {
    return `
.ceai-button {
  --ceai-btn-bg: #dcebff;
  --ceai-btn-bg-hover: #cfe3ff;
  --ceai-btn-bg-active: #bdd7ff;
  --ceai-btn-text: #19365e;
  --ceai-btn-disabled-bg: #e9eef6;
  --ceai-btn-disabled-text: #728097;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 14px;
  background: var(--ceai-btn-bg);
  color: var(--ceai-btn-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  text-decoration: none;
  transition: transform 120ms ease, background-color 120ms ease, color 120ms ease, filter 120ms ease;
}
.ceai-button:hover:not([disabled]) {
  background: var(--ceai-btn-bg-hover);
  filter: saturate(1.05) brightness(1.03);
}
.ceai-button:active:not([disabled]) {
  background: var(--ceai-btn-bg-active);
  transform: translateY(1px);
}
.ceai-button[disabled] {
  background: var(--ceai-btn-disabled-bg);
  color: var(--ceai-btn-disabled-text);
  cursor: not-allowed;
  opacity: 1;
  filter: saturate(0.85);
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
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 3px;
  width: 100%;
}
.ceai-button__icon {
  width: 20px;
  height: 20px;
  display: block;
  flex: 0 0 auto;
}
.ceai-button__spinner {
  width: 9px;
  height: 9px;
  display: block;
  flex: 0 0 auto;
}
.ceai-button__spinner {
  position: absolute;
  left: 50%;
  top: 50%;
  margin-left: -4.5px;
  margin-top: -4.5px;
  opacity: 0;
  animation: ceai-button-spin 0.85s linear infinite;
}
.ceai-button__icon svg,
.ceai-button__spinner svg {
  width: 100%;
  height: 100%;
}
.ceai-button__label {
  display: block;
  line-height: 1.05;
  text-align: center;
}
.ceai-button--stacked .ceai-button__label {
  letter-spacing: 0.02em;
}
.ceai-button--stacked {
  aspect-ratio: 1 / 1;
}
.ceai-button--secondary {
  --ceai-btn-bg: #dbe3ee;
  --ceai-btn-bg-hover: #d1dbe8;
  --ceai-btn-bg-active: #c3cfdd;
  --ceai-btn-text: #283447;
  --ceai-btn-disabled-bg: #e8edf3;
  --ceai-btn-disabled-text: #7b8799;
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
      ? `<span class="ceai-button__content ceai-button__stack">${downloadGlyphMarkup()}<span class="ceai-button__label">${label}</span></span>${spinnerMarkup()}`
      : `<span class="ceai-button__content"><span class="ceai-button__label">${label}</span></span>${spinnerMarkup()}`;
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
