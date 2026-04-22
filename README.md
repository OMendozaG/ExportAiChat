# Chat Export AI

Chat Export AI is a browser extension that exports AI chat conversations into clean local files.

Current supported providers:
- ChatGPT (`https://chatgpt.com/*`)
- Claude (`https://claude.ai/*`)
- Gemini (`https://gemini.google.com/*`)
- DeepSeek (`https://chat.deepseek.com/*`)
- Grok (`https://grok.com/*`)

## What It Does

The extension detects when you are inside a supported chat page and lets you export the current conversation as:
- `.TXT`
- `.HTML`
- `.MHT`
- `.PDF`

The TXT export is designed as a readable chat log:
- `<Human> message...`
- `<ChatGPT> message...`

## Install In Chrome (ZIP)

1. Download this repository as a `.zip` from GitHub.
2. Extract it to a local folder.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted project folder.

## Main Features

- Modular provider architecture for adding more LLM websites later
- Export formats for text, web archive, printable HTML, and PDF
- Persistent settings stored locally in the browser
- Configurable visible names for the human and the AI
- Configurable text handling for markdown, quotes, separators, and multiline output
- Dedicated TXT export settings, including per-role message header templates
- Optional metadata export
- Optional export title header (Chat Name) above metadata/messages
- Optional reasoning text export when the provider exposes visible thinking/reasoning content
- Optional thinking time export when the provider exposes it (default off)
- Optional message date and time export when the provider exposes it in the page
- Optional message ids starting at 1 across TXT, HTML, and PDF exports
- Optional metadata for provider/chat summary and conversation start, end, and duration when message dates are available
- Optional user attachment file names and assistant attachment/URL references in exports
- ChatGPT user file tiles and assistant inline file/reference chips are extracted explicitly instead of relying only on sanitized rich text
- ChatGPT attachment tile detection, including attachment-only user turns
- Broader ChatGPT thinking/reasoning block detection, including localized labels and timing extraction
- ChatGPT thought blocks are now detected structurally from assistant turn DOM (pre-message block in `agent-turn`) and stripped from assistant body text before sanitize
- ChatGPT extraction now supports modern `conversation-turn` sections, including assistant image-only turns
- ChatGPT export now keeps forcing scroll to top until `scrollTop` reaches zero, then waits for a short adaptive no-growth settle window before finishing hydration
- When ChatGPT top-settle coverage looks incomplete, extraction now runs repeated intermediate coverage sweeps (including denser follow-up passes) until counts stabilize
- ChatGPT now preserves user turns even when they are attachment-only (and attachment names are hidden) or rendered in alternate user DOM wrappers, reducing dropped Human entries
- Virtualized hydration now uses the same strict top+settle verification across ChatGPT, Claude, Gemini, Grok, and DeepSeek: repeated animated scroll-to-top plus short no-growth settle waits (no incremental sweep)
- If a provider cannot reach top before hydration timeout, export is canceled and an explicit user-facing alert is shown
- ChatGPT turn deduplication now uses stable turn ids (not message ids), preventing dropped/imbalanced turns on edited or regenerated branches
- ChatGPT turn merge/dedup now keys by `turnId + role` when stable ids exist, and falls back to role-aware content fingerprints when ids are synthetic or missing
- Virtualized turn hydration now restores the original chat scroll position after export collection (ChatGPT, Claude, Gemini, Grok, and DeepSeek)
- Thinking labels now export inline under the AI message header as `(<label>)` using provider wording (for example, `(Pensó por 18s)`), and no longer create standalone messages
- When a provider exposes both a thinking label and thinking body, exports now format it inline as `(<label>: <thinking text>)`
- Reasoning text and thinking-time exports are now independent toggles, so each can be exported alone or together
- Thought notes no longer emit generic placeholders when reasoning/time data is missing for a message
- Thinking-label normalization in post-processing no longer depends on provider-global helpers, avoiding runtime export failures in TXT/HTML/PDF/MHT
- TXT thinking notes now always end with a line break and keep a blank line before the message body/attachments
- TXT thinking notes are normalized as `(...)` without role prefix
- TXT first-line indentation now follows the TXT indentation style with a dedicated toggle (`Apply indentation style to the first content line`, default on)
- TXT exports no longer print the chat title line at the top
- TXT adds a `[Content]` header after `[Metadata]` when metadata is present
- DeepSeek thinking-only blocks no longer duplicate into separate assistant reply messages
- MHT and PDF exports now inline chat images as data URLs when possible, so generated-image replies are preserved more reliably
- ChatGPT extraction now prefers section-level turns over nested legacy placeholders so image-only assistant replies are not dropped
- ChatGPT button-based assistant references are now limited to file/url-like labels so generic UI action text is not exported across locales
- ChatGPT now strips inline citation/web pills from assistant body HTML when `Show assistant web links` is disabled, including labels like `arXiv+1`
- MHT export now forces rich media extraction for the current export and companion MHT generation, improving generated-image preservation
- Claude extraction for user/assistant turns, title, model, and share-anchor integration
- Gemini extraction for user/assistant turns, title, mode/model label, share-anchor integration, and uploaded-file labels
- DeepSeek extraction for user/assistant turns plus visible thinking duration labels from current DOM logs
- DeepSeek export now strips decorative inline SVG icons from message sanitization to avoid repeated `[SVG: non-textual content]` noise
- DeepSeek now strips inline web anchors/citation links from assistant and thinking HTML when `Show assistant web links` is disabled (default `false`)
- DeepSeek now includes a relaxed fallback extraction pass when strict role heuristics return zero messages, preventing empty exports on recent DOM variants
- DeepSeek inline header integration now places `Export To...` before Share, with non-wrapping row detection and icon-anchor styling fallback so it stays in the same header action row
- DeepSeek inline button styling includes a compact, borderless mode with provider-specific spacing to avoid overlap with header share controls
- ChatGPT inline button styling now keeps a transparent, borderless appearance to blend with the native header actions
- Gemini inline button styling now applies a 30% smaller label size for better header fit
- Grok extraction for user/assistant turns, visible thinking duration labels, and user file chip labels
- Configurable AI/Human border colors for HTML, PDF, and MHT exports
- Exported rich media now stays inside message containers with proportional scaling (no overflow/deformation) in HTML, MHT, and PDF
- Configurable file naming templates
- Persistent filename counters (`TotalCount`, `DayCount`, `ChatNameCount`) with configurable values and mapping view
- Editable `ChatNameCount` associations with inline id, provider, and chat-name editing, plus single delete and clear-all reset
- Auto-save overwrite vs add-count conflict policy
- Optional inline `EXPORT...` action per provider in supported headers
- Provider and resolved file name preview in the popup summary card
- Popup format buttons stay centered as a group when some formats are hidden
- Shared raised button component across popup, settings, and inline export menu
- Unified download icon sizing across popup and inline export menus
- Download format icons sized consistently at 20px
- Button-level export feedback with loading and success states
- Shared export buttons keep spinner and success check centered and visible in both the popup and the inline page menu
- Inline header integration now swaps the `Export To...` label for a centered in-button spinner during export across all providers
- Inline `Export To...` keeps a fixed button width while loading so the spinner stays centered and the button width does not jump
- Per-format success state stays visible after export and resets to download when the conversation gets new messages
- Refined line-art robot export icon with transparent background assets
- Unicode-friendly file naming and an empty default TXT separator
- Higher-contrast export button labels for better readability
- Defensive settings fallback when a shared script runs without extension storage APIs
- Guarded runtime/storage listeners and caught inline refresh failures to avoid uncaught extension-context errors
- PDF rendering now injects HTML directly into the debug target instead of navigating to a `data:` URL, to reduce renderer failures
- PDF download now uses direct base64 data URLs from the background worker to avoid blob URL lifecycle failures
- Reset defaults now asks for confirmation before overwriting the current settings
- Shared Chrome API helpers no longer throw path-based missing-API errors
- Current builds load a dedicated `extension-bridge.js` wrapper for Chrome APIs, while the legacy helper path is kept as a harmless shim for stale tabs
- Both the active bridge and the legacy helper path now resolve safe fallbacks instead of surfacing uncaught missing-API errors
- Local-first export flow with no server-side processing

## Export Options

### TXT
Best for logs, archives, search, and plain-text workflows.

### HTML
Best for preserving readable structure and formatting in a browser.

### MHT
Best for keeping a single-file web archive copy.

### PDF
Best for sharing, printing, and long-form archiving.

## Settings

The settings page supports:
- Human display name
- AI display name by provider name or custom name
- Markdown or clean text formatting
- Quote and divider style
- Dedicated TXT section with message indentation style (default `Indent with tab`)
- TXT option to apply indentation style to the first content line (default on)
- Editable TXT message separator
- Editable TXT per-role message header templates for Human and AI messages
- TXT template placeholders: `<HumanName>`, `<AiName>`
- TXT header placeholders resolve Human/AI names from the General tab settings
- Default TXT headers use `<<HumanName>>:` and `<<AiName>>:` with the same surrounding line breaks
- TXT first content line follows indentation style: tab, repeated speaker name, or no prefix (configurable), with optional legacy speaker-prefix behavior by disabling first-line indentation style
- Dedicated HTML/PDF/MHT appearance section with AI and Human border colors (default AI blue, Human orange)
- Visible export format toggles are configured in the General tab
- Media handling rules
- Metadata toggles
- Export title toggle (default on) that prints `Chat Name` as the first line/header
- TXT export ignores the title header toggle and starts directly with metadata or content
- Separate metadata toggles for provider, chat name, and message summary
- `Provider` metadata disabled by default
- `PC/User` metadata disabled by default
- `Window Title` metadata disabled by default
- `Chat Folder` metadata and `Chat Name` metadata are independent toggles (`Chat Folder` default off, `Chat Name` default on)
- Metadata `Date` includes date and time in system locale format with full year
- Conversation timeline labels follow the browser/system locale short date format
- Global metadata toggle to remove the entire metadata section from all export formats
- Metadata field toggles are visually grouped/indented under the global metadata toggle in Settings
- Popup provider/chat/message summary with total messages and H/AI counts
- Message time export toggle
- Message id export toggle
- Conversation start, end, and duration metadata toggles when message dates exist
- Separate reasoning text toggle (default on)
- Separate thinking time toggle (default off)
- User attachment and assistant reference toggles split into:
- assistant references to user attachments (default on)
- assistant-generated file attachments (default on)
- assistant web links (default off)
- Separate Chat Name summary path from Chat Title extraction
- Visible export format toggles
- Auto naming toggle and file name template
- Dedicated `Counters` tab to configure counter values and inspect `ChatNameCount` associations
- `Counters` tab supports editing each `ChatNameCount` id directly (unique ids only) and deleting rows
- `Counters` tab also supports editing provider and chat name directly in each association row
- `Counters` tab supports clearing all `ChatNameCount` associations with confirmation
- New `ChatNameCount` ids are always assigned from the current highest id + 1
- Only manually changed settings are pinned; untouched fields keep following new version defaults after updates
- Default-valued overrides are auto-pruned from storage so reverted fields follow future default updates again
- Settings auto-save skips writes when there are no real field changes
- Download mode supports:
- direct save to Downloads
- direct save to a custom subfolder inside Downloads
- ask-for-location mode
- Custom Downloads subfolder input is compact and inline in the Download behavior section
- Auto-save overwrite or add-count conflict mode
- Inline header button toggle per provider (ChatGPT, Claude, Gemini, DeepSeek, Grok)
- Credits tab with the public GitHub repository link
- Popup settings button opens the Settings page in a new browser tab

Supported file naming keywords:
- `<WindowTitle>`
- `<ChatName>`
- `<ChatFolder>`
- `<Model>`
- `<Provider>`
- `<Date>`
- `<Time>`
- `<TotalCount>`
- `<DayCount>`
- `<ChatNameCount>`

Supported direct date and time tokens:
- `YY`
- `YYYY`
- `M`
- `MM`
- `MMM`
- `MMMM`
- `D`
- `DD`
- `H`
- `HH`
- `m`
- `mm`
- `s`
- `ss`

Default file name template:
- `<ChatNameCount*3>. <ChatName>`

`<ChatName>` is the provider-visible conversation name. `<WindowTitle>` is the browser window/tab title.

Keyword placeholders are protected before date-token replacement, so single-letter date tokens no longer corrupt `<ChatName>`, `<WindowTitle>`, or the other file-name keywords.

Numeric filename keywords support zero-left padding via `*N` (example: `<TotalCount*4>`).

## Privacy Model

Chat Export AI is designed as a local-first extension.

- Export processing happens locally in the browser
- Settings are stored with browser extension storage
- The extension does not need a cloud account
- The extension does not send chat content to an external server
- The extension does not include analytics or tracking

See [PRIVACY.md](./PRIVACY.md) for the public privacy policy text.

## Permissions

The current extension uses these permissions:
- `storage`: save persistent settings
- `downloads`: save exported files
- `activeTab`: interact with the current supported tab
- `tabs`: query the active tab and create a temporary tab for PDF rendering
- `pageCapture`: capture MHT when needed
- `debugger`: render reliable PDFs from generated HTML
- `https://chatgpt.com/*`
- `https://claude.ai/*`
- `https://gemini.google.com/*`
- `https://chat.deepseek.com/*`
- `https://grok.com/*`

## Install For Development

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select this project folder
5. Open a supported conversation page:
   - `https://chatgpt.com/`
   - `https://claude.ai/`
   - `https://gemini.google.com/app`
   - `https://chat.deepseek.com/`
   - `https://grok.com/`
6. Use the extension popup or the inline `EXPORT...` action if enabled

## Project Structure

- `manifest.json`: Chrome extension manifest
- `src/providers/`: provider-specific adapters
- `src/shared/`: shared export, processing, storage, and utility modules
- `src/content/`: content script controller and inline UI
- `src/popup/`: popup UI
- `src/options/`: settings UI
- `src/assets/`: extension icons and static assets

## Adding New Providers

New providers are added by implementing a provider adapter under `src/providers/`.

The intended workflow is:
1. Get the exact provider URL pattern
2. Get a real HTML extract from the provider chat page
3. Find the simplest stable selectors for human and AI messages
4. Normalize extracted messages into the shared pipeline
5. Reuse the same post-processing and export modules

## Provider Notes (Known Gaps)

- ChatGPT: full adapter implemented with dedicated title/folder/model, attachments, references, and thinking extraction.
- Claude: message/title/model/share selectors are integrated; chat-folder extraction is not identified from current logs.
- Gemini: message/title/model/share selectors and uploaded-file labels are integrated; stable per-message timestamps were not identified from current logs.
- DeepSeek: message + visible thinking extraction are integrated; share-anchor and model selectors are heuristic because current logs depend on hash-like CSS classes.
- Grok: message + visible thinking + file chip extraction are integrated; stable model selector extraction was not confirmed from current logs.

## Status

Current status:
- Base architecture implemented
- ChatGPT, Claude, Gemini, DeepSeek, and Grok support implemented
- Export pipeline implemented
- Settings UI implemented
- Public docs and store copy prepared
