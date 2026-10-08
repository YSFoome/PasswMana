// Cryptography and local persistence only. This module never contacts a server.
const DB_NAME = 'passwmana';
const STORE_NAME = 'vault';
const RECORD_KEY = 'primary';
const ROLLBACK_KEY = 'before-restore';
const DRAFT_KEY = 'encrypted-draft';
const PBKDF2_ITERATIONS = 600000;
const MAX_CIPHERTEXT_BYTES = 64 * 1024 * 1024;
const preparedRestores = new WeakMap();

export const DEFAULT_CATEGORIES = Object.freeze(['工作', '个人', '金融']);

function formatError(message) {
    const error = new Error(message);
    error.code = 'format';
    error.retryable = false;
    return error;
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertObject(value, label) {
    if (!isPlainObject(value) || Object.keys(value).some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) {
        throw formatError(`${label}格式不正确`);
    }
}

function assertString(value, label, { nonempty = false, maximum = 1024 * 1024 } = {}) {
    if (typeof value !== 'string' || value.length > maximum || (nonempty && !value.trim())) {
        throw formatError(`${label}格式不正确`);
    }
}

function assertTimestamp(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        || !Number.isFinite(Date.parse(value))) throw formatError(`${label}格式不正确`);
}

export function makeId() {
    return crypto.randomUUID();
}

export function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export function base64ToBytes(value) {
    // atob alone accepts incomplete encodings and whitespace. Persisted crypto
    // fields must be canonical so malformed lengths cannot reach Web Crypto.
    if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw formatError('Base64 数据格式不正确');
    }
    let bytes;
    try {
        const binary = atob(value);
        bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
        throw formatError('Base64 数据格式不正确');
    }
    if (bytesToBase64(bytes) !== value) throw formatError('Base64 数据格式不正确');
    return bytes;
}

function assertBytes(value, length, label) {
    if (base64ToBytes(value).byteLength !== length) throw formatError(`${label}长度不正确`);
}

export function randomBase64(byteLength = 24) {
    return bytesToBase64(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function formatRecoveryCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const characters = [...crypto.getRandomValues(new Uint8Array(20))].map((byte) => alphabet[byte % alphabet.length]).join('');
    return characters.match(/.{4}/g).join('-');
}

export function validateEncryptedValue(value, label = '密文') {
    assertObject(value, label);
    assertBytes(value.iv, 12, `${label} IV`);
    const size = base64ToBytes(value.data).byteLength;
    if (size < 16) throw formatError(`${label}长度不正确`);
    return value;
}

function validateKeyWrappers(record) {
    assertBytes(record.masterSalt, 16, '主密码盐');
    assertBytes(record.recoverySalt, 16, '恢复密钥盐');
    validateEncryptedValue(record.wrappedVaultKey, '主密码包装');
    validateEncryptedValue(record.recoveryWrappedVaultKey, '恢复密钥包装');
    // A 32-byte AES key is stored as exactly 44 Base64 UTF-8 bytes plus a
    // 16-byte GCM authentication tag inside each password wrapper.
    if (base64ToBytes(record.wrappedVaultKey.data).byteLength !== 60
        || base64ToBytes(record.recoveryWrappedVaultKey.data).byteLength !== 60) {
        throw formatError('保险库密钥包装长度不正确');
    }
}

export function validateEncryptedRecord(record) {
    assertObject(record, '保险库记录');
    if (record.format !== 'passwmana-v1') throw formatError('不支持此保险库格式');
    assertTimestamp(record.createdAt, '创建时间');
    assertTimestamp(record.updatedAt, '更新时间');
    validateKeyWrappers(record);
    validateEncryptedValue(record.encryptedVault, '保险库密文');
    if (record.syncBase != null) validateEncryptedValue(record.syncBase, '同步基线');
    if (record.syncKeyBase != null) {
        assertObject(record.syncKeyBase, '密码包装基线');
        validateKeyWrappers(record.syncKeyBase);
    }
    if (record.remoteSha != null) assertString(record.remoteSha, '同步版本', { nonempty: true, maximum: 512 });
    if (record.dirty !== undefined && typeof record.dirty !== 'boolean') throw formatError('同步状态格式不正确');
    if (record.lastSyncedAt != null) assertTimestamp(record.lastSyncedAt, '最近同步时间');
    return record;
}

export function validateVault(vault) {
    assertObject(vault, '保险库内容');
    if (!Array.isArray(vault.entries) || !Array.isArray(vault.trash) || !Array.isArray(vault.categories)) {
        throw formatError('保险库内容格式不正确');
    }
    const categories = new Set();
    for (const category of vault.categories) {
        assertString(category, '分类', { nonempty: true, maximum: 1024 });
        if (categories.has(category)) throw formatError('保险库包含重复分类');
        categories.add(category);
    }
    assertObject(vault.preferences, '保险库偏好');
    if (vault.preferences.lockMinutes !== undefined && (typeof vault.preferences.lockMinutes !== 'number'
        || !Number.isFinite(vault.preferences.lockMinutes) || vault.preferences.lockMinutes < 0)) {
        throw formatError('自动锁定时间格式不正确');
    }
    for (const value of Object.values(vault.preferences)) {
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw formatError('保险库偏好格式不正确');
        if (typeof value === 'number' && !Number.isFinite(value)) throw formatError('保险库偏好格式不正确');
    }
    if (vault.sync !== undefined) {
        assertObject(vault.sync, '同步配置');
        for (const field of ['owner', 'repo', 'branch', 'path', 'token']) {
            if (vault.sync[field] !== undefined) assertString(vault.sync[field], '同步配置', { maximum: 8192 });
        }
        if (vault.sync.automatic !== undefined && typeof vault.sync.automatic !== 'boolean') throw formatError('自动同步配置格式不正确');
    }
    const ids = new Set();
    for (const entry of [...vault.entries, ...vault.trash]) {
        assertObject(entry, '密码条目');
        // Legacy IDs are opaque strings, not UUIDs. Rendering must escape them.
        assertString(entry.id, '条目标识', { nonempty: true, maximum: 4096 });
        if (ids.has(entry.id)) throw formatError('保险库包含重复条目标识');
        ids.add(entry.id);
        assertString(entry.title, '条目标题', { nonempty: true });
        assertString(entry.password, '条目密码');
        for (const field of ['username', 'category', 'url', 'notes']) {
            if (entry[field] !== undefined) assertString(entry[field], '条目字段');
        }
        if (entry.favorite !== undefined && typeof entry.favorite !== 'boolean') throw formatError('收藏状态格式不正确');
        for (const field of ['createdAt', 'updatedAt', 'deletedAt']) {
            if (entry[field] !== undefined) assertTimestamp(entry[field], '条目时间');
        }
    }
    return vault;
}

export function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        let failed = false;
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => {
            if (failed) { request.result.close(); return; }
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
        request.onerror = () => { failed = true; reject(request.error || new Error('无法打开本地保险库')); };
        request.onblocked = () => { failed = true; reject(new Error('请关闭其他旧版页面后重试')); };
    });
}

export async function dbGet(key = RECORD_KEY) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(key);
        let value = null;
        request.onsuccess = () => { value = request.result ?? null; };
        transaction.oncomplete = () => { db.close(); resolve(value); };
        transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error || request.error || new Error('读取本地保险库失败')); };
    });
}

export async function dbPut(record) {
    validateEncryptedRecord(record);
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(record, RECORD_KEY);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error || new Error('保存本地保险库失败')); };
    });
}

async function writeStoredValue(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        if (value == null) store.delete(key);
        else store.put(value, key);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error || new Error('保存本地数据失败')); };
    });
}

export async function deriveKey(secret, salt) {
    if (typeof secret !== 'string' || !secret) throw formatError('请输入密码或恢复密钥');
    assertBytes(salt, 16, '密码盐');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: base64ToBytes(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

export async function encryptText(value, key) {
    if (typeof value !== 'string') throw formatError('待加密内容必须是文本');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
    return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) };
}

export async function decryptText(value, key) {
    validateEncryptedValue(value);
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(value.iv) }, key, base64ToBytes(value.data));
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
}

export async function importVaultKey(raw) {
    assertBytes(raw, 32, '保险库密钥');
    return crypto.subtle.importKey('raw', base64ToBytes(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function defaultVault() {
    return {
        entries: [],
        trash: [],
        categories: [...DEFAULT_CATEGORIES],
        preferences: { lockMinutes: 5 },
        sync: { owner: '', repo: '', branch: 'main', path: 'passwmana.vault', token: '', automatic: true },
    };
}

export async function createVault(masterPassword, recoveryCode) {
    const vaultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const rawKey = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey)));
    const masterSalt = randomBase64(16);
    const recoverySalt = randomBase64(16);
    const masterKey = await deriveKey(masterPassword, masterSalt);
    const recoveryKey = await deriveKey(recoveryCode, recoverySalt);
    const vault = defaultVault();
    const record = {
        format: 'passwmana-v1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        masterSalt,
        recoverySalt,
        wrappedVaultKey: await encryptText(rawKey, masterKey),
        recoveryWrappedVaultKey: await encryptText(rawKey, recoveryKey),
        encryptedVault: await encryptText(JSON.stringify(vault), vaultKey),
        remoteSha: null,
        dirty: true,
    };
    return { record, vaultKey, rawVaultKey: rawKey, vault };
}

async function unlockRecord(record, secret, recovery) {
    validateEncryptedRecord(record);
    const key = await deriveKey(secret, recovery ? record.recoverySalt : record.masterSalt);
    const rawVaultKey = await decryptText(recovery ? record.recoveryWrappedVaultKey : record.wrappedVaultKey, key);
    const vaultKey = await importVaultKey(rawVaultKey);
    const vault = validateVault(JSON.parse(await decryptText(record.encryptedVault, vaultKey)));
    return { vaultKey, rawVaultKey, vault };
}

export async function unlockWithMaster(record, masterPassword) {
    return unlockRecord(record, masterPassword, false);
}

export async function unlockWithRecovery(record, recoveryCode) {
    return unlockRecord(record, recoveryCode.trim().replace(/\s/g, '').toUpperCase(), true);
}

export async function prepareBackupRestore(data, { masterPassword, recoveryCode } = {}) {
    const source = isPlainObject(data) && Object.hasOwn(data, 'record') ? data.record : data;
    // Clone before awaiting, so an in-flight caller mutation cannot change what
    // was decrypted and later committed.
    const record = structuredClone(validateEncryptedRecord(source));
    const unlocked = recoveryCode !== undefined
        ? await unlockWithRecovery(record, recoveryCode)
        : await unlockWithMaster(record, masterPassword);
    delete record.syncBase;
    delete record.syncKeyBase;
    delete record.lastSyncedAt;
    record.remoteSha = null;
    record.dirty = true;
    const prepared = { record: structuredClone(record), ...unlocked };
    preparedRestores.set(prepared, { record, ...unlocked, vault: structuredClone(unlocked.vault) });
    return prepared;
}

export async function commitBackupRestore(prepared) {
    const snapshot = preparedRestores.get(prepared);
    if (!snapshot) throw formatError('请先验证备份密码与内容');
    const { record } = snapshot;
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const previous = store.get(RECORD_KEY);
        previous.onsuccess = () => {
            if (previous.result) store.put(previous.result, ROLLBACK_KEY);
            store.put(record, RECORD_KEY);
            store.delete(DRAFT_KEY);
        };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error || new Error('恢复备份失败，原保险库未被替换')); };
    });
    preparedRestores.delete(prepared);
    Object.assign(prepared, { record: structuredClone(record), vaultKey: snapshot.vaultKey,
        rawVaultKey: snapshot.rawVaultKey, vault: structuredClone(snapshot.vault) });
    return prepared;
}

export async function getRollbackRecord() {
    return dbGet(ROLLBACK_KEY);
}

export async function restoreRollbackRecord(credentials) {
    const record = await getRollbackRecord();
    if (!record) throw new Error('此设备没有可回滚的保险库');
    return commitBackupRestore(await prepareBackupRestore(record, credentials));
}

async function draftBinding(record, rawVaultKey) {
    assertBytes(rawVaultKey, 32, '保险库密钥');
    assertTimestamp(record.createdAt, '保险库创建时间');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`passwmana-draft-v1:${record.createdAt}:${rawVaultKey}`));
    return bytesToBase64(new Uint8Array(hash));
}

function validateDraft(draft) {
    assertObject(draft, '草稿');
    if (!['add-entry', 'edit-entry'].includes(draft.type)) throw formatError('草稿类型不正确');
    assertObject(draft.values, '草稿字段');
    for (const [field, value] of Object.entries(draft.values)) {
        if (!['title', 'username', 'password', 'category', 'url', 'notes', 'favorite'].includes(field)) throw formatError('草稿字段不正确');
        if (field === 'favorite') {
            if (typeof value !== 'boolean') throw formatError('草稿收藏状态不正确');
        } else assertString(value, '草稿字段');
    }
    if (draft.type === 'edit-entry') {
        assertString(draft.entryId, '草稿条目标识', { nonempty: true, maximum: 4096 });
        if (draft.entry !== undefined) {
            // Keep the original snapshot for the existing stale-edit guard.
            validateVault({ ...defaultVault(), entries: [draft.entry] });
            if (draft.entry.id !== draft.entryId) throw formatError('草稿条目标识不匹配');
        }
    }
    return draft;
}

export async function saveEncryptedDraft(record, vaultKey, rawVaultKey, draft) {
    const snapshot = structuredClone(validateDraft(draft));
    const binding = await draftBinding(record, rawVaultKey);
    const encryptedDraft = await encryptText(JSON.stringify({ binding, draft: snapshot }), vaultKey);
    await writeStoredValue(DRAFT_KEY, { format: 'passwmana-draft-v1', binding, encryptedDraft });
}

export async function loadEncryptedDraft(record, vaultKey, rawVaultKey) {
    const stored = await dbGet(DRAFT_KEY);
    if (!stored) return null;
    try {
        assertObject(stored, '加密草稿');
        if (stored.format !== 'passwmana-draft-v1') return null;
        const binding = await draftBinding(record, rawVaultKey);
        if (stored.binding !== binding) return null;
        const data = JSON.parse(await decryptText(stored.encryptedDraft, vaultKey));
        if (data.binding !== binding) return null;
        return validateDraft(data.draft);
    } catch {
        // A stale or damaged draft must never prevent normal vault access.
        return null;
    }
}

export async function clearEncryptedDraft() {
    return writeStoredValue(DRAFT_KEY, null);
}
