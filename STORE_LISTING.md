# Chrome Web Store Listing

This file contains ready-to-adapt copy and a practical checklist for publishing Chat Export AI publicly.

## Store Name

Chat Export AI

## Short Description

Export ChatGPT chats to TXT, HTML, MHT, and PDF with configurable names, metadata, formatting, and local-first processing.

## Alternative Short Descriptions

- Export ChatGPT chats to TXT, HTML, MHT, and PDF with flexible formatting and metadata.
- Save ChatGPT conversations as TXT, HTML, MHT, or PDF with local processing and configurable export settings.
- Export the current ChatGPT chat into clean local files with metadata, naming templates, and multiple formats.

## Detailed Description

Chat Export AI lets you export the current ChatGPT conversation into clean local files.

Supported export formats:
- TXT for chat logs and searchable archives
- HTML for readable browser-based exports
- MHT for single-file web archive copies
- PDF for sharing and printing

Main capabilities:
- Clean chat-log TXT export using visible speaker names
- Configurable metadata such as date/time, chat title, model, and URL
- Configurable formatting for markdown, quotes, separators, and multiline messages
- Optional export of visible reasoning or thinking blocks when the page exposes them
- Optional export of message timestamps when the page exposes them
- Configurable file naming templates
- Local-first processing with no remote server needed
- Optional inline `EXPORT...` action in the ChatGPT header

Current provider support:
- ChatGPT (`https://chatgpt.com/*`)

Planned future providers:
- DeepSeek
- Grok
- Claude
- Gemini

## One-Line Promo Text

Export the current ChatGPT conversation into clean local files, with control over formatting, metadata, and file naming.

## Suggested Category

Productivity

## Suggested Tags / Keywords

- chat export
- chatgpt export
- ai chat export
- chat archive
- export to pdf
- export to txt
- export to html
- prompt logs
- conversation export

## Permission Justification

### storage
Used to save export settings locally in the browser.

### downloads
Used to save exported files to the user's device.

### activeTab
Used to interact with the current supported chat tab.

### tabs
Used to read the active tab state and create a temporary hidden tab for PDF rendering.

### pageCapture
Used to generate MHT exports when needed.

### debugger
Used only for reliable PDF generation from the extension's generated HTML export.

### Host permission: https://chatgpt.com/*
Used to activate the extension only on ChatGPT pages.

## Privacy Summary For Listing

- The extension processes exports locally in the browser.
- The extension stores settings locally.
- The extension does not require an account.
- The extension does not upload chat content to external servers.
- The extension does not include analytics or tracking.

## Store Assets Checklist

Prepare these before submission:
- Extension icon
- Small promotional tile if needed
- At least one screenshot
- Optional larger screenshots that show popup, settings, and exported output
- Public privacy policy URL
- Public support URL or repository URL

## Recommended Screenshots

1. Popup with `.PDF`, `.MHT`, `.HTML`, `.TXT`
2. Settings page with tabs and export options
3. Inline `EXPORT...` action in ChatGPT header
4. Example exported TXT file
5. Example exported HTML or PDF output

## Recommended Public URLs

- Homepage URL: GitHub repository URL
- Support URL: GitHub repository issues page
- Privacy policy URL: published version of `PRIVACY.md`

## Before Submission

1. Verify the extension name is final
2. Verify the icon is final
3. Verify the privacy policy is published on a public URL
4. Verify the store description matches the real permission usage
5. Verify the extension only runs on the intended host permissions
6. Verify screenshots match the current UI
7. Verify there are no placeholder contact fields left in public docs
