# PasswMana

PasswMana is an offline-first, zero-server password vault PWA for GitHub Pages, built with **React + TypeScript + Tailwind CSS + Amicro** (`motion/react` + `lucide-react`). It stores the encrypted vault in IndexedDB and syncs ciphertext in the background to a separate private GitHub repository after the first connection.

## Run locally

```powershell
npm install
npm run dev
```

For production bundle + Service Worker verification:

```powershell
npm run build
npm run preview
```

Open the reported URL over HTTP. Creating a vault generates a recovery key once; save it offline and verify its last four characters before continuing. The confirmation screen stays visible until you finish; closing or refreshing it loses the one-time display.

Cryptography and storage live in `src/core/vault-core.ts`, pure three-way sync merging lives in `src/core/sync-core.ts`, interaction helpers live in `src/core/ui-helpers.ts`, the reactive vault store lives in `src/core/vault-store.ts`, and Amicro micro-interaction components live in `src/components/amicro/`.

Legacy plaintext JSON backups can be merged from **Settings > Sync and Backup > Migrate Legacy Backup**. Migration happens locally and immediately re-encrypts valid entries; securely delete the old plaintext file after verification. Entries whose ID is already in the trash are skipped, so re-running a migration never recreates a deleted record or duplicates an ID. The merged vault is validated before anything is written.

## Deploy to GitHub Pages

Push the repository contents to the `main` branch of `YSFoome/PasswMana` and select GitHub Actions as the Pages source. `.github/workflows/pages.yml` runs TypeScript typechecking, production build (`npm run build`), unit regressions (`npm test`), desktop/mobile Playwright checks, and real Service Worker offline checks before deploying. Pull requests run verification without deploying. Only built application assets in `dist/` are published through `scripts/prepare-pages.cjs`; tests and local backup files are excluded. Relative asset URLs (`base: './'`) support the `/PasswMana/` project path.

After changing application assets or building manually, refresh and verify the offline shell hashes:

```powershell
npm run build
npm run sw:check
```

The HTML uses a strict Content Security Policy restricting scripts and styles to local `'self'` assets and network connections to the same origin and `https://api.github.com`.

## Security Model & Features

- The master password and recovery key wrap a random AES-GCM 256-bit vault key via PBKDF2-SHA256 (600,000 iterations); neither secret is saved.
- Vault entries and GitHub Fine-grained PAT configuration are encrypted before local IndexedDB storage. Remote revisions omit device sync credentials and contain only encrypted vault content and key-wrapping metadata.
- Unfinished entry forms are stored as separate encrypted drafts bound to the vault key.
- **Remember on this device** seals the vault key with a non-extractable AES-GCM `CryptoKey` held by the browser for this origin.
- **Three-way field-level merge** with ETag (`If-None-Match` / `304 Not Modified`), >1 MB Git blob reads, CAS SHA protection, and masked conflict resolution.
- **Shortcuts**: `Ctrl+K` / `Cmd+K` quick switch, `/` search focus, `Ctrl+Shift+L` quick lock, and `#search=<term>` URL hash filtering.

## Verification

The verification suite uses synthetic vaults and a mocked GitHub API; no real account or credentials are required:

```powershell
npm run typecheck
npm run build
npm test
npm run test:browser
npm run test:pwa
```
