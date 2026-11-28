import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { beforeAll, test } from 'vitest';
import * as core from '../src/core/vault-core';
import type { EncryptedRecord, VaultEntry } from '../src/core/types';

// Synthetic data only; real Web Crypto is used for every encryption operation.
if (!globalThis.crypto) {
    (globalThis as any).crypto = webcrypto;
}

const password = 'synthetic-core-master-password';
const recoveryCode = 'ABCDE-FGHIJ-KLMNO-PQRST';
const timestamp = '2026-10-08T00:00:00.000Z';
let fixture: core.PreparedRestore;

function clone<T>(value: T): T {
    return structuredClone(value);
}

function entry(id = 'legacy-entry-id'): VaultEntry {
    return {
        id,
        title: 'Synthetic title',
        username: 'synthetic@example.invalid',
        password: 'synthetic-entry-password',
        category: '个人',
        url: 'https://example.invalid',
        notes: '',
        favorite: false,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function memoryIndexedDb() {
    let records = new Map<string, unknown>();
    let failNextWrite = false;
    let closed = 0;
    const api = {
        records: () => records,
        failWrite() { failNextWrite = true; },
        closed: () => closed,
        open() {
            const request: any = {};
            setImmediate(() => {
                request.result = {
                    objectStoreNames: { contains: () => true },
                    close() { closed += 1; },
                    transaction(_name: string, mode: string) {
                        const values = new Map([...records].map(([key, value]) => [key, clone(value)]));
                        let pending = 0;
                        let ended = false;
                        const transaction: any = { error: null };
                        const schedule = (operation: () => unknown) => {
                            const operationRequest: any = {};
                            pending += 1;
                            setImmediate(() => {
                                if (ended) return;
                                try {
                                    operationRequest.result = operation();
                                    operationRequest.onsuccess?.();
                                } catch (error) {
                                    ended = true;
                                    transaction.error = error;
                                    transaction.onabort?.();
                                    return;
                                }
                                pending -= 1;
                                setImmediate(() => {
                                    if (ended || pending) return;
                                    ended = true;
                                    if (mode === 'readwrite') records = values;
                                    transaction.oncomplete?.();
                                });
                            });
                            return operationRequest;
                        };
                        transaction.objectStore = () => ({
                            get(key: string) { return schedule(() => clone(values.get(key))); },
                            put(value: unknown, key: string) {
                                const saved = clone(value);
                                return schedule(() => {
                                    if (failNextWrite) {
                                        failNextWrite = false;
                                        throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
                                    }
                                    values.set(key, saved);
                                    return key;
                                });
                            },
                            delete(key: string) { return schedule(() => values.delete(key)); },
                        });
                        return transaction;
                    },
                };
                request.onsuccess?.();
            });
            return request;
        },
    };
    return api;
}

beforeAll(async () => {
    fixture = await core.createVault(password, recoveryCode);
});

test('default categories are copied for each vault', () => {
    const first = core.defaultVault();
    first.categories.push('Synthetic custom category');
    assert.deepEqual(core.defaultVault().categories, ['工作', '个人', '金融']);
    assert.deepEqual(core.DEFAULT_CATEGORIES, ['工作', '个人', '金融']);
});

test('a generated record unlocks with master password and recovery key', async () => {
    assert.equal(core.validateEncryptedRecord(fixture.record), fixture.record);
    const unlocked = await core.unlockWithMaster(fixture.record, password);
    const recovered = await core.unlockWithRecovery(fixture.record, `  ${recoveryCode.toLowerCase()}  `);
    assert.equal(unlocked.rawVaultKey, recovered.rawVaultKey);
    assert.deepEqual(unlocked.vault, fixture.vault);
    await assert.rejects(core.unlockWithMaster(fixture.record, 'synthetic-wrong-password'), { name: 'OperationError' });
    await assert.rejects(core.unlockWithRecovery(fixture.record, 'synthetic-wrong-recovery'), { name: 'OperationError' });
});

test('canonical Base64, IV, salt and wrapped key lengths are required', async () => {
    const mutations: Array<(record: any) => void> = [
        (record) => { record.masterSalt = core.randomBase64(15); },
        (record) => { record.recoverySalt = core.randomBase64(17); },
        (record) => { record.masterSalt = `${record.masterSalt}\n`; },
        (record) => { record.encryptedVault.iv = core.randomBase64(11); },
        (record) => { record.encryptedVault.data = core.randomBase64(15); },
        (record) => { record.wrappedVaultKey.data = core.randomBase64(59); },
        (record) => { record.recoveryWrappedVaultKey.iv = 'not-base64'; },
        (record) => { record.dirty = 'true'; },
        (record) => { record.remoteSha = {}; },
        (record) => { record.createdAt = 'not-a-time'; },
        (record) => { record.syncBase = {}; },
        (record) => { record.syncKeyBase = { masterSalt: record.masterSalt }; },
    ];
    for (const mutate of mutations) {
        const record = clone(fixture.record);
        mutate(record);
        assert.throws(() => core.validateEncryptedRecord(record), { code: 'format' });
    }
    for (const value of ['Zg', 'Zg===', 'Zh==', ' Zg==', '', null, {}]) {
        assert.throws(() => core.base64ToBytes(value), { code: 'format' });
    }
    assert.deepEqual(core.base64ToBytes('Zg=='), new Uint8Array([102]));
    await assert.rejects(core.importVaultKey(core.randomBase64(31)), { code: 'format' });
});

test('vault validation accepts opaque legacy IDs but rejects duplicate and malformed content', () => {
    const valid = core.defaultVault();
    valid.entries.push(entry('legacy-"<>& id'));
    assert.equal(core.validateVault(valid), valid);
    const mutations: Array<(vault: any) => void> = [
        (vault) => { vault.trash.push(clone(vault.entries[0])); },
        (vault) => { vault.entries[0].username = {}; },
        (vault) => { vault.entries[0].favorite = 'false'; },
        (vault) => { vault.entries[0].createdAt = 'bad-date'; },
        (vault) => { vault.entries[0].id = ''; },
        (vault) => { vault.entries[0].title = []; },
        (vault) => { vault.entries[0].password = null; },
        (vault) => { vault.preferences.lockMinutes = '5'; },
        (vault) => { vault.preferences.lockMinutes = NaN; },
        (vault) => { vault.categories.push('个人'); },
        (vault) => { vault.categories = [{ name: '个人' }]; },
        (vault) => { vault.sync.token = {}; },
        (vault) => { vault.preferences = JSON.parse('{"__proto__": {"unsafe": true}}'); },
    ];
    for (const mutate of mutations) {
        const vault = clone(valid);
        mutate(vault);
        assert.throws(() => core.validateVault(vault), { code: 'format' });
    }
});

test('unlock refuses authenticated ciphertext containing invalid vault JSON', async () => {
    const record = clone(fixture.record);
    record.encryptedVault = await core.encryptText(JSON.stringify({ entries: 'invalid' }), fixture.vaultKey);
    await assert.rejects(core.unlockWithMaster(record, password), { code: 'format' });
    record.encryptedVault = await core.encryptText('{bad-json', fixture.vaultKey);
    await assert.rejects(core.unlockWithMaster(record, password), SyntaxError);
    record.encryptedVault = clone(fixture.record.encryptedVault);
    const bytes = core.base64ToBytes(record.encryptedVault.data);
    bytes[0] ^= 1;
    record.encryptedVault.data = core.bytesToBase64(bytes);
    await assert.rejects(core.unlockWithMaster(record, password), { name: 'OperationError' });
});

test('backup restore validates before writing and atomically preserves a rollback copy', async () => {
    const database = memoryIndexedDb();
    (globalThis as any).indexedDB = database;
    await core.dbPut(fixture.record);
    const changedVault = clone(fixture.vault);
    changedVault.entries.push(entry());
    const backup = clone(fixture.record);
    backup.encryptedVault = await core.encryptText(JSON.stringify(changedVault), fixture.vaultKey);
    backup.remoteSha = 'synthetic-old-remote-sha';
    backup.syncBase = fixture.record.encryptedVault;
    backup.lastSyncedAt = timestamp;
    await assert.rejects(core.prepareBackupRestore({ record: backup }, { masterPassword: 'wrong-synthetic-password' }), { name: 'OperationError' });
    assert.deepEqual(await core.dbGet(), fixture.record);
    await assert.rejects(core.commitBackupRestore({ record: backup } as any), { code: 'format' });
    const prepared = await core.prepareBackupRestore({ record: backup }, { masterPassword: password });
    assert.deepEqual(await core.dbGet(), fixture.record, 'Preparing a backup must not replace the current vault');
    prepared.record.masterSalt = 'caller-mutation-must-not-be-committed';
    await core.commitBackupRestore(prepared);
    const current = (await core.dbGet())!;
    assert.equal(current.remoteSha, null);
    assert.equal(current.dirty, true);
    assert.equal(current.syncBase, undefined);
    assert.equal(current.lastSyncedAt, undefined);
    assert.deepEqual((await core.unlockWithMaster(current, password)).vault, changedVault);
    assert.deepEqual(await core.getRollbackRecord(), fixture.record);
    const restored = await core.restoreRollbackRecord({ recoveryCode });
    assert.deepEqual(restored.vault, fixture.vault);
    assert.ok(database.closed() >= 1);
});

test('a failed restore transaction keeps the original vault and previous rollback copy', async () => {
    const database = memoryIndexedDb();
    (globalThis as any).indexedDB = database;
    await core.dbPut(fixture.record);
    const candidate = await core.prepareBackupRestore(fixture.record, { masterPassword: password });
    database.failWrite();
    await assert.rejects(core.commitBackupRestore(candidate), { name: 'QuotaExceededError' });
    assert.deepEqual(await core.dbGet(), fixture.record);
    assert.equal(await core.getRollbackRecord(), null);
    await core.commitBackupRestore(candidate);
    assert.deepEqual(await core.getRollbackRecord(), fixture.record);
});

test('drafts stay encrypted, are vault-bound and tolerate damaged ciphertext', async () => {
    const database = memoryIndexedDb();
    (globalThis as any).indexedDB = database;
    const draft = {
        type: 'add-entry' as const,
        values: { title: 'Synthetic unfinished entry', username: '', password: 'synthetic-draft-password', category: '个人', url: '', notes: '', favorite: false },
    };
    await core.saveEncryptedDraft(fixture.record, fixture.vaultKey, fixture.rawVaultKey, draft);
    const stored = database.records().get('encrypted-draft') as any;
    assert.ok(!JSON.stringify(stored).includes(draft.values.password!));
    assert.ok(!JSON.stringify(stored).includes(draft.values.title!));
    assert.deepEqual(await core.loadEncryptedDraft(fixture.record, fixture.vaultKey, fixture.rawVaultKey), draft);
    const sameVaultWithNewPassword = { ...fixture.record, masterSalt: core.randomBase64(16) };
    assert.deepEqual(await core.loadEncryptedDraft(sameVaultWithNewPassword, fixture.vaultKey, fixture.rawVaultKey), draft);
    const otherVault = { ...fixture.record, createdAt: '2026-10-09T00:00:00.000Z' };
    assert.equal(await core.loadEncryptedDraft(otherVault, fixture.vaultKey, fixture.rawVaultKey), null);
    assert.equal(await core.loadEncryptedDraft(fixture.record, fixture.vaultKey, core.randomBase64(32)), null);
    stored.encryptedDraft.data = core.randomBase64(32);
    assert.equal(await core.loadEncryptedDraft(fixture.record, fixture.vaultKey, fixture.rawVaultKey), null);
    await core.clearEncryptedDraft();
    assert.equal(await core.loadEncryptedDraft(fixture.record, fixture.vaultKey, fixture.rawVaultKey), null);
});

test('edit draft retains the original entry snapshot and restore clears obsolete drafts', async () => {
    const database = memoryIndexedDb();
    (globalThis as any).indexedDB = database;
    const original = entry();
    const draft = { type: 'edit-entry' as const, entryId: original.id, entry: original, values: { title: 'Synthetic draft title', favorite: true } };
    await core.saveEncryptedDraft(fixture.record, fixture.vaultKey, fixture.rawVaultKey, draft);
    assert.deepEqual(await core.loadEncryptedDraft(fixture.record, fixture.vaultKey, fixture.rawVaultKey), draft);
    await assert.rejects(core.saveEncryptedDraft(fixture.record, fixture.vaultKey, fixture.rawVaultKey, { ...draft, entryId: 'other-id' }), { code: 'format' });
    await core.commitBackupRestore(await core.prepareBackupRestore(fixture.record, { masterPassword: password }));
    assert.equal(await core.loadEncryptedDraft(fixture.record, fixture.vaultKey, fixture.rawVaultKey), null);
});

test('device unlock resumes the vault key without the master password and withdraws cleanly', async () => {
    const database = memoryIndexedDb();
    (globalThis as any).indexedDB = database;
    await core.dbPut(fixture.record);
    assert.equal(await core.hasDeviceUnlock(), false);
    assert.equal(await core.loadDeviceUnlock(fixture.record), null);

    const authenticated: EncryptedRecord = { ...fixture.record, updatedAt: '2026-10-10T09:00:00.000Z' };
    await core.saveDeviceUnlock(authenticated, fixture.rawVaultKey);
    assert.equal(await core.hasDeviceUnlock(), true);
    const stored = database.records().get('device-unlock') as any;
    const serialized = JSON.stringify(stored);
    assert.equal(stored.key.extractable, false);
    assert.ok(!serialized.includes(fixture.rawVaultKey));
    assert.ok(!serialized.includes('wrappedVaultKey'));

    const resumed = (await core.loadDeviceUnlock(authenticated))!;
    assert.equal((resumed as any).rawVaultKey, undefined);
    assert.deepEqual(resumed.vault, fixture.vault);
    const raw = await crypto.subtle.exportKey('raw', resumed.vaultKey).catch(() => null);
    assert.equal(raw, null, 'the imported session key stays non-extractable');
    const reread = await core.decryptText(authenticated.encryptedVault, resumed.vaultKey);
    assert.deepEqual(JSON.parse(reread), fixture.vault);

    assert.equal(await core.loadDeviceUnlock({ ...authenticated, updatedAt: '2026-10-10T10:00:00.000Z' }), null);
    assert.equal(await core.loadDeviceUnlock({ ...authenticated, createdAt: '2026-10-10T00:00:00.000Z' }), null);

    await core.clearDeviceUnlock();
    assert.equal(await core.hasDeviceUnlock(), false);
    assert.equal(await core.loadDeviceUnlock(authenticated), null);
});

test('a damaged or absent device unlock never blocks the password path', async () => {
    const database = memoryIndexedDb();
    (globalThis as any).indexedDB = database;
    const authenticated: EncryptedRecord = { ...fixture.record, updatedAt: '2026-10-10T09:00:00.000Z' };
    await core.saveDeviceUnlock(authenticated, fixture.rawVaultKey);
    const stored = database.records().get('device-unlock') as any;
    stored.encrypted.data = core.randomBase64(32);
    assert.equal(await core.loadDeviceUnlock(authenticated), null);
    const unlocked = await core.unlockWithMaster(authenticated, password);
    assert.deepEqual(unlocked.vault, fixture.vault);
});
