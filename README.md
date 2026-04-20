# Chat Export AI

Chat Export AI is a browser extension that exports AI chat conversations into clean local files.

Current supported provider:
- ChatGPT (`https://chatgpt.com/*`)

Planned next providers:
- DeepSeek
- Grok
- Claude
- Gemini

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
- Optional visible reasoning or thinking export when the provider exposes it in the page
- Optional message date and time export when the provider exposes it in the page
- Optional metadata for provider/chat summary and conversation start, end, and duration when message dates are available
- Optional user attachment file names and assistant attachment/URL references in exports
- Configurable file naming templates
- Optional inline `EXPORT...` action in the ChatGPT header
- Provider and message summary in the popup with the resolved download file name preview
- Shared raised button component across popup, settings, and inline export menu
- Refined line-art robot export icon with transparent background assets
- Unicode-friendly file naming and a blank-line default TXT separator
- Higher-contrast export button labels for better readability
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
- Editable TXT message separator
- Media handling rules
- Metadata toggles
- Popup provider/chat/message summary with total messages and H/AI counts
- Message time export toggle
- Conversation start, end, and duration metadata toggles when message dates exist
- Thinking or reasoning export toggle
- User attachment and assistant reference toggles
- Visible export format toggles
- Auto naming toggle and file name template
- Auto-save vs ask-for-location download mode
- Inline ChatGPT header button toggle

Supported file naming keywords:
- `<ChatTitle>`
- `<ChatName>`
- `<ChatFolder>`
- `<Model>`
- `<Provider>`
- `<Date>`
- `<Time>`

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
- `YY.MM.DD <ChatTitle>`

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
- `https://chatgpt.com/*`: run only on ChatGPT for now

## Install For Development

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select this project folder
5. Open a ChatGPT conversation at `https://chatgpt.com/`
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

## Status

Current status:
- Base architecture implemented
- ChatGPT support implemented
- Export pipeline implemented
- Settings UI implemented
- Public docs and store copy prepared

## Roadmap

Next likely integrations:
1. DeepSeek
2. Grok
3. Claude
4. Gemini

Those integrations should be added one by one using real page HTML and an explicit allowed URL pattern for each provider.
