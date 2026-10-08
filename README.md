# PasswMana

PasswMana is a zero-build, offline-first password vault for GitHub Pages. It stores the encrypted vault in IndexedDB and syncs the ciphertext in the background to a separate private GitHub repository after the first connection.

## Run locally

Serve this directory over HTTP so the service worker can install:

```powershell
npx serve .
```

Open the reported URL. Creating a vault generates a recovery key once; save it offline and verify its last four characters before continuing. The confirmation screen stays visible until you finish; closing or refreshing it loses the one-time display.

The app still requires no bundler or server. Cryptography and storage are in `vault-core.js`, pure sync merging is in `sync-core.js`, and interaction helpers are in `ui-helpers.js`. The pinned Lucide script and license are served locally from `vendor/`.

Legacy plaintext JSON backups from the React version can be merged from Settings > Sync and Backup > Migrate Legacy Backup. Migration happens locally and immediately re-encrypts valid entries; securely delete the old plaintext file after verification.

## Deploy to GitHub Pages

Push the repository contents to the `main` branch of `YSFoome/PasswMana` and select GitHub Actions as the Pages source. `.github/workflows/pages.yml` runs the unit, desktop/mobile, and actual service worker regressions before deploying. Pull requests run verification without deploying. Only application assets are published, through `scripts/prepare-pages.cjs`; tests and local backup files are excluded. Relative asset URLs support the `/PasswMana/` project path without bundling.

After changing application assets, refresh the offline shell hashes:

```powershell
node scripts/generate-sw.cjs
node scripts/generate-sw.cjs --check
```

The script runs automatically in CI. Service worker caches are isolated per deployment path. Updates wait for **Save draft and update**; choosing it saves an encrypted entry draft, locks the vault, activates the new worker, and reloads. Online shell requests also refresh successful offline fallbacks; failed responses and GitHub requests are never cached. Keep the hash generation step when manually deploying, especially when adding assets.

The HTML uses a Content Security Policy restricting scripts and styles to local assets and connections to the same origin and the GitHub API. A hosting provider with response-header support can additionally enforce `frame-ancestors`; GitHub Pages does not let this application set that header through an HTML meta tag.

## Security Model

- The master password and recovery key wrap a random AES-GCM vault key; neither secret is saved.
- Vault entries and GitHub Fine-grained PAT configuration are encrypted before local IndexedDB storage. Remote revisions omit device sync credentials and contain encrypted vault content and key-wrapping metadata.
- The public Pages repository must never contain a vault backup, PAT, master password, or recovery key.
- Sync credentials remain local to the device when pulling another revision. The local merge baseline is also encrypted; local sync metadata is excluded from uploads.
- Each upload uses the exact remote SHA read and merged. Concurrent changes cause a fresh fetch and merge, rather than overwriting the latest remote version.
- Imported records are structurally validated and actually decrypted before replacement. A single IndexedDB transaction preserves the previous encrypted vault for **Restore previous vault**; rollback requires that previous vault's password.
- Entry IDs and imported text are escaped in HTML. Website links accept only HTTP/HTTPS URLs without embedded credentials.
- Unfinished entry forms are stored as separate encrypted drafts bound to the vault key. They stay local, never enter backups or sync uploads, and can be resumed after unlocking. Locking clears the unlocked vault and plaintext form state.

## Everyday use

The mobile header includes **Lock now**. Entry forms offer cryptographically random passwords from 12 to 64 characters (the interface presets start at 16), and details offer account/password copying and safe website links. Modal dialogs move and contain keyboard focus, support Escape, and return focus when closed; edited entry forms ask before discarding changes. Validation stays beside the form, and an idle warning appears before automatic locking.

Copying again restarts the 30-second cleanup timer. Cleanup only clears the clipboard if read permission is already granted and the value still matches the copied text. It never requests read permission on the timer; if the browser cannot safely check the value, it leaves the clipboard unchanged.

## GitHub sync

The connection wizard accepts the private GitHub repository URL, then a Fine-grained PAT with Contents read/write permission. Branch and encrypted file path are under Advanced settings. **Test connection** checks repository privacy, branch access, and write access when GitHub reports it; it never performs a write probe. Saving opens the first-connection step:

- **Import from remote** replaces the local entries. Back up existing local entries first. A different vault requires its master password once; subsequent syncs keep the vault unlocked.
- **Initialize remote** creates the file only if it does not exist. It refuses to overwrite an existing vault.

After that, background sync runs on unlock, about two seconds after saving, when connectivity or the visible page returns, and every minute while the page is visible. It uses one sync job at a time. You can turn background sync off in settings and use **Sync now** instead.

Unrelated entry changes, including changes to different fields of one entry, are merged using the encrypted last-synced baseline. Trash moves, restores, permanent deletions, categories, and preferences participate. Conflicting changes to the same field stop the upload and preserve local data. **Review conflicts** shows both versions and lets you choose each field; passwords stay hidden until requested. Applying choices reads the remote SHA again and refuses stale choices. Export a backup before choosing a version or using **Use remote version**, which replaces local entries. There is no automatic last-write-wins overwrite.

Devices sharing a vault also share its master-password and recovery-key wrapping version. Password wrappers have a separate local merge baseline: a remote password change is adopted, ordinary entry uploads cannot revert it, and simultaneous password changes require an explicit complete version choice. Older records missing that wrapping baseline stop if versions differ rather than guessing. After choosing the remote version, use that device's password on your next unlock. Restoring with a recovery key obtains the same cross-tab lock and rereads the latest database record before saving.

Offline edits stay encrypted in IndexedDB. Transient failures retry up to three times, then back off for later background retries; GitHub rate-limit headers are respected. Authentication, configuration, format, and merge errors remain visible in the sync status until addressed or manually retried. Changing the repository, branch, or path and restoring a backup require a fresh first connection.

Background sync preserves open forms and their focus. Saving an entry that changed remotely while it was being edited requires reopening it. Locked vaults and closed pages cannot access the encrypted PAT or sync; pending edits resume on the next unlock. Keep the page unlocked until the status says synced if you need an immediate upload.

Browsers supporting Web Locks allow only one unlocked tab per origin, preventing two pages from overwriting the shared local vault. Lock the first tab before unlocking another. Use one unlocked tab on browsers without Web Locks.

## Verification

The sync regression tests use synthetic vaults and a mocked GitHub API; no real account or credentials are required:

```powershell
node --test tests/*.test.cjs
node tests/browser-check.cjs
node tests/pwa-browser-check.cjs
```

The interaction suite covers desktop/mobile setup, recovery, password changes, keyboard focus, encrypted drafts, safe imports, backups, generated passwords, and mocked sync. The PWA suite allows actual service workers and covers offline unlock/refresh, cache isolation, failed responses, waiting updates, draft-preserving reload, and local icons. Set `PLAYWRIGHT_MODULE_PATH`, `BROWSER_CHANNEL`, or `BROWSER_EXECUTABLE` to use another installed runtime/browser; the default is Microsoft Edge. Tests serve localhost, intercept all GitHub requests, and save screenshots and synthetic backups in the system temporary directory (or `BROWSER_SCREENSHOT_DIR`). No real account or credentials are required.
