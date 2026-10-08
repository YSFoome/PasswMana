# PasswMana

PasswMana is a zero-build, offline-first password vault for GitHub Pages. It stores the encrypted vault in IndexedDB and syncs the ciphertext in the background to a separate private GitHub repository after the first connection.

## Run locally

Serve this directory over HTTP so the service worker can install:

```powershell
npx serve .
```

Open the reported URL. Creating a vault generates a recovery key once; save it offline before continuing.

Legacy plaintext JSON backups from the React version can be merged from Settings > Sync and Backup > Migrate Legacy Backup. Migration happens locally and immediately re-encrypts valid entries; securely delete the old plaintext file after verification.

## Deploy to GitHub Pages

Push the repository contents to the `main` branch of `YSFoome/PasswMana` and select GitHub Actions as the Pages source. `.github/workflows/pages.yml` publishes the static files after each push. The application uses relative asset URLs, so it works at the `/PasswMana/` project path without a build step.

## Security Model

- The master password and recovery key wrap a random AES-GCM vault key; neither secret is saved.
- Vault entries and GitHub Fine-grained PAT configuration are encrypted together before writing to IndexedDB or the private repository.
- The public Pages repository must never contain a vault backup, PAT, master password, or recovery key.
- Sync credentials remain local to the device when pulling another revision. The local merge baseline is also encrypted; local sync metadata is excluded from uploads.
- Each upload uses the exact remote SHA read and merged. Concurrent changes cause a fresh fetch and merge, rather than overwriting the latest remote version.

## GitHub sync

Configure the owner, private repository, existing branch, file path, and a Fine-grained PAT with Contents read/write permission in Settings > Sync and Backup. Then open Sync Details once:

- **Import from remote** replaces the local entries. Back up existing local entries first. A different vault requires its master password once; subsequent syncs keep the vault unlocked.
- **Initialize remote** creates the file only if it does not exist. It refuses to overwrite an existing vault.

After that, background sync runs on unlock, about two seconds after saving, when connectivity or the visible page returns, and every minute while the page is visible. It uses one sync job at a time. You can turn background sync off in settings and use **Sync now** instead.

Unrelated entry changes are merged using the encrypted last-synced baseline. Trash moves, restores, permanent deletions, categories, and preferences participate in the merge. Conflicting changes to the same entry or preference stop the upload and preserve the local version. Export a backup of the local changes before using **Use remote version**, which explicitly replaces the local entries. There is no automatic last-write-wins overwrite. Older records without a merge baseline also stop if both sides have changed; a successful sync establishes the baseline.

Offline edits stay encrypted in IndexedDB. Transient failures retry up to three times, then back off for later background retries; GitHub rate-limit headers are respected. Authentication, configuration, format, and merge errors remain visible in the sync status until addressed or manually retried. Changing the repository, branch, or path and restoring a backup require a fresh first connection.

Background sync preserves open forms and their focus. Saving an entry that changed remotely while it was being edited requires reopening it. Locked vaults and closed pages cannot access the encrypted PAT or sync; pending edits resume on the next unlock. Keep the page unlocked until the status says synced if you need an immediate upload.

Browsers supporting Web Locks allow only one unlocked tab per origin, preventing two pages from overwriting the shared local vault. Lock the first tab before unlocking another. Use one unlocked tab on browsers without Web Locks.

## Verification

The sync regression tests use synthetic vaults and a mocked GitHub API; no real account or credentials are required:

```powershell
node --test tests/sync.test.cjs
```

`node tests/browser-check.cjs` runs the desktop/mobile browser checks with Playwright and Microsoft Edge. Set `PLAYWRIGHT_MODULE_PATH` or `BROWSER_EXECUTABLE` to use another installed runtime/browser. It serves the app over localhost, mocks every GitHub request, and writes screenshots and synthetic backup files to the system temporary directory.
