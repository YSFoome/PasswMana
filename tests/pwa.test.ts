import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const { generateWorker, discoverShellPaths } = require('../scripts/generate-sw.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const swTemplate = fs.readFileSync(path.join(repositoryRoot, 'public', 'sw.js'), 'utf8');
const sampleShellPaths = [
    './index.html',
    './assets/index-synthetic.js',
    './assets/index-synthetic.css',
    './manifest.webmanifest',
    './icon.svg',
];

function createFixture(): { root: string; cleanup: () => void } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'passwmana-shell-'));
    fs.writeFileSync(path.join(root, 'sw.js'), swTemplate);
    for (const asset of sampleShellPaths) {
        const target = path.join(root, asset);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `synthetic ${asset}`);
    }
    return {
        root,
        cleanup() {
            assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
            assert.ok(path.basename(root).startsWith('passwmana-shell-'));
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

function workerHarness(workerSource: string, { scope = 'https://example.invalid/PasswMana/', failure = null as ((url: string) => boolean) | null } = {}) {
    const handlers: Record<string, (event: any) => void> = {};
    const stored = new Map<string, Map<string, Response>>();
    const requests: string[] = [];
    let offline = false;
    let skipped = 0;
    const keyOf = (value: string | { url: string }) => typeof value === 'string' ? value : value.url;
    const cacheStorage = {
        async keys() { return [...stored.keys()]; },
        async delete(key: string) { return stored.delete(key); },
        async open(name: string) {
            if (!stored.has(name)) stored.set(name, new Map());
            const contents = stored.get(name)!;
            return {
                async keys() { return [...contents.keys()].map((url) => ({ url })); },
                async put(key: string | { url: string }, response: Response) { contents.set(keyOf(key), response.clone()); },
                async match(key: string | { url: string }) { return contents.get(keyOf(key))?.clone(); },
                async delete(key: string | { url: string }) { return contents.delete(keyOf(key)); },
            };
        },
    };
    const self = {
        registration: { scope },
        clients: { async claim() {} },
        addEventListener(type: string, handler: (event: any) => void) { handlers[type] = handler; },
        async skipWaiting() { skipped += 1; },
    };
    vm.runInNewContext(workerSource, {
        self,
        caches: cacheStorage,
        URL,
        crypto: webcrypto,
        Uint8Array,
        TextEncoder,
        async fetch(request: string | { url: string }) {
            const url = keyOf(request);
            requests.push(url);
            if (offline) throw new TypeError('Synthetic offline');
            if (failure?.(url)) return new Response('synthetic failure', { status: 404 });
            return new Response(`synthetic ./${new URL(url).pathname.slice(new URL(scope).pathname.length)}`, { status: 200 });
        },
    });
    return {
        stored,
        requests,
        cacheStorage,
        setOffline(value: boolean) { offline = value; },
        get skipped() { return skipped; },
        async dispatch(type: string, extra: Record<string, any> = {}) {
            const waits: Promise<unknown>[] = [];
            let response: Promise<Response> | undefined;
            handlers[type]({
                ...extra,
                waitUntil(promise: Promise<unknown>) { waits.push(promise); },
                respondWith(promise: Promise<Response>) { response = promise; },
            });
            const result = response ? await response : undefined;
            await Promise.all(waits);
            return { response: result, waits: waits.length };
        },
    };
}

test('shell generation is stable and changes for assets and worker implementation', () => {
    const fx = createFixture();
    try {
        const first = generateWorker(fx.root);
        fs.writeFileSync(path.join(fx.root, 'sw.js'), first.source);
        assert.equal(generateWorker(fx.root).source, first.source);
        fs.appendFileSync(path.join(fx.root, 'assets', 'index-synthetic.js'), '\n// synthetic change');
        const assetChange = generateWorker(fx.root);
        assert.notEqual(assetChange.version, first.version);
        fs.appendFileSync(path.join(fx.root, 'sw.js'), '\n// synthetic worker change');
        assert.notEqual(generateWorker(fx.root).version, assetChange.version);
        assert.equal(first.assets.length, sampleShellPaths.length);
    } finally {
        fx.cleanup();
    }
});

test('shell hashes survive Git CRLF and LF checkouts', () => {
    const fx = createFixture();
    try {
        const filename = path.join(fx.root, 'assets', 'index-synthetic.js');
        fs.writeFileSync(filename, 'synthetic\nrelease\n');
        const unix = generateWorker(fx.root);
        fs.writeFileSync(filename, 'synthetic\r\nrelease\r\n');
        assert.equal(generateWorker(fx.root).version, unix.version);
    } finally {
        fx.cleanup();
    }
});

test('install precaches the complete shell without activating a waiting update', async () => {
    const fx = createFixture();
    try {
        const generated = generateWorker(fx.root);
        const worker = workerHarness(generated.source);
        const installed = await worker.dispatch('install');
        assert.equal(installed.waits, 1);
        assert.equal(worker.skipped, 0);
        assert.equal([...worker.stored.values()][0].size, sampleShellPaths.length);
        worker.setOffline(true);
        const navigation = await worker.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://example.invalid/PasswMana/' } });
        assert.equal(await navigation.response!.text(), 'synthetic ./index.html');
        for (const asset of sampleShellPaths) {
            const result = await worker.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: new URL(asset, 'https://example.invalid/PasswMana/').href } });
            assert.equal(result.response!.status, 200, asset);
        }
        await worker.dispatch('message', { data: { type: 'SKIP_WAITING' } });
        assert.equal(worker.skipped, 1);
    } finally {
        fx.cleanup();
    }
});

test('failed installation cannot retain a partial shell', async () => {
    const fx = createFixture();
    try {
        const generated = generateWorker(fx.root);
        const worker = workerHarness(generated.source, { failure: (url) => url.endsWith('.js') });
        await assert.rejects(worker.dispatch('install'), /resource unavailable/);
        assert.equal(worker.stored.size, 0);
    } finally {
        fx.cleanup();
    }
});

test('content mismatches reject an incomplete deployment', async () => {
    const fx = createFixture();
    try {
        const generated = generateWorker(fx.root);
        const changedHash = generated.source.replace(generated.assets[0].sha256, '0'.repeat(64));
        const worker = workerHarness(changedHash);
        await assert.rejects(worker.dispatch('install'), /changed during deployment/);
        assert.equal(worker.stored.size, 0);
    } finally {
        fx.cleanup();
    }
});

test('activation cleans only the current application path and migrates shared legacy caches', async () => {
    const fx = createFixture();
    try {
        const generated = generateWorker(fx.root);
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
        assert.deepEqual([...worker.stored.get('passwmana-static-v12')!.keys()], ['https://example.invalid/Other/app.js']);
    } finally {
        fx.cleanup();
    }
});

test('404 responses do not overwrite a working cache and API requests are never cached', async () => {
    const fx = createFixture();
    try {
        const generated = generateWorker(fx.root);
        let fail = false;
        const worker = workerHarness(generated.source, { failure: () => fail });
        await worker.dispatch('install');
        fail = true;
        const request = { method: 'GET', mode: 'cors', url: 'https://example.invalid/PasswMana/assets/index-synthetic.js' };
        const failed = await worker.dispatch('fetch', { request });
        assert.equal(failed.response!.status, 404);
        assert.equal(failed.waits, 1);
        worker.setOffline(true);
        assert.equal(await (await worker.dispatch('fetch', { request })).response!.text(), 'synthetic ./assets/index-synthetic.js');
        const before = worker.requests.length;
        const api = await worker.dispatch('fetch', { request: { ...request, url: 'https://api.github.com/repos/synthetic/private' } });
        const otherApp = await worker.dispatch('fetch', { request: { ...request, url: 'https://example.invalid/Other/app.js' } });
        assert.equal(api.response, undefined);
        assert.equal(otherApp.response, undefined);
        assert.equal(worker.requests.length, before);
    } finally {
        fx.cleanup();
    }
});

test('production HTML allows zoom, uses local scripts and restricts executable content', () => {
    const distHtmlPath = path.join(repositoryRoot, 'dist', 'index.html');
    const html = fs.readFileSync(fs.existsSync(distHtmlPath) ? distHtmlPath : path.join(repositoryRoot, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1|id="app" aria-live/);
    assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /style-src 'self'/);
    assert.match(html, /connect-src 'self' https:\/\/api\.github\.com/);
    assert.match(html, /object-src 'none'/);
    if (fs.existsSync(path.join(repositoryRoot, 'dist', 'sw.js'))) {
        const discovered = discoverShellPaths(path.join(repositoryRoot, 'dist'));
        assert.ok(discovered.includes('./index.html'));
        assert.ok(discovered.some((p: string) => p.startsWith('./assets/') && p.endsWith('.js')));
        assert.ok(discovered.some((p: string) => p.startsWith('./assets/') && p.endsWith('.css')));
    }
});
