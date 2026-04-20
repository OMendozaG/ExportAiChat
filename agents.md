# agents.md

## Project Goal
Build a browser extension that exports chats from web LLM interfaces to:
- `txt`
- `html`
- `mht`
- `pdf`

The TXT export must behave like a chat log:
- `<Human> text...`
- `<AIName> text...`

Do not wrap provider names in parentheses for normal assistant messages.

## Core Implementation Rules
1. Add clear comments throughout the codebase, especially in provider adapters, post-processing, export logic, storage, and UI wiring.
2. Keep the architecture modular by provider. Each LLM integration must have:
   - its own URL matcher,
   - its own chat-page detector,
   - its own DOM extractor,
   - its own anchor resolver for inline UI when needed.
3. Keep provider-specific extraction separate from global post-processing and export formatting.
4. When given HTML from a provider, prefer the simplest stable selectors that let you:
   - identify human messages,
   - identify AI messages,
   - extract useful text or safe rich text,
   - avoid leaking random page HTML into exports.
5. If an element is unknown, try to rescue meaningful text instead of dropping content, but do not include noisy raw HTML.
6. Shared formatting and cleanup rules must be global so every provider can reuse them.
7. The extension UI must stay in English.

## Settings Requirements
Persist settings in extension storage and auto-save on change.

Settings must support relevant shared behavior, including:
- visible human name,
- AI visible name by provider name or custom name,
- text formatting mode,
- quote and divider handling,
- media and non-text handling,
- visible metadata fields,
- optional visible thinking/reasoning export,
- optional message time export,
- multiline continuation style,
- editable TXT message separator,
- visible export format buttons,
- provider-specific in-page export button toggles,
- auto naming and editable file name template,
- save mode: auto-save or ask for location.

Document naming keywords in settings. Supported keywords should include:
- `<ChatTitle>` as the browser window/tab title for the current conversation,
- `<WindowTitle>` as an explicit alias of `<ChatTitle>`,
- `<ChatName>`
- `<ChatFolder>`
- `<Model>`
- `<Provider>`
- `<Date>`
- `<Time>`

`<ChatName>` should stay bound to the provider-visible conversation name.

Default file naming should use `<ChatTitle>`.

## Metadata Rules
Metadata must be configurable per field and reusable across TXT, HTML, MHT, and PDF exports.

Supported metadata fields include:
- date / time,
- PC / user,
- chat folder,
- window title,
- chat model,
- chat URL.

`Chat Folder`, `ChatName`, and `Window Title` must be treated as different fields.

## Inline UI Rules
Do not inject random floating controls into the page layout.

For ChatGPT:
- if inline integration is enabled, the entry point should live in the header area near the share action,
- the trigger should be a stable inline `Export To...` button that fits the host page header style,
- its export menu should render as an absolute or fixed overlay so it is not clipped by the host page layout.

When a new provider is added:
- add a dedicated integration checkbox for that provider in Settings, defaulting to `true`,
- decide where the in-page export button belongs in that provider UI,
- implement that anchor location in the provider adapter.

## Provider Onboarding Flow
When adding a new provider:
1. Ask the user for the exact URL or domain pattern where the extension should activate.
2. Ask the user for an HTML extract from a real chat page.
3. Use the simplest reliable DOM hooks from that HTML.
4. Implement a new adapter under `src/providers/`.
5. Return normalized raw conversation data to the shared post-processing layer.
6. Do not make exporters depend on provider-specific DOM details.
7. Add the provider to the integration settings so its in-page button can be enabled or disabled independently.

When DeepSeek, Grok, Claude, Gemini, or other providers are added later, request their URL limits explicitly before wiring the manifest and provider matcher.

## Delivery Workflow
Every new feature or bug fix should end with its own commit once the change is in a stable state.
After every functional change or bug fix, update `README.md` so the public documentation stays aligned with the current behavior before finishing the task.

Before finishing work, use this order:
1. sync,
2. commit,
3. push.

If the git tree contains unexpected unrelated changes, stop and ask before pushing.

When working from a WSL/bash-style path and Git authentication or push behavior fails there, also try the same git flow from `cmd.exe` using the Windows repo path. If `cmd.exe` can push successfully while bash/WSL cannot, prefer the `cmd.exe` route for the final push.

## Current Baseline
- ChatGPT is the current implemented provider.
- The extension is designed so more LLM providers can be added without rewriting exporters or settings.
