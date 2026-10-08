const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const { generateWorker, shellPaths } = require('../scripts/generate-sw.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repositoryRoot, 'sw.js'), 'utf8');
const digest = (value) => createHash('sha256').update(value).digest('hex');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'passwmana-shell-'));
    t.after(() => {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('passwmana-shell-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    fs.writeFileSync(path.join(root, 'sw.js'), source);
    for (const asset of shellPaths) {
        const target = path.join(root, asset);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `synthetic ${asset}`);
    }
    return root;
}

function workerHarness(workerSource, { scope = 'https://example.invalid/PasswMana/', failure = null } = {}) {
    const handlers = {};
    const stored = new Map();
    const requests = [];
    let offline = false;
    let skipped = 0;
    const keyOf = (value) => typeof value === 'string' ? value : value.url;
    const cacheStorage = {
        async keys() { return [...stored.keys()]; },
        async delete(key) { return stored.delete(key); },
        async open(name) {
            if (!stored.has(name)) stored.set(name, new Map());
            const contents = stored.get(name);
            return {
                async keys() { return [...contents.keys()].map((url) => ({ url })); },
                async put(key, response) { contents.set(keyOf(key), response.clone()); },
                async match(key) { return contents.get(keyOf(key))?.clone(); },
                async delete(key) { return contents.delete(keyOf(key)); }
            };
        }
    };
    const self = {
        registration: { scope },
        clients: { async claim() {} },
        addEventListener(type, handler) { handlers[type] = handler; },
        async skipWaiting() { skipped += 1; }
    };
    vm.runInNewContext(workerSource, {
        self, caches: cacheStorage, URL, crypto: webcrypto, Uint8Array, TextEncoder,
        async fetch(request) {
            const url = keyOf(request);
            requests.push(url);
            if (offline) throw new TypeError('Synthetic offline');
            if (failure?.(url)) return new Response('synthetic failure', { status: 404 });
            return new Response(`synthetic ./${new URL(url).pathname.slice(new URL(scope).pathname.length)}`, { status: 200 });
        }
    });
    return {
        stored, requests, cacheStorage,
        setOffline(value) { offline = value; },
        get skipped() { return skipped; },
        async dispatch(type, extra = {}) {
            const waits = [];
            let response;
            handlers[type]({ ...extra, waitUntil(promise) { waits.push(promise); }, respondWith(promise) { response = promise; } });
            const result = response ? await response : undefined;
            await Promise.all(waits);
            return { response: result, waits: waits.length };
        }
    };
}

test('shell generation is stable and changes for assets and worker implementation', (t) => {
    const root = fixture(t);
    const first = generateWorker(root);
    fs.writeFileSync(path.join(root, 'sw.js'), first.source);
    assert.equal(generateWorker(root).source, first.source);
    fs.appendFileSync(path.join(root, 'ui-helpers.js'), '\n// synthetic change');
    const assetChange = generateWorker(root);
    assert.notEqual(assetChange.version, first.version);
    fs.appendFileSync(path.join(root, 'sw.js'), '\n// synthetic worker change');
    assert.notEqual(generateWorker(root).version, assetChange.version);
    assert.equal(first.assets.length, shellPaths.length);
});

test('shell hashes survive Git CRLF and LF checkouts', (t) => {
    const root = fixture(t);
    const filename = path.join(root, 'app.js');
    fs.writeFileSync(filename, 'synthetic\nrelease\n');
    const unix = generateWorker(root);
    fs.writeFileSync(filename, 'synthetic\r\nrelease\r\n');
    assert.equal(generateWorker(root).version, unix.version);
});

test('install precaches the complete shell without activating a waiting update', async (t) => {
    const generated = generateWorker(fixture(t));
    const worker = workerHarness(generated.source);
    const installed = await worker.dispatch('install');
    assert.equal(installed.waits, 1);
    assert.equal(worker.skipped, 0);
    assert.equal([...worker.stored.values()][0].size, shellPaths.length);
    worker.setOffline(true);
    const navigation = await worker.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://example.invalid/PasswMana/' } });
    assert.equal(await navigation.response.text(), 'synthetic ./index.html');
    for (const asset of shellPaths) {
        const result = await worker.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: new URL(asset, 'https://example.invalid/PasswMana/').href } });
        assert.equal(result.response.status, 200, asset);
    }
    await worker.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    assert.equal(worker.skipped, 1);
});

test('failed installation cannot retain a partial shell', async (t) => {
    const generated = generateWorker(fixture(t));
    const worker = workerHarness(generated.source, { failure: (url) => url.endsWith('app.js') });
    await assert.rejects(worker.dispatch('install'), /resource unavailable/);
    assert.equal(worker.stored.size, 0);
});

test('content mismatches reject an incomplete deployment', async (t) => {
    const root = fixture(t);
    const generated = generateWorker(root);
    const changedHash = generated.source.replace(generated.assets[0].sha256, '0'.repeat(64));
    const worker = workerHarness(changedHash);
    await assert.rejects(worker.dispatch('install'), /changed during deployment/);
    assert.equal(worker.stored.size, 0);
});

test('activation cleans only the current application path and migrates shared legacy caches', async (t) => {
    const generated = generateWorker(fixture(t));
    const worker = workerHarness(generated.source);
    await worker.dispatch('install');
    worker.stored.set('another-app-cache', new Map());
    worker.stored.set('passwmana-shell-%2FOther%2F-old', new Map());
    worker.stored.set('passwmana-shell-%2FPasswMana%2F-old', new Map());
    const legacy = await worker.cacheStorage.open('passwmana-static-v12');
    await legacy.put('https://example.invalid/PasswMana/app.js', new Response('old'));
    await legacy.put('https://example.invalid/Other/app.js', new Response('other'));
    await worker.dispatch('activate');
    assert.ok(worker.stored.has('another-app-cache'));
    assert.ok(worker.stored.has('passwmana-shell-%2FOther%2F-old'));
    assert.ok(!worker.stored.has('passwmana-shell-%2FPasswMana%2F-old'));
    assert.deepEqual([...worker.stored.get('passwmana-static-v12').keys()], ['https://example.invalid/Other/app.js']);
});

test('404 responses do not overwrite a working cache and API requests are never cached', async (t) => {
    const generated = generateWorker(fixture(t));
    let fail = false;
    const worker = workerHarness(generated.source, { failure: () => fail });
    await worker.dispatch('install');
    fail = true;
    const request = { method: 'GET', mode: 'cors', url: 'https://example.invalid/PasswMana/app.js' };
    const failed = await worker.dispatch('fetch', { request });
    assert.equal(failed.response.status, 404);
    assert.equal(failed.waits, 1);
    worker.setOffline(true);
    assert.equal(await (await worker.dispatch('fetch', { request })).response.text(), 'synthetic ./app.js');
    const before = worker.requests.length;
    const api = await worker.dispatch('fetch', { request: { ...request, url: 'https://api.github.com/repos/synthetic/private' } });
    const otherApp = await worker.dispatch('fetch', { request: { ...request, url: 'https://example.invalid/Other/app.js' } });
    assert.equal(api.response, undefined);
    assert.equal(otherApp.response, undefined);
    assert.equal(worker.requests.length, before);
});

test('production HTML allows zoom, uses local scripts and restricts executable content', () => {
    const html = fs.readFileSync(path.join(repositoryRoot, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1|id="app" aria-live/);
    assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /style-src 'self'/);
    assert.match(html, /connect-src 'self' https:\/\/api\.github\.com/);
    assert.match(html, /object-src 'none'/);
    assert.equal(digest(fs.readFileSync(path.join(repositoryRoot, 'vendor/lucide-0.468.0.min.js'))), '3411692820cb8d47543f69496aa25fd603a358f4498046f41c508a5a3342210e');
});
