/*
 * Browser regression tests without npm dependencies. Run with Node 22+ and a
 * local Chrome/Chromium installation (CHROME_PATH can override discovery).
 * Snapshots are parsed inertly, scripts/event handlers are removed, and Chrome
 * blocks every network request. Private snapshots never enter the repository.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures");
const projectUrl = "https://chatgpt.com/g/g-p-regression-project/c/regression-chat";
const scriptPaths = [
  "src/shared/namespace.js",
  "src/shared/constants.js",
  "src/shared/default-settings.js",
  "src/shared/sanitize.js",
  "src/shared/text-converter.js",
  "src/shared/post-process.js",
  "src/shared/export-engine.js",
  "src/providers/provider-registry.js",
  "src/providers/chatgpt-provider.js"
];

async function findChrome() {
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try next installation. */ }
  }
  throw new Error("Chrome/Chromium was not found; set CHROME_PATH to its executable.");
}

async function cleanupProfile(profile) {
  // Validate the final target before recursively removing our temporary profile.
  const resolved = path.resolve(profile);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith("chat-export-ai-test-"));
  await rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

// A small CDP client keeps this repository's classic-script architecture free
// from a test-only package manager or browser automation dependency.
class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message);
      }
    });
  }

  send(method, params = {}, sessionId) {
    if (process.env.CHATGPT_TEST_DEBUG) console.error(`CDP ${method}`);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method, callback) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(callback);
    this.listeners.set(method, listeners);
  }

  close() { this.socket.close(); }
}

async function startBrowser() {
  const chrome = await findChrome();
  const profile = await mkdtemp(path.join(tmpdir(), "chat-export-ai-test-"));
  const browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let client;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = "";
      const timer = setTimeout(() => reject(new Error("Chrome debugging startup timed out.")), 15000);
      browser.once("error", (error) => { clearTimeout(timer); reject(error); });
      browser.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Chrome exited during startup (${code}).`));
      });
      browser.stderr.on("data", (data) => {
        stderr += data;
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    client = new CdpClient(socket);
    return { client, browser, profile };
  } catch (error) {
    browser.kill();
    await cleanupProfile(profile);
    throw error;
  }
}

async function evaluate(client, sessionId, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function extractFixture(client, html, url, scripts, settingsOverride = {}, setupScript = "", extractionOptions = {}) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => client.send(method, params, sessionId);
  let initialDocument = true;
  const interceptionErrors = [];

  // Fulfill only the initial navigation with an empty, locked-down document.
  // No request reaches ChatGPT, including optional snapshots' remote resources.
  client.on("Fetch.requestPaused", (event) => {
    if (event.sessionId !== sessionId) return;
    const { requestId, request, resourceType } = event.params;
    const isInitialDocument = initialDocument && request.url === url && resourceType === "Document";
    if (isInitialDocument) initialDocument = false;
    const operation = isInitialDocument
      ? send("Fetch.fulfillRequest", {
        requestId, responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/html; charset=utf-8" },
          { name: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'" }
        ],
        body: Buffer.from("<!doctype html><html><head></head><body></body></html>").toString("base64")
      })
      : send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    operation.catch((error) => interceptionErrors.push(error));
  });

  try {
    await send("Page.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await send("Page.navigate", { url });
    await evaluate(client, sessionId, `new Promise(resolve => {
      if (document.readyState === "complete") resolve(true);
      else addEventListener("load", () => resolve(true), { once: true });
    })`);
    await send("Network.enable");
    await send("Network.setBlockedURLs", { urls: ["*"] });

    // DOMParser never executes the snapshot. Remove active content before
    // importNode, because a saved page must remain test data, not executable code.
    await evaluate(client, sessionId, `(() => {
      const parsed = new DOMParser().parseFromString(${JSON.stringify(html)}, "text/html");
      parsed.querySelectorAll("script, iframe, frame, object, embed, link, base, meta").forEach(node => node.remove());
      parsed.querySelectorAll("*").forEach(node => {
        for (const attribute of Array.from(node.attributes)) {
          if (/^on/i.test(attribute.name) || /^(?:href|src|action|formaction|srcdoc)$/i.test(attribute.name)
            && /^(?:javascript|data:text\\/html):/i.test(attribute.value.trim())) {
            node.removeAttribute(attribute.name);
          }
        }
      });
      document.title = parsed.title;
      document.body.replaceWith(document.importNode(parsed.body, true));
      return true;
    })()`);
    await evaluate(client, sessionId, scripts);
    if (setupScript) await evaluate(client, sessionId, setupScript);

    const result = await evaluate(client, sessionId, `(async () => {
      const root = globalThis.ChatExportAi;
      const provider = root.providers.findProviderForUrl(location.href);
      const settings = { ...root.defaults.settings, includeThinking: false, includeThinkingDuration: false,
        metadataFolder: true, metadataTitle: true, metadataUrl: true, ...${JSON.stringify(settingsOverride)} };
      const raw = await provider.extractConversation(settings, { hydrateVirtualized: false, ...${JSON.stringify(extractionOptions)} });
      const processed = root.postProcess.processConversation(raw, settings, provider);
      const anchor = provider.findInlineActionAnchor();
      const normalizeLabel = value => value.replace(/\\s+/g, " ").trim();
      const citations = Array.from(document.querySelectorAll("a[data-testid='chatgpt-citation'][href]")).map(node => ({
        href: node.getAttribute("href"), label: normalizeLabel(node.textContent)
      }));
      const exportedBody = new DOMParser().parseFromString(raw.messages.map(message => message.safeHtml).join(""), "text/html");
      return {
        matchesUrl: provider.matchesUrl(location.href),
        rejectsOtherHost: !provider.matchesUrl("https://chatgpt.com.evil.invalid/c/test"),
        isChatPage: provider.isChatPage(), status: provider.getLiveStatus(),
        roles: raw.messages.map(message => message.role),
        ids: raw.messages.map(message => message.id),
        html: raw.messages.map(message => message.safeHtml),
        references: raw.messages.map(message => message.references || []),
        // Source preview cards can link to the same article and contain real
        // thumbnails. Match the compact citation's label as well as its URL.
        citationLinksWithMedia: Array.from(exportedBody.querySelectorAll("a[href]")).filter(node =>
          node.textContent.includes("[IMG:") && citations.some(citation =>
            citation.href === node.getAttribute("href")
            && citation.label === normalizeLabel(node.textContent.replace(/\\[IMG:[^\\]]*\\]/g, ""))
          )).length,
        text: processed.messages.map(message => message.text),
        chatName: raw.chatName, folderName: raw.folderName, title: raw.title,
        metadata: processed.metadata,
        txt: root.exporters.toChatText(processed),
        exportHtml: root.exporters.toHtmlDocument(processed, settings),
        anchorLabel: anchor?.referenceNode?.getAttribute("aria-label") || "",
        fixtureScriptExecuted: Boolean(globalThis.fixtureScriptExecuted),
        hydration: globalThis.fixtureHydration || null,
        visibleChatName: document.querySelector("[aria-current='page'] [data-thread-title]")?.textContent.trim() || "",
        visibleFolderNames: Array.from(document.querySelectorAll("[data-app-action-sidebar-project-label]")).map(node => node.getAttribute("data-app-action-sidebar-project-label")),
        snapshotUserCount: document.querySelectorAll("[data-user-message-bubble]").length,
        snapshotAssistantCount: document.querySelectorAll("[data-conversation-role='assistant']").length,
        snapshotTurnCount: document.querySelectorAll("[data-turn-key]").length
      };
    })()`);
    assert.equal(interceptionErrors.length, 0, "request interception succeeded");
    assert.equal(result.fixtureScriptExecuted, false, "snapshot scripts and event handlers stayed inert");
    return result;
  } finally {
    await client.send("Target.closeTarget", { targetId });
  }
}

function assertExportBasics(result, expectedRoles, expectedLiveCount = expectedRoles.length) {
  assert.equal(result.matchesUrl, true, "ChatGPT URL is accepted");
  assert.equal(result.rejectsOtherHost, true, "lookalike host is rejected");
  assert.equal(result.isChatPage, true, "conversation is detected");
  assert.deepEqual(result.roles, expectedRoles, "all messages retain DOM order and speaker");
  assert.equal(result.status.messageCount, expectedLiveCount, "live count counts message markers, not paired turns");
  assert.equal(new Set(result.ids).size, result.ids.length, "message IDs remain unique");
  assert.ok(result.txt.includes("<Human>"), "TXT has human headers");
  assert.ok(result.txt.includes("<ChatGPT>"), "TXT has assistant headers without parentheses");
  assert.ok(!result.txt.includes("(ChatGPT)"), "normal assistant label has no parentheses");
  for (const text of [...result.html, ...result.text]) {
    assert.ok(!/TOOLBAR_NOISE|ChatGPT said:|You said:|Today 00:23/.test(text), "page chrome is excluded");
  }
}

async function main() {
  const scripts = (await Promise.all(scriptPaths.map(file => readFile(path.join(repoRoot, file), "utf8")))).join("\n");
  const runtime = await startBrowser();
  const { client, browser, profile } = runtime;
  try {
    const currentHtml = await readFile(path.join(fixtureRoot, "chatgpt-current.html"), "utf8");
    const current = await extractFixture(client, currentHtml, projectUrl, scripts);
    assertExportBasics(current, ["human", "assistant", "human", "assistant", "human", "assistant"]);
    assert.equal(current.chatName, "Visible chat name");
    assert.equal(current.folderName, "Test folder");
    assert.equal(current.title, "Browser title");
    assert.equal(current.anchorLabel, "Share", "modern header share button anchors inline export");
    assert.ok(current.html[1].includes("<strong>one</strong>"), "assistant emphasis survives");
    assert.ok(current.html[1].includes("<li>First item</li>"), "assistant list survives");
    assert.ok(current.html[1].includes("const answer = 42;"), "assistant code survives");
    assert.deepEqual(current.metadata.filter(item => ["Chat Folder", "Window Title", "Chat URL"].includes(item.label)), [
      { label: "Chat Folder", value: "Test folder" },
      { label: "Window Title", value: "Browser title" },
      { label: "Chat URL", value: projectUrl }
    ]);
    console.log("PASS current paired turns: detection, 6 ordered messages, rich content, metadata, inline anchor, inert fixture");

    assert.ok(!current.txt.includes("example.com"), "disabled web citations do not leak into TXT");
    assert.ok(!current.txt.includes("Article headline"), "disabled web references remove source preview cards");
    const citations = await extractFixture(client, currentHtml, projectUrl, scripts, { showAssistantWebReferences: true });
    assert.ok(citations.html[1].includes('href="https://example.com/source"'), "enabled citations keep the source URL");
    assert.deepEqual(citations.references[1].find(reference => reference.url === "https://example.com/source"),
      { kind: "url", label: "example.com", url: "https://example.com/source" });
    assert.ok(citations.references[1].every(reference => reference.kind === "url"), "citations and news preview cards are web references");
    assert.ok(!citations.html[1].includes("[IMG: non-textual content]"), "decorative favicons do not create media placeholders");
    assert.ok(citations.html[1].includes("[IMG: Article illustration]"), "meaningful article thumbnails are preserved");
    console.log("PASS citation setting, URL classification, and favicon cleanup");

    const grouped = await extractFixture(client, currentHtml, projectUrl, scripts, {}, `(() => {
      const bubble = document.querySelector("[data-turn-key='turn-b'] [data-user-message-bubble]");
      bubble.insertAdjacentHTML("beforeend", '<div class="whitespace-pre-wrap">Continuation two</div>');
      const answer = document.querySelector("[data-chatgpt-search-unit-key='fallback-turn-1:2:assistant']");
      answer.insertAdjacentHTML("beforeend", '<div data-markdown-text-style="assistant-message"><p>Answer continuation.</p></div>');
    })()`);
    assertExportBasics(grouped, ["human", "assistant", "human", "human", "assistant", "human", "assistant"], 6);
    assert.ok(grouped.text[2].includes("Question two") && grouped.text[3].includes("Continuation two"));
    assert.ok(grouped.text[4].includes("Answer two.") && grouped.text[4].includes("Answer continuation."));
    console.log("PASS grouped user bubbles and multiple assistant rich-text bodies");

    const hybrid = await extractFixture(client, currentHtml, projectUrl, scripts, {}, `(() => {
      document.querySelectorAll("[data-user-message-bubble]").forEach((node, index) => {
        node.setAttribute("data-message-author-role", "user");
        node.setAttribute("data-message-id", "hybrid-user-" + index);
      });
      document.querySelectorAll("[data-markdown-text-style='assistant-message']").forEach((node, index) => {
        node.setAttribute("data-message-author-role", "assistant");
        node.setAttribute("data-message-id", "hybrid-assistant-" + index);
      });
      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-turn-key", "outer-wrapper");
      const main = document.querySelector("main");
      wrapper.append(...Array.from(main.children));
      main.append(wrapper);
    })()`);
    assertExportBasics(hybrid, ["human", "assistant", "human", "assistant", "human", "assistant"]);
    console.log("PASS hybrid legacy markers and nested turn containers do not duplicate messages");

    const hydrated = await extractFixture(client, currentHtml, projectUrl, scripts, {}, `(() => {
      const scrollRoot = document.querySelector("main");
      scrollRoot.style.cssText = "display:flex;flex-direction:column-reverse;height:1000px;width:800px;overflow:auto";
      const content = document.createElement("div");
      content.style.cssText = "height:5000px;width:1200px;flex:none";
      const turns = Array.from(scrollRoot.children);
      content.append(turns[2]);
      scrollRoot.replaceChildren(content);
      const nativeScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
      const measurements = globalThis.fixtureHydration = { writes: [], mounted: false };
      Object.defineProperty(scrollRoot, "scrollTop", {
        get() { return nativeScrollTop.get.call(this); },
        set(value) {
          measurements.writes.push(value);
          nativeScrollTop.set.call(this, value);
          if (value < -3000 && !measurements.mounted) {
            content.prepend(turns[0], turns[1]);
            measurements.mounted = true;
          }
        }
      });
      scrollRoot.scrollTo = ({ top, left }) => { scrollRoot.scrollTop = top; scrollRoot.scrollLeft = left; };
      // Keep the production hydration algorithm, accelerating only its waits.
      const nativeTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, Math.min(delay, 5), ...args);
    })()`, { hydrateVirtualized: true, maxHydrationMs: 5000 });
    assertExportBasics(hydrated, ["human", "assistant", "human", "assistant", "human", "assistant"]);
    assert.equal(hydrated.hydration.mounted, true, "reverse scrolling mounts earlier virtualized messages");
    assert.ok(hydrated.hydration.writes.some(top => top <= -4000), "hydration reaches the physical negative top");
    assert.ok(hydrated.hydration.writes.every(top => top <= 0), "reversed container never gets a positive scroll offset");
    assert.equal(hydrated.hydration.writes.at(-1), 0, "hydration finishes at the visual bottom");
    console.log("PASS reversed timeline hydration recovers earlier messages and returns to the bottom");

    const legacyHtml = await readFile(path.join(fixtureRoot, "chatgpt-legacy.html"), "utf8");
    const legacy = await extractFixture(client, legacyHtml, "https://chatgpt.com/c/legacy-chat", scripts);
    assertExportBasics(legacy, ["human", "assistant"]);
    assert.equal(legacy.chatName, "Legacy chat");
    assert.equal(legacy.title, "Legacy browser title");
    assert.ok(legacy.html[1].includes("<strong>answer</strong>"));
    console.log("PASS legacy section and author-role extraction");

    const empty = await extractFixture(client, "<html><body><main><h1>New chat</h1></main></body></html>", "https://chatgpt.com/", scripts);
    assert.equal(empty.isChatPage, false);
    assert.equal(empty.status.messageCount, 0);
    assert.deepEqual(empty.roles, []);
    console.log("PASS empty landing page is not treated as a conversation");

    if (process.env.CHATGPT_SNAPSHOT_PATH) {
      const html = await readFile(process.env.CHATGPT_SNAPSHOT_PATH, "utf8");
      const url = process.env.CHATGPT_SNAPSHOT_URL || projectUrl;
      const snapshot = await extractFixture(client, html, url, scripts);
      const expectedCount = snapshot.snapshotAssistantCount;
      assert.ok(expectedCount > 0, "snapshot contains modern assistant markers");
      assert.equal(snapshot.snapshotUserCount, expectedCount, "snapshot has complete user/assistant pairs");
      assertExportBasics(snapshot, Array.from({ length: expectedCount }, () => ["human", "assistant"]).flat());
      assert.ok(snapshot.text.every(text => text.trim()), "snapshot messages all have useful content");
      assert.ok(snapshot.visibleChatName, "snapshot exposes a visible selected title");
      assert.equal(snapshot.chatName, snapshot.visibleChatName, "selected sidebar title remains the chat name");
      assert.ok(snapshot.visibleFolderNames.includes(snapshot.folderName), "snapshot project name is read from the matching project row");
      const snapshotCitations = await extractFixture(client, html, url, scripts, { showAssistantWebReferences: true });
      assertExportBasics(snapshotCitations, snapshot.roles);
      assert.ok(snapshotCitations.references.flat().some(reference => reference.kind === "url"), "snapshot citations remain web references");
      assert.equal(snapshotCitations.citationLinksWithMedia, 0, "snapshot citation favicons stay out of exports");
      assert.ok(!snapshotCitations.html.join("").includes("[IMG: non-textual content]"), "source preview favicons stay out of exports");
      console.log(`PASS local snapshot: ${snapshot.roles.length} ordered messages; private contents omitted`);
    }
  } finally {
    await client.send("Browser.close").catch(() => {});
    client.close();
    if (browser.exitCode === null) {
      await Promise.race([
        new Promise(resolve => browser.once("exit", resolve)),
        new Promise(resolve => setTimeout(() => { browser.kill(); resolve(); }, 3000))
      ]);
    }
    await cleanupProfile(profile);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
