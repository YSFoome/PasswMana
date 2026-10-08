const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// All credentials and entries below are synthetic. GitHub is always intercepted.
const masterPassword = 'synthetic-master-password-2026';
const repositoryRoot = path.resolve(__dirname, '..');
const bundledPlaywright = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright');
let playwright;
try {
    playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
} catch {
    playwright = require(bundledPlaywright);
}

function serveRepository() {
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    const server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const filename = path.resolve(repositoryRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!filename.startsWith(`${repositoryRoot}${path.sep}`)) {
            response.writeHead(403).end();
            return;
        }
        fs.readFile(filename, (error, content) => {
            response.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            response.end(error ? '' : content);
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function visibleClick(page, selector) {
    await page.locator(`${selector}:visible`).first().click();
}

async function navigate(page, view, mobile) {
    if (mobile) {
        await page.locator('[data-action="mobile-left"]').click();
        // Mobile detail screens use the same control as Back before the drawer.
        if (!await page.locator('.drawer.open').count()) await page.locator('[data-action="mobile-left"]').click();
        await page.locator(`.drawer.open [data-action="view"][data-view-name="${view}"]`).click();
    } else {
        await page.locator(`.side-nav [data-action="view"][data-view-name="${view}"]`).click();
    }
}

async function setting(page, panel, mobile) {
    await navigate(page, 'settings', mobile);
    await page.locator(`.settings-nav [data-panel="${panel}"]`).click();
}

async function unlock(page, password = masterPassword) {
    const form = page.locator('[data-form="unlock"]');
    await form.locator('[name="password"]').fill(password);
    await form.locator('[type="submit"]').click();
    if (password === masterPassword) await page.locator('.app-shell').waitFor();
}

async function addEntry(page, title) {
    await visibleClick(page, '[data-action="open-add"]');
    const form = page.locator('[data-form="add-entry"]');
    await form.locator('[name="title"]').fill(title);
    await form.locator('[name="username"]').fill('synthetic@example.invalid');
    await form.locator('[name="password"]').fill('synthetic-entry-password');
    await form.locator('[name="url"]').fill('https://example.invalid');
    await form.locator('[type="submit"]').click();
    await form.waitFor({ state: 'hidden' });
    await page.locator('.entry').filter({ hasText: title }).waitFor();
}

async function runScenario(browser, baseUrl, outputDirectory, mobile) {
    const name = mobile ? 'mobile' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const browserErrors = [];
    const github = { payload: null, sha: null, version: 0, requests: [], failure: 0, delay: 0 };
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await context.route('**/app.js', async (route) => {
        const source = await fs.promises.readFile(path.join(repositoryRoot, 'app.js'), 'utf8');
        await route.fulfill({ contentType: 'text/javascript', body: `${source}\nglobalThis.__testApi = { state, encryptText, decryptText, remoteRecord, persistVault, synchronize, lockVault, createVault, resetLockTimer, scheduleAutoSync };` });
    });
    await context.route('https://api.github.com/**', async (route) => {
        const request = route.request();
        const method = request.method();
        const url = request.url();
        const body = request.postDataJSON();
        github.requests.push({ method, url, body });
        assert.equal(request.headers().authorization, 'Bearer synthetic-test-token');
        if (github.delay) await new Promise((resolve) => setTimeout(resolve, github.delay));
        const fulfill = (status, result) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
        if (github.failure) return fulfill(github.failure, { message: 'Synthetic authorization failure' });
        if (!url.includes('/contents/')) return fulfill(200, { private: true });
        if (method === 'GET') {
            return github.payload
                ? fulfill(200, { sha: github.sha, content: Buffer.from(JSON.stringify(github.payload)).toString('base64') })
                : fulfill(404, { message: 'Synthetic file does not exist' });
        }
        assert.equal(method, 'PUT');
        assert.equal(body.sha || null, github.sha);
        github.payload = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
        github.sha = `synthetic-sha-${++github.version}`;
        assert.equal(github.payload.dirty, undefined);
        assert.equal(github.payload.syncBase, undefined);
        assert.equal(github.payload.remoteSha, undefined);
        assert.ok(!JSON.stringify(github.payload).includes('synthetic-test-token'));
        assert.ok(!JSON.stringify(github.payload).includes('synthetic-entry-password'));
        return fulfill(200, { content: { sha: github.sha } });
    });
    try {
        await page.goto(baseUrl);
        const setup = page.locator('[data-form="setup"]');
        await setup.locator('[name="password"]').fill(masterPassword);
        await setup.locator('[name="confirmPassword"]').fill(masterPassword);
        await setup.locator('[type="submit"]').click();
        await page.getByRole('heading', { name: '保存恢复密钥' }).waitFor();
        const recoveryCode = await page.locator('.recovery-code').textContent();
        assert.match(recoveryCode, /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){4}$/);
        assert.ok(!(await page.evaluate(() => JSON.stringify(__testApi.state.record))).includes(recoveryCode));
        await page.locator('[data-action="finish-setup"]').click();

        await addEntry(page, 'Synthetic entry');
        await page.locator('.entry').filter({ hasText: 'Synthetic entry' }).click();
        await page.locator('[data-action="open-edit"]').click();
        const edit = page.locator('[data-form="edit-entry"]');
        await edit.locator('[name="title"]').fill('Synthetic updated entry');
        await edit.locator('[type="submit"]').click();
        await edit.waitFor({ state: 'hidden' });
        await page.locator('.entry').filter({ hasText: 'Synthetic updated entry' }).waitFor();
        await page.locator('.entry').click();
        await page.locator('[data-action="delete-entry"]').click();
        await page.locator('.entry').waitFor({ state: 'hidden' });
        await setting(page, 'trash', mobile);
        await page.locator('[data-action="restore-entry"]').click();
        await page.locator('[data-action="restore-entry"]').waitFor({ state: 'hidden' });
        await navigate(page, 'vault', mobile);
        await page.locator('.entry').filter({ hasText: 'Synthetic updated entry' }).waitFor();

        if (mobile) await page.evaluate(() => __testApi.lockVault());
        else await page.locator('[data-action="lock"]').click();
        await unlock(page, 'synthetic-wrong-password');
        await page.getByText('主密码错误，无法解锁保险库', { exact: true }).waitFor();
        assert.ok(await page.locator('[data-form="unlock"]').isVisible());
        await unlock(page);
        await page.reload();
        await page.locator('[data-form="unlock"]').waitFor();
        await unlock(page);
        assert.equal(await page.locator('.entry').count(), 1);

        const secondTab = await context.newPage();
        await secondTab.goto(baseUrl);
        await secondTab.locator('[data-form="unlock"] [name="password"]').fill(masterPassword);
        await secondTab.locator('[data-form="unlock"] [type="submit"]').click();
        await secondTab.getByText('保险库已在另一个标签页解锁，请先锁定该页面', { exact: true }).waitFor();
        assert.equal(await secondTab.locator('.app-shell').count(), 0);
        await page.locator('.entry').click();
        await page.locator('[data-action="open-edit"]').click();
        await page.locator('[data-form="edit-entry"] [name="notes"]').fill('Synthetic first-tab edit');
        await page.locator('[data-form="edit-entry"] [type="submit"]').click();
        await page.locator('[data-form="edit-entry"]').waitFor({ state: 'hidden' });
        await page.evaluate(() => __testApi.lockVault());
        await unlock(secondTab);
        assert.equal(await secondTab.evaluate(() => __testApi.state.vault.entries[0].notes), 'Synthetic first-tab edit');
        await secondTab.evaluate(() => __testApi.lockVault());
        await secondTab.close();
        await unlock(page);

        await setting(page, 'appearance', mobile);
        await page.locator('[data-action="set-mode"][data-mode="dark"]').click();
        await page.locator('[data-action="set-accent"][data-accent="blue"]').click();
        await page.reload();
        assert.equal(await page.locator('html').getAttribute('data-mode'), 'dark');
        assert.equal(await page.locator('html').getAttribute('data-accent'), 'blue');
        await unlock(page);

        await setting(page, 'sync', mobile);
        const downloadPromise = page.waitForEvent('download');
        await page.locator('[data-action="export-backup"]:visible').click();
        const download = await downloadPromise;
        const backup = await fs.promises.readFile(await download.path());
        const backupRecord = JSON.parse(backup.toString('utf8')).record;
        assert.equal(backupRecord.format, 'passwmana-v1');
        assert.ok(!backup.toString('utf8').includes('synthetic-entry-password'));
        const importChooser = page.waitForEvent('filechooser');
        await page.locator('[data-action="import-backup"]').click();
        await (await importChooser).setFiles({ name: 'synthetic.passwmana', mimeType: 'application/json', buffer: backup });
        await page.locator('[data-form="unlock"]').waitFor();
        await unlock(page);
        assert.equal(await page.evaluate(() => __testApi.state.record.remoteSha), null);
        assert.equal(await page.evaluate(() => __testApi.state.vault.entries.length), 1);

        await setting(page, 'sync', mobile);
        const legacyChooser = page.waitForEvent('filechooser');
        await page.locator('[data-action="import-legacy"]').click();
        await (await legacyChooser).setFiles({ name: 'synthetic-legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ entries: [{ id: 'synthetic-legacy', siteName: 'Synthetic legacy entry', account: 'test@example.invalid', password: 'synthetic-legacy-password', type: 'Synthetic category' }] })) });
        await page.waitForFunction(() => __testApi.state.vault.entries.length === 2);
        assert.ok(await page.evaluate(() => __testApi.state.vault.categories.includes('Synthetic category')));

        await page.locator('[data-action="open-sync-config"]').click();
        const config = page.locator('[data-form="sync-config"]');
        await config.locator('[name="owner"]').fill('synthetic-owner');
        await config.locator('[name="repo"]').fill('synthetic-private-vault');
        await config.locator('[name="token"]').fill('synthetic-test-token');
        await config.locator('[type="submit"]').click();
        await config.waitFor({ state: 'hidden' });
        assert.equal(github.requests.length, 0, 'First connection must wait for explicit initialization/import');
        await visibleClick(page, '[data-action="open-sync"]');
        await page.locator('[data-action="push-remote"]').click();
        await page.waitForFunction(() => __testApi.state.record.remoteSha && !__testApi.state.syncing);
        assert.ok(github.payload);
        assert.ok(await page.evaluate(() => Boolean(__testApi.state.vaultKey)));

        await navigate(page, 'vault', mobile);
        const beforeSavePuts = github.requests.filter((request) => request.method === 'PUT').length;
        await addEntry(page, 'Synthetic automatic entry');
        await page.waitForFunction(() => !__testApi.state.record.dirty && !__testApi.state.syncing);
        assert.ok(github.requests.filter((request) => request.method === 'PUT').length > beforeSavePuts);

        // Simulate another device editing a different entry using the same AES key.
        github.payload = await page.evaluate(async () => {
            const api = __testApi;
            const vault = structuredClone(api.state.vault);
            vault.entries.find((entry) => entry.id === 'synthetic-legacy').notes = 'Synthetic remote note';
            return { ...api.remoteRecord(api.state.record), encryptedVault: await api.encryptText(JSON.stringify(vault), api.state.vaultKey) };
        });
        github.sha = `synthetic-sha-${++github.version}`;
        github.delay = 100;
        await visibleClick(page, '[data-action="open-add"]');
        const draft = page.locator('[data-form="add-entry"] [name="title"]');
        await draft.fill('Draft survives background');
        await draft.focus();
        await page.evaluate(() => { globalThis.__draftNode = document.activeElement; void __testApi.synchronize({ automatic: true }); });
        await draft.press('End');
        await draft.pressSequentially(' typing');
        await page.waitForFunction(() => !__testApi.state.syncing && __testApi.state.vault.entries.find((entry) => entry.id === 'synthetic-legacy').notes === 'Synthetic remote note');
        assert.equal(await draft.inputValue(), 'Draft survives background typing');
        assert.ok(await page.evaluate(() => document.activeElement === __draftNode && __draftNode.isConnected));
        assert.equal(await page.locator('[role="alertdialog"]').count(), 0);
        await visibleClick(page, '[data-action="close-modal"]');
        github.delay = 0;

        // Remote changes to the entry currently being edited must prevent a stale save.
        const targetId = await page.evaluate(() => __testApi.state.vault.entries.find((entry) => entry.title === 'Synthetic updated entry').id);
        await page.locator(`[data-action="open-detail"][data-id="${targetId}"]`).click();
        await page.locator('[data-action="open-edit"]').click();
        const staleEdit = page.locator('[data-form="edit-entry"]');
        await staleEdit.locator('[name="title"]').fill('Synthetic stale draft');
        github.payload = await page.evaluate(async (id) => {
            const api = __testApi;
            const vault = structuredClone(api.state.vault);
            vault.entries.find((entry) => entry.id === id).notes = 'Synthetic remote edit';
            return { ...api.remoteRecord(api.state.record), encryptedVault: await api.encryptText(JSON.stringify(vault), api.state.vaultKey) };
        }, targetId);
        github.sha = `synthetic-sha-${++github.version}`;
        await page.evaluate(() => __testApi.synchronize({ automatic: true }));
        await staleEdit.locator('[type="submit"]').click();
        await page.getByText('此条目已在后台更新或删除，请关闭编辑窗口后重新打开', { exact: true }).waitFor();
        assert.ok(await staleEdit.isVisible());
        assert.equal(await page.evaluate((id) => __testApi.state.vault.entries.find((entry) => entry.id === id).title, targetId), 'Synthetic updated entry');
        await visibleClick(page, '[data-action="close-modal"]');

        const entriesBeforeFailure = await page.evaluate(() => JSON.stringify(__testApi.state.vault.entries));
        github.failure = 401;
        await visibleClick(page, '[data-action="open-sync"]');
        await page.locator('[data-action="push-remote"]').click();
        await page.locator('[role="alertdialog"]').waitFor();
        assert.match(await page.locator('[role="alertdialog"]').textContent(), /401/);
        assert.equal(await page.evaluate(() => JSON.stringify(__testApi.state.vault.entries)), entriesBeforeFailure);
        assert.ok(await page.evaluate(() => __testApi.state.syncBlocked));
        await visibleClick(page, '[data-action="close-modal"]');
        github.failure = 0;

        await setting(page, 'sync', mobile);
        await page.screenshot({ path: path.join(outputDirectory, `sync-${name}.png`), fullPage: true });
        const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(horizontalOverflow, false, `${name} page must fit its viewport`);

        // A background poll must not extend the user's idle lock deadline.
        await setting(page, 'security', mobile);
        await page.clock.install();
        await page.locator('[data-input="lock-minutes"]:visible').selectOption('1');
        await page.waitForFunction(() => __testApi.state.vault.preferences.lockMinutes === 1);
        await page.clock.fastForward(61000);
        await page.locator('[data-form="unlock"]').waitFor();
        assert.equal(await page.evaluate(() => __testApi.state.vaultKey), null);
        assert.equal(await page.evaluate(() => __testApi.state.rawVaultKey), null);
        assert.deepEqual(browserErrors, []);
        console.log(`PASS ${name}: setup/recovery, CRUD/trash, wrong-password/refresh, tab exclusivity/latest record, theme, backup/migration, initialization, automatic save, background focus/draft, stale edit, 401, idle lock`);
    } finally {
        await context.close();
    }
}

(async () => {
    const outputDirectory = process.env.BROWSER_SCREENSHOT_DIR || await fs.promises.mkdtemp(path.join(os.tmpdir(), 'passwmana-browser-'));
    await fs.promises.mkdir(outputDirectory, { recursive: true });
    const server = await serveRepository();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await playwright.chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'msedge' }) });
        await runScenario(browser, baseUrl, outputDirectory, false);
        await runScenario(browser, baseUrl, outputDirectory, true);
        console.log(`Screenshots: ${outputDirectory}`);
    } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
