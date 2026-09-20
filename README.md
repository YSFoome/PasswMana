# PasswMana

PasswMana is a zero-build, offline-first password vault for GitHub Pages. It stores the encrypted vault in IndexedDB and can manually pull or push the ciphertext to a separate private GitHub repository.

## Run locally

Serve this directory over HTTP so the service worker can install:

```powershell
npx serve .
```

Open the reported URL. Creating a vault generates a recovery key once; save it offline before continuing.

Legacy plaintext JSON backups from the React version can be merged from Settings > Sync and Backup > Migrate Legacy Backup. Migration happens locally and immediately re-encrypts valid entries; securely delete the old plaintext file after verification.

## Deploy to GitHub Pages

Push the repository contents to `YSFoome/PasswMana` and configure GitHub Pages to deploy from the branch root. The application uses relative asset URLs, so it works at the `/PasswMana/` project path without a build step.

## Security Model

- The master password and recovery key wrap a random AES-GCM vault key; neither secret is saved.
- Vault entries and GitHub Fine-grained PAT configuration are encrypted together before writing to IndexedDB or the private repository.
- The public Pages repository must never contain a vault backup, PAT, master password, or recovery key.
- Sync is deliberately manual. A changed remote version blocks push until the user pulls it; pull gives the remote encrypted version priority.
