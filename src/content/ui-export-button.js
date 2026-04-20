/*
 * Inline header export UI injected on supported chat pages.
 * The floating menu is rendered as a fixed overlay to avoid clipping inside ChatGPT layouts.
 */
(() => {
  const root = globalThis.ChatExportAi;

  const UI_ROOT_ID = "ceai-inline-export-root";
  const MENU_ID = "ceai-inline-export-menu";
  const STYLE_ID = "ceai-inline-export-style";

  function robotButtonIconMarkup() {
    return [
      "<svg viewBox=\"0 0 128 128\" role=\"img\" aria-hidden=\"true\">",
      "  <rect x=\"24\" y=\"20\" width=\"80\" height=\"56\" rx=\"19\" fill=\"currentColor\"/>",
      "  <rect x=\"31\" y=\"31\" width=\"66\" height=\"20\" rx=\"10\" fill=\"#1f2937\" fill-opacity=\"0.28\"/>",
      "  <circle cx=\"51\" cy=\"41\" r=\"5\" fill=\"#ffffff\"/>",
      "  <circle cx=\"77\" cy=\"41\" r=\"5\" fill=\"#ffffff\"/>",
      "  <path d=\"M58 55h12v27h14L64 106 44 82h14z\" fill=\"#ffffff\" stroke=\"#ffffff\" stroke-width=\"2.5\" stroke-linejoin=\"round\"/>",
      "</svg>"
    ].join("");
  }

  function spinnerIconMarkup() {
    return [
      "<svg viewBox=\"0 0 24 24\" role=\"img\" aria-hidden=\"true\">",
      "  <circle cx=\"12\" cy=\"12\" r=\"8\" fill=\"none\" stroke=\"rgba(255,255,255,0.28)\" stroke-width=\"3\"></circle>",
      "  <path d=\"M12 4a8 8 0 0 1 8 8\" fill=\"none\" stroke=\"#ffffff\" stroke-linecap=\"round\" stroke-width=\"3\"></path>",
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
  width: 42px;
  height: 42px;
  border: 0;
  background: linear-gradient(180deg, #ff4d6d 0%, #ff8a00 18%, #ffd60a 36%, #2fd46b 54%, #34c4ff 72%, #5b6cff 88%, #c45bff 100%);
  color: #ffffff;
  border-radius: 14px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.2);
  cursor: pointer;
}
#${UI_ROOT_ID} .ceai-inline-btn svg {
  width: 24px;
  height: 24px;
  display: block;
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
  position: fixed;
  top: 0;
  left: 0;
  display: none;
  gap: 6px;
  align-items: center;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid #d0d7e2;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
  backdrop-filter: blur(10px);
  white-space: nowrap;
  z-index: 2147483647;
}
#${MENU_ID}.is-open {
  display: flex;
}
#${MENU_ID} button {
  border: 0;
  border-radius: 10px;
  background: #f5f7fb;
  color: #111827;
  min-width: 64px;
  min-height: 56px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
#${MENU_ID} button:hover {
  background: #e8edf8;
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
    mainButton.innerHTML = robotButtonIconMarkup();

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

      syncMenuPosition();
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
      mainButton.innerHTML = isLoading ? spinnerIconMarkup() : robotButtonIconMarkup();
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

      syncMenuPosition();
      menuNode.classList.add("is-open");
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
