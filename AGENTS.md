# Repository Guidelines

## Project Structure

PasswMana is a zero-build static PWA. `index.html` loads `styles.css` and `app.js`; `manifest.webmanifest`, `sw.js`, and `icon.svg` provide install and offline behavior. The standalone `pwa-prototype.html` is a layout reference, not production code. Do not add server-side code or put encrypted vault data in this repository.

## Local Development

Use any static HTTP server from the repository root, for example:

```powershell
npx serve .
```

Open the reported URL, not `file://`, when checking service worker and install behavior. No bundling or transpilation is required. Verify a change by creating a test vault, locking/unlocking it, and refreshing the page.

## Coding Style

Use modern browser JavaScript with four-space indentation, semicolons, and descriptive camelCase names. Keep cryptographic and IndexedDB helpers near the top of `app.js`; keep DOM rendering and event handling below them. Use CSS custom properties for colors so the Appearance controls affect every view. Prefer Lucide icon names through `data-lucide` rather than emoji or bespoke SVGs.

## Testing

Test both desktop and a narrow mobile viewport. Cover first-run recovery key display, master-password unlock failure, auto-lock, entry CRUD, trash restore, encrypted backup import/export, legacy JSON migration, theme persistence, and manual sync failure states. Never use real passwords, recovery keys, or GitHub tokens in fixtures or commits.

## Commits and Pull Requests

Use concise imperative commit subjects, such as `Add encrypted backup export`. Keep each commit focused. PRs should describe user-visible changes, list verification performed, link relevant issues, and include desktop/mobile screenshots for UI changes.
