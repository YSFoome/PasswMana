import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'vitest';
import * as vaultCore from '../src/core/vault-core';
import { collectVaultConflicts, keyMetadata, mergeVaultChanges, mergeVaults } from '../src/core/sync-core';
import { convertLegacyBackup } from '../src/core/ui-helpers';
import { createVaultStore } from '../src/core/vault-store';
import type { EncryptedRecord, SyncConfig, VaultData, VaultEntry } from '../src/core/types';

if (!globalThis.crypto) {
    (globalThis as any).crypto = webcrypto;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const timestamp = '2026-10-08T00:00:00.000Z';
const deviceSync: SyncConfig = {
    owner: 'test-owner',
    repo: 'test-private-vault',
    branch: 'main',
    path: 'fixtures/test.vault',
    token: 'fake-test-token',
};

function entry(id: string, changes: Partial<VaultEntry> = {}): VaultEntry {
    return {
        id,
        title: `Test ${id}`,
        username: `test-${id}`,
        password: 'synthetic-test-password',
        category: '个人',
        url: '',
        notes: '',
        favorite: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...changes,
    };
}

function vault(changes: Partial<VaultData> = {}): VaultData {
    return {
        entries: [],
        trash: [],
        categories: ['工作', '个人', '金融'],
        preferences: { lockMinutes: 5 },
        sync: { ...deviceSync },
        ...changes,
    };
}

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function response(status: number, result: unknown, headers: Record<string, string> = {}) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        json: async () => result,
    } as unknown as Response;
}

function passwordMetadata(marker: number) {
    const encoded = (size: number, offset = 0) => btoa(String.fromCharCode(...new Uint8Array(size).fill(marker + offset)));
    return {
        masterSalt: encoded(16),
        recoverySalt: encoded(16, 1),
        wrappedVaultKey: { iv: encoded(12), data: encoded(60) },
        recoveryWrappedVaultKey: { iv: encoded(12, 1), data: encoded(60, 1) },
    };
}

function loadApp(
    fetchHandler: (request: any) => Promise<Response> = async () => response(404, {}),
    { repositoryResult = { private: true } }: { repositoryResult?: unknown } = {},
) {
    const saved: EncryptedRecord[] = [];
    const notices: string[] = [];
    const confirmations: string[] = [];
    const requests: any[] = [];
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let timerId = 0;

    const overrides = {
        saveImpl: (record: EncryptedRecord): Promise<void> | void => { saved.push(clone(record)); },
        encryptImpl: vaultCore.encryptText,
        decryptImpl: (value: unknown, key: CryptoKey) => vaultCore.decryptText(JSON.parse(JSON.stringify(value)), key),
    };

    const nav = { onLine: true };
    const store = createVaultStore({
        dbPut: async (record) => { await overrides.saveImpl(record); },
        encryptText: (value, key) => overrides.encryptImpl(value, key),
        decryptText: (value, key) => overrides.decryptImpl(value, key),
        navigator: nav as any,
        document: { visibilityState: 'visible' },
        setTimeout: ((callback: () => void, delay = 0) => {
            const id = ++timerId;
            timers.set(id, { callback, delay });
            if (delay <= 1000) queueMicrotask(() => { if (timers.delete(id)) callback(); });
            return id;
        }) as any,
        clearTimeout: (id: number) => { timers.delete(id); },
        setInterval: ((callback: () => void, delay = 0) => {
            const id = ++timerId;
            timers.set(id, { callback, delay });
            return id;
        }) as any,
        clearInterval: (id: number) => { timers.delete(id); },
        fetch: (async (url: string | URL | Request, options: RequestInit = {}) => {
            const req = { url: String(url), ...options, body: options.body ? JSON.parse(String(options.body)) : undefined };
            requests.push(req);
            if (req.method === 'GET' && !req.url.includes('/contents/') && !req.url.includes('/git/blobs/')) {
                return response(200, repositoryResult);
            }
            return fetchHandler(req);
        }) as typeof fetch,
    });

    store.toast = (message: string) => { notices.push(message); };
    store.askConfirm = async ({ message }: { message?: string }) => {
        confirmations.push(message || '');
        return true;
    };
    store.askPrompt = async () => null;
    store.showMessage = () => {};

    return { store, saved, notices, confirmations, requests, timers, overrides, nav };
}

async function initialize(app: ReturnType<typeof loadApp>, local: VaultData, base: VaultData = local, { bound = true, dirty = true } = {}) {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const rawKey = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw', key))));
    app.store.state.vaultKey = key;
    app.store.state.rawVaultKey = rawKey;
    app.store.state.vault = clone(local);
    app.store.state.record = {
        format: 'passwmana-v1',
        createdAt: timestamp,
        updatedAt: timestamp,
        ...passwordMetadata(2),
        encryptedVault: await app.store.encryptText(JSON.stringify(local), key),
        remoteSha: bound ? 'sha-base' : null,
        remoteEtag: bound ? 'etag-base' : '',
        syncBase: bound ? await app.store.encryptText(JSON.stringify(base), key) : null,
        syncKeyBase: bound ? passwordMetadata(2) : null,
        dirty,
    };
    return key;
}

async function remoteFile(app: ReturnType<typeof loadApp>, remoteVault: unknown, sha = 'sha-remote', key = app.store.state.vaultKey!) {
    const payload = {
        format: 'passwmana-v1' as const,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...clone(keyMetadata(app.store.state.record!)),
        encryptedVault: await app.store.encryptText(JSON.stringify(remoteVault), key),
    };
    return { sha, content: btoa(JSON.stringify(payload)), payload };
}

function contentsRequests(app: ReturnType<typeof loadApp>) {
    return app.requests.filter((request) => request.url.includes('/contents/'));
}

function remoteFileWithEtag(app: ReturnType<typeof loadApp>, remoteVault: unknown, sha = 'sha-remote', key = app.store.state.vaultKey!) {
    return remoteFile(app, remoteVault, sha, key).then((file) => ({
        ...file,
        etag: `etag-${sha}`,
        res: (status = 200) => response(status, { sha: file.sha, content: file.content }, { etag: `etag-${sha}` }),
    }));
}

async function pushedVault(app: ReturnType<typeof loadApp>, request: any) {
    const payload = JSON.parse(atob(request.body.content));
    return JSON.parse(await app.store.decryptText(payload.encryptedVault, app.store.state.vaultKey!));
}

function changeRemoteMetadata(file: Awaited<ReturnType<typeof remoteFile>>, metadata: ReturnType<typeof passwordMetadata>) {
    Object.assign(file.payload, clone(metadata));
    file.content = btoa(JSON.stringify(file.payload));
    return file;
}

test('an unchanged remote answers If-None-Match with 304 and skips download, decrypt and merge', async () => {
    const app = loadApp(async (request) => {
        assert.equal(request.method, 'GET');
        assert.equal(request.headers['If-None-Match'], 'etag-base');
        return response(304, {}, { etag: 'etag-base' });
    });
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    const before = JSON.stringify(app.store.state.vault);
    await app.store.synchronize({ automatic: true });
    assert.equal(JSON.stringify(app.store.state.vault), before);
    assert.equal(app.store.state.record!.remoteEtag, 'etag-base');
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.store.state.record!.dirty, false);
    assert.ok(app.store.state.record!.lastSyncedAt);
});

test('a 304 while local changes are dirty uploads against the known remote SHA', async () => {
    let puts = 0;
    const app = loadApp(async (request) => {
        if (request.method === 'GET') {
            assert.equal(request.headers['If-None-Match'], 'etag-base');
            return response(304, {}, { etag: 'etag-base' });
        }
        puts += 1;
        return response(200, { content: { sha: 'sha-next' } });
    });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local edit' })] }), vault({ entries: [entry('a')] }), { dirty: true });
    await app.store.synchronize();
    assert.equal(puts, 1);
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.equal(put.body.sha, 'sha-base');
    assert.equal(app.store.state.record!.remoteSha, 'sha-next');
    assert.equal(app.store.state.record!.dirty, false);
});

test('a successful contents read stores the response ETag for the next poll', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFileWithEtag>>;
    const app = loadApp(async () => remote.res());
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFileWithEtag(app, vault({ entries: [entry('a'), entry('remote')] }), 'sha-remote');
    await app.store.synchronize({ automatic: true });
    assert.equal(app.store.state.record!.remoteEtag, 'etag-sha-remote');
    assert.deepEqual(clone(app.store.state.vault!.entries.map((item) => item.id).sort()), ['a', 'remote']);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
});

test('a remote file beyond the contents API size limit is read through the blobs endpoint', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    let blobRequest: any;
    const app = loadApp(async (request) => {
        if (request.url.includes('/git/blobs/')) {
            blobRequest = request;
            return response(200, { content: remote.content, encoding: 'base64', size: 2 * 1024 * 1024, sha: remote.sha });
        }
        if (request.method === 'GET') return response(200, { sha: remote.sha, size: 2 * 1024 * 1024, content: '', encoding: 'none' });
        return response(200, { content: { sha: 'sha-accepted' } });
    });
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, vault({ entries: [entry('a'), entry('remote')] }));
    await app.store.synchronize({ automatic: true });
    assert.ok(blobRequest, 'the blob endpoint must supply content omitted by the contents endpoint');
    assert.ok(blobRequest.url.endsWith(`/git/blobs/${remote.sha}`));
    assert.deepEqual(clone(app.store.state.vault!.entries.map((item) => item.id).sort()), ['a', 'remote']);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
});

test('legacy migration does not recreate an ID that is still in the trash', () => {
    const app = loadApp();
    const current = vault({ entries: [entry('kept')], trash: [{ ...entry('deleted'), deletedAt: timestamp }] });
    const converted = convertLegacyBackup({
        entries: [
            { id: 'deleted', siteName: 'Deleted entry', account: 'synthetic@example.invalid', password: 'synthetic-password' },
            { id: 'new', siteName: 'New entry', account: 'synthetic@example.invalid', password: 'synthetic-password' },
        ],
    }, current);
    assert.deepEqual(clone(converted.entries.map((item) => item.id).sort()), ['kept', 'new']);
    assert.equal(converted.skipped, 1);
    assert.doesNotThrow(() => app.store.validateVault({ ...current, entries: converted.entries, categories: converted.categories }));
});

test('persisting a duplicate ID is refused before it can lock the vault out', async () => {
    const app = loadApp();
    await initialize(app, vault({ entries: [entry('a')] }));
    app.store.state.vault!.trash.push({ ...entry('a'), deletedAt: timestamp });
    await assert.rejects(app.store.persistVault(), /重复条目标识/);
    assert.equal(app.saved.length, 0, 'an invalid vault must never reach encrypted storage');
    assert.equal(app.store.state.localSaveError?.code, 'format');
});

test('three-way merge preserves independent edits, new entries, and permanent deletions', () => {
    const base = vault({ entries: [entry('a'), entry('b'), entry('deleted')] });
    const local = vault({ entries: [entry('a', { password: 'synthetic-local-update' }), entry('b'), entry('local-add')] });
    const remote = vault({ entries: [entry('a'), entry('b', { notes: 'remote update' }), entry('deleted'), entry('remote-add')] });
    const merged = clone(mergeVaults(base, local, remote));
    const records = new Map(merged.entries.map((item) => [item.id, item]));
    assert.deepEqual([...records.keys()].sort(), ['a', 'b', 'local-add', 'remote-add']);
    assert.equal(records.get('a')!.password, 'synthetic-local-update');
    assert.equal(records.get('b')!.notes, 'remote update');
    assert.equal(local.entries.length, 3);
    assert.equal(remote.entries.length, 4);
});

test('same-entry divergent edits fail instead of silently selecting a timestamp winner', () => {
    const base = vault({ entries: [entry('a')] });
    const local = vault({ entries: [entry('a', { password: 'synthetic-local-update', updatedAt: '2026-10-08T02:00:00Z' })] });
    const remote = vault({ entries: [entry('a', { notes: 'remote update', updatedAt: '2026-10-08T03:00:00Z' })] });
    assert.throws(() => mergeVaults(base, local, remote), (error: any) => error.code === 'conflict');
});

test('timestamp-only edits do not conflict with a content edit', () => {
    const base = vault({ entries: [entry('a')] });
    const local = vault({ entries: [entry('a', { updatedAt: '2026-10-08T02:00:00Z' })] });
    const remote = vault({ entries: [entry('a', { notes: 'remote update', updatedAt: '2026-10-08T03:00:00Z' })] });
    const merged = clone(mergeVaults(base, local, remote));
    assert.equal(merged.entries[0].notes, 'remote update');
    assert.equal(merged.entries[0].updatedAt, remote.entries[0].updatedAt);
});

test('trash moves and restorations merge as a single record per id', () => {
    const base = vault({ entries: [entry('deleted')], trash: [{ ...entry('restored'), deletedAt: timestamp }] });
    const local = vault({ entries: [], trash: [{ ...entry('restored'), deletedAt: timestamp }, { ...entry('deleted'), deletedAt: timestamp }] });
    const remote = vault({ entries: [entry('deleted'), entry('restored')], trash: [] });
    const merged = clone(mergeVaults(base, local, remote));
    assert.deepEqual(merged.entries.map((item) => item.id), ['restored']);
    assert.deepEqual(merged.trash.map((item) => item.id), ['deleted']);
});

test('an edit racing a deletion is a conflict', () => {
    const base = vault({ entries: [entry('a')] });
    const local = vault({ entries: [], trash: [{ ...entry('a'), deletedAt: timestamp }] });
    const remote = vault({ entries: [entry('a', { notes: 'remote update' })] });
    assert.throws(() => mergeVaults(base, local, remote), (error: any) => error.code === 'conflict');
});

test('category membership and independent preference fields merge; credentials stay device-local', () => {
    const base = vault({ categories: ['个人', 'removed'], preferences: { lockMinutes: 5, compact: false } });
    const local = vault({ categories: ['个人', 'local-added'], preferences: { lockMinutes: 15, compact: false } });
    const remote = vault({
        categories: ['个人', 'removed', 'remote-added'],
        preferences: { lockMinutes: 5, compact: true },
        sync: { owner: 'other-owner', repo: 'r', branch: 'main', path: 'p', token: 'different-fake-token' },
    });
    const merged = clone(mergeVaults(base, local, remote));
    assert.deepEqual(merged.categories.sort(), ['local-added', 'remote-added', '个人'].sort());
    assert.deepEqual(merged.preferences, { lockMinutes: 15, compact: true });
    assert.deepEqual(merged.sync, deviceSync);
    assert.throws(() => mergeVaults(base, local, { ...remote, preferences: { lockMinutes: 30, compact: true } }), (error: any) => error.code === 'conflict');
});

test('synchronize merges before PUT and records only the accepted encrypted baseline', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a'), entry('b')] });
    const local = vault({ entries: [entry('a', { notes: 'local edit' }), entry('b')] });
    await initialize(app, local, base);
    remote = await remoteFile(app, vault({ entries: [entry('a'), entry('b', { notes: 'remote edit' })] }));
    await app.store.synchronize();
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put, 'the independent changes should be uploaded');
    assert.equal(put.body.sha, 'sha-remote');
    const uploaded = await pushedVault(app, put);
    assert.equal(uploaded.entries.find((item: VaultEntry) => item.id === 'a').notes, 'local edit');
    assert.equal(uploaded.entries.find((item: VaultEntry) => item.id === 'b').notes, 'remote edit');
    const uploadedRecordText = atob(put.body.content);
    const uploadedRecord = JSON.parse(uploadedRecordText);
    assert.ok(!uploadedRecordText.includes(deviceSync.token), 'the token must remain encrypted in the transmitted record');
    assert.ok(!uploadedRecordText.includes('synthetic-test-password'), 'entry passwords must remain encrypted in the transmitted record');
    for (const field of ['remoteSha', 'syncBase', 'dirty', 'lastSyncedAt']) assert.ok(!Object.hasOwn(uploadedRecord, field));
    assert.deepEqual(clone(app.store.state.vault!.sync), deviceSync);
    assert.equal(app.store.state.record!.remoteSha, 'sha-accepted');
    assert.equal(app.store.state.record!.dirty, false);
    assert.ok(app.store.state.record!.syncBase?.data);
    assert.ok(app.store.state.record!.lastSyncedAt);
});

test('a GitHub CAS rejection retries with a fresh GET and preserves new remote changes', async () => {
    let firstRemote!: Awaited<ReturnType<typeof remoteFile>>;
    let secondRemote!: Awaited<ReturnType<typeof remoteFile>>;
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
    await app.store.synchronize();
    assert.deepEqual(contentsRequests(app).map((request) => request.method), ['GET', 'PUT', 'GET', 'PUT']);
    const puts = contentsRequests(app).filter((request) => request.method === 'PUT');
    assert.equal(puts[1].body.sha, 'sha-second');
    assert.deepEqual((await pushedVault(app, puts[1])).entries.map((item: VaultEntry) => item.id).sort(), ['base', 'local', 'remote']);
    assert.equal(app.store.state.record!.dirty, false);
});

test('an unbound initial push refuses to overwrite an existing encrypted remote', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async () => response(200, remote));
    await initialize(app, vault({ entries: [entry('local')] }), undefined, { bound: false });
    remote = await remoteFile(app, vault({ entries: [entry('remote')] }));
    await app.store.pushRemote();
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.store.state.record!.remoteSha, null);
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.vault!.entries[0].id, 'local');
});

test('an unbound initial push can create a missing remote after confirmation', async () => {
    const app = loadApp(async (request) => request.method === 'GET' ? response(404, {}) : response(201, { content: { sha: 'sha-created' } }));
    await initialize(app, vault({ entries: [entry('local')] }), undefined, { bound: false });
    await app.store.pushRemote();
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put);
    assert.ok(!Object.hasOwn(put.body, 'sha'));
    assert.ok(app.confirmations.length > 0);
    assert.equal(app.store.state.record!.remoteSha, 'sha-created');
    assert.equal(app.store.state.record!.dirty, false);
});

test('a divergent same-entry automatic sync leaves local data dirty and performs no PUT', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local edit' })] }), base);
    remote = await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote edit' })] }));
    await app.store.synchronize({ automatic: true });
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.store.state.vault!.entries[0].notes, 'local edit');
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.syncLastError?.code, 'conflict');
    assert.equal(app.store.state.syncBlocked, true);
    assert.equal(app.store.state.modal, null);
});

test('a local edit while PUT is pending remains in memory and dirty after the upload succeeds', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const putStarted = deferred<any>();
    const putFinished = deferred<Response>();
    const app = loadApp(async (request) => {
        if (request.method === 'GET') return response(200, remote);
        putStarted.resolve(request);
        return putFinished.promise;
    });
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'first edit' })] }), base);
    remote = await remoteFile(app, base, 'sha-base');
    const syncing = app.store.synchronize();
    await putStarted.promise;
    app.store.state.vault!.entries[0].notes = 'edit made during request';
    await app.store.persistVault();
    putFinished.resolve(response(200, { content: { sha: 'sha-accepted' } }));
    await syncing;
    assert.equal(app.store.state.vault!.entries[0].notes, 'edit made during request');
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.record!.remoteSha, 'sha-accepted');
    const accepted = JSON.parse(await app.store.decryptText(app.store.state.record!.syncBase!, app.store.state.vaultKey!));
    assert.equal(accepted.entries[0].notes, 'first edit');
    const saved = JSON.parse(await app.store.decryptText(app.saved.at(-1)!.encryptedVault, app.store.state.vaultKey!));
    assert.equal(saved.entries[0].notes, 'edit made during request');
});

test('a local edit during remote decryption is included in the merged upload', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const decryptStarted = deferred();
    const decryptFinished = deferred();
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, vault({ entries: [entry('a'), entry('remote')] }));
    const originalDecrypt = app.overrides.decryptImpl;
    app.overrides.decryptImpl = async (value: any, key: CryptoKey) => {
        if (value.data === remote.payload.encryptedVault.data) {
            decryptStarted.resolve();
            await decryptFinished.promise;
        }
        return originalDecrypt(value, key);
    };
    const syncing = app.store.synchronize();
    await decryptStarted.promise;
    app.store.state.vault!.entries[0].notes = 'edit during decryption';
    await app.store.persistVault();
    decryptFinished.resolve();
    await syncing;
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put, 'the edit made during decryption must still be uploaded');
    const uploaded = await pushedVault(app, put);
    assert.equal(uploaded.entries.find((item: VaultEntry) => item.id === 'a').notes, 'edit during decryption');
    assert.ok(uploaded.entries.some((item: VaultEntry) => item.id === 'remote'));
    assert.equal(app.store.state.vault!.entries.find((item) => item.id === 'a')!.notes, 'edit during decryption');
});

test('overlapping local saves keep the latest plaintext snapshot in encrypted storage', async () => {
    const app = loadApp();
    await initialize(app, vault({ entries: [entry('a')] }));
    const firstEncryptionStarted = deferred();
    const firstEncryptionFinished = deferred();
    const originalEncrypt = app.overrides.encryptImpl;
    let firstTestEncryption = true;
    app.overrides.encryptImpl = async (value: string, key: CryptoKey) => {
        if (firstTestEncryption) {
            firstTestEncryption = false;
            firstEncryptionStarted.resolve();
            await firstEncryptionFinished.promise;
        }
        return originalEncrypt(value, key);
    };
    app.store.state.vault!.entries[0].notes = 'first saved edit';
    const firstSave = app.store.persistVault();
    await firstEncryptionStarted.promise;
    app.store.state.vault!.entries[0].notes = 'latest saved edit';
    const secondSave = app.store.persistVault();
    firstEncryptionFinished.resolve();
    await Promise.all([firstSave, secondSave]);
    const stored = JSON.parse(await app.store.decryptText(app.saved.at(-1)!.encryptedVault, app.store.state.vaultKey!));
    assert.equal(stored.entries[0].notes, 'latest saved edit');
    assert.equal(app.store.state.record!.dirty, true);
});

test('locking aborts an in-flight request and prevents a later response from restoring the unlocked vault', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const getStarted = deferred<any>();
    const getFinished = deferred<Response>();
    const app = loadApp(async (request) => { getStarted.resolve(request); return getFinished.promise; });
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, vault({ entries: [entry('a'), entry('remote')] }));
    const syncing = app.store.synchronize({ automatic: true });
    const request = await getStarted.promise;
    app.store.lockVault();
    assert.equal(request.signal.aborted, true);
    getFinished.resolve(response(200, remote));
    await syncing;
    assert.equal(app.store.state.vault, null);
    assert.equal(app.store.state.vaultKey, null);
    assert.equal(app.store.state.record!.remoteSha, 'sha-base');
    assert.equal(contentsRequests(app).filter((item) => item.method === 'PUT').length, 0);
});

test('offline automatic sync does not issue requests or discard unsynced local edits', async () => {
    const app = loadApp();
    await initialize(app, vault({ entries: [entry('a', { notes: 'offline edit' })] }));
    app.nav.onLine = false;
    await app.store.synchronize({ automatic: true });
    assert.equal(app.requests.length, 0);
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.vault!.entries[0].notes, 'offline edit');
    assert.equal(app.store.state.modal, null);
});

test('automatic sync never imports a remote protected by a different vault key', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async () => response(200, remote));
    const originalKey = await initialize(app, vault({ entries: [entry('local')] }), undefined, { dirty: false });
    const differentKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    remote = await remoteFile(app, vault({ entries: [entry('remote')] }), 'sha-different', differentKey);
    await app.store.synchronize({ automatic: true });
    assert.equal(app.store.state.vaultKey, originalKey);
    assert.equal(app.store.state.vault!.entries[0].id, 'local');
    assert.equal(app.store.state.record!.remoteSha, 'sha-base');
    assert.equal(app.store.state.pendingRemote, null);
    assert.equal(app.store.state.modal, null);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
});

test('manual remote replacement requests confirmation and unlocks a different-key remote explicitly', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async () => response(200, remote));
    const originalKey = await initialize(app, vault({ entries: [entry('local')] }), undefined, { bound: false });
    const differentKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    remote = await remoteFile(app, vault({ entries: [entry('remote')] }), 'sha-import', differentKey);
    await app.store.pullRemote();
    assert.ok(app.confirmations.length > 0);
    assert.equal(app.store.state.vaultKey, originalKey);
    assert.equal(app.store.state.vault!.entries[0].id, 'local');
    assert.equal(app.store.state.modal?.type, 'remote-unlock');
    assert.ok(app.store.state.pendingRemote);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
});

test('a migrated local record without a baseline refuses an unknown remote revision', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local edit' })] }), base);
    delete app.store.state.record!.syncBase;
    remote = await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote edit' })] }), 'sha-unknown');
    await app.store.synchronize();
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.vault!.entries[0].notes, 'local edit');
});

test('temporary GitHub failures are retried and success clears the previous error', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
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
    await app.store.synchronize();
    assert.equal(attempts, 3);
    assert.equal(app.store.state.record!.dirty, false);
    assert.equal(app.store.state.syncLastError, null);
});

test('a public repository is rejected before fetching or uploading the encrypted file', async () => {
    const app = loadApp(async () => response(404, {}), { repositoryResult: { private: false } });
    await initialize(app, vault({ entries: [entry('a')] }));
    await app.store.synchronize();
    assert.equal(contentsRequests(app).length, 0);
    assert.equal(app.store.state.syncLastError?.code, 'repository');
    assert.equal(app.store.state.syncBlocked, true);
    assert.equal(app.store.state.record!.dirty, true);
});

test('a missing bound remote is not silently recreated', async () => {
    const app = loadApp(async () => response(404, {}));
    await initialize(app, vault({ entries: [entry('a')] }));
    await app.store.synchronize();
    assert.deepEqual(contentsRequests(app).map((request) => request.method), ['GET']);
    assert.equal(app.store.state.syncLastError?.code, 'missing');
    assert.equal(app.store.state.record!.remoteSha, 'sha-base');
    assert.equal(app.store.state.record!.dirty, true);
});

test('malformed remote entries are rejected before replacing or uploading local data', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async () => response(200, remote));
    await initialize(app, vault({ entries: [entry('local')] }));
    remote = await remoteFile(app, vault({ entries: [entry('duplicate'), entry('duplicate')] }));
    await app.store.synchronize();
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.store.state.syncLastError?.code, 'format');
    assert.equal(app.store.state.vault!.entries[0].id, 'local');
    assert.equal(app.store.state.record!.dirty, true);
});

test('authentication failures stop retrying and retain the local encrypted vault', async () => {
    const app = loadApp(async () => response(401, { message: 'test token rejected' }));
    await initialize(app, vault({ entries: [entry('a')] }));
    await app.store.synchronize({ automatic: true });
    assert.equal(contentsRequests(app).length, 1);
    assert.equal(app.store.state.syncLastError?.status, 401);
    assert.equal(app.store.state.syncBlocked, true);
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.modal, null);
});

test('request timeout aborts fetch and reports a retryable 408 error', async () => {
    const requestStarted = deferred<any>();
    const app = loadApp((request) => {
        requestStarted.resolve(request);
        return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('test request aborted', 'AbortError')), { once: true }));
    });
    const pending = app.store.remoteRequest('GET', deviceSync);
    const request = await requestStarted.promise;
    const timeout = [...app.timers.values()].find((timer) => timer.delay > 1000);
    assert.ok(timeout, 'each network request should install a timeout');
    timeout.callback();
    await assert.rejects(pending, (error: any) => error.status === 408);
    assert.equal(request.signal.aborted, true);
    assert.equal(app.timers.size, 0);
});

test('a failed encryption preserves unsaved edits and prevents uploading an older encrypted snapshot', async () => {
    const app = loadApp();
    await initialize(app, vault({ entries: [entry('a')] }), undefined, { dirty: false });
    const storedCiphertext = clone(app.store.state.record!.encryptedVault);
    app.store.state.vault!.entries[0].notes = 'edit that failed to encrypt';
    app.overrides.encryptImpl = async () => { throw new Error('synthetic encryption failure'); };
    await assert.rejects(app.store.persistVault(), /synthetic encryption failure/);
    assert.match(app.store.state.localSaveError?.message || '', /synthetic encryption failure/);
    assert.deepEqual(clone(app.store.state.record!.encryptedVault), storedCiphertext);
    await app.store.synchronize();
    assert.equal(app.requests.length, 0);
    assert.equal(app.store.state.syncLastError?.code, 'storage');
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.vault!.entries[0].notes, 'edit that failed to encrypt');
});

test('a failed encrypted storage write blocks sync until a later local save succeeds', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, base, 'sha-base');
    const originalSave = app.overrides.saveImpl;
    app.overrides.saveImpl = () => { throw new Error('synthetic storage quota failure'); };
    app.store.state.vault!.entries[0].notes = 'edit that initially failed to store';
    await assert.rejects(app.store.persistVault(), /synthetic storage quota failure/);
    assert.match(app.store.state.localSaveError?.message || '', /synthetic storage quota failure/);
    await app.store.synchronize();
    assert.equal(app.requests.length, 0);
    assert.equal(app.store.state.record!.dirty, true);
    app.overrides.saveImpl = originalSave;
    await app.store.persistVault();
    assert.equal(app.store.state.localSaveError, null);
    await app.store.synchronize();
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put, 'sync should resume after successful encrypted local storage');
    assert.equal((await pushedVault(app, put)).entries[0].notes, 'edit that initially failed to store');
    assert.equal(app.store.state.record!.dirty, false);
});

test('a local save failure while GET is pending prevents uploading the previous encrypted snapshot', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const getStarted = deferred();
    const getFinished = deferred<Response>();
    const app = loadApp(async (request) => {
        if (request.method === 'GET') { getStarted.resolve(); return getFinished.promise; }
        return response(200, { content: { sha: 'sha-stale-upload' } });
    });
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, base, 'sha-base');
    const syncing = app.store.synchronize();
    await getStarted.promise;
    app.store.state.vault!.entries[0].notes = 'unsaved edit during fetch';
    app.overrides.encryptImpl = async () => { throw new Error('synthetic encryption failure'); };
    await assert.rejects(app.store.persistVault(), /synthetic encryption failure/);
    getFinished.resolve(response(200, remote));
    await syncing;
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.store.state.syncLastError?.code, 'storage');
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.vault!.entries[0].notes, 'unsaved edit during fetch');
});

test('an unchanged clean remote establishes the encrypted baseline without PUT', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    delete app.store.state.record!.syncBase;
    remote = await remoteFile(app, base, 'sha-base');
    await app.store.synchronize();
    assert.deepEqual(contentsRequests(app).map((request) => request.method), ['GET']);
    assert.deepEqual(clone(app.store.state.record!.syncBase), clone(remote.payload.encryptedVault));
    assert.equal(app.store.state.record!.dirty, false);
    assert.equal(app.store.state.record!.remoteSha, 'sha-base');
    assert.ok(app.store.state.record!.lastSyncedAt);
});

test('GitHub Retry-After pauses automatic sync instead of immediately repeating requests', async () => {
    const app = loadApp(async () => response(429, { message: 'synthetic rate limit' }, { 'retry-after': '120' }));
    await initialize(app, vault({ entries: [entry('a')] }));
    const startedAt = Date.now();
    await app.store.synchronize({ automatic: true });
    assert.equal(contentsRequests(app).length, 1);
    assert.equal(app.store.state.syncLastError?.status, 429);
    assert.equal(app.store.state.syncBlocked, false);
    assert.ok(app.store.state.syncRetryAt >= startedAt + 120000);
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.modal, null);
    await app.store.synchronize({ automatic: true });
    assert.equal(contentsRequests(app).length, 1);
    assert.ok([...app.timers.values()].some((timer) => timer.delay >= 119000));
});

test('a remote vault with missing or array preferences is rejected', async () => {
    for (const preferences of [undefined, [] as any]) {
        let remote!: Awaited<ReturnType<typeof remoteFile>>;
        const app = loadApp(async () => response(200, remote));
        await initialize(app, vault({ entries: [entry('local')] }));
        remote = await remoteFile(app, vault({ entries: [entry('remote')], preferences }));
        await app.store.synchronize();
        assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
        assert.equal(app.store.state.syncLastError?.code, 'format');
        assert.equal(app.store.state.vault!.entries[0].id, 'local');
        assert.equal(app.store.state.record!.dirty, true);
    }
});

test('automatic remote polling preserves the last user activity and remaining lock timeout', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')], preferences: { lockMinutes: 1 } });
    await initialize(app, base, base, { dirty: false });
    remote = await remoteFile(app, { ...base, entries: [entry('a'), entry('remote')] });
    const lastUserActivity = Date.now() - 30000;
    app.store.state.lastActivityAt = lastUserActivity;
    await app.store.synchronize({ automatic: true });
    assert.equal(app.store.state.lastActivityAt, lastUserActivity);
    const lockTimer = app.timers.get(app.store.state.timer);
    assert.ok(lockTimer, 'remote preference changes should rearm the existing auto-lock deadline');
    assert.ok(lockTimer.delay <= 30000 && lockTimer.delay > 25000);
    lockTimer.callback();
    assert.equal(app.store.state.vault, null);
    assert.equal(app.store.state.vaultKey, null);
});

test('field merge retains independent changes to the same entry without exposing sync credentials', () => {
    const base = vault({ entries: [entry('a')] });
    const local = vault({ entries: [entry('a', { password: 'synthetic-local-password' })] });
    const remote = vault({ entries: [entry('a', { notes: 'independent remote note' })] });
    const result = clone(mergeVaultChanges(base, local, remote));
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.vault.entries[0].password, 'synthetic-local-password');
    assert.equal(result.vault.entries[0].notes, 'independent remote note');
    remote.entries[0].password = 'synthetic-remote-password';
    const conflicts = clone(collectVaultConflicts(base, local, remote));
    assert.deepEqual(conflicts.map((item) => item.field), ['password']);
    assert.ok(!JSON.stringify(conflicts).includes(deviceSync.token));
    const resolved = clone(mergeVaultChanges(base, local, remote, { choices: { [conflicts[0].id]: 'remote' } }));
    assert.equal(resolved.conflicts.length, 0);
    assert.equal(resolved.vault.entries[0].password, 'synthetic-remote-password');
    assert.equal(resolved.vault.entries[0].notes, 'independent remote note');
});

test('an entry upload adopts a remote password change instead of rolling it back', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'ordinary local edit' })] }), base);
    const oldMetadata = passwordMetadata(20);
    const newMetadata = passwordMetadata(30);
    Object.assign(app.store.state.record!, clone(oldMetadata), { syncKeyBase: clone(oldMetadata) });
    remote = changeRemoteMetadata(await remoteFile(app, base), newMetadata);
    await app.store.synchronize();
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put);
    const uploaded = JSON.parse(atob(put.body.content));
    assert.deepEqual(clone(keyMetadata(uploaded)), newMetadata);
    assert.deepEqual(clone(keyMetadata(app.store.state.record!)), newMetadata);
    assert.equal((await pushedVault(app, put)).entries[0].notes, 'ordinary local edit');
    assert.ok(!Object.hasOwn(uploaded, 'syncKeyBase'));
});

test('a local password change survives an unrelated remote entry update', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base);
    const oldMetadata = passwordMetadata(40);
    const newMetadata = passwordMetadata(50);
    Object.assign(app.store.state.record!, clone(newMetadata), { syncKeyBase: clone(oldMetadata) });
    remote = changeRemoteMetadata(await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote edit' })] })), oldMetadata);
    await app.store.synchronize();
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put);
    assert.deepEqual(clone(keyMetadata(JSON.parse(atob(put.body.content)))), newMetadata);
    assert.equal((await pushedVault(app, put)).entries[0].notes, 'remote edit');
});

test('a clean device adopts remote password wrappers before its next unlock', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base, { dirty: false });
    const oldMetadata = passwordMetadata(60);
    const newMetadata = passwordMetadata(70);
    Object.assign(app.store.state.record!, clone(oldMetadata), { syncKeyBase: clone(oldMetadata) });
    remote = changeRemoteMetadata(await remoteFile(app, base), newMetadata);
    await app.store.synchronize({ automatic: true });
    assert.deepEqual(clone(keyMetadata(app.store.state.record!)), newMetadata);
    assert.deepEqual(clone(app.store.state.record!.syncKeyBase), newMetadata);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
});

test('simultaneous password changes stop uploads until the user chooses one complete wrapping version', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-resolved' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, base, base);
    const oldMetadata = passwordMetadata(80);
    const localMetadata = passwordMetadata(90);
    const remoteMetadata = passwordMetadata(100);
    Object.assign(app.store.state.record!, clone(localMetadata), { syncKeyBase: clone(oldMetadata) });
    remote = changeRemoteMetadata(await remoteFile(app, base), remoteMetadata);
    await app.store.synchronize({ automatic: true });
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.store.state.syncLastError?.code, 'conflict');
    assert.equal(app.store.state.syncConflict?.conflicts[0].kind, 'master-password');
    assert.ok(!JSON.stringify(app.store.state.syncConflict).includes(deviceSync.token));
    assert.deepEqual(clone(keyMetadata(app.store.state.record!)), localMetadata);
    await app.store.resolveSyncConflicts({ 'key:master-password': 'remote' });
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put);
    assert.deepEqual(clone(keyMetadata(JSON.parse(atob(put.body.content)))), remoteMetadata);
    assert.equal(app.store.state.syncConflict, null);
    assert.equal(app.store.state.record!.dirty, false);
});

test('an old baseline without password wrappers refuses to overwrite an unknown password version', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async () => response(200, remote));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local edit' })] }), base);
    delete app.store.state.record!.syncKeyBase;
    remote = changeRemoteMetadata(await remoteFile(app, base), passwordMetadata(110));
    await app.store.synchronize();
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.store.state.syncConflict?.conflicts[0].kind, 'master-password');
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.vault!.entries[0].notes, 'local edit');
});

test('conflict selection fresh-reads the remote SHA and preserves other device additions', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-resolved' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local note' })] }), base);
    remote = await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote note' })] }), 'sha-conflict');
    await app.store.synchronize();
    const choices = Object.fromEntries(app.store.state.syncConflict!.conflicts.map((item) => [item.id, 'local' as const]));
    const reads = contentsRequests(app).filter((request) => request.method === 'GET').length;
    remote = await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote note' }), entry('remote-added')] }), 'sha-new-conflict');
    await app.store.resolveSyncConflicts(choices);
    assert.ok(contentsRequests(app).filter((request) => request.method === 'GET').length > reads);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0, 'choices from an older remote version must not overwrite new changes');
    assert.equal(app.store.state.syncConflict!.sha, 'sha-new-conflict');
    const newChoices = Object.fromEntries(app.store.state.syncConflict!.conflicts.map((item) => [item.id, 'local' as const]));
    await app.store.resolveSyncConflicts(newChoices);
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.equal(put.body.sha, 'sha-new-conflict');
    const uploaded = await pushedVault(app, put);
    assert.equal(uploaded.entries.find((item: VaultEntry) => item.id === 'a').notes, 'local note');
    assert.ok(uploaded.entries.some((item: VaultEntry) => item.id === 'remote-added'));
});

test('edits made while reviewing a conflict invalidate old choices instead of discarding the edit', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-resolved' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local note' })] }), base);
    remote = await remoteFile(app, vault({ entries: [entry('a', { notes: 'remote note' })] }));
    await app.store.synchronize();
    const choices = Object.fromEntries(app.store.state.syncConflict!.conflicts.map((item) => [item.id, 'remote' as const]));
    app.store.state.vault!.entries[0].notes = 'newer local note';
    await app.store.persistVault();
    await app.store.resolveSyncConflicts(choices);
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.store.state.vault!.entries[0].notes, 'newer local note');
    assert.equal(app.store.state.syncConflict!.conflicts[0].local, 'newer local note');
});

test('a failed merge storage write prevents PUT and preserves merged edits for a later save', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-should-not-upload' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'local edit' })] }), base);
    remote = await remoteFile(app, vault({ entries: [entry('a'), entry('remote-added')] }));
    app.overrides.saveImpl = () => { throw new Error('synthetic merge storage failure'); };
    await app.store.synchronize();
    assert.equal(contentsRequests(app).filter((request) => request.method === 'PUT').length, 0);
    assert.equal(app.store.state.syncLastError?.code, 'storage');
    assert.match(app.store.state.localSaveError?.message || '', /synthetic merge storage failure/);
    assert.equal(app.store.state.record!.dirty, true);
    assert.equal(app.store.state.vault!.entries.find((item) => item.id === 'a')!.notes, 'local edit');
    assert.ok(app.store.state.vault!.entries.some((item) => item.id === 'remote-added'));
});

test('an edit during the merge storage write retains the accepted remote password version', async () => {
    let remote!: Awaited<ReturnType<typeof remoteFile>>;
    const mergeWriteStarted = deferred();
    const mergeWriteFinished = deferred();
    const app = loadApp(async (request) => request.method === 'GET' ? response(200, remote) : response(200, { content: { sha: 'sha-accepted' } }));
    const base = vault({ entries: [entry('a')] });
    await initialize(app, vault({ entries: [entry('a', { notes: 'initial local note' })] }), base);
    const oldMetadata = passwordMetadata(120);
    const remoteMetadata = passwordMetadata(130);
    Object.assign(app.store.state.record!, clone(oldMetadata), { syncKeyBase: clone(oldMetadata) });
    remote = changeRemoteMetadata(await remoteFile(app, vault({ entries: [entry('a'), entry('remote-added')] })), remoteMetadata);
    const originalSave = app.overrides.saveImpl;
    let paused = false;
    app.overrides.saveImpl = (record: EncryptedRecord) => {
        if (!paused) {
            paused = true;
            mergeWriteStarted.resolve();
            return mergeWriteFinished.promise.then(() => originalSave(record));
        }
        return originalSave(record);
    };
    const syncing = app.store.synchronize();
    await mergeWriteStarted.promise;
    app.store.state.vault!.entries.find((item) => item.id === 'a')!.notes = 'edit during merge storage';
    const saving = app.store.persistVault();
    mergeWriteFinished.resolve();
    await Promise.all([syncing, saving]);
    const put = contentsRequests(app).find((request) => request.method === 'PUT');
    assert.ok(put);
    const uploadedRecord = JSON.parse(atob(put.body.content));
    assert.deepEqual(clone(keyMetadata(uploadedRecord)), remoteMetadata);
    const uploadedVault = await pushedVault(app, put);
    assert.equal(uploadedVault.entries.find((item: VaultEntry) => item.id === 'a').notes, 'edit during merge storage');
    assert.ok(uploadedVault.entries.some((item: VaultEntry) => item.id === 'remote-added'));
    assert.deepEqual(clone(keyMetadata(app.store.state.record!)), remoteMetadata);
});
