/*
 * Inline header export UI injected on supported chat pages.
 * The floating menu is rendered as a fixed overlay to avoid clipping inside ChatGPT layouts.
 */
(() => {
  const root = globalThis.ChatExportAi;

  const UI_ROOT_ID = "ceai-inline-export-root";
  const MENU_ID = "ceai-inline-export-menu";
  const STYLE_ID = "ceai-inline-export-style";

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function spinnerIconMarkup() {
    return [
      "<svg viewBox=\"0 0 24 24\" role=\"img\" aria-hidden=\"true\">",
      "  <circle cx=\"12\" cy=\"12\" r=\"8\" fill=\"none\" stroke=\"currentColor\" stroke-opacity=\"0.28\" stroke-width=\"3\"></circle>",
      "  <path d=\"M12 4a8 8 0 0 1 8 8\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-width=\"3\"></path>",
      "</svg>"
    ].join("");
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    root.buttonSystem.ensureDocumentStyles(document);

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${UI_ROOT_ID} {
  display: inline-flex;
  margin-left: 8px;
  z-index: 2147483000;
  --ceai-inline-btn-width: 112px;
}
#${UI_ROOT_ID}[hidden] {
  display: none !important;
}
#${UI_ROOT_ID} .ceai-inline-btn {
  border: 1px solid #d0d7e2;
  background: #ffffff;
  color: #0f172a;
  border-radius: 999px;
  padding: 8px 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  width: var(--ceai-inline-btn-width);
  min-width: var(--ceai-inline-btn-width);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  position: relative;
  box-sizing: border-box;
}
#${UI_ROOT_ID} .ceai-inline-btn .ceai-inline-btn-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 1em;
  line-height: 1;
}
#${UI_ROOT_ID}[data-provider="deepseek"] .ceai-inline-btn,
#${UI_ROOT_ID} .ceai-inline-btn[data-compact="true"] {
  min-height: 30px;
  padding: 4px 10px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1;
}
#${UI_ROOT_ID}[data-provider="deepseek"] .ceai-inline-btn {
  background: transparent;
  border: 0;
  color: inherit;
}
#${UI_ROOT_ID}[data-provider="chatgpt"] .ceai-inline-btn {
  background: transparent;
  border: 0;
  color: inherit;
}
#${UI_ROOT_ID}[data-provider="deepseek"] {
  margin-right: 60px;
}
#${UI_ROOT_ID} .ceai-inline-btn svg {
  width: 16px;
  height: 16px;
  display: block;
}
#${UI_ROOT_ID} .ceai-inline-btn .ceai-inline-btn-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: opacity 120ms ease;
}
#${UI_ROOT_ID} .ceai-inline-btn:hover {
  filter: saturate(1.05) brightness(1.05);
}
#${UI_ROOT_ID} .ceai-inline-btn .ceai-inline-btn-spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
#${UI_ROOT_ID} .ceai-inline-btn .ceai-inline-btn-spinner svg {
  width: 15px;
  height: 15px;
}
#${UI_ROOT_ID} .ceai-inline-btn.is-loading .ceai-inline-btn-spinner {
  opacity: 1;
  animation: ceai-spin 0.85s linear infinite;
}
#${UI_ROOT_ID} .ceai-inline-btn.is-loading .ceai-inline-btn-label {
  opacity: 0;
  visibility: hidden;
}
#${UI_ROOT_ID} .ceai-inline-btn[disabled] {
  opacity: 0.55;
  cursor: default;
}
#${MENU_ID} {
  --ceai-menu-bg: #ffffff;
  --ceai-menu-border: #d0d7e2;
  --ceai-menu-shadow: rgba(15, 23, 42, 0.16);
  --ceai-btn-bg: #dcebff;
  --ceai-btn-bg-hover: #cfe3ff;
  --ceai-btn-bg-active: #bdd7ff;
  --ceai-btn-text: #19365e;
  --ceai-btn-disabled-bg: #e9eef6;
  --ceai-btn-disabled-text: #728097;
  position: fixed;
  top: 0;
  left: 0;
  display: none;
  gap: 6px;
  align-items: center;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid var(--ceai-menu-border);
  background: var(--ceai-menu-bg);
  box-shadow: 0 10px 24px var(--ceai-menu-shadow);
  backdrop-filter: blur(10px);
  white-space: nowrap;
  z-index: 2147483647;
}
#${MENU_ID}[data-theme="dark"] {
  --ceai-menu-bg: rgba(19, 29, 43, 0.98);
  --ceai-menu-border: #2a3d57;
  --ceai-menu-shadow: rgba(2, 6, 23, 0.42);
  --ceai-btn-bg: #d6e7ff;
  --ceai-btn-bg-hover: #c8defe;
  --ceai-btn-bg-active: #bad4f8;
  --ceai-btn-text: #163056;
  --ceai-btn-disabled-bg: #e5ebf3;
  --ceai-btn-disabled-text: #748296;
}
#${MENU_ID}.is-open {
  display: flex;
}
#${MENU_ID} .ceai-button {
  width: 72px;
  min-width: 72px;
  min-height: 68px;
  padding: 8px 6px;
  font-size: 13px;
  white-space: nowrap;
}
#${MENU_ID} .ceai-button[hidden] {
  display: none !important;
}
@keyframes ceai-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

    document.documentElement.appendChild(style);
  }

  function createActionButton(label, format, onExport) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.format = format;
    root.buttonSystem.decorateButton(button, {
      label,
      stacked: true
    });
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      root.buttonSystem.setButtonState(button, "loading");

      try {
        await Promise.resolve(onExport(format));
        root.buttonSystem.setButtonState(button, "success");
      } catch (_error) {
        root.buttonSystem.setButtonState(button, "idle");
      }
    });
    return button;
  }

  function createHeaderExportUi({ onExport }) {
    ensureStyles();

    const rootNode = document.createElement("div");
    rootNode.id = UI_ROOT_ID;
    rootNode.hidden = true;

    const mainButton = document.createElement("button");
    mainButton.type = "button";
    mainButton.className = "ceai-inline-btn";
    mainButton.setAttribute("aria-label", "Export current chat");
    mainButton.title = "Export current chat";
    mainButton.innerHTML = "<span class=\"ceai-inline-btn-label\">Export To...</span><span class=\"ceai-inline-btn-spinner\">" + spinnerIconMarkup() + "</span>";

    const menuNode = document.createElement("div");
    menuNode.id = MENU_ID;

    const exportMulti = createActionButton("Multi", root.constants.EXPORT_FORMATS.MULTI, onExport);
    const exportPdf = createActionButton(".PDF", root.constants.EXPORT_FORMATS.PDF, onExport);
    const exportMht = createActionButton(".MHT", root.constants.EXPORT_FORMATS.MHT, onExport);
    const exportHtml = createActionButton(".HTML", root.constants.EXPORT_FORMATS.HTML, onExport);
    const exportTxt = createActionButton(".TXT", root.constants.EXPORT_FORMATS.TXT, onExport);
    const defaultOrder = [
      root.constants.EXPORT_FORMATS.MULTI,
      root.constants.EXPORT_FORMATS.PDF,
      root.constants.EXPORT_FORMATS.MHT,
      root.constants.EXPORT_FORMATS.HTML,
      root.constants.EXPORT_FORMATS.TXT
    ];
    const formatButtonByFormat = {
      [root.constants.EXPORT_FORMATS.MULTI]: exportMulti,
      [root.constants.EXPORT_FORMATS.PDF]: exportPdf,
      [root.constants.EXPORT_FORMATS.MHT]: exportMht,
      [root.constants.EXPORT_FORMATS.HTML]: exportHtml,
      [root.constants.EXPORT_FORMATS.TXT]: exportTxt
    };
    let formatButtons = [];
    let isLoading = false;

    function normalizeExportButtonOrder(order) {
      const seen = new Set();
      const normalized = [];

      if (Array.isArray(order)) {
        order.forEach((item) => {
          const format = normalizeText(item).toLowerCase();
          if (!defaultOrder.includes(format) || seen.has(format)) {
            return;
          }

          seen.add(format);
          normalized.push(format);
        });
      }

      defaultOrder.forEach((format) => {
        if (!seen.has(format)) {
          seen.add(format);
          normalized.push(format);
        }
      });

      return normalized.length ? normalized : [...defaultOrder];
    }

    function setFormatOrder(order) {
      const orderedFormats = normalizeExportButtonOrder(order);
      formatButtons = orderedFormats
        .map((format) => formatButtonByFormat[format])
        .filter(Boolean);

      formatButtons.forEach((button) => {
        menuNode.appendChild(button);
      });
    }

    rootNode.appendChild(mainButton);
    document.body.appendChild(menuNode);
    setFormatOrder();

    function hasVisibleFormats() {
      return formatButtons.some((button) => !button.hidden);
    }

    function closeMenu() {
      menuNode.classList.remove("is-open");
    }

    function isMenuOpen() {
      return menuNode.classList.contains("is-open");
    }

    function syncMenuPosition() {
      if (!menuNode.classList.contains("is-open")) {
        return;
      }

      const rect = mainButton.getBoundingClientRect();
      const gap = 8;
      const maxLeft = Math.max(gap, window.innerWidth - menuNode.offsetWidth - gap);
      const desiredLeft = Math.min(Math.max(gap, rect.right - menuNode.offsetWidth), maxLeft);
      const desiredTop = Math.min(rect.bottom + gap, Math.max(gap, window.innerHeight - menuNode.offsetHeight - gap));

      menuNode.style.left = `${desiredLeft}px`;
      menuNode.style.top = `${desiredTop}px`;
    }

    function setTheme(themeMode) {
      menuNode.dataset.theme = themeMode === "dark" ? "dark" : "light";
    }

    function setProvider(providerId) {
      const normalizedProviderId = normalizeText(providerId).toLowerCase();
      if (!normalizedProviderId) {
        delete rootNode.dataset.provider;
        return;
      }

      rootNode.dataset.provider = normalizedProviderId;
    }

    function applyReferenceButtonStyle(referenceNode) {
      if (!referenceNode) {
        mainButton.style.cssText = "";
        mainButton.removeAttribute("data-compact");
        return;
      }

      const computed = window.getComputedStyle(referenceNode);
      const referenceRect = referenceNode.getBoundingClientRect();
      const width = Number(referenceRect.width) || 0;
      const height = Number(referenceRect.height) || 0;
      const textLabel = normalizeText(
        referenceNode.getAttribute("aria-label")
        || referenceNode.getAttribute("title")
        || referenceNode.textContent
      );
      const hasIcon = Boolean(referenceNode.querySelector("svg"));
      const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
      const borderRadius = String(computed.borderRadius || "").toLowerCase();
      const isIconOnlyReference = hasIcon && (!textLabel || textLabel.length <= 2);
      const isCompactReference = width <= 64 || height <= 36;
      const isCircularReference = borderRadius.includes("%");
      const hasTinyHorizontalPadding = (paddingLeft + paddingRight) <= 6;
      const looksIconButton = isIconOnlyReference || (
        isCompactReference && (isCircularReference || hasTinyHorizontalPadding)
      );

      if (looksIconButton) {
        // Keep base/compact styling when the anchor is icon-like so
        // "Export To..." does not inherit circular icon-button dimensions.
        mainButton.style.cssText = "";
        mainButton.dataset.compact = "true";
        mainButton.style.color = computed.color || "";
        mainButton.style.fontFamily = computed.fontFamily || "";
        return;
      }
      mainButton.removeAttribute("data-compact");

      const properties = [
        "background",
        "backgroundColor",
        "border",
        "borderRadius",
        "color",
        "font",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "boxShadow"
      ];

      properties.forEach((propertyName) => {
        const value = computed[propertyName];
        if (value) {
          mainButton.style[propertyName] = value;
        }
      });

      mainButton.style.display = "inline-flex";
      mainButton.style.alignItems = "center";
      mainButton.style.justifyContent = "center";
      mainButton.style.whiteSpace = "nowrap";
      mainButton.style.cursor = "pointer";
      mainButton.style.boxSizing = "border-box";

      // ChatGPT integration requirement: keep the inline button borderless/background-less
      // even when host styles are copied from Share.
      const activeProvider = normalizeText(rootNode.dataset.provider).toLowerCase();
      if (activeProvider === "chatgpt") {
        mainButton.style.background = "transparent";
        mainButton.style.backgroundColor = "transparent";
        mainButton.style.border = "0";
      }

      if (activeProvider === "gemini") {
        const currentFontSize = Number.parseFloat(mainButton.style.fontSize || computed.fontSize || "13");
        if (Number.isFinite(currentFontSize) && currentFontSize > 0) {
          mainButton.style.fontSize = `${(currentFontSize * 0.7).toFixed(2)}px`;
        }
      }
    }

    function syncButtonWidth() {
      mainButton.style.removeProperty("--ceai-inline-btn-width");
      const currentWidth = Math.ceil(mainButton.getBoundingClientRect().width || 0);

      if (currentWidth > 0) {
        mainButton.style.setProperty("--ceai-inline-btn-width", `${currentWidth}px`);
      }
    }

    function mount(anchor) {
      const referenceNode = anchor?.referenceNode || null;
      const styleReferenceNode = anchor?.styleReferenceNode || referenceNode;
      const container = anchor?.container || referenceNode?.parentElement || null;
      const shouldInsertBefore = Boolean(anchor?.preferBefore && referenceNode && referenceNode.parentElement === container);

      if (!container) {
        return false;
      }

      if (referenceNode && referenceNode.parentElement === container) {
        if (rootNode.parentElement !== referenceNode.parentElement) {
          referenceNode.insertAdjacentElement(shouldInsertBefore ? "beforebegin" : "afterend", rootNode);
        } else if (shouldInsertBefore && rootNode.nextElementSibling !== referenceNode) {
          referenceNode.insertAdjacentElement("beforebegin", rootNode);
        } else if (!shouldInsertBefore && rootNode.previousElementSibling !== referenceNode) {
          referenceNode.insertAdjacentElement("afterend", rootNode);
        }
      } else if (rootNode.parentElement !== container) {
        container.appendChild(rootNode);
      }

      applyReferenceButtonStyle(styleReferenceNode);
      syncButtonWidth();
      return true;
    }

    function setVisibleFormats(nextVisibility) {
      exportMulti.hidden = !nextVisibility.showExportMulti;
      exportPdf.hidden = !nextVisibility.showExportPdf;
      exportMht.hidden = !nextVisibility.showExportMht;
      exportHtml.hidden = !nextVisibility.showExportHtml;
      exportTxt.hidden = !nextVisibility.showExportTxt;

      if (!hasVisibleFormats()) {
        closeMenu();
      }
    }

    function setFormatStates(stateByFormat) {
      formatButtons.forEach((button) => {
        const format = button.dataset.format;
        const shouldShowSuccess = Boolean(stateByFormat && stateByFormat[format]);
        root.buttonSystem.setButtonState(button, shouldShowSuccess ? "success" : "idle");
      });
    }

    function setVisible(visible) {
      rootNode.hidden = !visible || !hasVisibleFormats();
      if (!visible) {
        closeMenu();
      }
    }

    function setEnabled(enabled) {
      mainButton.disabled = !enabled || isLoading;
      formatButtons.forEach((button) => {
        button.disabled = !enabled || button.hidden || isLoading;
        if (!enabled && !isLoading) {
          root.buttonSystem.setButtonState(button, "idle");
        }
      });

      if (!enabled) {
        closeMenu();
      }
    }

    function setLoading(loading) {
      isLoading = Boolean(loading);
      mainButton.classList.toggle("is-loading", isLoading);
      mainButton.setAttribute("aria-busy", isLoading ? "true" : "false");
      mainButton.disabled = isLoading;
      formatButtons.forEach((button) => {
        button.disabled = isLoading || button.hidden;
        if (isLoading) {
          root.buttonSystem.setButtonState(button, "idle");
        }
      });

      if (isLoading) {
        closeMenu();
      }
    }

    function destroy() {
      closeMenu();
      menuNode.remove();
      rootNode.remove();
    }

    mainButton.addEventListener("click", () => {
      if (mainButton.disabled) {
        return;
      }

      if (menuNode.classList.contains("is-open")) {
        closeMenu();
        return;
      }

      menuNode.classList.add("is-open");
      syncMenuPosition();
      window.requestAnimationFrame(syncMenuPosition);
    });

    window.addEventListener("resize", syncMenuPosition);
    window.addEventListener("scroll", syncMenuPosition, true);

    document.addEventListener("click", (event) => {
      if (!rootNode.contains(event.target) && !menuNode.contains(event.target)) {
        closeMenu();
      }
    });

    menuNode.addEventListener("click", () => {
      closeMenu();
    });

    return {
      mount,
      setTheme,
      setProvider,
      setFormatOrder,
      setVisibleFormats,
      setFormatStates,
      hasVisibleFormats,
      setVisible,
      setEnabled,
      setLoading,
      isMenuOpen,
      closeMenu,
      destroy
    };
  }

  root.contentUi = {
    createHeaderExportUi
  };
})();
