const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { generateWorker, shellPaths } = require('../scripts/generate-sw.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const bundledPlaywright = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright');
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'); }
catch { playwright = require(bundledPlaywright); }

function prepareFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'passwmana-real-sw-'));
    for (const scope of ['PasswMana', 'Other']) {
        const destinationRoot = path.join(root, scope);
        for (const filename of [...shellPaths, './sw.js']) {
            const target = path.join(destinationRoot, filename);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(repositoryRoot, filename), target);
        }
        fs.writeFileSync(path.join(destinationRoot, 'sw.js'), generateWorker(destinationRoot).source);
    }
    return root;
}

function serveFixture(root) {
    const state = { failurePath: null };
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    const server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const filename = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
        if (!filename.startsWith(`${root}${path.sep}`)) return response.writeHead(403).end();
        if (pathname === state.failurePath) return response.writeHead(404).end('synthetic unavailable resource');
        fs.readFile(filename, (error, contents) => {
            response.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            response.end(error ? '' : contents);
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state })));
}

async function waitForControl(page) {
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
            await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
        }
    });
}

async function waitForAsyncCondition(page, predicate, description) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        if (await page.evaluate(predicate)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${description}`);
}

async function createSyntheticVault(page) {
    const setup = page.locator('[data-form="setup"]');
    await setup.locator('[name="password"]').fill('synthetic-pwa-master-2026');
    await setup.locator('[name="confirmPassword"]').fill('synthetic-pwa-master-2026');
    await setup.locator('[type="submit"]').click();
    await page.locator('.recovery-code').waitFor();
    const code = (await page.locator('.recovery-code').textContent()).trim();
    const saved = page.locator('[data-input="recovery-saved"]');
    if (await saved.count()) await saved.check();
    const confirmation = page.locator('[name="recoverySuffix"]');
    if (await confirmation.count()) await confirmation.fill(code.split('-').at(-1));
    await page.locator('[data-action="finish-setup"]').click();
    await page.locator('.app-shell').waitFor();
    await page.locator('[data-action="open-add"]:visible').first().click();
    const form = page.locator('[data-form="add-entry"]');
    await form.locator('[name="title"]').fill('Synthetic offline entry');
    await form.locator('[name="username"]').fill('synthetic@example.invalid');
    await form.locator('[name="password"]').fill('synthetic-offline-entry-secret');
    await form.locator('[type="submit"]').click();
    await form.waitFor({ state: 'hidden' });
    await page.locator('.entry').filter({ hasText: 'Synthetic offline entry' }).waitFor();
    await page.locator('[data-action="lock"]:visible').first().click();
    await page.locator('[data-form="unlock"]').waitFor();
}

async function unlockSyntheticVault(page) {
    await page.locator('[data-form="unlock"] [name="password"]').fill('synthetic-pwa-master-2026');
    await page.locator('[data-form="unlock"] [type="submit"]').click();
    await page.locator('.entry').filter({ hasText: 'Synthetic offline entry' }).waitFor();
}

async function scenario(browser, mobile, screenshotDirectory) {
    const root = prepareFixture();
    const { server, state } = await serveFixture(root);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const appUrl = `${origin}/PasswMana/`;
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('dialog', (dialog) => dialog.accept());
    const errors = [];
    const violations = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.text().includes('Content Security Policy')) violations.push(message.text()); });
    await context.route('https://api.github.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"private":true}' }));
    try {
        await page.goto(appUrl);
        await page.locator('[data-form="setup"]').waitFor();
        await waitForControl(page);
        await createSyntheticVault(page);
        assert.ok(await page.locator('svg').count(), 'vendored icons render');
        const firstCache = (await page.evaluate(() => caches.keys())).find((name) => name.startsWith('passwmana-shell-%2FPasswMana%2F-'));
        assert.ok(firstCache);

        // GitHub traffic is mocked, and remains outside all offline caches.
        assert.equal(await page.evaluate(async () => (await fetch('https://api.github.com/repos/synthetic/private')).status), 200);
        assert.equal(await page.evaluate(async () => {
            for (const name of await caches.keys()) {
                if ((await (await caches.open(name)).keys()).some((request) => request.url.startsWith('https://api.github.com/'))) return true;
            }
            return false;
        }), false);

        await context.setOffline(true);
        await page.reload();
        await page.locator('[data-form="unlock"]').waitFor();
        assert.ok(await page.locator('svg').count(), 'icons work offline');
        await unlockSyntheticVault(page);
        assert.equal(await page.locator('.entry').count(), 1);
        await page.screenshot({ path: path.join(screenshotDirectory, `offline-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.locator('[data-action="lock"]:visible').first().click();
        await context.setOffline(false);

        // A 404 must not poison the resource saved by installation.
        state.failurePath = '/PasswMana/icon.svg';
        assert.equal(await page.evaluate(async () => (await fetch('./icon.svg')).status), 404);
        assert.equal(await page.evaluate(async (cacheName) => (await (await caches.open(cacheName)).match(new URL('./icon.svg', location.href))).status, firstCache), 200);
        state.failurePath = null;

        // Install a second app path and preserve a completely unrelated cache.
        await page.evaluate(async () => { await caches.open('unrelated-static-site'); });
        const otherPage = await context.newPage();
        await otherPage.goto(`${origin}/Other/`);
        await waitForControl(otherPage);
        const otherCache = (await page.evaluate(() => caches.keys())).find((name) => name.startsWith('passwmana-shell-%2FOther%2F-'));
        assert.ok(otherCache);

        await unlockSyntheticVault(page);
        await page.locator('[data-action="open-add"]:visible').first().click();
        const updateDraft = page.locator('[data-form="add-entry"]');
        await updateDraft.locator('[name="title"]').fill('Synthetic update draft');
        await updateDraft.locator('[name="password"]').fill('synthetic-update-draft-secret');

        // Publish a byte-different complete shell. It must wait for consent.
        const appRoot = path.join(root, 'PasswMana');
        const indexPath = path.join(appRoot, 'index.html');
        fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8').replace('<title>PasswMana</title>', '<title>PasswMana synthetic release 2</title>'));
        fs.appendFileSync(path.join(appRoot, 'app.js'), '\nglobalThis.__pwaRelease = "synthetic-release-2";\n');
        fs.writeFileSync(path.join(appRoot, 'sw.js'), generateWorker(appRoot).source);
        await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
        await waitForAsyncCondition(page, async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting), 'new worker waits for consent');
        assert.equal(await page.evaluate(() => globalThis.__pwaRelease), undefined, 'waiting worker must not reload an active page');
        assert.equal(await updateDraft.locator('[name="title"]').inputValue(), 'Synthetic update draft');
        assert.ok((await page.evaluate(() => caches.keys())).includes(firstCache));
        const updateNavigation = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
        await page.locator('[data-update-notice] [data-action="apply-update"]').click();
        await updateNavigation;
        await waitForAsyncCondition(page, async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            return !registration.waiting && registration.active?.state === 'activated';
        }, 'new worker activates after consent');
        await page.locator('[data-form="unlock"]').waitFor();
        assert.equal(await page.title(), 'PasswMana synthetic release 2');
        await page.waitForFunction(() => globalThis.__pwaRelease === 'synthetic-release-2');
        const cachesAfterUpdate = await page.evaluate(() => caches.keys());
        assert.ok(!cachesAfterUpdate.includes(firstCache));
        assert.ok(cachesAfterUpdate.includes(otherCache));
        assert.ok(cachesAfterUpdate.includes('unrelated-static-site'));

        await context.setOffline(true);
        await page.reload();
        await page.locator('[data-form="unlock"]').waitFor();
        assert.equal(await page.title(), 'PasswMana synthetic release 2');
        await unlockSyntheticVault(page);
        await page.locator('[data-action="resume-draft"]').click();
        const resumedDraft = page.locator('[data-form="add-entry"]');
        assert.equal(await resumedDraft.locator('[name="title"]').inputValue(), 'Synthetic update draft');
        assert.equal(await resumedDraft.locator('[name="password"]').inputValue(), 'synthetic-update-draft-secret');
        await page.screenshot({ path: path.join(screenshotDirectory, `update-draft-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
        await page.locator('[data-action="close-modal"]:visible').first().click();

        // Ordinary static edits remain discoverable even if a manual deployer
        // forgets to regenerate sw.js. Newly added resources still need hashing.
        await page.locator('[data-action="lock"]:visible').first().click();
        await context.setOffline(false);
        fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8').replace('PasswMana synthetic release 2', 'PasswMana synthetic manual edit'));
        await page.reload();
        await page.locator('[data-form="unlock"]').waitFor();
        assert.equal(await page.title(), 'PasswMana synthetic manual edit');
        await waitForAsyncCondition(page, async () => {
            const names = await caches.keys();
            const name = names.find((candidate) => candidate.startsWith('passwmana-shell-%2FPasswMana%2F-'));
            const response = await (await caches.open(name)).match(new URL('./index.html', location.href));
            return (await response.text()).includes('PasswMana synthetic manual edit');
        }, 'manual HTML update reaches offline cache');
        await context.setOffline(true);
        await page.reload();
        await page.locator('[data-form="unlock"]').waitFor();
        assert.equal(await page.title(), 'PasswMana synthetic manual edit');
        await unlockSyntheticVault(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(violations, []);
        console.log(`PASS real PWA ${mobile ? 'mobile' : 'desktop'}: local icons/CSP, offline refresh/unlock, API exclusion, 404, waiting update and encrypted draft resume, cache isolation, new release offline, manual deployment fallback`);
        await otherPage.close();
    } finally {
        await context.close();
        await new Promise((resolve) => server.close(resolve));
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('passwmana-real-sw-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
}

(async () => {
    const screenshotDirectory = process.env.BROWSER_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'passwmana-pwa-screenshots-'));
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    const browser = await playwright.chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'msedge' }) });
    try {
        await scenario(browser, false, screenshotDirectory);
        await scenario(browser, true, screenshotDirectory);
        console.log(`PWA screenshots: ${screenshotDirectory}`);
    } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
