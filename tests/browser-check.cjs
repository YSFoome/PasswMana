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

async function checkSettingsNavigation(page, outputDirectory, mobile, screenshotName) {
    const panels = ['sync', 'security', 'appearance', 'categories', 'trash'];
    await navigate(page, 'settings', mobile);
    const navigation = page.locator('.settings-nav');
    await navigation.waitFor();
    assert.equal(await navigation.locator('button:visible').count(), panels.length);
    if (mobile) {
        assert.equal(await page.locator('.settings-panel:visible').count(), 0, 'The mobile settings list must show navigation before detail');
        await page.screenshot({ path: path.join(outputDirectory, `settings-list-${screenshotName}.png`), fullPage: true });
    }
    let originalButtonPositions;
    for (const panel of panels) {
        await navigation.locator(`[data-panel="${panel}"]`).click();
        const activeButton = navigation.locator('button.active');
        const activePanel = page.locator('.settings-panel.active');
        assert.equal(await activeButton.count(), 1, 'Exactly one settings navigation button must be selected');
        assert.equal(await activeButton.getAttribute('data-panel'), panel);
        assert.equal(await activeButton.getAttribute('aria-current'), 'page');
        assert.equal(await navigation.locator('[aria-current="page"]').count(), 1);
        assert.equal(await activePanel.count(), 1, 'Exactly one settings panel must be active');
        assert.equal(await activePanel.getAttribute('data-panel'), panel);
        await activePanel.waitFor();
        assert.equal(await page.locator('.settings-panel:visible').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${screenshotName} ${panel} settings must fit their viewport`);
        if (mobile) {
            assert.equal(await navigation.isVisible(), false, 'Mobile details must hide the settings list');
            assert.equal(await page.locator('[data-action="mobile-left"]').getAttribute('aria-label'), '返回设置');
        } else {
            const buttonPositions = await navigation.locator('button').evaluateAll((buttons) => buttons.map((button) => {
                const rectangle = button.getBoundingClientRect();
                return { top: rectangle.top, height: rectangle.height };
            }));
            for (const button of buttonPositions) assert.ok(button.height >= 36 && button.height <= 48, `${panel} navigation buttons must remain compact; observed ${button.height}px`);
            if (originalButtonPositions) {
                for (let index = 0; index < buttonPositions.length; index += 1) {
                    assert.ok(Math.abs(buttonPositions[index].top - originalButtonPositions[index].top) <= 1, 'Changing the panel must not stretch or reposition the settings navigation');
                }
            } else originalButtonPositions = buttonPositions;
            if (panel === 'sync') {
                const hoveredButton = navigation.locator('[data-panel="appearance"]');
                await hoveredButton.hover();
                const hoverBackground = await hoveredButton.evaluate((button) => getComputedStyle(button).backgroundColor);
                const activeBackground = await activeButton.evaluate((button) => getComputedStyle(button).backgroundColor);
                assert.notEqual(hoverBackground, activeBackground, 'Hover must look different from the selected setting');
                assert.equal(await hoveredButton.getAttribute('aria-current'), null);
                assert.equal(await activeButton.getAttribute('data-panel'), 'sync', 'Hover must not change the selected panel');
            }
        }
        await page.screenshot({ path: path.join(outputDirectory, `settings-${panel}-${screenshotName}.png`), fullPage: true });
        if (mobile) {
            await page.locator('[data-action="mobile-left"]').click();
            await navigation.waitFor();
            assert.equal(await navigation.locator('button:visible').count(), panels.length);
            assert.equal(await page.locator('.settings-panel:visible').count(), 0);
            assert.equal(await page.locator('[data-action="mobile-left"]').getAttribute('aria-label'), '打开导航');
            const heights = await navigation.locator('button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
            assert.ok(heights.every((height) => height >= 44 && height <= 80), 'Mobile navigation must keep usable, compact touch targets');
        }
    }
    if (!mobile) {
        const focusButton = navigation.locator('[data-panel="sync"]');
        await page.mouse.move(1, 1);
        await focusButton.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        assert.ok(await focusButton.evaluate((button) => button === document.activeElement));
        const outline = await focusButton.evaluate((button) => ({ width: getComputedStyle(button).outlineWidth, style: getComputedStyle(button).outlineStyle }));
        assert.ok(Number.parseFloat(outline.width) > 0 && outline.style !== 'none', 'Keyboard focus must have a visible outline independent of selection');
        assert.equal(await navigation.locator('button.active').getAttribute('data-panel'), 'trash', 'Keyboard focus must not change selection');
        await page.screenshot({ path: path.join(outputDirectory, `settings-focus-${screenshotName}.png`), fullPage: true });
    }
    await navigate(page, 'vault', mobile);
}

async function unlock(page, password = masterPassword, expectUnlocked = password === masterPassword) {
    const form = page.locator('[data-form="unlock"]');
    await form.locator('[name="password"]').fill(password);
    await form.locator('[type="submit"]').click();
    if (expectUnlocked) await page.locator('.app-shell').waitFor();
}

async function lockThroughUi(page) {
    await visibleClick(page, '[data-action="lock"]');
    await page.locator('[data-form="unlock"]').waitFor();
}

async function uploadFile(page, action, name, buffer) {
    const chooser = page.waitForEvent('filechooser');
    await visibleClick(page, `[data-action="${action}"]`);
    await (await chooser).setFiles({ name, mimeType: 'application/json', buffer });
}

async function checkKeyboardAndGenerator(page) {
    await visibleClick(page, '[data-action="open-add"]');
    const form = page.locator('[data-form="add-entry"]');
    await form.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'title');
    assert.equal(await form.getAttribute('role'), 'dialog');
    assert.equal(await form.getAttribute('aria-modal'), 'true');
    const controls = form.locator('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)');
    for (let index = 0; index < await controls.count() + 2; index += 1) {
        await page.keyboard.press('Tab');
        assert.ok(await page.evaluate(() => document.querySelector('[data-form="add-entry"]').contains(document.activeElement)), 'Tab must stay inside the modal');
    }
    await controls.first().focus();
    await page.keyboard.press('Shift+Tab');
    assert.ok(await controls.last().evaluate((node) => node === document.activeElement));
    await page.keyboard.press('Tab');
    assert.ok(await controls.first().evaluate((node) => node === document.activeElement));
    await page.keyboard.press('Escape');
    await form.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'open-add', 'Closing the modal must return keyboard focus to its trigger');

    await visibleClick(page, '[data-action="open-add"]');
    await form.locator('[data-generator-length]').selectOption('32');
    await form.locator('[data-action="generate-password"]').click();
    const generated = await form.locator('[name="password"]').inputValue();
    assert.equal(generated.length, 32);
    await form.locator('[data-action="copy-generated"]').click();
    assert.equal(await page.evaluate(() => globalThis.__syntheticClipboard), generated);
    await page.keyboard.press('Escape');
    await form.waitFor({ state: 'hidden' });
}

async function changePasswordThroughUi(page, currentPassword, nextPassword, mobile, checkErrors = false) {
    await setting(page, 'security', mobile);
    await visibleClick(page, '[data-action="open-change-password"]');
    const form = page.locator('[data-form="change-password"]');
    await form.locator('[name="currentPassword"]').fill(checkErrors ? 'synthetic-wrong-current-password' : currentPassword);
    await form.locator('[name="newPassword"]').fill(nextPassword);
    await form.locator('[name="confirmPassword"]').fill(nextPassword);
    if (checkErrors) {
        await form.locator('[type="submit"]').click();
        await form.locator('[data-form-error]').waitFor();
        assert.match(await form.locator('[data-form-error]').textContent(), /当前主密码错误/);
        assert.equal(await form.locator('[name="currentPassword"]').getAttribute('aria-invalid'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'currentPassword');
        await form.locator('[name="currentPassword"]').fill(currentPassword);
        await form.locator('[name="confirmPassword"]').fill('synthetic-mismatched-confirmation');
        await form.locator('[type="submit"]').click();
        await form.locator('[data-form-error]').waitFor();
        assert.match(await form.locator('[data-form-error]').textContent(), /两次新密码不一致/);
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'confirmPassword');
        await form.locator('[name="confirmPassword"]').fill(nextPassword);
    }
    await form.locator('[type="submit"]').click();
    await form.waitFor({ state: 'hidden' });
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
    await context.addInitScript(() => {
        globalThis.__syntheticClipboard = '';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            async writeText(value) { globalThis.__syntheticClipboard = value; },
            async readText() { return globalThis.__syntheticClipboard; },
        } });
        const originalQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (descriptor) => descriptor.name === 'clipboard-read'
            ? Promise.resolve({ state: 'granted' }) : originalQuery(descriptor);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const browserErrors = [];
    const github = { payload: null, sha: null, version: 0, requests: [], failure: 0, delay: 0 };
    page.on('pageerror', (error) => browserErrors.push(error.message));
    let promptValue = 'Synthetic unused custom category';
    const observeDialogs = (observedPage) => observedPage.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? promptValue : undefined));
    observeDialogs(page);
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
        if (url.includes('/branches/')) return fulfill(200, { name: 'main', protected: false });
        if (!url.includes('/contents/')) return fulfill(200, { private: true, permissions: { push: true } });
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
        assert.equal(github.payload.syncKeyBase, undefined);
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
        assert.equal(await page.evaluate(() => __testApi.state.timer), null, 'Recovery verification must remain available until saved');
        assert.equal(await page.locator('[data-action="finish-setup"]').isDisabled(), true);
        await page.locator('[name="recoverySuffix"]').fill(recoveryCode.split('-').at(-1));
        await page.locator('[data-action="finish-setup"]').click();

        await page.getByText('还没有密码条目', { exact: true }).waitFor();
        await checkSettingsNavigation(page, outputDirectory, mobile, name);
        await setting(page, 'categories', mobile);
        await visibleClick(page, '[data-action="add-category"]');
        await page.waitForFunction((category) => __testApi.state.vault.categories.includes(category), promptValue);
        const addedCategoryDelete = page.locator(`[data-action="delete-category"][data-category="${promptValue}"]`);
        await addedCategoryDelete.waitFor();
        assert.equal(await addedCategoryDelete.count(), 1, 'A category added in the first session must be deletable');
        await addedCategoryDelete.click();
        await addedCategoryDelete.waitFor({ state: 'hidden' });
        await page.waitForFunction((category) => !__testApi.state.vault.categories.includes(category), promptValue);
        await navigate(page, 'vault', mobile);
        await checkKeyboardAndGenerator(page);

        await addEntry(page, 'Synthetic entry');
        await page.locator('.entry').filter({ hasText: 'Synthetic entry' }).click();
        await page.locator('[data-action="copy-account"]').click();
        assert.equal(await page.evaluate(() => globalThis.__syntheticClipboard), 'synthetic@example.invalid');
        const websiteLink = page.locator('.modal a[href="https://example.invalid/"]');
        assert.equal(await websiteLink.getAttribute('target'), '_blank');
        assert.match(await websiteLink.getAttribute('rel'), /noopener/);
        const reveal = page.locator('[data-action="reveal-password"]');
        await reveal.focus();
        await reveal.click();
        assert.ok(await reveal.evaluate((node) => node === document.activeElement));
        assert.equal(await page.locator('[data-secret-value]').textContent(), 'synthetic-entry-password');
        await reveal.click();
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

        await lockThroughUi(page);
        await unlock(page, 'synthetic-wrong-password');
        await page.getByText('主密码错误，无法解锁保险库', { exact: true }).waitFor();
        assert.ok(await page.locator('[data-form="unlock"]').isVisible());
        await unlock(page);
        await page.reload();
        await page.locator('[data-form="unlock"]').waitFor();
        await unlock(page);
        assert.equal(await page.locator('.entry').count(), 1);

        const secondTab = await context.newPage();
        observeDialogs(secondTab);
        secondTab.on('pageerror', (error) => browserErrors.push(error.message));
        await secondTab.goto(baseUrl);
        await secondTab.locator('[data-form="unlock"] [name="password"]').fill(masterPassword);
        await secondTab.locator('[data-form="unlock"] [type="submit"]').click();
        await secondTab.getByText('保险库已在另一个标签页解锁，请先锁定该页面', { exact: true }).waitFor();
        assert.equal(await secondTab.locator('.app-shell').count(), 0);
        await secondTab.locator('[data-action="open-recovery-reset"]').click();
        const recoveryForm = secondTab.locator('[data-form="recovery-reset"]');
        await recoveryForm.waitFor();
        const recoveredPassword = 'synthetic-recovered-master-password';
        await recoveryForm.locator('[name="recoveryCode"]').fill(recoveryCode);
        await recoveryForm.locator('[name="newPassword"]').fill(recoveredPassword);
        await recoveryForm.locator('[name="confirmPassword"]').fill(recoveredPassword);
        await recoveryForm.locator('[type="submit"]').click();
        await recoveryForm.locator('[data-form-error]').waitFor();
        assert.match(await recoveryForm.locator('[data-form-error]').textContent(), /另一个标签页/);
        await page.locator('.entry').click();
        await page.locator('[data-action="open-edit"]').click();
        await page.locator('[data-form="edit-entry"] [name="notes"]').fill('Synthetic first-tab edit');
        await page.locator('[data-form="edit-entry"] [type="submit"]').click();
        await page.locator('[data-form="edit-entry"]').waitFor({ state: 'hidden' });
        await lockThroughUi(page);
        await recoveryForm.locator('[name="recoveryCode"]').fill('SYNTHETIC-INVALID-RECOVERY-CODE');
        await recoveryForm.locator('[type="submit"]').click();
        await recoveryForm.locator('[data-form-error]').waitFor();
        assert.match(await recoveryForm.locator('[data-form-error]').textContent(), /恢复密钥无效/);
        assert.equal(await recoveryForm.locator('[name="recoveryCode"]').getAttribute('aria-invalid'), 'true');
        await recoveryForm.locator('[name="recoveryCode"]').fill(recoveryCode);
        await recoveryForm.locator('[type="submit"]').click();
        await recoveryForm.waitFor({ state: 'hidden' });
        await unlock(secondTab, masterPassword, false);
        await secondTab.locator('[data-form="unlock"] [data-form-error]').waitFor();
        await unlock(secondTab, recoveredPassword, true);
        assert.equal(await secondTab.evaluate(() => __testApi.state.vault.entries[0].notes), 'Synthetic first-tab edit');
        await changePasswordThroughUi(secondTab, recoveredPassword, masterPassword, mobile, true);
        await lockThroughUi(secondTab);
        await unlock(secondTab, recoveredPassword, false);
        await secondTab.locator('[data-form="unlock"] [data-form-error]').waitFor();
        await unlock(secondTab);
        await lockThroughUi(secondTab);
        await secondTab.close();
        await unlock(page);

        await setting(page, 'appearance', mobile);
        await page.locator('[data-action="set-mode"][data-mode="dark"]').click();
        await page.locator('[data-action="set-accent"][data-accent="blue"]').click();
        assert.equal(await page.locator('html').getAttribute('data-mode'), 'dark');
        assert.equal(await page.locator('html').getAttribute('data-accent'), 'blue');
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
        assert.equal(backupRecord.syncKeyBase, undefined);
        assert.equal(backupRecord.syncBase, undefined);
        assert.ok(!backup.toString('utf8').includes('synthetic-entry-password'));

        const originalRecord = await page.evaluate(() => JSON.stringify(__testApi.state.record));
        await uploadFile(page, 'import-backup', 'synthetic-invalid.passwmana', Buffer.from(JSON.stringify({ format: 'passwmana-v1', encryptedVault: {}, wrappedVaultKey: {} })));
        await page.getByText(/恢复失败，原保险库已保留/).waitFor();
        assert.equal(await page.evaluate(() => JSON.stringify(__testApi.state.record)), originalRecord);
        assert.ok(await page.evaluate(() => Boolean(__testApi.state.vaultKey)));

        const invalidContentBackup = await page.evaluate(async () => {
            const api = __testApi;
            return { record: { ...api.remoteRecord(api.state.record), encryptedVault: await api.encryptText(JSON.stringify({ entries: 'invalid-synthetic-content' }), api.state.vaultKey) } };
        });
        await uploadFile(page, 'import-backup', 'synthetic-invalid-content.passwmana', Buffer.from(JSON.stringify(invalidContentBackup)));
        const backupForm = page.locator('[data-form="backup-unlock"]');
        await backupForm.locator('[name="password"]').fill(masterPassword);
        await backupForm.locator('[type="submit"]').click();
        await backupForm.locator('[data-form-error]').waitFor();
        assert.equal(await page.evaluate(() => JSON.stringify(__testApi.state.record)), originalRecord);
        assert.equal(await page.evaluate(() => __testApi.state.vault.entries.length), 1);
        await page.keyboard.press('Escape');
        await backupForm.waitFor({ state: 'hidden' });

        await uploadFile(page, 'import-backup', 'synthetic.passwmana', backup);
        await backupForm.locator('[name="password"]').fill('synthetic-wrong-backup-password');
        await backupForm.locator('[type="submit"]').click();
        await backupForm.locator('[data-form-error]').waitFor();
        assert.match(await backupForm.locator('[data-form-error]').textContent(), /原保险库已保留/);
        assert.equal(await page.evaluate(() => JSON.stringify(__testApi.state.record)), originalRecord);
        await backupForm.locator('[name="password"]').fill(masterPassword);
        await backupForm.locator('[type="submit"]').click();
        await page.locator('[data-form="unlock"]').waitFor();
        await unlock(page);
        assert.equal(await page.evaluate(() => __testApi.state.record.remoteSha), null);
        assert.equal(await page.evaluate(() => __testApi.state.vault.entries.length), 1);

        await setting(page, 'sync', mobile);
        const hostileId = 'synthetic" data-injected-test="true"><img src="synthetic-invalid" onerror="globalThis.__migrationInjected=true">';
        const migrationComplete = page.waitForEvent('dialog', { predicate: (dialog) => dialog.type() === 'alert' && dialog.message().startsWith('迁移完成：') });
        await uploadFile(page, 'import-legacy', 'synthetic-legacy.json', Buffer.from(JSON.stringify({ entries: [
            { id: 'synthetic-legacy', siteName: 'Synthetic legacy entry', account: 'test@example.invalid', password: 'synthetic-legacy-password', type: 'Synthetic category' },
            { id: hostileId, siteName: 'Synthetic hostile ID', account: 'test@example.invalid', password: 'synthetic-hostile-password', type: '个人', url: 'javascript:globalThis.__migrationInjected=true' },
        ] })));
        await migrationComplete;
        await page.waitForFunction(() => __testApi.state.vault.entries.length === 3);
        assert.ok(await page.evaluate(() => __testApi.state.vault.categories.includes('Synthetic category')));
        await navigate(page, 'vault', mobile);
        assert.equal(await page.locator('[data-injected-test]').count(), 0);
        assert.equal(await page.evaluate(() => globalThis.__migrationInjected === true), false);
        await page.locator('.entry').filter({ hasText: 'Synthetic hostile ID' }).click();
        assert.equal(await page.locator('.modal a[href^="javascript:"]').count(), 0);
        assert.equal(await page.locator('[data-injected-test]').count(), 0);
        await page.locator('[data-action="delete-entry"]').click();
        await page.locator('[data-action="delete-entry"]').waitFor({ state: 'hidden' });
        await setting(page, 'trash', mobile);
        assert.equal(await page.locator('[data-injected-test]').count(), 0);
        await page.locator('[data-action="restore-entry"]').click();
        // Restoring changes memory before its encrypted IndexedDB write finishes.
        // Wait for the post-save render before reloading and checking persistence.
        await page.locator('[data-action="restore-entry"]').waitFor({ state: 'hidden' });
        await navigate(page, 'vault', mobile);
        await page.locator('.entry').filter({ hasText: 'Synthetic hostile ID' }).waitFor();
        await page.reload();
        await unlock(page);
        await navigate(page, 'vault', mobile);
        assert.equal(await page.locator('[data-injected-test]').count(), 0);
        assert.equal(await page.evaluate(() => globalThis.__migrationInjected === true), false);
        assert.ok(await page.evaluate((id) => __testApi.state.vault.entries.some((item) => item.id === id), hostileId));
        await setting(page, 'sync', mobile);

        await page.locator('[data-action="open-sync-config"]').click();
        const config = page.locator('[data-form="sync-config"]');
        await config.locator('[name="repositoryUrl"]').fill('https://github.com/synthetic-owner/synthetic-private-vault');
        await config.locator('[data-action="wizard-next"]').click();
        await config.locator('[name="token"]').fill('synthetic-test-token');
        await config.locator('[data-action="test-sync-connection"]').click();
        await config.locator('[data-connection-result]').filter({ hasText: '连接正常' }).waitFor();
        await config.locator('[type="submit"]').click();
        await config.waitFor({ state: 'hidden' });
        assert.equal(github.requests.filter((request) => request.url.includes('/contents/')).length, 0, 'First connection must wait for explicit initialization/import');
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
        assert.equal(await page.locator('.sync-result[role="alert"]').count(), 0);
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

        // Two devices changing the same fields must expose explicit choices.
        github.payload = await page.evaluate(async ({ id, payload }) => {
            const api = __testApi;
            const vault = JSON.parse(await api.decryptText(payload.encryptedVault, api.state.vaultKey));
            const target = vault.entries.find((item) => item.id === id);
            target.notes = 'Synthetic remote conflict note';
            target.password = 'synthetic-remote-conflict-password';
            return { ...payload, encryptedVault: await api.encryptText(JSON.stringify(vault), api.state.vaultKey) };
        }, { id: targetId, payload: github.payload });
        github.sha = `synthetic-sha-${++github.version}`;
        await page.locator(`[data-action="open-detail"][data-id="${targetId}"]`).click();
        await page.locator('[data-action="open-edit"]').click();
        const conflictingEdit = page.locator('[data-form="edit-entry"]');
        await conflictingEdit.locator('[name="notes"]').fill('Synthetic local conflict note');
        await conflictingEdit.locator('[name="password"]').fill('synthetic-local-conflict-password');
        await conflictingEdit.locator('[type="submit"]').click();
        await conflictingEdit.waitFor({ state: 'hidden' });
        await page.evaluate(() => __testApi.synchronize({ automatic: true }));
        await page.waitForFunction(() => Boolean(__testApi.state.syncConflict) && !__testApi.state.syncing);
        await visibleClick(page, '[data-action="open-sync"]');
        await page.locator('[data-action="open-conflicts"]').click();
        const conflicts = page.locator('[data-form="resolve-conflicts"]');
        await conflicts.waitFor();
        assert.match(await conflicts.textContent(), /Synthetic local conflict note/);
        assert.match(await conflicts.textContent(), /Synthetic remote conflict note/);
        assert.ok(!(await conflicts.textContent()).includes('synthetic-local-conflict-password'));
        assert.ok(!(await conflicts.textContent()).includes('synthetic-remote-conflict-password'));
        await conflicts.locator('[data-action="reveal-conflict"]').click();
        assert.match(await conflicts.locator('[data-conflict-secret]').textContent(), /synthetic-local-conflict-password/);
        assert.match(await conflicts.locator('[data-conflict-secret]').textContent(), /synthetic-remote-conflict-password/);
        await conflicts.locator('[data-action="reveal-conflict"]').click();
        assert.equal(await conflicts.locator('[data-conflict-secret]').textContent(), '');
        await conflicts.locator('fieldset').filter({ hasText: '备注' }).locator('input[value="local"]').check();
        await conflicts.locator('fieldset').filter({ hasText: '密码' }).locator('input[value="remote"]').check();
        await page.screenshot({ path: path.join(outputDirectory, `conflicts-${name}.png`), fullPage: true });
        await conflicts.locator('[type="submit"]').click();
        await conflicts.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => !__testApi.state.record.dirty && !__testApi.state.syncing);
        const resolvedEntry = await page.evaluate((id) => __testApi.state.vault.entries.find((item) => item.id === id), targetId);
        assert.equal(resolvedEntry.notes, 'Synthetic local conflict note');
        assert.equal(resolvedEntry.password, 'synthetic-remote-conflict-password');

        const entriesBeforeFailure = await page.evaluate(() => JSON.stringify(__testApi.state.vault.entries));
        github.failure = 401;
        await visibleClick(page, '[data-action="open-sync"]');
        await page.locator('[data-action="push-remote"]').click();
        await page.locator('.sync-result[role="alert"]').waitFor();
        assert.match(await page.locator('.sync-result[role="alert"]').textContent(), /401/);
        assert.equal(await page.evaluate(() => JSON.stringify(__testApi.state.vault.entries)), entriesBeforeFailure);
        assert.ok(await page.evaluate(() => __testApi.state.syncBlocked));
        await visibleClick(page, '[data-action="close-modal"]');
        github.failure = 0;

        await setting(page, 'sync', mobile);
        await page.screenshot({ path: path.join(outputDirectory, `sync-${name}.png`), fullPage: true });
        const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(horizontalOverflow, false, `${name} page must fit its viewport`);

        // Browser zoom halves the CSS viewport. Exercise its 200% reflow size.
        const originalViewport = page.viewportSize();
        const zoomViewport = { width: Math.round(originalViewport.width / 2), height: originalViewport.height };
        await page.setViewportSize(zoomViewport);
        await checkSettingsNavigation(page, outputDirectory, true, `reflow-200-${name}`);
        await navigate(page, 'vault', true);
        await visibleClick(page, '[data-action="open-add"]');
        assert.ok(await page.locator('[data-form="add-entry"] [name="title"]').isVisible());
        await page.screenshot({ path: path.join(outputDirectory, `reflow-200-${name}.png`), fullPage: true });
        const reflowOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        if (reflowOverflow) {
            console.error('Reflow overflow:', await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
                elements: [...document.querySelectorAll('body *')].map((node) => ({ tag: node.tagName, className: String(node.className?.baseVal ?? node.className), right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width })).filter((node) => node.width > 0 && node.right > innerWidth + 1).slice(0, 20) })));
        }
        assert.equal(reflowOverflow, false, `${name} 200% reflow viewport must fit`);
        await page.keyboard.press('Escape');
        await page.locator('[data-form="add-entry"]').waitFor({ state: 'hidden' });
        await page.setViewportSize(originalViewport);

        // A background poll must not extend the user's idle lock deadline.
        await setting(page, 'security', mobile);
        await page.clock.install();
        await page.locator('[data-input="lock-minutes"]:visible').selectOption('1');
        await page.waitForFunction(() => __testApi.state.vault.preferences.lockMinutes === 1);
        await navigate(page, 'vault', mobile);
        await visibleClick(page, '[data-action="open-add"]');
        const idleDraft = page.locator('[data-form="add-entry"]');
        await idleDraft.locator('[name="title"]').fill('Synthetic idle draft');
        await idleDraft.locator('[name="password"]').fill('synthetic-idle-draft-password');
        await page.clock.runFor(1000);
        await page.clock.fastForward(41000);
        await page.locator('[data-lock-warning]').waitFor();
        await page.clock.fastForward(20000);
        await page.locator('[data-form="unlock"]').waitFor();
        assert.equal(await page.evaluate(() => __testApi.state.vaultKey), null);
        assert.equal(await page.evaluate(() => __testApi.state.rawVaultKey), null);
        await unlock(page);
        const encryptedDraft = await page.evaluate(async () => {
            const { dbGet } = await import('./vault-core.js');
            return JSON.stringify(await dbGet('encrypted-draft'));
        });
        assert.ok(!encryptedDraft.includes('synthetic-idle-draft-password'));
        assert.ok(!encryptedDraft.includes('Synthetic idle draft'));
        await page.locator('[data-action="resume-draft"]').click();
        await idleDraft.waitFor();
        assert.equal(await idleDraft.locator('[name="title"]').inputValue(), 'Synthetic idle draft');
        assert.equal(await idleDraft.locator('[name="password"]').inputValue(), 'synthetic-idle-draft-password');
        await idleDraft.locator('[name="username"]').fill('synthetic-draft@example.invalid');
        await idleDraft.locator('[type="submit"]').click();
        await idleDraft.waitFor({ state: 'hidden' });
        assert.equal(await page.locator('[data-action="resume-draft"]').count(), 0);
        await page.screenshot({ path: path.join(outputDirectory, `vault-${name}.png`), fullPage: true });
        assert.deepEqual(browserErrors, []);
        console.log(`PASS ${name}: compact settings navigation/selection/hover/focus/mobile back, recovery verification/reset/tab protection/latest record, keyboard focus/Esc, generator/account copy/safe links, CRUD/trash, password errors/change/unlock, categories/theme, validated backup/malicious migration, connection wizard, automatic sync, background draft/stale edit, masked conflict choices, 401, 200% reflow, idle lock/encrypted draft recovery`);
    } finally {
        await context.close();
    }
}

(async () => {
    const outputDirectory = process.env.BROWSER_SCREENSHOT_DIR || await fs.promises.mkdtemp(path.join(os.tmpdir(), 'passwmana-browser-'));
    await fs.promises.mkdir(outputDirectory, { recursive: true });
    console.log(`Screenshots: ${outputDirectory}`);
    const server = await serveRepository();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        const launchOptions = process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE }
            : process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL }
                : process.platform === 'win32' ? { channel: 'msedge' } : {};
        browser = await playwright.chromium.launch({ headless: true, ...launchOptions });
        await runScenario(browser, baseUrl, outputDirectory, false);
        await runScenario(browser, baseUrl, outputDirectory, true);
    } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
