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

## Main Features

- Modular provider architecture for adding more LLM websites later
- Export formats for text, web archive, printable HTML, and PDF
- Persistent settings stored locally in the browser
- Configurable visible names for the human and the AI
- Configurable text handling for markdown, quotes, separators, and multiline output
- Optional metadata export
- Optional export title header (Chat Name) above metadata/messages
- Optional visible reasoning or thinking export when the provider exposes it in the page
- Optional message date and time export when the provider exposes it in the page
- Optional message ids starting at 1 across TXT, HTML, and PDF exports
- Optional metadata for provider/chat summary and conversation start, end, and duration when message dates are available
- Optional user attachment file names and assistant attachment/URL references in exports
- ChatGPT user file tiles and assistant inline file/reference chips are extracted explicitly instead of relying only on sanitized rich text
- ChatGPT attachment tile detection, including attachment-only user turns
- Broader ChatGPT thinking/reasoning block detection, including localized labels and timing extraction
- Claude extraction for user/assistant turns, title, model, and share-anchor integration
- Gemini extraction for user/assistant turns, title, mode/model label, share-anchor integration, and uploaded-file labels
- DeepSeek extraction for user/assistant turns plus visible thinking duration labels from current DOM logs
- DeepSeek inline header integration now places `Export To...` before Share, with non-wrapping row detection and icon-anchor styling fallback so it stays in the same header action row
- DeepSeek inline button styling includes a compact, borderless mode with provider-specific spacing to avoid overlap with header share controls
- ChatGPT inline button styling now keeps a transparent, borderless appearance to blend with the native header actions
- Grok extraction for user/assistant turns, visible thinking duration labels, and user file chip labels
- Configurable AI/Human border colors for HTML and PDF exports
- Configurable file naming templates
- Persistent filename counters (`TotalCount`, `DayCount`, `ChatNameCount`) with configurable values and mapping view
- Auto-save overwrite vs add-count conflict policy
- Optional inline `EXPORT...` action per provider in supported headers
- Provider and message summary in the popup with the resolved download file name preview
- Popup format buttons stay centered as a group when some formats are hidden
- Shared raised button component across popup, settings, and inline export menu
- Unified download icon sizing across popup and inline export menus
- Download format icons sized consistently at 20px
- Button-level export feedback with loading and success states
- Shared export buttons keep spinner and success check centered and visible in both the popup and the inline page menu
- Inline header integration now swaps the `Export To...` label for a centered in-button spinner during export across all providers
- Per-format success state stays visible after export and resets to download when the conversation gets new messages
- Refined line-art robot export icon with transparent background assets
- Unicode-friendly file naming and a blank-line default TXT separator
- Higher-contrast export button labels for better readability
- Defensive settings fallback when a shared script runs without extension storage APIs
- Guarded runtime/storage listeners and caught inline refresh failures to avoid uncaught extension-context errors
- PDF rendering now injects HTML directly into the debug target instead of navigating to a `data:` URL, to reduce renderer failures
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
- Multiline continuation style
- AI and Human border colors for HTML/PDF (default AI blue, Human orange)
- Editable TXT message separator
- Media handling rules
- Metadata toggles
- Export title toggle (default on) that prints `Chat Name` as the first line/header
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
- Thinking or reasoning export toggle
- User attachment and assistant reference toggles split into:
- assistant references to user attachments (default on)
- assistant-generated file attachments (default on)
- assistant web links (default off)
- Separate Chat Name summary path from Chat Title extraction
- Visible export format toggles
- Auto naming toggle and file name template
- Dedicated `Counters` tab to configure counter values and inspect `ChatNameCount` associations
- Only manually changed settings are pinned; untouched fields keep following new version defaults after updates
- Auto-save vs ask-for-location download mode
- Auto-save overwrite or add-count conflict mode
- Inline header button toggle per provider (ChatGPT, Claude, Gemini, DeepSeek, Grok)
- Credits tab with the public GitHub repository link

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
- `YY.MM-<ChatNameCount*3> <ChatName>`

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
