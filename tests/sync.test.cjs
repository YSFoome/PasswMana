const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const sourcePath = path.join(__dirname, '..', 'app.js');
const clone = (value) => JSON.parse(JSON.stringify(value));
const timestamp = '2026-10-08T00:00:00.000Z';
const deviceSync = { owner: 'test-owner', repo: 'test-private-vault', branch: 'main', path: 'fixtures/test.vault', token: 'fake-test-token' };

function entry(id, changes = {}) {
    return { id, title: `Test ${id}`, username: `test-${id}`, password: 'synthetic-test-password', category: '个人', url: '', notes: '', favorite: false, createdAt: timestamp, updatedAt: timestamp, ...changes };
}

function vault(changes = {}) {
    return { entries: [], trash: [], categories: ['工作', '个人', '金融'], preferences: { lockMinutes: 5 }, sync: { ...deviceSync }, ...changes };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    return { promise, resolve, reject };
}

function response(status, result, headers = {}) {
    return { status, ok: status >= 200 && status < 300, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, json: async () => result };
}

function scriptWithModuleMocks(source) {
    // Keep each zero-build module in its own scope while making imported bindings
    // replaceable for network, storage, and encryption race fixtures.
    return source.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"](.\/[^'"]+)['"];?/g, (_statement, bindings, relativePath) => {
        const modulePath = path.resolve(path.dirname(sourcePath), relativePath);
        const moduleSource = fs.readFileSync(modulePath, 'utf8');
        const exportedNames = [...moduleSource.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)].map((match) => match[1]);
        const body = moduleSource.replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/g, '');
        return `let { ${bindings} } = (() => { ${body}\nreturn { ${exportedNames.join(', ')} }; })();`;
    });
}

function loadApp(fetchHandler = async () => response(404, {}), { repositoryResult = { private: true } } = {}) {
    const saved = [];
    const notices = [];
    const confirmations = [];
    const requests = [];
    const timers = new Map();
    let timerId = 0;
    const appElement = { addEventListener() {}, append() {}, querySelector() { return null; }, querySelectorAll() { return []; }, innerHTML: '', textContent: '' };
    const context = vm.createContext({
        crypto: webcrypto,
        TextEncoder,
        TextDecoder,
        Uint8Array,
        AbortController,
        DOMException,
        URL,
        btoa,
        atob,
        console,
        queueMicrotask,
        structuredClone,
        document: {
            getElementById: () => appElement, addEventListener() {}, querySelector() { return null; },
            createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, querySelector() { return null; }, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }),
            documentElement: { dataset: {} }, visibilityState: 'visible', hidden: false,
        },
        window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
        navigator: { onLine: true },
        localStorage: { getItem() { return null; }, setItem() {} },
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        confirm(message) { confirmations.push(message); return true; },
        alert() {},
        prompt() { return null; },
        setTimeout(callback, delay = 0) {
            const id = ++timerId;
            timers.set(id, { callback, delay });
            if (delay <= 1000) queueMicrotask(() => { if (timers.delete(id)) callback(); });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        setInterval(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearInterval(id) { timers.delete(id); },
        async fetch(url, options = {}) {
            const request = { url: String(url), ...options, body: options.body ? JSON.parse(options.body) : undefined };
            requests.push(request);
            if (request.method === 'GET' && !request.url.includes('/contents/')) return response(200, repositoryResult);
            return fetchHandler(request);
        },
        __save(record) { saved.push(clone(record)); },
        __notice(message) { notices.push(message); },
    });
    const source = scriptWithModuleMocks(fs.readFileSync(sourcePath, 'utf8').replace(/bootstrap\(\)\.catch\([\s\S]*?\);\s*$/, ''));
    vm.runInContext(`${source}\nrender = () => {};\ntoast = __notice;\ndbPut = async (record) => __save(record);\nglobalThis.testApi = { state, mergeVaults, mergeVaultChanges, collectVaultConflicts, resolveSyncConflicts, keyMetadata, encryptText, decryptText: (value, key) => decryptText(JSON.parse(JSON.stringify(value)), key), persistVault, synchronize, pushRemote, pullRemote, lockVault, defaultVault, remoteRequest };`, context, { filename: sourcePath });
    return { api: context.testApi, context, saved, notices, confirmations, requests, timers };
}

async function initialize(app, local, base = local, { bound = true, dirty = true } = {}) {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const rawKey = btoa(String.fromCharCode(...new Uint8Array(await webcrypto.subtle.exportKey('raw', key))));
    app.api.state.vaultKey = key;
    app.api.state.rawVaultKey = rawKey;
    app.api.state.vault = clone(local);
    app.api.state.record = {
        format: 'passwmana-v1', createdAt: timestamp, updatedAt: timestamp,
        ...passwordMetadata(2),
        encryptedVault: await app.api.encryptText(JSON.stringify(local), key),
        remoteSha: bound ? 'sha-base' : null,
        syncBase: bound ? await app.api.encryptText(JSON.stringify(base), key) : null,
        syncKeyBase: bound ? passwordMetadata(2) : null,
        dirty,
    };
    return key;
}

async function remoteFile(app, remoteVault, sha = 'sha-remote', key = app.api.state.vaultKey) {
    const payload = {
        format: 'passwmana-v1', createdAt: timestamp, updatedAt: timestamp,
        ...clone(app.api.keyMetadata(app.api.state.record)),
        encryptedVault: await app.api.encryptText(JSON.stringify(remoteVault), key),
    };
    return { sha, content: btoa(JSON.stringify(payload)), payload };
}

function contentsRequests(app) {
    return app.requests.filter((request) => request.url.includes('/contents/'));
}

async function pushedVault(app, request) {
    const payload = JSON.parse(atob(request.body.content));
    return JSON.parse(await app.api.decryptText(payload.encryptedVault, app.api.state.vaultKey));
}

test('three-way merge preserves independent edits, new entries, and permanent deletions', () => {
    const app = loadApp();
    const base = vault({ entries: [entry('a'), entry('b'), entry('deleted')] });
    const local = vault({ entries: [entry('a', { password: 'synthetic-local-update' }), entry('b'), entry('local-add')] });
    const remote = vault({ entries: [entry('a'), entry('b', { notes: 'remote update' }), entry('deleted'), entry('remote-add')] });
    const merged = clone(app.api.mergeVaults(base, local, remote));
    const records = new Map(merged.entries.map((item) => [item.id, item]));
    assert.deepEqual([...records.keys()].sort(), ['a', 'b', 'local-add', 'remote-add']);
    assert.equal(records.get('a').password, 'synthetic-local-update');
    assert.equal(records.get('b').notes, 'remote update');
    assert.equal(local.entries.length, 3);
    assert.equal(remote.entries.length, 4);
});

test('same-entry divergent edits fail instead of silently selecting a timestamp winner', () => {
    const app = loadApp();
    const base = vault({ entries: [entry('a')] });
    const local = vault({ entries: [entry('a', { password: 'synthetic-local-update', updatedAt: '2026-10-08T02:00:00Z' })] });
    const remote = vault({ entries: [entry('a', { notes: 'remote update', updatedAt: '2026-10-08T03:00:00Z' })] });
    assert.throws(() => app.api.mergeVaults(base, local, remote), (error) => error.code === 'conflict');
});

test('timestamp-only edits do not conflict with a content edit', () => {
    const app = loadApp();
    const base = vault({ entries: [entry('a')] });
    const local = vault({ entries: [entry('a', { updatedAt: '2026-10-08T02:00:00Z' })] });
    const remote = vault({ entries: [entry('a', { notes: 'remote update', updatedAt: '2026-10-08T03:00:00Z' })] });
    const merged = clone(app.api.mergeVaults(base, local, remote));
    assert.equal(merged.entries[0].notes, 'remote update');
    assert.equal(merged.entries[0].updatedAt, remote.entries[0].updatedAt);
});

test('trash moves and restorations merge as a single record per id', () => {
    const app = loadApp();
    const base = vault({ entries: [entry('deleted')], trash: [entry('restored', { deletedAt: timestamp })] });
    const local = vault({ entries: [], trash: [entry('restored', { deletedAt: timestamp }), entry('deleted', { deletedAt: timestamp })] });
    const remote = vault({ entries: [entry('deleted'), entry('restored')], trash: [] });
    const merged = clone(app.api.mergeVaults(base, local, remote));
    assert.deepEqual(merged.entries.map((item) => item.id), ['restored']);
    assert.deepEqual(merged.trash.map((item) => item.id), ['deleted']);
});

test('an edit racing a deletion is a conflict', () => {
    const app = loadApp();
    const base = vault({ entries: [entry('a')] });
    const local = vault({ entries: [], trash: [entry('a', { deletedAt: timestamp })] });
    const remote = vault({ entries: [entry('a', { notes: 'remote update' })] });
    assert.throws(() => app.api.mergeVaults(base, local, remote), (error) => error.code === 'conflict');
});

test('category membership and independent preference fields merge; credentials stay device-local', () => {
    const app = loadApp();
    const base = vault({ categories: ['个人', 'removed'], preferences: { lockMinutes: 5, compact: false } });
    const local = vault({ categories: ['个人', 'local-added'], preferences: { lockMinutes: 15, compact: false } });
    const remote = vault({ categories: ['个人', 'removed', 'remote-added'], preferences: { lockMinutes: 5, compact: true }, sync: { owner: 'other-owner', token: 'different-fake-token' } });
    const merged = clone(app.api.mergeVaults(base, local, remote));
    assert.deepEqual(merged.categories.sort(), ['local-added', 'remote-added', '个人'].sort());
    assert.deepEqual(merged.preferences, { lockMinutes: 15, compact: true });
    assert.deepEqual(merged.sync, deviceSync);
    assert.throws(() => app.api.mergeVaults(base, local, { ...remote, preferences: { lockMinutes: 30, compact: true } }), (error) => error.code === 'conflict');
});

test('synchronize merges before PUT and records only the accepted encrypted baseline', async () => {
    let remote;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a'), entry('b')] });
    const local = vault({ entries: [entry('a', { notes: 'local edit' }), entry('b')] });
    await initialize(app, local, base);
    remote = await remoteFile(app, vault({ entries: [entry('a'), entry('b', { notes: 'remote edit' })] }));
    await app.api.synchronize();
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put, 'the independent changes should be uploaded');
    assert.equal(put.body.sha, 'sha-remote');
    const uploaded = await pushedVault(app, put);
    assert.equal(uploaded.entries.find((item) => item.id === 'a').notes, 'local edit');
    assert.equal(uploaded.entries.find((item) => item.id === 'b').notes, 'remote edit');
    const uploadedRecordText = atob(put.body.content);
    const uploadedRecord = JSON.parse(uploadedRecordText);
    assert.ok(!uploadedRecordText.includes(deviceSync.token), 'the token must remain encrypted in the transmitted record');
    assert.ok(!uploadedRecordText.includes('synthetic-test-password'), 'entry passwords must remain encrypted in the transmitted record');
    for (const field of ['remoteSha', 'syncBase', 'dirty', 'lastSyncedAt']) assert.ok(!Object.hasOwn(uploadedRecord, field));
    assert.deepEqual(clone(app.api.state.vault.sync), deviceSync);
    assert.equal(app.api.state.record.remoteSha, 'sha-accepted');
    assert.equal(app.api.state.record.dirty, false);
    assert.ok(app.api.state.record.syncBase?.data);
    assert.ok(app.api.state.record.lastSyncedAt);
});

test('a GitHub CAS rejection retries with a fresh GET and preserves new remote changes', async () => {
    let firstRemote;
    let secondRemote;
    let getCount = 0;
    let putCount = 0;
    const app = loadApp(async (request) => {
        if (request.method === 'GET') return response(200, ++getCount === 1 ? firstRemote : secondRemote);
        putCount += 1;
        return putCount === 1 ? response(409, { message: 'sha mismatch' }) : response(200, { content: { sha: 'sha-accepted' } });
    });
    const base = vault({ entries: [entry('base')] });
    await initialize(app, vault({ entries: [entry('base'), entry('local')] }), base);
    firstRemote = await remoteFile(app, base, 'sha-first');
    secondRemote = await remoteFile(app, vault({ entries: [entry('base'), entry('remote')] }), 'sha-second');
    await app.api.synchronize();
    assert.deepEqual(contentsRequests(app).map((request) => request.method), ['GET', 'PUT', 'GET', 'PUT']);
    const puts = contentsRequests(app).filter((request) => request.method === 'PUT');
    assert.equal(puts[1].body.sha, 'sha-second');
    assert.deepEqual((await pushedVault(app, puts[1])).entries.map((item) => item.id).sort(), ['base', 'local', 'remote']);
    assert.equal(app.api.state.record.dirty, false);
});

test('an unbound initial push refuses to overwrite an existing encrypted remote', async () => {
    let remote;
    const app = loadApp(async () => response(200, remote));
    await initialize(app, vault({ entries: [entry('local')] }), undefined, { bound: false });
    remote = await remoteFile(app, vault({ entries: [entry('remote')] }));
    await app.api.pushRemote();
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.api.state.record.remoteSha, null);
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.vault.entries[0].id, 'local');
});

test('an unbound initial push can create a missing remote after confirmation', async () => {
    const app = loadApp(async (request) => request.method === 'GET' ? response(404, {}) : response(201, { content: { sha: 'sha-created' } }));
    await initialize(app, vault({ entries: [entry('local')] }), undefined, { bound: false });
    await app.api.pushRemote();
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put);
    assert.ok(!Object.hasOwn(put.body, 'sha'));
    assert.ok(app.confirmations.length > 0);
    assert.equal(app.api.state.record.remoteSha, 'sha-created');
    assert.equal(app.api.state.record.dirty, false);
});

test('a divergent same-entry automatic sync leaves local data dirty and performs no PUT', async () => {
    let remote;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local edit' })] }), base);
    remote = await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote edit' })] }));
    await app.api.synchronize({ automatic: true });
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.api.state.vault.entries[0].notes, 'local edit');
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.syncLastError?.code, 'conflict');
    assert.equal(app.api.state.syncBlocked, true);
    assert.equal(app.api.state.modal, null);
});

test('a local edit while PUT is pending remains in memory and dirty after the upload succeeds', async () => {
    let remote;
    const putStarted = deferred();
    const putFinished = deferred();
    const app = loadApp(async (request) => {
        if (request.method === 'GET') return response(200, remote);
        putStarted.resolve(request);
        return putFinished.promise;
    });
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'first edit' })] }), base);
    remote = await remoteFile(app, base, 'sha-base');
    const syncing = app.api.synchronize();
    await putStarted.promise;
    app.api.state.vault.entries[0].notes = 'edit made during request';
    await app.api.persistVault();
    putFinished.resolve(response(200, { content: { sha: 'sha-accepted' } }));
    await syncing;
    assert.equal(app.api.state.vault.entries[0].notes, 'edit made during request');
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.record.remoteSha, 'sha-accepted');
    const accepted = JSON.parse(await app.api.decryptText(app.api.state.record.syncBase, app.api.state.vaultKey));
    assert.equal(accepted.entries[0].notes, 'first edit');
    const saved = JSON.parse(await app.api.decryptText(app.saved.at(-1).encryptedVault, app.api.state.vaultKey));
    assert.equal(saved.entries[0].notes, 'edit made during request');
});

test('a local edit during remote decryption is included in the merged upload', async () => {
    let remote;
    const decryptStarted = deferred();
    const decryptFinished = deferred();
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, vault({ entries: [entry('a'), entry('remote')] }));
    app.context.__delayedRemoteData = remote.payload.encryptedVault.data;
    app.context.__decryptGate = () => { decryptStarted.resolve(); return decryptFinished.promise; };
    vm.runInContext('const originalTestDecrypt = decryptText; decryptText = async (value, key) => { if (value.data === __delayedRemoteData) await __decryptGate(); return originalTestDecrypt(value, key); };', app.context);
    const syncing = app.api.synchronize();
    await decryptStarted.promise;
    app.api.state.vault.entries[0].notes = 'edit during decryption';
    await app.api.persistVault();
    decryptFinished.resolve();
    await syncing;
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put, 'the edit made during decryption must still be uploaded');
    const uploaded = await pushedVault(app, put);
    assert.equal(uploaded.entries.find((item) => item.id === 'a').notes, 'edit during decryption');
    assert.ok(uploaded.entries.some((item) => item.id === 'remote'));
    assert.equal(app.api.state.vault.entries.find((item) => item.id === 'a').notes, 'edit during decryption');
});

test('overlapping local saves keep the latest plaintext snapshot in encrypted storage', async () => {
    const app = loadApp();
    await initialize(app, vault({ entries: [entry('a')] }));
    const firstEncryptionStarted = deferred();
    const firstEncryptionFinished = deferred();
    app.context.__encryptionGate = () => { firstEncryptionStarted.resolve(); return firstEncryptionFinished.promise; };
    vm.runInContext('const originalTestEncrypt = encryptText; let firstTestEncryption = true; encryptText = async (value, key) => { if (firstTestEncryption) { firstTestEncryption = false; await __encryptionGate(); } return originalTestEncrypt(value, key); };', app.context);
    app.api.state.vault.entries[0].notes = 'first saved edit';
    const firstSave = app.api.persistVault();
    await firstEncryptionStarted.promise;
    app.api.state.vault.entries[0].notes = 'latest saved edit';
    const secondSave = app.api.persistVault();
    firstEncryptionFinished.resolve();
    await Promise.all([firstSave, secondSave]);
    const stored = JSON.parse(await app.api.decryptText(app.saved.at(-1).encryptedVault, app.api.state.vaultKey));
    assert.equal(stored.entries[0].notes, 'latest saved edit');
    assert.equal(app.api.state.record.dirty, true);
});

test('locking aborts an in-flight request and prevents a later response from restoring the unlocked vault', async () => {
    let remote;
    const getStarted = deferred();
    const getFinished = deferred();
    const app = loadApp(async (request) => { getStarted.resolve(request); return getFinished.promise; });
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, vault({ entries: [entry('a'), entry('remote')] }));
    const syncing = app.api.synchronize({ automatic: true });
    const request = await getStarted.promise;
    app.api.lockVault();
    assert.equal(request.signal.aborted, true);
    getFinished.resolve(response(200, remote));
    await syncing;
    assert.equal(app.api.state.vault, null);
    assert.equal(app.api.state.vaultKey, null);
    assert.equal(app.api.state.record.remoteSha, 'sha-base');
    assert.equal(contentsRequests(app).filter((item) => item.method === 'PUT').length, 0);
});

test('offline automatic sync does not issue requests or discard unsynced local edits', async () => {
    const app = loadApp();
    await initialize(app, vault({ entries: [entry('a', { notes: 'offline edit' })] }));
    app.context.navigator.onLine = false;
    await app.api.synchronize({ automatic: true });
    assert.equal(app.requests.length, 0);
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.vault.entries[0].notes, 'offline edit');
    assert.equal(app.api.state.modal, null);
});

test('automatic sync never imports a remote protected by a different vault key', async () => {
    let remote;
    const app = loadApp(async () => response(200, remote));
    const originalKey = await initialize(app, vault({ entries: [entry('local')] }), undefined, { dirty: false });
    const differentKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    remote = await remoteFile(app, vault({ entries: [entry('remote')] }), 'sha-different', differentKey);
    await app.api.synchronize({ automatic: true });
    assert.equal(app.api.state.vaultKey, originalKey);
    assert.equal(app.api.state.vault.entries[0].id, 'local');
    assert.equal(app.api.state.record.remoteSha, 'sha-base');
    assert.equal(app.api.state.pendingRemote, null);
    assert.equal(app.api.state.modal, null);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
});

test('manual remote replacement requests confirmation and unlocks a different-key remote explicitly', async () => {
    let remote;
    const app = loadApp(async () => response(200, remote));
    const originalKey = await initialize(app, vault({ entries: [entry('local')] }), undefined, { bound: false });
    const differentKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    remote = await remoteFile(app, vault({ entries: [entry('remote')] }), 'sha-import', differentKey);
    await app.api.pullRemote();
    assert.ok(app.confirmations.length > 0);
    assert.equal(app.api.state.vaultKey, originalKey);
    assert.equal(app.api.state.vault.entries[0].id, 'local');
    assert.equal(app.api.state.modal?.type, 'remote-unlock');
    assert.ok(app.api.state.pendingRemote);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
});

test('a migrated local record without a baseline refuses an unknown remote revision', async () => {
    let remote;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local edit' })] }), base);
    delete app.api.state.record.syncBase;
    remote = await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote edit' })] }), 'sha-unknown');
    await app.api.synchronize();
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.vault.entries[0].notes, 'local edit');
});

test('temporary GitHub failures are retried and success clears the previous error', async () => {
    let remote;
    let attempts = 0;
    const app = loadApp(async (request) => {
        if (request.method === 'GET') {
            attempts += 1;
            return attempts < 3 ? response(503, { message: 'temporary test outage' }) : response(200, remote);
        }
        return response(200, { content: { sha: 'sha-accepted' } });
    });
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local edit' })] }), base);
    remote = await remoteFile(app, base, 'sha-base');
    await app.api.synchronize();
    assert.equal(attempts, 3);
    assert.equal(app.api.state.record.dirty, false);
    assert.equal(app.api.state.syncLastError, null);
});

test('a public repository is rejected before fetching or uploading the encrypted file', async () => {
    const app = loadApp(async () => response(404, {}), { repositoryResult: { private: false } });
    await initialize(app, vault({ entries: [entry('a')] }));
    await app.api.synchronize();
    assert.equal(contentsRequests(app).length, 0);
    assert.equal(app.api.state.syncLastError?.code, 'repository');
    assert.equal(app.api.state.syncBlocked, true);
    assert.equal(app.api.state.record.dirty, true);
});

test('a missing bound remote is not silently recreated', async () => {
    const app = loadApp(async () => response(404, {}));
    await initialize(app, vault({ entries: [entry('a')] }));
    await app.api.synchronize();
    assert.deepEqual(contentsRequests(app).map((request) => request.method), ['GET']);
    assert.equal(app.api.state.syncLastError?.code, 'missing');
    assert.equal(app.api.state.record.remoteSha, 'sha-base');
    assert.equal(app.api.state.record.dirty, true);
});

test('malformed remote entries are rejected before replacing or uploading local data', async () => {
    let remote;
    const app = loadApp(async () => response(200, remote));
    await initialize(app, vault({ entries: [entry('local')] }));
    remote = await remoteFile(app, vault({ entries: [entry('duplicate'), entry('duplicate')] }));
    await app.api.synchronize();
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.api.state.syncLastError?.code, 'format');
    assert.equal(app.api.state.vault.entries[0].id, 'local');
    assert.equal(app.api.state.record.dirty, true);
});

test('authentication failures stop retrying and retain the local encrypted vault', async () => {
    const app = loadApp(async () => response(401, { message: 'test token rejected' }));
    await initialize(app, vault({ entries: [entry('a')] }));
    await app.api.synchronize({ automatic: true });
    assert.equal(contentsRequests(app).length, 1);
    assert.equal(app.api.state.syncLastError?.status, 401);
    assert.equal(app.api.state.syncBlocked, true);
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.modal, null);
});

test('request timeout aborts fetch and reports a retryable 408 error', async () => {
    const requestStarted = deferred();
    const app = loadApp((request) => {
        requestStarted.resolve(request);
        return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('test request aborted', 'AbortError')), { once: true }));
    });
    const pending = app.api.remoteRequest('GET', deviceSync);
    const request = await requestStarted.promise;
    const timeout = [...app.timers.values()].find((timer) => timer.delay > 1000);
    assert.ok(timeout, 'each network request should install a timeout');
    timeout.callback();
    await assert.rejects(pending, (error) => error.status === 408);
    assert.equal(request.signal.aborted, true);
    assert.equal(app.timers.size, 0);
});

test('a failed encryption preserves unsaved edits and prevents uploading an older encrypted snapshot', async () => {
    const app = loadApp();
    await initialize(app, vault({ entries: [entry('a')] }), undefined, { dirty: false });
    const storedCiphertext = clone(app.api.state.record.encryptedVault);
    app.api.state.vault.entries[0].notes = 'edit that failed to encrypt';
    vm.runInContext('encryptText = async () => { throw new Error("synthetic encryption failure"); };', app.context);
    await assert.rejects(app.api.persistVault(), /synthetic encryption failure/);
    assert.match(app.api.state.localSaveError?.message, /synthetic encryption failure/);
    assert.deepEqual(clone(app.api.state.record.encryptedVault), storedCiphertext);
    await app.api.synchronize();
    assert.equal(app.requests.length, 0);
    assert.equal(app.api.state.syncLastError?.code, 'storage');
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.vault.entries[0].notes, 'edit that failed to encrypt');
});

test('a failed encrypted storage write blocks sync until a later local save succeeds', async () => {
    let remote;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, base, 'sha-base');
    const save = app.context.__save;
    app.context.__save = () => { throw new Error('synthetic storage quota failure'); };
    app.api.state.vault.entries[0].notes = 'edit that initially failed to store';
    await assert.rejects(app.api.persistVault(), /synthetic storage quota failure/);
    assert.match(app.api.state.localSaveError?.message, /synthetic storage quota failure/);
    await app.api.synchronize();
    assert.equal(app.requests.length, 0);
    assert.equal(app.api.state.record.dirty, true);
    app.context.__save = save;
    await app.api.persistVault();
    assert.equal(app.api.state.localSaveError, null);
    await app.api.synchronize();
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put, 'sync should resume after successful encrypted local storage');
    assert.equal((await pushedVault(app, put)).entries[0].notes, 'edit that initially failed to store');
    assert.equal(app.api.state.record.dirty, false);
});

test('a local save failure while GET is pending prevents uploading the previous encrypted snapshot', async () => {
    let remote;
    const getStarted = deferred();
    const getFinished = deferred();
    const app = loadApp(async (request) => {
        if (request.method === 'GET') { getStarted.resolve(); return getFinished.promise; }
        return response(200, { content: { sha: 'sha-stale-upload' } });
    });
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, base, 'sha-base');
    const syncing = app.api.synchronize();
    await getStarted.promise;
    app.api.state.vault.entries[0].notes = 'unsaved edit during fetch';
    vm.runInContext('encryptText = async () => { throw new Error("synthetic encryption failure"); };', app.context);
    await assert.rejects(app.api.persistVault(), /synthetic encryption failure/);
    getFinished.resolve(response(200, remote));
    await syncing;
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.api.state.syncLastError?.code, 'storage');
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.vault.entries[0].notes, 'unsaved edit during fetch');
});

test('an unchanged clean remote establishes the encrypted baseline without PUT', async () => {
    let remote;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    delete app.api.state.record.syncBase;
    remote = await remoteFile(app, base, 'sha-base');
    await app.api.synchronize();
    assert.deepEqual(contentsRequests(app).map((request) => request.method), ['GET']);
    assert.deepEqual(clone(app.api.state.record.syncBase), clone(remote.payload.encryptedVault));
    assert.equal(app.api.state.record.dirty, false);
    assert.equal(app.api.state.record.remoteSha, 'sha-base');
    assert.ok(app.api.state.record.lastSyncedAt);
});

test('GitHub Retry-After pauses automatic sync instead of immediately repeating requests', async () => {
    const app = loadApp(async () => response(429, { message: 'synthetic rate limit' }, { 'retry-after': '120' }));
    await initialize(app, vault({ entries: [entry('a')] }));
    const startedAt = Date.now();
    await app.api.synchronize({ automatic: true });
    assert.equal(contentsRequests(app).length, 1);
    assert.equal(app.api.state.syncLastError?.status, 429);
    assert.equal(app.api.state.syncBlocked, false);
    assert.ok(app.api.state.syncRetryAt >= startedAt + 120000);
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.modal, null);
    await app.api.synchronize({ automatic: true });
    assert.equal(contentsRequests(app).length, 1);
    assert.ok([...app.timers.values()].some((timer) => timer.delay >= 119000));
});

test('a remote vault with missing or array preferences is rejected', async (t) => {
    for (const preferences of [undefined, []]) {
        await t.test(preferences === undefined ? 'missing preferences' : 'array preferences', async () => {
            let remote;
            const app = loadApp(async () => response(200, remote));
            await initialize(app, vault({ entries: [entry('local')] }));
            remote = await remoteFile(app, vault({ entries: [entry('remote')], preferences }));
            await app.api.synchronize();
            assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
            assert.equal(app.api.state.syncLastError?.code, 'format');
            assert.equal(app.api.state.vault.entries[0].id, 'local');
            assert.equal(app.api.state.record.dirty, true);
        });
    }
});

test('automatic remote polling preserves the last user activity and remaining lock timeout', async () => {
    let remote;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')], preferences: { lockMinutes: 1 } });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, { ...base, entries: [entry('a'), entry('remote')] });
    const lastUserActivity = Date.now() - 30000;
    app.api.state.lastActivityAt = lastUserActivity;
    await app.api.synchronize({ automatic: true });
    assert.equal(app.api.state.lastActivityAt, lastUserActivity);
    const lockTimer = app.timers.get(app.api.state.timer);
    assert.ok(lockTimer, 'remote preference changes should rearm the existing auto-lock deadline');
    assert.ok(lockTimer.delay <= 30000 && lockTimer.delay > 25000);
    lockTimer.callback();
    assert.equal(app.api.state.vault, null);
    assert.equal(app.api.state.vaultKey, null);
});

function passwordMetadata(marker) {
    const encoded = (size, offset = 0) => btoa(String.fromCharCode(...new Uint8Array(size).fill(marker + offset)));
    return {
        masterSalt: encoded(16), recoverySalt: encoded(16, 1),
        wrappedVaultKey: { iv: encoded(12), data: encoded(60) },
        recoveryWrappedVaultKey: { iv: encoded(12, 1), data: encoded(60, 1) },
    };
}

function changeRemoteMetadata(file, metadata) {
    Object.assign(file.payload, clone(metadata));
    file.content = btoa(JSON.stringify(file.payload));
    return file;
}

test('field merge retains independent changes to the same entry without exposing sync credentials', () => {
    const app = loadApp();
    const base = vault({ entries: [entry('a')] });
    const local = vault({ entries: [entry('a', { password: 'synthetic-local-password' })] });
    const remote = vault({ entries: [entry('a', { notes: 'independent remote note' })] });
    const result = clone(app.api.mergeVaultChanges(base, local, remote));
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.vault.entries[0].password, 'synthetic-local-password');
    assert.equal(result.vault.entries[0].notes, 'independent remote note');
    remote.entries[0].password = 'synthetic-remote-password';
    const conflicts = clone(app.api.collectVaultConflicts(base, local, remote));
    assert.deepEqual(conflicts.map((item) => item.field), ['password']);
    assert.ok(!JSON.stringify(conflicts).includes(deviceSync.token));
    const resolved = clone(app.api.mergeVaultChanges(base, local, remote, { choices: { [conflicts[0].id]: 'remote' } }));
    assert.equal(resolved.conflicts.length, 0);
    assert.equal(resolved.vault.entries[0].password, 'synthetic-remote-password');
    assert.equal(resolved.vault.entries[0].notes, 'independent remote note');
});

test('an entry upload adopts a remote password change instead of rolling it back', async () => {
    let remote;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'ordinary local edit' })] }), base);
    const oldMetadata = passwordMetadata(20);
    const newMetadata = passwordMetadata(30);
    Object.assign(app.api.state.record, clone(oldMetadata), { syncKeyBase: clone(oldMetadata) });
    remote = changeRemoteMetadata(await remoteFile(app, base), newMetadata);
    await app.api.synchronize();
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put);
    const uploaded = JSON.parse(atob(put.body.content));
    assert.deepEqual(clone(app.api.keyMetadata(uploaded)), newMetadata);
    assert.deepEqual(clone(app.api.keyMetadata(app.api.state.record)), newMetadata);
    assert.equal((await pushedVault(app, put)).entries[0].notes, 'ordinary local edit');
    assert.ok(!Object.hasOwn(uploaded, 'syncKeyBase'));
});

test('a local password change survives an unrelated remote entry update', async () => {
    let remote;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base);
    const oldMetadata = passwordMetadata(40);
    const newMetadata = passwordMetadata(50);
    Object.assign(app.api.state.record, clone(newMetadata), { syncKeyBase: clone(oldMetadata) });
    remote = changeRemoteMetadata(await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote edit' })] })), oldMetadata);
    await app.api.synchronize();
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put);
    assert.deepEqual(clone(app.api.keyMetadata(JSON.parse(atob(put.body.content)))), newMetadata);
    assert.equal((await pushedVault(app, put)).entries[0].notes, 'remote edit');
});

test('a clean device adopts remote password wrappers before its next unlock', async () => {
    let remote;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    const oldMetadata = passwordMetadata(60);
    const newMetadata = passwordMetadata(70);
    Object.assign(app.api.state.record, clone(oldMetadata), { syncKeyBase: clone(oldMetadata) });
    remote = changeRemoteMetadata(await remoteFile(app, base), newMetadata);
    await app.api.synchronize({ automatic: true });
    assert.deepEqual(clone(app.api.keyMetadata(app.api.state.record)), newMetadata);
    assert.deepEqual(clone(app.api.state.record.syncKeyBase), newMetadata);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
});

test('simultaneous password changes stop uploads until the user chooses one complete wrapping version', async () => {
    let remote;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-resolved' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base);
    const oldMetadata = passwordMetadata(80);
    const localMetadata = passwordMetadata(90);
    const remoteMetadata = passwordMetadata(100);
    Object.assign(app.api.state.record, clone(localMetadata), { syncKeyBase: clone(oldMetadata) });
    remote = changeRemoteMetadata(await remoteFile(app, base), remoteMetadata);
    await app.api.synchronize({ automatic: true });
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.api.state.syncLastError?.code, 'conflict');
    assert.equal(app.api.state.syncConflict?.conflicts[0].kind, 'master-password');
    assert.ok(!JSON.stringify(app.api.state.syncConflict).includes(deviceSync.token));
    assert.deepEqual(clone(app.api.keyMetadata(app.api.state.record)), localMetadata);
    await app.api.resolveSyncConflicts({ 'key:master-password': 'remote' });
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put);
    assert.deepEqual(clone(app.api.keyMetadata(JSON.parse(atob(put.body.content)))), remoteMetadata);
    assert.equal(app.api.state.syncConflict, null);
    assert.equal(app.api.state.record.dirty, false);
});

test('an old baseline without password wrappers refuses to overwrite an unknown password version', async () => {
    let remote;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local edit' })] }), base);
    delete app.api.state.record.syncKeyBase;
    remote = changeRemoteMetadata(await remoteFile(app, base), passwordMetadata(110));
    await app.api.synchronize();
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.api.state.syncConflict?.conflicts[0].kind, 'master-password');
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.vault.entries[0].notes, 'local edit');
});

test('conflict selection fresh-reads the remote SHA and preserves other device additions', async () => {
    let remote;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-resolved' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local note' })] }), base);
    remote = await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote note' })] }), 'sha-conflict');
    await app.api.synchronize();
    const choices = Object.fromEntries(app.api.state.syncConflict.conflicts.map((item) => [item.id, 'local']));
    const reads = contentsRequests(app).filter((request) => request.method === 'GET').length;
    remote = await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote note' }), entry('remote-added')] }), 'sha-new-conflict');
    await app.api.resolveSyncConflicts(choices);
    assert.ok(contentsRequests(app).filter((request) => request.method === 'GET').length > reads);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0, 'choices from an older remote version must not overwrite new changes');
    assert.equal(app.api.state.syncConflict.sha, 'sha-new-conflict');
    const newChoices = Object.fromEntries(app.api.state.syncConflict.conflicts.map((item) => [item.id, 'local']));
    await app.api.resolveSyncConflicts(newChoices);
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.equal(put.body.sha, 'sha-new-conflict');
    const uploaded = await pushedVault(app, put);
    assert.equal(uploaded.entries.find((item) => item.id === 'a').notes, 'local note');
    assert.ok(uploaded.entries.some((item) => item.id === 'remote-added'));
});

test('edits made while reviewing a conflict invalidate old choices instead of discarding the edit', async () => {
    let remote;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-resolved' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local note' })] }), base);
    remote = await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote note' })] }));
    await app.api.synchronize();
    const choices = Object.fromEntries(app.api.state.syncConflict.conflicts.map((item) => [item.id, 'remote']));
    app.api.state.vault.entries[0].notes = 'newer local note';
    await app.api.persistVault();
    await app.api.resolveSyncConflicts(choices);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.api.state.vault.entries[0].notes, 'newer local note');
    assert.equal(app.api.state.syncConflict.conflicts[0].local, 'newer local note');
});

test('a failed merge storage write prevents PUT and preserves merged edits for a later save', async () => {
    let remote;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-should-not-upload' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local edit' })] }), base);
    remote = await remoteFile(app, vault({ entries: [entry('a'), entry('remote-added')] }));
    app.context.__save = () => { throw new Error('synthetic merge storage failure'); };
    await app.api.synchronize();
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.api.state.syncLastError?.code, 'storage');
    assert.match(app.api.state.localSaveError?.message, /synthetic merge storage failure/);
    assert.equal(app.api.state.record.dirty, true);
    assert.equal(app.api.state.vault.entries.find((item) => item.id === 'a').notes, 'local edit');
    assert.ok(app.api.state.vault.entries.some((item) => item.id === 'remote-added'));
});

test('an edit during the merge storage write retains the accepted remote password version', async () => {
    let remote;
    const mergeWriteStarted = deferred();
    const mergeWriteFinished = deferred();
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'initial local note' })] }), base);
    const oldMetadata = passwordMetadata(120);
    const remoteMetadata = passwordMetadata(130);
    Object.assign(app.api.state.record, clone(oldMetadata), { syncKeyBase: clone(oldMetadata) });
    remote = changeRemoteMetadata(await remoteFile(app, vault({ entries: [entry('a'), entry('remote-added')] })), remoteMetadata);
    const originalSave = app.context.__save;
    let paused = false;
    app.context.__save = (record) => {
        if (!paused) {
            paused = true;
            mergeWriteStarted.resolve();
            return mergeWriteFinished.promise.then(() => originalSave(record));
        }
        return originalSave(record);
    };
    const syncing = app.api.synchronize();
    await mergeWriteStarted.promise;
    app.api.state.vault.entries.find((item) => item.id === 'a').notes = 'edit during merge storage';
    const saving = app.api.persistVault();
    mergeWriteFinished.resolve();
    await Promise.all([syncing, saving]);
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put);
    const uploadedRecord = JSON.parse(atob(put.body.content));
    assert.deepEqual(clone(app.api.keyMetadata(uploadedRecord)), remoteMetadata);
    const uploadedVault = await pushedVault(app, put);
    assert.equal(uploadedVault.entries.find((item) => item.id === 'a').notes, 'edit during merge storage');
    assert.ok(uploadedVault.entries.some((item) => item.id === 'remote-added'));
    assert.deepEqual(clone(app.api.keyMetadata(app.api.state.record)), remoteMetadata);
});
