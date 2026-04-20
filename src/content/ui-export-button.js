/*
 * Inline header export UI injected on supported chat pages.
 * The floating menu is rendered as a fixed overlay to avoid clipping inside ChatGPT layouts.
 */
(() => {
  const root = globalThis.ChatExportAi;

  const UI_ROOT_ID = "ceai-inline-export-root";
  const MENU_ID = "ceai-inline-export-menu";
  const STYLE_ID = "ceai-inline-export-style";

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

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${UI_ROOT_ID} {
  display: inline-flex;
  margin-left: 8px;
  z-index: 2147483000;
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
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
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
}
#${UI_ROOT_ID} .ceai-inline-btn:hover {
  filter: saturate(1.04) brightness(1.02);
}
#${UI_ROOT_ID} .ceai-inline-btn.is-loading svg {
  animation: ceai-spin 0.85s linear infinite;
}
#${UI_ROOT_ID} .ceai-inline-btn[disabled] {
  opacity: 0.55;
  cursor: default;
}
#${MENU_ID} {
  --ceai-menu-bg: #ffffff;
  --ceai-menu-border: #d0d7e2;
  --ceai-menu-shadow: rgba(15, 23, 42, 0.16);
  --ceai-menu-button-bg: #eef4ff;
  --ceai-menu-button-border: #c8dafd;
  --ceai-menu-button-border-strong: #a9c6fd;
  --ceai-menu-button-base: #86a9ea;
  --ceai-menu-button-glow: rgba(120, 166, 255, 0.42);
  --ceai-menu-button-text: #0d2342;
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
  --ceai-menu-button-bg: #dce9ff;
  --ceai-menu-button-border: #bbd1fb;
  --ceai-menu-button-border-strong: #d5e4ff;
  --ceai-menu-button-base: #6c8fd1;
  --ceai-menu-button-glow: rgba(195, 219, 255, 0.34);
  --ceai-menu-button-text: #0b1830;
}
#${MENU_ID}.is-open {
  display: flex;
}
#${MENU_ID} button {
  position: relative;
  margin-bottom: 6px;
  border: 0;
  border-radius: 12px;
  background: var(--ceai-menu-button-bg);
  color: var(--ceai-menu-button-text);
  min-width: 64px;
  min-height: 56px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}
#${MENU_ID} button::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow:
    inset 1px 0 0 var(--ceai-menu-button-border),
    inset -1px 0 0 var(--ceai-menu-button-border),
    inset 0 -1px 0 var(--ceai-menu-button-border);
  pointer-events: none;
}
#${MENU_ID} button::after {
  content: "";
  position: absolute;
  top: 6px;
  right: 0;
  bottom: -4px;
  left: 0;
  border-radius: inherit;
  background: var(--ceai-menu-button-base);
  z-index: -1;
}
#${MENU_ID} button:hover {
  background: color-mix(in srgb, var(--ceai-menu-button-bg) 84%, white 16%);
  box-shadow: 0 0 16px var(--ceai-menu-button-glow);
  transform: translateY(1px);
}
#${MENU_ID} button:hover::before {
  box-shadow:
    inset 1px 0 0 var(--ceai-menu-button-border-strong),
    inset -1px 0 0 var(--ceai-menu-button-border-strong),
    inset 0 -1px 0 var(--ceai-menu-button-border-strong);
}
#${MENU_ID} button:active {
  transform: translateY(4px);
}
#${MENU_ID} button[hidden] {
  display: none !important;
}
#${MENU_ID} button[disabled] {
  opacity: 0.55;
  cursor: default;
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
    button.textContent = label;
    button.addEventListener("click", () => {
      void Promise.resolve(onExport(format)).catch(() => {});
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
    mainButton.innerHTML = "<span class=\"ceai-inline-btn-label\">Export To...</span>";

    const menuNode = document.createElement("div");
    menuNode.id = MENU_ID;

    const exportPdf = createActionButton(".PDF", root.constants.EXPORT_FORMATS.PDF, onExport);
    const exportMht = createActionButton(".MHT", root.constants.EXPORT_FORMATS.MHT, onExport);
    const exportHtml = createActionButton(".HTML", root.constants.EXPORT_FORMATS.HTML, onExport);
    const exportTxt = createActionButton(".TXT", root.constants.EXPORT_FORMATS.TXT, onExport);
    const formatButtons = [exportPdf, exportMht, exportHtml, exportTxt];
    let isLoading = false;

    menuNode.appendChild(exportPdf);
    menuNode.appendChild(exportMht);
    menuNode.appendChild(exportHtml);
    menuNode.appendChild(exportTxt);

    rootNode.appendChild(mainButton);
    document.body.appendChild(menuNode);

    function hasVisibleFormats() {
      return formatButtons.some((button) => !button.hidden);
    }

    function closeMenu() {
      menuNode.classList.remove("is-open");
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

    function applyReferenceButtonStyle(referenceNode) {
      if (!referenceNode) {
        mainButton.style.cssText = "";
        return;
      }

      const computed = window.getComputedStyle(referenceNode);
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
        "lineHeight",
        "padding",
        "height",
        "minHeight",
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
    }

    function mount(anchor) {
      const referenceNode = anchor?.referenceNode || null;
      const container = referenceNode?.parentElement || anchor?.container || null;

      if (!container) {
        return false;
      }

      if (referenceNode && referenceNode.parentElement) {
        if (rootNode.previousElementSibling !== referenceNode || rootNode.parentElement !== referenceNode.parentElement) {
          referenceNode.insertAdjacentElement("afterend", rootNode);
        }
      } else if (rootNode.parentElement !== container) {
        container.appendChild(rootNode);
      }

      applyReferenceButtonStyle(referenceNode);
      return true;
    }

    function setVisibleFormats(nextVisibility) {
      exportPdf.hidden = !nextVisibility.showExportPdf;
      exportMht.hidden = !nextVisibility.showExportMht;
      exportHtml.hidden = !nextVisibility.showExportHtml;
      exportTxt.hidden = !nextVisibility.showExportTxt;

      if (!hasVisibleFormats()) {
        closeMenu();
      }
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
      });

      if (!enabled) {
        closeMenu();
      }
    }

    function setLoading(loading) {
      isLoading = Boolean(loading);
      mainButton.classList.toggle("is-loading", isLoading);
      mainButton.innerHTML = isLoading
        ? spinnerIconMarkup()
        : "<span class=\"ceai-inline-btn-label\">Export To...</span>";
      mainButton.disabled = isLoading;
      formatButtons.forEach((button) => {
        button.disabled = isLoading || button.hidden;
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
      setVisibleFormats,
      hasVisibleFormats,
      setVisible,
      setEnabled,
      setLoading,
      closeMenu,
      destroy
    };
  }

  root.contentUi = {
    createHeaderExportUi
  };
})();
