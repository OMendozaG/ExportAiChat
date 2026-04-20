# Privacy Policy

Last updated: 2026-04-20

## Overview

Chat Export AI is a browser extension that exports supported AI chat pages into local files such as TXT, HTML, MHT, and PDF.

The extension is designed to work locally in the user's browser.

## Data Processing

Chat Export AI processes chat content locally in the browser in order to generate export files.

The extension does not require a user account.

The extension does not provide a cloud backend for storing exported chat content.

## Data Collected

Chat Export AI does not intentionally collect personal data on a remote server.

The extension stores local configuration values in browser extension storage, such as:
- naming preferences,
- formatting preferences,
- metadata preferences,
- visibility preferences for export buttons,
- export behavior preferences.

These settings are stored locally so the extension can remember the user's choices.

## Chat Content

When the user exports a conversation, the extension reads the visible chat page content from supported sites in order to generate local export files.

The generated files are saved locally through the browser download flow.

Chat content is not intentionally transmitted to an external server by the extension.

## Permissions

Chat Export AI currently uses these permissions:

- `storage`: save settings locally
- `downloads`: save exported files
- `activeTab`: access the current supported tab
- `tabs`: query the active tab and create a temporary tab for PDF rendering
- `pageCapture`: generate MHT exports when needed
- `debugger`: render PDF output from generated HTML
- `https://chatgpt.com/*`: activate only on supported ChatGPT pages

## Analytics and Tracking

Chat Export AI does not include analytics, advertising SDKs, or behavioral tracking.

## Third-Party Sharing

Chat Export AI does not intentionally sell, rent, or share exported chat content with third parties.

## Security

Because the extension processes supported chat content locally and stores settings locally, the main stored data is limited to browser-side extension settings and user-triggered downloaded files.

Users remain responsible for handling exported files appropriately on their own devices.

## User Controls

Users can:
- change extension settings,
- disable the inline page button,
- choose visible export formats,
- choose naming behavior,
- choose what metadata is included,
- remove the extension at any time.

## Supported Providers

Current provider support:
- ChatGPT (`https://chatgpt.com/*`)

If additional providers are added later, this policy should be updated if the permission surface or data handling changes.

## Contact

Before publishing publicly, replace this section with a real support contact or repository support URL.
