import * as vaultCore from './vault-core';
import {
    conflictVaultSnapshot,
    keyMetadata,
    mergeKeyMetadata,
    mergeVaultChanges,
    sameValue,
} from './sync-core';
import {
    convertLegacyBackup,
    createClipboardManager,
    formatBytes,
    parseGithubRepository,
    safeWebUrl,
    sortEntries,
    type LegacyBackupData,
} from './ui-helpers';
import type {
    AccentColor,
    AppView,
    EncryptedRecord,
    EntryDraft,
    EntryFormValues,
    ModalState,
    PendingRemoteState,
    SettingPanel,
    SortMode,
    StorageStatus,
    SyncConfig,
    SyncConflictState,
    SyncStatusInfo,
    ThemeMode,
    ToastItem,
    VaultConflictItem,
    VaultData,
    VaultEntry,
} from './types';

export const MAX_SYNC_ATTEMPTS = 3;
export const SYNC_DEBOUNCE_MS = 2000;
export const SYNC_POLL_MS = 60000;
export const SYNC_TIMEOUT_MS = 20000;
export const SYNC_FOREGROUND_PAUSE_MS = 10000;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const REVEAL_TIMEOUT_MS = 30000;
export const CLIPBOARD_CLEAR_MS = 30000;
export const SORT_LABELS: Readonly<Record<SortMode, string>> = Object.freeze({
    updated: '最近更新',
    title: '名称 A–Z',
    created: '添加日期',
});

export interface SyncError extends Error {
    code?: string;
    status?: number;
    retryable?: boolean;
    retryAfterMs?: number;
}

export interface VaultState {
    record: EncryptedRecord | null;
    vaultKey: CryptoKey | null;
    rawVaultKey: string | null;
    vault: VaultData | null;
    view: AppView;
    settingPanel: SettingPanel;
    settingsDetail: boolean;
    search: string;
    category: string;
    favoriteOnly: boolean;
    sort: SortMode;
    selectedId: string | null;
    inspectorRevealed: boolean;
    modal: ModalState | null;
    syncing: 'sync' | 'pull' | 'push' | null;
    syncLastError: SyncError | null;
    pendingRemote: PendingRemoteState | null;
    session: number;
    vaultRevision: number;
    syncPromise: Promise<void> | null;
    syncController: AbortController | null;
    syncTimer: any;
    syncPollTimer: any;
    syncRetryCount: number;
    syncRetryAt: number;
    syncForegroundAt: number;
    syncBlocked: boolean;
    verifiedSyncTarget: string | null;
    syncConflict: SyncConflictState | null;
    drawerOpen: boolean;
    timer: any;
    lockWarningTimer: any;
    lockWarningVisible: boolean;
    lastActivityAt: number;
    localSaveError: SyncError | null;
    releaseVaultLock: (() => void) | null;
    deviceUnlock: boolean | null;
    resumedByDevice: boolean;
    formDraft: EntryDraft | null;
    savedDraft: EntryDraft | null;
    draftTimer: any;
    serviceWorkerRegistration: ServiceWorkerRegistration | null;
    updateReady: boolean;
    revealTimer: any;
    storage: StorageStatus | null;
    toasts: ToastItem[];
    mode: ThemeMode;
    accent: AccentColor;
    bootstrapped: boolean;
    bootstrapError: string | null;
    lastFavoriteAnimationId: string | null;
}

export interface StoreDeps {
    dbGet?: typeof vaultCore.dbGet;
    dbPut?: typeof vaultCore.dbPut;
    getRollbackRecord?: typeof vaultCore.getRollbackRecord;
    prepareBackupRestore?: typeof vaultCore.prepareBackupRestore;
    commitBackupRestore?: typeof vaultCore.commitBackupRestore;
    saveEncryptedDraft?: typeof vaultCore.saveEncryptedDraft;
    loadEncryptedDraft?: typeof vaultCore.loadEncryptedDraft;
    clearEncryptedDraft?: typeof vaultCore.clearEncryptedDraft;
    hasDeviceUnlock?: typeof vaultCore.hasDeviceUnlock;
    saveDeviceUnlock?: typeof vaultCore.saveDeviceUnlock;
    loadDeviceUnlock?: typeof vaultCore.loadDeviceUnlock;
    clearDeviceUnlock?: typeof vaultCore.clearDeviceUnlock;
    createVault?: typeof vaultCore.createVault;
    unlockWithMaster?: typeof vaultCore.unlockWithMaster;
    unlockWithRecovery?: typeof vaultCore.unlockWithRecovery;
    deriveKey?: typeof vaultCore.deriveKey;
    encryptText?: typeof vaultCore.encryptText;
    decryptText?: typeof vaultCore.decryptText;
    validateVault?: typeof vaultCore.validateVault;
    validateEncryptedRecord?: typeof vaultCore.validateEncryptedRecord;
    fetch?: typeof fetch;
    setTimeout?: (cb: (...args: any[]) => void, ms?: number) => any;
    clearTimeout?: (id: any) => void;
    setInterval?: (cb: (...args: any[]) => void, ms?: number) => any;
    clearInterval?: (id: any) => void;
    navigator?: Partial<Navigator> & {
        onLine?: boolean;
        locks?: LockManager;
        clipboard?: Clipboard;
        permissions?: Permissions;
        storage?: StorageManager;
        serviceWorker?: ServiceWorkerContainer;
    };
    document?: {
        visibilityState?: DocumentVisibilityState;
        documentElement?: { dataset: Record<string, string | undefined> };
        querySelector?: (selector: string) => Element | null;
    };
    window?: {
        location?: { hash: string; reload: () => void };
        matchMedia?: (query: string) => { matches: boolean; addEventListener?: (t: string, cb: () => void) => void };
        open?: (url: string, target?: string, features?: string) => Window | null;
    };
    localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
    onSearchFocusRequested?: () => boolean;
}

function githubHeaders(token: string): Record<string, string> {
    return {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

function syncError(message: string, code: string): SyncError {
    const error = new Error(message) as SyncError;
    error.code = code;
    error.retryable = false;
    return error;
}

export function isRetryableSyncError(error: SyncError): boolean {
    if (error.retryable === false || error.name === 'AbortError') return false;
    return Boolean(error.retryAfterMs) || !error.status || [408, 409, 425, 429].includes(error.status) || error.status >= 500;
}

export interface StoreSnapshot {
    version: number;
    state: VaultState;
}

export function createVaultStore(deps: StoreDeps = {}) {
    const core = {
        dbGet: deps.dbGet ?? vaultCore.dbGet,
        dbPut: deps.dbPut ?? vaultCore.dbPut,
        getRollbackRecord: deps.getRollbackRecord ?? vaultCore.getRollbackRecord,
        prepareBackupRestore: deps.prepareBackupRestore ?? vaultCore.prepareBackupRestore,
        commitBackupRestore: deps.commitBackupRestore ?? vaultCore.commitBackupRestore,
        saveEncryptedDraft: deps.saveEncryptedDraft ?? vaultCore.saveEncryptedDraft,
        loadEncryptedDraft: deps.loadEncryptedDraft ?? vaultCore.loadEncryptedDraft,
        clearEncryptedDraft: deps.clearEncryptedDraft ?? vaultCore.clearEncryptedDraft,
        hasDeviceUnlock: deps.hasDeviceUnlock ?? vaultCore.hasDeviceUnlock,
        saveDeviceUnlock: deps.saveDeviceUnlock ?? vaultCore.saveDeviceUnlock,
        loadDeviceUnlock: deps.loadDeviceUnlock ?? vaultCore.loadDeviceUnlock,
        clearDeviceUnlock: deps.clearDeviceUnlock ?? vaultCore.clearDeviceUnlock,
        createVault: deps.createVault ?? vaultCore.createVault,
        unlockWithMaster: deps.unlockWithMaster ?? vaultCore.unlockWithMaster,
        unlockWithRecovery: deps.unlockWithRecovery ?? vaultCore.unlockWithRecovery,
        deriveKey: deps.deriveKey ?? vaultCore.deriveKey,
        encryptText: deps.encryptText ?? vaultCore.encryptText,
        decryptText: deps.decryptText ?? vaultCore.decryptText,
        validateVault: deps.validateVault ?? vaultCore.validateVault,
        validateEncryptedRecord: deps.validateEncryptedRecord ?? vaultCore.validateEncryptedRecord,
    };

    const runtime = {
        fetch: deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
        setTimeout: deps.setTimeout ?? ((cb: (...args: any[]) => void, ms?: number) => globalThis.setTimeout(cb, ms)),
        clearTimeout: deps.clearTimeout ?? ((id: any) => globalThis.clearTimeout(id)),
        setInterval: deps.setInterval ?? ((cb: (...args: any[]) => void, ms?: number) => globalThis.setInterval(cb, ms)),
        clearInterval: deps.clearInterval ?? ((id: any) => globalThis.clearInterval(id)),
        get navigator() {
            return deps.navigator ?? (typeof globalThis.navigator !== 'undefined' ? globalThis.navigator : { onLine: true });
        },
        get document() {
            return deps.document ?? (typeof globalThis.document !== 'undefined' ? globalThis.document : { visibilityState: 'visible' as DocumentVisibilityState });
        },
        get window() {
            return deps.window ?? (typeof globalThis.window !== 'undefined' ? globalThis.window : undefined);
        },
        get localStorage() {
            return deps.localStorage ?? (typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : undefined);
        },
    };

    const state: VaultState = {
        record: null,
        vaultKey: null,
        rawVaultKey: null,
        vault: null,
        view: 'vault',
        settingPanel: 'sync',
        settingsDetail: false,
        search: '',
        category: '',
        favoriteOnly: false,
        sort: 'updated',
        selectedId: null,
        inspectorRevealed: false,
        modal: null,
        syncing: null,
        syncLastError: null,
        pendingRemote: null,
        session: 0,
        vaultRevision: 0,
        syncPromise: null,
        syncController: null,
        syncTimer: null,
        syncPollTimer: null,
        syncRetryCount: 0,
        syncRetryAt: 0,
        syncForegroundAt: 0,
        syncBlocked: false,
        verifiedSyncTarget: null,
        syncConflict: null,
        drawerOpen: false,
        timer: null,
        lockWarningTimer: null,
        lockWarningVisible: false,
        lastActivityAt: Date.now(),
        localSaveError: null,
        releaseVaultLock: null,
        deviceUnlock: null,
        resumedByDevice: false,
        formDraft: null,
        savedDraft: null,
        draftTimer: null,
        serviceWorkerRegistration: null,
        updateReady: false,
        revealTimer: null,
        storage: null,
        toasts: [],
        mode: 'system',
        accent: 'emerald',
        bootstrapped: false,
        bootstrapError: null,
        lastFavoriteAnimationId: null,
    };

    let version = 0;
    let snapshot: StoreSnapshot = { version, state };
    const listeners = new Set<() => void>();
    let storageQueue: Promise<unknown> = Promise.resolve();
    let searchTimer: any = null;
    let toastId = 0;
    let updateRequested = false;
    let dialogTrigger: { action: string; id?: string; panel?: string } | null = null;

    const entrySearchIndex = new WeakMap<VaultEntry, string>();

    const clipboardManager = createClipboardManager(
        {
            writeText: (value: string) => runtime.navigator.clipboard!.writeText(value),
            readText: async () => {
                if (!runtime.navigator.permissions?.query) throw new Error('无法安全检查剪贴板');
                const permission = await runtime.navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
                if (permission.state !== 'granted') throw new Error('未授予剪贴板读取权限');
                return runtime.navigator.clipboard!.readText();
            },
        },
        (cb, delay) => runtime.setTimeout(cb, delay),
        (id) => runtime.clearTimeout(id),
    );

    function notify(): void {
        version += 1;
        snapshot = { version, state };
        for (const listener of listeners) listener();
    }

    function subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }

    function getSnapshot(): StoreSnapshot {
        return snapshot;
    }

    function queueStorage<T>(operation: () => Promise<T>): Promise<T> {
        const result = storageQueue.then(operation);
        storageQueue = result.catch(() => {});
        return result;
    }

    function readPreference(key: string): string | null {
        try { return runtime.localStorage?.getItem(key) ?? null; } catch { return null; }
    }

    function writePreference(key: string, value: string): void {
        try { runtime.localStorage?.setItem(key, value); } catch { /* Theme persistence is optional. */ }
    }

    function applyThemeColor(): void {
        const doc = typeof globalThis.document !== 'undefined' ? globalThis.document : null;
        if (!doc) return;
        const meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
        if (!meta) return;
        const color = globalThis.getComputedStyle(doc.documentElement).getPropertyValue('--bg-sidebar').trim();
        if (color) meta.content = color;
    }

    function isMobileViewport(): boolean {
        return Boolean(runtime.window?.matchMedia?.('(max-width: 899px)').matches);
    }

    function toast(message: string): void {
        const id = ++toastId;
        state.toasts = [...state.toasts, { id, message }];
        notify();
        runtime.setTimeout(() => {
            state.toasts = state.toasts.filter((item) => item.id !== id);
            notify();
        }, 2600);
    }

    function searchableEntryText(entry: VaultEntry): string {
        let text = entrySearchIndex.get(entry);
        if (text === undefined) {
            text = [entry.title, entry.username, entry.category, entry.url, entry.notes]
                .map((value) => String(value || '').toLocaleLowerCase()).join('\n');
            entrySearchIndex.set(entry, text);
        }
        return text;
    }

    function normalizeCategoryFilter(): void {
        if (state.vault && state.category && !state.vault.categories.includes(state.category)) state.category = '';
    }

    function currentEntries(): VaultEntry[] {
        if (!state.vault) return [];
        normalizeCategoryFilter();
        const query = state.search.trim().toLocaleLowerCase();
        const matches = state.vault.entries
            .filter((entry) => !state.category || entry.category === state.category)
            .filter((entry) => !state.favoriteOnly || entry.favorite)
            .filter((entry) => !query || searchableEntryText(entry).includes(query));
        return sortEntries(matches, state.sort);
    }

    function resolvedSelectedEntry(entries: VaultEntry[] = currentEntries()): VaultEntry | null {
        if (!entries.length) return null;
        return entries.find((entry) => entry.id === state.selectedId) || entries[0];
    }

    function syncSelectedEntry(): void {
        const entries = currentEntries();
        const selected = resolvedSelectedEntry(entries);
        if (selected && state.selectedId !== selected.id) {
            state.selectedId = selected.id;
            state.inspectorRevealed = false;
            if (state.revealTimer) runtime.clearTimeout(state.revealTimer);
            state.revealTimer = null;
        } else if (!selected) {
            state.selectedId = null;
            state.inspectorRevealed = false;
        }
    }

    function currentVaultHeading(): string {
        if (state.favoriteOnly) return '收藏';
        if (state.category) return state.category;
        return '全部密码';
    }

    function syncConfigured(sync: SyncConfig | undefined = state.vault?.sync): boolean {
        return Boolean(sync?.owner && sync.repo && sync.branch && sync.path && sync.token);
    }

    function syncStatus(): SyncStatusInfo {
        if (state.localSaveError) return { label: '本地保存失败', detail: '无法保存到本机，请保留页面并检查浏览器存储空间', status: 'error', icon: 'circle-alert' };
        if (!syncConfigured()) return { label: '仅本地保存', detail: '配置私有仓库后即可启用后台同步', status: 'local', icon: 'hard-drive' };
        if (state.syncing) return { label: '正在同步', detail: '正在后台同步加密保险库，可以继续使用', status: 'syncing', icon: 'refresh-cw' };
        if (!state.record?.remoteSha) return { label: '等待首次连接', detail: '请选择从远端导入或初始化远端，完成后自动同步', status: 'pending', icon: 'cloud-off' };
        if (runtime.navigator.onLine === false) return { label: '离线保存', detail: '改动已在本地加密保存，联网并解锁后自动同步', status: 'pending', icon: 'cloud-off' };
        if (state.syncLastError) return { label: state.syncBlocked ? '需要处理同步' : '等待重试', detail: state.syncLastError.message, status: 'error', icon: 'circle-alert' };
        if (state.record.dirty) return { label: '等待同步', detail: state.vault?.sync.automatic === false ? '改动已在本地保存，请手动同步' : '改动已在本地保存，即将自动同步', status: 'pending', icon: 'cloud-upload' };
        return { label: '已同步', detail: state.record.lastSyncedAt ? `最近同步：${new Date(state.record.lastSyncedAt).toLocaleString('zh-CN')}` : '本地保险库已与私有仓库同步', status: 'synced', icon: 'cloud-upload' };
    }

    function storageStatusText(): string {
        const storage = state.storage;
        if (!storage) return '正在检查浏览器存储保护…';
        if (!storage.supported) return '此浏览器不支持持久化存储申请，请定期导出加密备份。';
        const usage = storage.usage != null && storage.quota != null
            ? `已用 ${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}。` : '';
        return storage.persisted
            ? `已启用持久化存储，浏览器不会自动清理。${usage}`
            : `未启用持久化存储，浏览器在空间紧张时可能清除数据。${usage}`;
    }

    async function requestStoragePersistence(): Promise<boolean> {
        if (typeof runtime.navigator.storage?.persist !== 'function') return false;
        try { return await runtime.navigator.storage.persist(); } catch { return false; }
    }

    async function refreshStorageStatus(): Promise<void> {
        if (typeof runtime.navigator.storage?.persisted !== 'function') {
            state.storage = { supported: false };
            notify();
            return;
        }
        try {
            const persisted = await runtime.navigator.storage.persisted();
            let usage: number | null = null;
            let quota: number | null = null;
            if (typeof runtime.navigator.storage.estimate === 'function') {
                const estimate = await runtime.navigator.storage.estimate().catch(() => null);
                if (estimate && Number.isFinite(estimate.usage) && Number.isFinite(estimate.quota)) {
                    usage = estimate.usage ?? null;
                    quota = estimate.quota ?? null;
                }
            }
            state.storage = { supported: true, persisted, usage, quota };
        } catch {
            state.storage = { supported: false };
        }
        notify();
    }

    async function persistVault({ dirty = true } = {}): Promise<void> {
        const record = state.record!;
        const vaultKey = state.vaultKey!;
        // Refuse to encrypt a shape the unlock path would reject later. Without this
        // guard a bad in-memory edit becomes an unopenable vault after reload.
        try {
            core.validateVault(state.vault);
        } catch (error) {
            state.localSaveError = error as SyncError;
            notify();
            throw error;
        }
        const snapshotJson = JSON.stringify(state.vault);
        const updatedAt = new Date().toISOString();
        state.vaultRevision += 1;
        if (dirty) record.dirty = true;
        try {
            await queueStorage(async () => {
                record.encryptedVault = await core.encryptText(snapshotJson, vaultKey);
                record.updatedAt = updatedAt;
                await core.dbPut(record);
            });
            state.localSaveError = null;
            notify();
        } catch (error) {
            state.localSaveError = error as SyncError;
            notify();
            throw error;
        }
        if (dirty) scheduleAutoSync();
    }

    function resetLockTimer({ activity = true } = {}): void {
        if (!state.vaultKey) return;
        if (activity) state.lastActivityAt = Date.now();
        if (state.timer) runtime.clearTimeout(state.timer);
        if (state.lockWarningTimer) runtime.clearTimeout(state.lockWarningTimer);
        state.timer = null;
        state.lockWarningTimer = null;
        if (state.lockWarningVisible) {
            state.lockWarningVisible = false;
            notify();
        }
        if (state.modal?.type === 'recovery-created') return;
        const minutes = Number(state.vault?.preferences?.lockMinutes ?? 5);
        if (minutes > 0) {
            const remaining = Math.max(0, minutes * 60 * 1000 - (Date.now() - state.lastActivityAt));
            state.timer = runtime.setTimeout(() => lockVault(), remaining);
            state.lockWarningTimer = runtime.setTimeout(() => {
                if (!state.vaultKey) return;
                state.lockWarningVisible = true;
                notify();
            }, Math.max(0, remaining - 30000));
        }
    }

    async function acquireVaultLock(): Promise<void> {
        if (!runtime.navigator.locks || state.releaseVaultLock) return;
        let report!: (outcome: 'held' | 'busy') => void;
        const acquired = new Promise<'held' | 'busy'>((resolve) => { report = resolve; });
        runtime.navigator.locks.request('passwmana-unlocked', { ifAvailable: true }, async (lock) => {
            if (!lock) { report('busy'); return; }
            const released = new Promise<void>((resolve) => { state.releaseVaultLock = resolve; });
            report('held');
            await released;
        }).catch(() => report('busy'));
        const outcome = await acquired;
        if (outcome === 'held') return;
        throw new Error('保险库已在另一个标签页解锁，请先锁定该页面');
    }

    function releaseVaultLock(): void {
        const release = state.releaseVaultLock;
        state.releaseVaultLock = null;
        // Finish captured encrypted saves before another tab reads the shared database.
        if (release) void storageQueue.finally(release);
    }

    function persistEntryDraft(): Promise<void> {
        const draft = state.formDraft && structuredClone(state.formDraft);
        const record = state.record;
        const key = state.vaultKey;
        const rawKey = state.rawVaultKey;
        if (!draft || !key || !record || !rawKey) return Promise.resolve();
        return queueStorage(() => core.saveEncryptedDraft(record, key, rawKey, draft));
    }

    function lockVault({ silent = false } = {}): void {
        if (state.timer) runtime.clearTimeout(state.timer);
        if (state.lockWarningTimer) runtime.clearTimeout(state.lockWarningTimer);
        if (state.draftTimer) runtime.clearTimeout(state.draftTimer);
        if (state.revealTimer) runtime.clearTimeout(state.revealTimer);
        if (searchTimer) runtime.clearTimeout(searchTimer);
        state.timer = null;
        state.lockWarningTimer = null;
        state.draftTimer = null;
        state.revealTimer = null;
        searchTimer = null;
        state.lockWarningVisible = false;
        if (state.formDraft && state.vaultKey) void persistEntryDraft().catch(() => {});
        stopSyncSession();
        releaseVaultLock();
        state.vaultKey = null;
        state.rawVaultKey = null;
        state.vault = null;
        state.selectedId = null;
        state.inspectorRevealed = false;
        if (state.modal && (state.modal.type === 'confirm' || state.modal.type === 'prompt')) {
            const resolve = state.modal.resolve;
            if (state.modal.type === 'prompt') (resolve as ((v: string | null) => void) | undefined)?.(null);
            else (resolve as ((v: boolean) => void) | undefined)?.(false);
        }
        state.modal = null;
        state.pendingRemote = null;
        state.drawerOpen = false;
        state.formDraft = null;
        state.savedDraft = null;
        state.resumedByDevice = false;
        dialogTrigger = null;
        if (!silent) notify();
    }

    function pruneTrash(): void {
        if (!state.vault) return;
        const cutoff = Date.now() - 30 * 86400000;
        const originalLength = state.vault.trash.length;
        state.vault.trash = state.vault.trash.filter((entry) => {
            const deletedAt = Date.parse(entry.deletedAt);
            return !Number.isFinite(deletedAt) || deletedAt > cutoff;
        });
        if (state.vault.trash.length !== originalLength) void persistVault().catch(() => {});
    }

    async function enterUnlockedVault(
        record: EncryptedRecord,
        { vaultKey, rawVaultKey, vault }: { vaultKey: CryptoKey; rawVaultKey?: string; vault: VaultData },
        { resumedByDevice = false } = {},
    ): Promise<void> {
        state.record = record;
        state.vaultKey = vaultKey;
        state.rawVaultKey = rawVaultKey ?? null;
        state.vault = vault;
        state.resumedByDevice = resumedByDevice;
        state.savedDraft = rawVaultKey ? await core.loadEncryptedDraft(record, vaultKey, rawVaultKey) : null;
        pruneTrash();
        syncSelectedEntry();
        notify();
        if (resumedByDevice) toast('已在此设备免密解锁');
        resetLockTimer();
        startSyncSession();
    }

    function stopSyncSession(): void {
        state.session += 1;
        state.syncController?.abort();
        if (state.syncTimer) runtime.clearTimeout(state.syncTimer);
        if (state.syncPollTimer) runtime.clearInterval(state.syncPollTimer);
        state.syncTimer = null;
        state.syncPollTimer = null;
        state.syncController = null;
        state.syncPromise = null;
        state.syncing = null;
        state.syncBlocked = false;
        state.syncRetryCount = 0;
        state.syncRetryAt = 0;
        state.syncForegroundAt = 0;
        state.verifiedSyncTarget = null;
        state.pendingRemote = null;
        state.syncConflict = null;
    }

    function startSyncSession(): void {
        stopSyncSession();
        state.syncLastError = null;
        if (!state.vaultKey) return;
        state.syncPollTimer = runtime.setInterval(() => scheduleAutoSync(0), SYNC_POLL_MS);
        scheduleAutoSync(0);
    }

    function pendingSyncDelay(delay: number): number {
        const pause = Date.now() < state.syncForegroundAt + SYNC_FOREGROUND_PAUSE_MS
            ? state.syncForegroundAt + SYNC_FOREGROUND_PAUSE_MS - Date.now() : 0;
        return Math.max(delay, state.syncRetryAt - Date.now(), Math.min(pause, SYNC_FOREGROUND_PAUSE_MS), 0);
    }

    function scheduleAutoSync(delay = SYNC_DEBOUNCE_MS): void {
        if (!state.vaultKey || !syncConfigured() || state.vault?.sync.automatic === false
            || !state.record?.remoteSha || state.syncBlocked) return;
        if (state.syncTimer) runtime.clearTimeout(state.syncTimer);
        state.syncTimer = null;
        if (runtime.navigator.onLine === false || runtime.document.visibilityState === 'hidden') return;
        state.syncTimer = runtime.setTimeout(() => { void synchronize({ automatic: true }); }, pendingSyncDelay(delay));
    }

    function syncOnForeground(): void {
        if (!state.vaultKey || !syncConfigured() || state.vault?.sync.automatic === false || !state.record?.remoteSha) return;
        state.syncForegroundAt = state.record.dirty ? 0 : Date.now();
        scheduleAutoSync(0);
    }

    function assertSyncSession(session: number): void {
        if (session !== state.session || !state.vaultKey) throw new DOMException('同步已取消', 'AbortError');
    }

    async function remoteRequestWithMetadata(
        method: string,
        sync: SyncConfig,
        body?: unknown,
        { repository = false, blob = '', etag = '' }: { repository?: boolean; blob?: string; etag?: string } = {},
    ): Promise<{ data?: any; notModified?: boolean; etag: string }> {
        const encodedPath = sync.path.split('/').map(encodeURIComponent).join('/');
        const root = `https://api.github.com/repos/${encodeURIComponent(sync.owner)}/${encodeURIComponent(sync.repo)}`;
        const url = blob ? `${root}/git/blobs/${encodeURIComponent(blob)}`
            : repository ? root
                : `${root}/contents/${encodedPath}${method === 'GET' ? `?ref=${encodeURIComponent(sync.branch)}` : ''}`;
        const controller = new AbortController();
        const sessionSignal = state.syncController?.signal;
        const abort = () => controller.abort();
        sessionSignal?.addEventListener('abort', abort, { once: true });
        if (sessionSignal?.aborted) controller.abort();
        const timer = runtime.setTimeout(abort, SYNC_TIMEOUT_MS);
        try {
            const conditional = method === 'GET' && etag && !repository && !blob;
            const response = await runtime.fetch(url, {
                method,
                cache: 'no-store',
                signal: controller.signal,
                headers: {
                    ...githubHeaders(sync.token),
                    ...(conditional ? { 'If-None-Match': etag } : {}),
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
            });
            if (response.status === 404 && method === 'GET' && !repository && !blob) return { data: null, etag: '' };
            if (conditional && response.status === 304) {
                return { notModified: true, etag: response.headers.get('etag') || etag };
            }
            const result = await response.json().catch(() => ({})) as Record<string, any>;
            if (!response.ok) {
                const error = new Error(`GitHub 返回 ${response.status}${result.message ? `：${result.message}` : ''}`) as SyncError;
                error.status = response.status;
                const retryAfter = Number(response.headers.get('retry-after'));
                const rateReset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
                if (response.status === 429 || (response.status === 403 && (retryAfter > 0
                    || response.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(result.message || '')))) {
                    error.retryAfterMs = Math.max(retryAfter * 1000, rateReset - Date.now(), 60000);
                }
                throw error;
            }
            return { data: result, etag: response.headers.get('etag') || '' };
        } catch (error: any) {
            if (controller.signal.aborted && !sessionSignal?.aborted) {
                const timeout = new Error('连接 GitHub 超时，将稍后重试') as SyncError;
                timeout.status = 408;
                throw timeout;
            }
            throw error;
        } finally {
            runtime.clearTimeout(timer);
            sessionSignal?.removeEventListener('abort', abort);
        }
    }

    async function remoteRequest(method: string, sync: SyncConfig, body?: unknown, options: { repository?: boolean; blob?: string; etag?: string } = {}): Promise<any> {
        const result = await remoteRequestWithMetadata(method, sync, body, options);
        return result.data;
    }

    async function withSyncRetry<T>(operation: () => Promise<T>, session = state.session): Promise<T> {
        for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
            assertSyncSession(session);
            notify();
            try {
                return await operation();
            } catch (error: any) {
                assertSyncSession(session);
                if (!isRetryableSyncError(error) || error.retryAfterMs || attempt === MAX_SYNC_ATTEMPTS) throw error;
                state.syncLastError = error;
                notify();
                await new Promise((resolve) => runtime.setTimeout(resolve, 500 * 2 ** (attempt - 1)));
            }
        }
        throw new Error('同步重试失败');
    }

    async function readRemoteFile(sync: SyncConfig, remote: any): Promise<any> {
        if (!remote) return remote;
        if (typeof remote.content === 'string' && remote.content.trim()) return remote;
        if (!remote.sha) return remote;
        const blob = await remoteRequest('GET', sync, undefined, { blob: remote.sha });
        if (!blob || typeof blob.content !== 'string' || !blob.content.trim()) {
            throw syncError('远端密文为空、过大或无法读取，请检查仓库文件', 'format');
        }
        return { ...remote, content: blob.content };
    }

    function decodeRemote(remote: any): EncryptedRecord {
        try {
            if (!remote.sha || typeof remote.content !== 'string') throw new Error();
            const payload = JSON.parse(new TextDecoder().decode(vaultCore.base64ToBytes(remote.content.replace(/\s/g, ''))));
            return core.validateEncryptedRecord(payload);
        } catch {
            throw syncError('远端文件格式不正确，已保留本地数据', 'format');
        }
    }

    function remoteRecord(record: EncryptedRecord): Omit<EncryptedRecord, 'remoteSha' | 'remoteEtag' | 'syncBase' | 'syncKeyBase' | 'dirty' | 'lastSyncedAt'> {
        const { remoteSha: _rs, remoteEtag: _re, syncBase: _sb, syncKeyBase: _skb, dirty: _d, lastSyncedAt: _lsa, ...payload } = record;
        return payload;
    }

    function recordEtag(record: EncryptedRecord): string {
        return record.remoteSha && record.syncBase && record.syncKeyBase && typeof record.remoteEtag === 'string'
            ? record.remoteEtag : '';
    }

    function localRevisionChanged(revision: number): void {
        if (revision !== state.vaultRevision) {
            const error = new Error('本地保存了新改动，正在重新同步') as SyncError;
            error.status = 409;
            throw error;
        }
    }

    function assertLocalSaved(): void {
        if (state.localSaveError) throw syncError('本地改动尚未成功保存，已暂停同步。请检查浏览器存储空间并重新保存。', 'storage');
    }

    async function persistSyncRecord(): Promise<void> {
        try { await core.dbPut(state.record!); }
        catch (error) {
            state.record!.dirty = true;
            state.localSaveError = error as SyncError;
            throw syncError('同步结果尚未成功保存到此设备，已暂停后续上传。请检查浏览器存储空间并重新保存。', 'storage');
        }
    }

    async function applyRemoteVault(
        vault: VaultData,
        payload: EncryptedRecord,
        sha: string,
        dirty: boolean,
        revision: number,
        session: number,
        metadata = keyMetadata(payload),
    ): Promise<void> {
        await queueStorage(async () => {
            assertSyncSession(session);
            localRevisionChanged(revision);
            assertLocalSaved();
            const encryptedVault = await core.encryptText(JSON.stringify(vault), state.vaultKey!);
            assertSyncSession(session);
            localRevisionChanged(revision);
            const nextRecord: EncryptedRecord = {
                ...state.record!,
                ...metadata,
                encryptedVault,
                remoteSha: sha,
                remoteEtag: state.record!.remoteEtag,
                syncBase: payload.encryptedVault,
                syncKeyBase: keyMetadata(payload),
                dirty,
                updatedAt: new Date().toISOString(),
            };
            Object.assign(state.record!, nextRecord);
            state.vault = vault;
            state.vaultRevision += 1;
            await persistSyncRecord();
        });
        assertSyncSession(session);
        resetLockTimer({ activity: false });
        if (state.modal?.type === 'detail') {
            const entry = state.vault?.entries.find((item) => item.id === (state.modal as { type: 'detail'; id: string }).id);
            if (!entry) {
                if (state.revealTimer) runtime.clearTimeout(state.revealTimer);
                state.revealTimer = null;
                state.modal = null;
                toast('此条目已在其他设备删除');
            }
        }
        syncSelectedEntry();
        notify();
    }

    async function synchronizeOnce(
        sync: SyncConfig,
        mode: 'sync' | 'pull',
        session: number,
        resolution?: { sha: string; revision: number; choices: Record<string, 'local' | 'remote'> },
    ): Promise<void> {
        await storageQueue;
        assertSyncSession(session);
        assertLocalSaved();
        const target = JSON.stringify(sync);
        if (state.verifiedSyncTarget !== target) {
            const repository = await remoteRequest('GET', sync, undefined, { repository: true });
            assertSyncSession(session);
            if (repository.private !== true) throw syncError('请选择私有仓库保存加密保险库', 'repository');
            state.verifiedSyncTarget = target;
        }
        const fetched = await remoteRequestWithMetadata('GET', sync, undefined, { etag: recordEtag(state.record!) });
        assertSyncSession(session);
        const remoteUnchanged = Boolean(fetched.notModified);
        let remote: any = null;
        if (remoteUnchanged) {
            state.record!.remoteEtag = fetched.etag || state.record!.remoteEtag;
            if (!state.record!.dirty) return;
        } else {
            state.record!.remoteEtag = fetched.etag || '';
            remote = await readRemoteFile(sync, fetched.data);
        }
        assertSyncSession(session);
        await storageQueue;
        assertSyncSession(session);
        assertLocalSaved();
        const revision = state.vaultRevision;
        if (!remoteUnchanged && !remote && (state.record!.remoteSha || mode === 'pull')) {
            throw syncError('远端保险库文件不存在或无权读取，请检查仓库、分支、路径和令牌权限', 'missing');
        }
        if (remote && !state.record!.remoteSha && mode !== 'pull') {
            throw syncError('远端已有保险库，请选择“从远端导入”。初始化不会覆盖现有文件。', 'unbound');
        }
        if (remote) {
            const payload = decodeRemote(remote);
            const localMetadata = keyMetadata(state.record!);
            const remoteMetadata = keyMetadata(payload);
            const choices = resolution && resolution.sha === remote.sha && resolution.revision === revision ? resolution.choices : {};
            const keyMerge = mode === 'pull'
                ? { metadata: remoteMetadata, conflicts: [] }
                : mergeKeyMetadata(state.record!.syncKeyBase, localMetadata, remoteMetadata, choices['key:master-password']);
            if (mode === 'pull' || remote.sha !== state.record!.remoteSha || keyMerge.conflicts.length
                || !sameValue(localMetadata, keyMerge.metadata)) {
                let remoteVault: VaultData;
                try {
                    remoteVault = JSON.parse(await core.decryptText(payload.encryptedVault, state.vaultKey!));
                } catch {
                    assertSyncSession(session);
                    localRevisionChanged(revision);
                    if (mode === 'pull' && !state.record!.remoteSha) {
                        state.pendingRemote = {
                            payload: {
                                ...remoteRecord(payload),
                                remoteSha: remote.sha,
                                syncBase: payload.encryptedVault,
                                syncKeyBase: remoteMetadata,
                                dirty: false,
                            },
                            sync,
                            revision,
                        };
                        state.modal = { type: 'remote-unlock' };
                        return;
                    }
                    throw syncError('远端属于不同保险库或密文已损坏，已保留本地数据。请检查同步配置。', 'key');
                }
                assertSyncSession(session);
                localRevisionChanged(revision);
                core.validateVault(remoteVault);
                remoteVault.sync = { ...state.vault!.sync };
                let merged = remoteVault;
                const dirty = mode !== 'pull' && Boolean(state.record!.dirty);
                let base = state.vault!;
                let conflicts: VaultConflictItem[] = [];
                if (dirty) {
                    if (!state.record!.syncBase) throw syncError('旧版同步尚无合并基线，两端都有改动。请先导出备份，再处理冲突。', 'conflict');
                    try { base = core.validateVault(JSON.parse(await core.decryptText(state.record!.syncBase, state.vaultKey!))); }
                    catch { throw syncError('无法读取同步基线，已保留本地改动，请先导出备份', 'conflict'); }
                    assertSyncSession(session);
                    localRevisionChanged(revision);
                    const result = mergeVaultChanges(base, state.vault!, remoteVault, { choices });
                    merged = result.vault;
                    conflicts = result.conflicts;
                }
                conflicts.push(...keyMerge.conflicts);
                if (conflicts.length) {
                    state.syncConflict = {
                        sha: remote.sha,
                        revision,
                        base: conflictVaultSnapshot(base),
                        local: conflictVaultSnapshot(state.vault!),
                        remote: conflictVaultSnapshot(remoteVault),
                        conflicts,
                    };
                    throw syncError(
                        keyMerge.conflicts.length
                            ? '两端的主密码设置不同，已暂停同步。请查看冲突并确认所有设备应使用哪一版主密码。'
                            : '两台设备修改了相同字段。请查看冲突并逐项选择保留的版本。',
                        'conflict',
                    );
                }
                core.validateVault(merged);
                await applyRemoteVault(merged, payload, remote.sha, dirty, revision, session, keyMerge.metadata);
            } else if (!state.record!.syncBase || !state.record!.syncKeyBase) {
                await queueStorage(async () => {
                    assertSyncSession(session);
                    localRevisionChanged(revision);
                    const nextRecord = { ...state.record!, syncBase: payload.encryptedVault, syncKeyBase: remoteMetadata };
                    Object.assign(state.record!, nextRecord);
                    await persistSyncRecord();
                });
            }
        }
        if (mode === 'pull' || (!state.record!.dirty && (remote || remoteUnchanged))) return;
        await storageQueue;
        assertSyncSession(session);
        assertLocalSaved();
        const uploadedRevision = state.vaultRevision;
        const remoteSha = remote?.sha || (remoteUnchanged ? state.record!.remoteSha : null);
        const payload = structuredClone(remoteRecord(state.record!));
        state.syncing = 'push';
        notify();
        const uploaded = await remoteRequestWithMetadata('PUT', sync, {
            message: 'Update encrypted PasswMana vault',
            branch: sync.branch,
            content: vaultCore.bytesToBase64(new TextEncoder().encode(JSON.stringify(payload))),
            ...(remoteSha ? { sha: remoteSha } : {}),
        });
        assertSyncSession(session);
        const result = uploaded.data;
        if (!result?.content?.sha) throw syncError('GitHub 未返回文件版本，请重新检查同步状态', 'format');
        await queueStorage(async () => {
            assertSyncSession(session);
            state.record!.remoteSha = result.content.sha;
            state.record!.remoteEtag = uploaded.etag || '';
            state.record!.syncBase = payload.encryptedVault;
            state.record!.syncKeyBase = keyMetadata(payload);
            state.record!.dirty = state.vaultRevision !== uploadedRevision;
            await persistSyncRecord();
        });
    }

    function settleModal(value: boolean | string | null, { restore = true } = {}): void {
        const modal = state.modal;
        if (!modal || (modal.type !== 'confirm' && modal.type !== 'prompt')) return;
        const resolve = modal.resolve;
        if (typeof resolve !== 'function') return;
        state.modal = restore && !value && modal.previousModal ? modal.previousModal : null;
        if (modal.type === 'prompt') (resolve as (v: string | null) => void)(value as string | null);
        else (resolve as (v: boolean) => void)(Boolean(value));
        notify();
    }

    function askConfirm({
        title,
        message,
        confirmLabel = '继续',
        cancelLabel = '取消',
        danger = false,
    }: {
        title: string;
        message?: string;
        confirmLabel?: string;
        cancelLabel?: string;
        danger?: boolean;
    }): Promise<boolean> {
        return new Promise((resolve) => {
            const previousModal = state.modal?.type === 'confirm' || state.modal?.type === 'prompt'
                ? state.modal.previousModal : state.modal;
            state.modal = { type: 'confirm', title, message, confirmLabel, cancelLabel, danger, previousModal, resolve };
            notify();
        });
    }

    function askPrompt({
        title,
        message = '',
        label = '名称',
        value = '',
        placeholder = '',
        confirmLabel = '保存',
    }: {
        title: string;
        message?: string;
        label?: string;
        value?: string;
        placeholder?: string;
        confirmLabel?: string;
    }): Promise<string | null> {
        return new Promise((resolve) => {
            const previousModal = state.modal?.type === 'confirm' || state.modal?.type === 'prompt'
                ? state.modal.previousModal : state.modal;
            state.modal = { type: 'prompt', title, message, label, value, placeholder, confirmLabel, previousModal, resolve };
            notify();
        });
    }

    function showMessage({ title, message, confirmLabel = '知道了' }: { title: string; message: string; confirmLabel?: string }): void {
        state.modal = { type: 'message', title, message, confirmLabel };
        notify();
    }

    async function synchronize({
        automatic = false,
        mode = 'sync',
        resolution,
    }: {
        automatic?: boolean;
        mode?: 'sync' | 'pull';
        resolution?: { sha: string; revision: number; choices: Record<string, 'local' | 'remote'> };
    } = {}): Promise<void> {
        if (!state.vaultKey || !syncConfigured()) return;
        if (state.syncPromise) return state.syncPromise;
        if (automatic && (state.vault?.sync.automatic === false || !state.record?.remoteSha || state.syncBlocked
            || runtime.navigator.onLine === false || runtime.document.visibilityState === 'hidden')) return;
        if (automatic && Date.now() < state.syncRetryAt) { scheduleAutoSync(0); return; }
        if (!automatic && mode === 'pull' && (!state.record?.remoteSha || state.record.dirty)
            && !await api.askConfirm({
                title: '从远端导入',
                message: '从远端导入会替换本地条目。请先导出加密备份保存本地改动。是否继续？',
                confirmLabel: '从远端导入',
                danger: true,
            })) return;
        if (!automatic && mode !== 'pull' && !state.record?.remoteSha
            && !await api.askConfirm({
                title: '初始化远端',
                message: '将以本机保险库初始化远端。只有远端不存在密文文件时才会创建。是否继续？',
                confirmLabel: '初始化远端',
            })) return;
        const session = state.session;
        const sync = { ...state.vault!.sync };
        state.syncController = new AbortController();
        state.syncing = mode === 'pull' ? 'pull' : 'sync';
        state.syncLastError = null;
        state.syncBlocked = false;
        if (state.syncTimer) runtime.clearTimeout(state.syncTimer);
        state.syncTimer = null;
        notify();
        const operation = (async () => {
            try {
                await withSyncRetry(() => synchronizeOnce(sync, mode, session, resolution), session);
                assertSyncSession(session);
                if (state.pendingRemote) return;
                await queueStorage(async () => {
                    assertSyncSession(session);
                    state.record!.lastSyncedAt = new Date().toISOString();
                    await persistSyncRecord();
                });
                state.syncLastError = null;
                state.syncConflict = null;
                state.syncRetryCount = 0;
                state.syncRetryAt = 0;
                if (!automatic) {
                    if (state.modal?.type === 'sync') state.modal = null;
                    notify();
                    api.toast(mode === 'pull' ? '已采用远端版本，保险库保持解锁' : '已同步加密保险库');
                }
            } catch (error: any) {
                if (session !== state.session || error.name === 'AbortError') return;
                state.syncLastError = error;
                state.syncBlocked = !isRetryableSyncError(error);
                state.syncRetryCount += 1;
                state.syncRetryAt = Date.now() + Math.max(error.retryAfterMs || 0, Math.min(300000, 5000 * 2 ** Math.min(state.syncRetryCount, 6)));
                if (!automatic && (!state.modal || state.modal.type === 'sync')) {
                    state.modal = { type: 'sync-result', title: '同步未完成', message: `${error.message} 本地数据仍保存在此设备。` };
                    notify();
                }
            } finally {
                if (session === state.session) {
                    state.syncing = null;
                    state.syncPromise = null;
                    state.syncController = null;
                    notify();
                    if (!state.syncBlocked && !state.pendingRemote && (state.record?.dirty || state.syncLastError)) scheduleAutoSync();
                }
            }
        })();
        state.syncPromise = operation;
        return operation;
    }

    async function pullRemote(): Promise<void> {
        return synchronize({ mode: 'pull' });
    }

    async function pushRemote(): Promise<void> {
        return synchronize();
    }

    async function resolveSyncConflicts(choices: Record<string, 'local' | 'remote'>): Promise<void> {
        const conflict = state.syncConflict;
        if (!conflict || !state.vaultKey) throw syncError('没有待处理的同步冲突', 'conflict');
        if (!choices || typeof choices !== 'object' || Array.isArray(choices)
            || conflict.conflicts.some((item) => !Object.hasOwn(choices, item.id) || !['local', 'remote'].includes(choices[item.id]))) {
            throw syncError('请为每个冲突选择此设备或远端版本', 'conflict');
        }
        if (state.syncPromise) throw syncError('请等待当前同步完成后再处理冲突', 'conflict');
        return synchronize({ resolution: { sha: conflict.sha, revision: conflict.revision, choices: { ...choices } } });
    }

    async function enableDeviceUnlock(record: EncryptedRecord, rawVaultKey: string): Promise<void> {
        try {
            await queueStorage(() => core.saveDeviceUnlock(record, rawVaultKey));
            state.deviceUnlock = await core.hasDeviceUnlock();
            await refreshStorageStatus();
        } catch {
            state.deviceUnlock = false;
            notify();
        }
    }

    async function rotateDeviceUnlock(): Promise<void> {
        if (!state.deviceUnlock || !state.record || !state.rawVaultKey) return;
        await enableDeviceUnlock(state.record, state.rawVaultKey);
    }

    async function disableDeviceUnlock({ keepOpen = false } = {}): Promise<boolean> {
        try {
            await queueStorage(() => core.clearDeviceUnlock());
        } catch (error: any) {
            if (keepOpen) api.toast(`无法删除设备密钥：${error.message}`);
            else throw error;
            return false;
        }
        state.deviceUnlock = null;
        if (keepOpen) api.toast('已关闭免密自动解锁，刷新后需要输入主密码');
        notify();
        return true;
    }

    async function tryAutoResume(): Promise<void> {
        try {
            await acquireVaultLock();
            await storageQueue;
            const record = await core.dbGet();
            if (!record) return;
            state.record = record;
            state.deviceUnlock = await core.hasDeviceUnlock();
            if (!state.deviceUnlock) return;
            const resumed = await core.loadDeviceUnlock(record);
            if (!resumed) {
                releaseVaultLock();
                state.deviceUnlock = null;
                notify();
                api.toast('此设备的免密解锁已失效，请用主密码解锁');
                return;
            }
            await enterUnlockedVault(record, resumed, { resumedByDevice: true });
        } catch {
            if (!state.vaultKey) releaseVaultLock();
        }
    }

    async function copyText(
        value: string,
        message = '已复制；30 秒后尝试清除，后续复制的内容会保留',
        options: { clearAfter?: number } = {},
    ): Promise<void> {
        if (!runtime.navigator.clipboard?.writeText) throw new Error('此浏览器无法访问剪贴板，请手动选择并复制');
        await clipboardManager.copy(value, { clearAfter: CLIPBOARD_CLEAR_MS, ...options });
        api.toast(message);
    }

    function hideRevealedPassword(): void {
        if (state.revealTimer) runtime.clearTimeout(state.revealTimer);
        state.revealTimer = null;
        if (state.modal?.type === 'detail' && state.modal.revealed) {
            state.modal = { ...state.modal, revealed: false };
        } else if (state.inspectorRevealed) {
            state.inspectorRevealed = false;
        } else {
            return;
        }
        notify();
    }

    function scheduleRevealHide(): void {
        if (state.revealTimer) runtime.clearTimeout(state.revealTimer);
        state.revealTimer = runtime.setTimeout(hideRevealedPassword, REVEAL_TIMEOUT_MS);
    }

    function toggleRevealPassword(targetId?: string): void {
        if (!state.vault) return;
        const detailModal = state.modal?.type === 'detail' ? state.modal : null;
        const id = detailModal ? detailModal.id : (targetId || state.selectedId);
        const entry = state.vault.entries.find((item) => item.id === id);
        if (!entry) return;
        let revealed: boolean;
        if (detailModal) {
            revealed = !detailModal.revealed;
            state.modal = { ...detailModal, revealed };
        } else {
            revealed = !state.inspectorRevealed;
            state.inspectorRevealed = revealed;
        }
        if (revealed) scheduleRevealHide();
        else {
            if (state.revealTimer) runtime.clearTimeout(state.revealTimer);
            state.revealTimer = null;
        }
        notify();
    }

    function setSearch(value: string): void {
        state.search = value;
        notify();
        if (searchTimer) runtime.clearTimeout(searchTimer);
        searchTimer = runtime.setTimeout(() => {
            searchTimer = null;
            syncSelectedEntry();
            notify();
        }, 120);
    }

    function clearFilters(): void {
        state.search = '';
        state.category = '';
        state.favoriteOnly = false;
        syncSelectedEntry();
        notify();
    }

    function setSort(value: string): void {
        state.sort = Object.hasOwn(SORT_LABELS, value) ? (value as SortMode) : 'updated';
        writePreference('passwmana-sort', state.sort);
        syncSelectedEntry();
        notify();
    }

    function setView(viewName: AppView): void {
        state.view = viewName;
        if (viewName === 'vault') {
            state.category = '';
            state.favoriteOnly = false;
        }
        state.settingsDetail = false;
        state.drawerOpen = false;
        syncSelectedEntry();
        notify();
    }

    function navFavorites(): void {
        state.view = 'vault';
        state.favoriteOnly = true;
        state.category = '';
        state.settingsDetail = false;
        state.drawerOpen = false;
        syncSelectedEntry();
        notify();
    }

    function navCategory(category: string): void {
        state.view = 'vault';
        state.favoriteOnly = false;
        state.category = category || '';
        state.settingsDetail = false;
        state.drawerOpen = false;
        syncSelectedEntry();
        notify();
    }

    function navTrash(): void {
        state.view = 'settings';
        state.settingPanel = 'trash';
        state.settingsDetail = isMobileViewport();
        state.drawerOpen = false;
        notify();
    }

    function handleMobileLeft(): void {
        dialogTrigger = { action: 'mobile-left' };
        if (state.settingsDetail) {
            state.settingsDetail = false;
            notify();
        } else {
            state.drawerOpen = true;
            notify();
        }
    }

    function closeDrawer(): void {
        state.drawerOpen = false;
        notify();
    }

    function selectSettingPanel(panel: SettingPanel): void {
        state.settingPanel = panel;
        if (isMobileViewport()) state.settingsDetail = true;
        if (panel === 'security') void refreshStorageStatus();
        notify();
    }

    function setThemeMode(mode: ThemeMode): void {
        state.mode = mode;
        if (typeof globalThis.document !== 'undefined') {
            globalThis.document.documentElement.dataset.mode = mode;
        }
        writePreference('passwmana-mode', mode);
        applyThemeColor();
        notify();
    }

    function setAccent(accent: AccentColor): void {
        state.accent = accent;
        if (typeof globalThis.document !== 'undefined') {
            globalThis.document.documentElement.dataset.accent = accent;
        }
        writePreference('passwmana-accent', accent);
        notify();
    }

    function openDetail(id: string): void {
        state.selectedId = id;
        state.inspectorRevealed = false;
        if (state.revealTimer) runtime.clearTimeout(state.revealTimer);
        state.revealTimer = null;
        if (isMobileViewport()) {
            state.modal = { type: 'detail', id, revealed: false };
        }
        notify();
    }

    async function toggleFavorite(id: string): Promise<void> {
        if (!state.vault) return;
        const entry = state.vault.entries.find((item) => item.id === id);
        if (!entry) return;
        entry.favorite = !entry.favorite;
        state.lastFavoriteAnimationId = entry.id;
        await persistVault();
        syncSelectedEntry();
        notify();
        api.toast(entry.favorite ? '已加入收藏' : '已取消收藏');
        runtime.setTimeout(() => {
            if (state.lastFavoriteAnimationId === entry.id) {
                state.lastFavoriteAnimationId = null;
                notify();
            }
        }, 420);
    }

    function openAddModal(): void {
        dialogTrigger = { action: 'open-add' };
        state.modal = { type: 'add' };
        notify();
    }

    function openEditModal(id: string): void {
        if (!state.vault) return;
        const entry = state.vault.entries.find((item) => item.id === id);
        if (!entry) return;
        dialogTrigger = { action: 'open-detail', id };
        state.modal = { type: 'edit', entry: structuredClone(entry) };
        notify();
    }

    function openModal(modal: ModalState, trigger?: { action: string; id?: string; panel?: string }): void {
        if (trigger) dialogTrigger = trigger;
        state.modal = modal;
        notify();
    }

    function updateDraft(values: Partial<EntryFormValues>, isEdit: boolean, originalEntry?: VaultEntry): void {
        if (!state.vaultKey) return;
        state.formDraft = {
            type: isEdit ? 'edit-entry' : 'add-entry',
            values: {
                title: values.title || '',
                username: values.username || '',
                password: values.password || '',
                category: values.category || '',
                url: values.url || '',
                notes: values.notes || '',
                favorite: Boolean(values.favorite),
            },
            ...(isEdit && originalEntry ? { entryId: originalEntry.id, entry: structuredClone(originalEntry) } : {}),
        };
        if (state.draftTimer) runtime.clearTimeout(state.draftTimer);
        state.draftTimer = runtime.setTimeout(() => {
            void persistEntryDraft().catch(() => {});
        }, 250);
    }

    async function closeModal(hasUnsavedEntryChanges = false): Promise<void> {
        if (state.revealTimer) runtime.clearTimeout(state.revealTimer);
        state.revealTimer = null;
        if (state.modal?.type === 'confirm') { settleModal(false); return; }
        if (state.modal?.type === 'prompt') { settleModal(null); return; }
        if (state.modal?.type === 'message') { state.modal = null; notify(); return; }
        if (state.modal?.type === 'add' || state.modal?.type === 'edit') {
            if (hasUnsavedEntryChanges || state.formDraft) {
                if (state.formDraft) {
                    state.modal = { ...state.modal, draft: state.formDraft };
                }
                const discard = await api.askConfirm({
                    title: '放弃编辑',
                    message: '放弃这次未保存的编辑？',
                    confirmLabel: '放弃编辑',
                    danger: true,
                });
                if (!discard) return;
            }
            if (state.draftTimer) runtime.clearTimeout(state.draftTimer);
            state.draftTimer = null;
            state.formDraft = null;
            state.savedDraft = null;
            await queueStorage(() => core.clearEncryptedDraft());
        }
        if (state.modal?.type === 'remote-unlock') state.pendingRemote = null;
        state.modal = null;
        notify();
    }

    async function resumeDraft(): Promise<void> {
        const draft = state.savedDraft;
        if (!draft || !state.vault) return;
        state.formDraft = draft;
        if (draft.type === 'edit-entry') {
            const entry = draft.entry || state.vault.entries.find((item) => item.id === draft.entryId);
            if (!entry) {
                state.modal = null;
                notify();
                api.toast('此条目已删除，请先导出草稿内容或重新添加');
                return;
            }
            state.modal = { type: 'edit', entry, draft };
        } else {
            state.modal = { type: 'add', draft };
        }
        notify();
    }

    async function discardDraft(): Promise<void> {
        if (!await api.askConfirm({ title: '放弃草稿', message: '放弃这份未完成的编辑？', confirmLabel: '放弃草稿', danger: true })) return;
        state.formDraft = null;
        state.savedDraft = null;
        await queueStorage(() => core.clearEncryptedDraft());
        notify();
    }

    async function deleteEntry(id: string): Promise<void> {
        if (!state.vault) return;
        const entry = state.vault.entries.find((item) => item.id === id);
        if (!entry) return;
        if (!await api.askConfirm({ title: '移至回收站', message: `将“${entry.title}”移至回收站？`, confirmLabel: '移至回收站', danger: true })) return;
        state.vault.entries = state.vault.entries.filter((item) => item.id !== entry.id);
        state.vault.trash.unshift({ ...entry, deletedAt: new Date().toISOString() });
        if (state.selectedId === entry.id) {
            state.selectedId = null;
            state.inspectorRevealed = false;
            if (state.revealTimer) runtime.clearTimeout(state.revealTimer);
            state.revealTimer = null;
        }
        await persistVault();
        state.modal = null;
        syncSelectedEntry();
        notify();
        api.toast('已移至回收站');
    }

    async function restoreEntry(id: string): Promise<void> {
        if (!state.vault) return;
        const entry = state.vault.trash.find((item) => item.id === id);
        if (!entry) return;
        state.vault.trash = state.vault.trash.filter((item) => item.id !== entry.id);
        const { deletedAt: _deleted, ...restored } = entry;
        restored.updatedAt = new Date().toISOString();
        state.vault.entries.unshift(restored);
        await persistVault();
        notify();
        api.toast('已恢复条目');
    }

    async function purgeEntry(id: string): Promise<void> {
        if (!state.vault) return;
        if (!await api.askConfirm({ title: '永久删除', message: '永久删除后无法恢复。是否继续？', confirmLabel: '永久删除', danger: true })) return;
        state.vault.trash = state.vault.trash.filter((item) => item.id !== id);
        await persistVault();
        notify();
        api.toast('已永久删除');
    }

    async function addCategory(): Promise<void> {
        if (!state.vault) return;
        const category = await api.askPrompt({ title: '新增分类', label: '分类名称', placeholder: '例如：工作', confirmLabel: '添加分类' });
        if (!category) return;
        if (state.vault.categories.includes(category)) {
            api.toast('分类已存在');
            return;
        }
        state.vault.categories.push(category);
        await persistVault();
        notify();
    }

    async function deleteCategory(category: string): Promise<void> {
        if (!state.vault) return;
        if ((vaultCore.DEFAULT_CATEGORIES as readonly string[]).includes(category)) {
            api.toast('默认分类不可删除');
            return;
        }
        if (state.vault.entries.some((entry) => entry.category === category)) {
            api.toast('该分类仍有条目，无法删除');
            return;
        }
        state.vault.categories = state.vault.categories.filter((item) => item !== category);
        await persistVault();
        normalizeCategoryFilter();
        notify();
    }

    async function toggleAutoSync(): Promise<void> {
        if (!state.vault) return;
        state.vault.sync.automatic = state.vault.sync.automatic === false;
        stopSyncSession();
        await persistVault();
        startSyncSession();
        notify();
    }

    async function setLockMinutes(minutes: number): Promise<void> {
        if (!state.vault) return;
        try {
            state.vault.preferences.lockMinutes = minutes;
            await persistVault();
            resetLockTimer();
            api.toast('自动锁定设置已保存');
        } catch (error: any) {
            api.toast(`设置保存失败：${error.message}`);
        }
    }

    async function downloadBackup(): Promise<void> {
        await storageQueue;
        const record = state.record;
        const key = state.vaultKey;
        const session = state.session;
        if (!key || !record || !state.vault) throw new Error('请先解锁再导出备份');
        const encryptedVault = await core.encryptText(JSON.stringify(state.vault), key);
        assertSyncSession(session);
        const data = JSON.stringify({ exportedAt: new Date().toISOString(), record: remoteRecord({ ...record, encryptedVault }) }, null, 2);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        link.download = `passwmana-${new Date().toISOString().slice(0, 10)}.passwmana`;
        link.click();
        runtime.setTimeout(() => URL.revokeObjectURL(link.href), 0);
        api.toast('已导出包含当前改动的加密备份');
    }

    function openBackupFilePicker(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.passwmana,.json,application/json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                if (file.size > MAX_IMPORT_BYTES) throw new Error('备份文件过大，请选择小于 20 MB 的文件');
                const data = JSON.parse(await file.text()) as { record?: unknown };
                core.validateEncryptedRecord(data.record || data);
                dialogTrigger = { action: 'import-backup' };
                state.modal = { type: 'backup-unlock', data };
                notify();
            } catch (error: any) {
                api.toast(`恢复失败，原保险库已保留：${error.message}`);
            }
        };
        input.click();
    }

    function openLegacyBackupPicker(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                if (file.size > MAX_IMPORT_BYTES) throw new Error('旧版备份过大，请选择小于 20 MB 的文件');
                const data = JSON.parse(await file.text()) as LegacyBackupData & { format?: string; record?: { format?: string } };
                if (data.format === 'passwmana-v1' || data.record?.format === 'passwmana-v1') {
                    throw new Error('这是新版加密备份，请使用“恢复加密备份”');
                }
                if (!Array.isArray(data.entries)) throw new Error('不是有效的旧版备份');
                const confirmed = await api.askConfirm({
                    title: '迁移旧版备份',
                    message: '旧版 JSON 包含明文密码。文件会在当前浏览器内读取并立即加密；启用同步后只上传密文。确认迁移并合并到当前保险库？',
                    confirmLabel: '迁移并合并',
                    danger: true,
                });
                if (!confirmed || !state.vault) return;
                const converted = convertLegacyBackup(data, state.vault);
                core.validateVault({ ...state.vault, entries: converted.entries, categories: converted.categories });
                state.vault.entries = converted.entries;
                state.vault.categories = converted.categories;
                await persistVault();
                syncSelectedEntry();
                notify();
                api.showMessage({
                    title: '迁移完成',
                    message: `新增 ${converted.added} 项，更新 ${converted.updated} 项，跳过 ${converted.skipped} 项。\n\n旧版 JSON 仍含明文密码，请在确认数据无误后安全删除该文件。`,
                });
            } catch (error: any) {
                api.toast(`迁移失败: ${error.message}`);
            }
        };
        input.click();
    }

    async function openRollbackBackup(): Promise<void> {
        if (!await core.getRollbackRecord()) {
            api.toast('此设备没有可回滚的保险库');
            return;
        }
        state.modal = { type: 'backup-unlock', rollback: true };
        notify();
    }

    async function requestStoragePersistFromUser(): Promise<void> {
        if (typeof runtime.navigator.storage?.persist !== 'function') {
            api.toast('此浏览器不支持持久化存储申请');
            return;
        }
        const granted = await requestStoragePersistence();
        await refreshStorageStatus();
        api.toast(granted ? '已启用持久化存储' : '浏览器未授予持久化存储，请定期导出加密备份');
    }

    async function checkUpdate(): Promise<void> {
        if (!state.serviceWorkerRegistration) {
            api.toast('此浏览器不支持应用更新检查');
            return;
        }
        try { await state.serviceWorkerRegistration.update(); }
        catch { api.toast('无法检查更新，请检查网络连接'); return; }
        if (state.updateReady) api.toast('新版本已准备好');
        else if (state.serviceWorkerRegistration.installing) api.toast('正在下载新版本，完成后会提示');
        else api.toast('已检查应用更新');
    }

    async function applyUpdate(): Promise<void> {
        const worker = state.serviceWorkerRegistration?.waiting;
        if (!worker) {
            api.toast('当前没有等待安装的更新');
            return;
        }
        await persistEntryDraft();
        await storageQueue;
        updateRequested = true;
        lockVault();
        worker.postMessage({ type: 'SKIP_WAITING' });
    }

    function openQuickSwitch(): void {
        if (!state.vaultKey) return;
        const previousModal = state.modal;
        state.modal = { type: 'quick-switch', query: '', index: 0, previousModal };
        notify();
    }

    function closeQuickSwitch(): void {
        if (state.modal?.type !== 'quick-switch') return;
        state.modal = state.modal.previousModal || null;
        notify();
    }

    function quickSwitchMatches(): VaultEntry[] {
        if (!state.vault) return [];
        const query = (state.modal?.type === 'quick-switch' ? state.modal.query : '').trim().toLocaleLowerCase();
        const entries = [...state.vault.entries].sort((left, right) => Number(Boolean(right.favorite)) - Number(Boolean(left.favorite))
            || (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0));
        return query ? entries.filter((entry) => searchableEntryText(entry).includes(query)) : entries;
    }

    function setQuickQuery(query: string): void {
        if (state.modal?.type !== 'quick-switch') return;
        state.modal = { ...state.modal, query, index: 0 };
        notify();
    }

    function moveQuickIndex(step: number): void {
        if (state.modal?.type !== 'quick-switch') return;
        const matches = quickSwitchMatches();
        if (!matches.length) return;
        const nextIndex = (state.modal.index + step + matches.length) % matches.length;
        state.modal = { ...state.modal, index: nextIndex };
        notify();
    }

    async function activateQuickSwitch(entry?: VaultEntry): Promise<void> {
        if (!entry) return;
        const url = safeWebUrl(entry.url);
        await copyText(entry.password, url ? '密码已复制；正在打开网站' : '密码已复制');
        state.modal = null;
        notify();
        if (url) runtime.window?.open?.(url, '_blank', 'noopener');
    }

    async function submitSetup(password: string, confirmPassword: string): Promise<void> {
        if (password.length < 12) throw new Error('主密码至少需要 12 个字符');
        if (password !== confirmPassword) throw new Error('两次主密码不一致');
        await acquireVaultLock();
        try {
            const existing = await core.dbGet();
            if (existing) {
                state.record = existing;
                releaseVaultLock();
                notify();
                return;
            }
            const recoveryCode = vaultCore.formatRecoveryCode();
            const created = await core.createVault(password, recoveryCode);
            state.record = created.record;
            state.vaultKey = created.vaultKey;
            state.rawVaultKey = created.rawVaultKey;
            state.vault = created.vault;
            await core.dbPut(state.record);
            state.modal = { type: 'recovery-created', code: recoveryCode };
            notify();
            resetLockTimer();
        } catch (error) {
            if (!state.vaultKey) releaseVaultLock();
            throw error;
        }
    }

    function submitRecoveryConfirm(suffix: string): void {
        if (state.modal?.type !== 'recovery-created') return;
        if (suffix.trim().toUpperCase() !== state.modal.code.split('-').at(-1)) {
            throw new Error('最后 4 位不匹配，请从保存的位置重新核验');
        }
        state.modal = null;
        syncSelectedEntry();
        notify();
        resetLockTimer();
        startSyncSession();
    }

    async function submitUnlock(password: string, keepDeviceUnlock: boolean): Promise<void> {
        await acquireVaultLock();
        try {
            await storageQueue;
            state.record = await core.dbGet();
            const session = state.session;
            const record = state.record!;
            if (keepDeviceUnlock && state.deviceUnlock) {
                const resumed = await core.loadDeviceUnlock(record);
                if (!resumed) {
                    releaseVaultLock();
                    throw new Error('此设备的免密解锁已失效，请输入主密码');
                }
                await enterUnlockedVault(record, resumed, { resumedByDevice: true });
                return;
            }
            const unlocked = await core.unlockWithMaster(record, password);
            if (session !== state.session || record !== state.record) return;
            await enterUnlockedVault(record, unlocked);
            if (keepDeviceUnlock) {
                await enableDeviceUnlock(state.record, unlocked.rawVaultKey);
                if (!state.deviceUnlock) api.toast('保险库已解锁，但无法在此浏览器启用免密解锁');
            }
        } catch (error: any) {
            if (!state.vaultKey) releaseVaultLock();
            if (error?.name === 'OperationError') throw new Error('主密码错误，无法解锁保险库');
            throw error;
        }
    }

    async function submitRemoteUnlock(password: string): Promise<void> {
        const pending = state.pendingRemote;
        if (!pending) throw new Error('远端拉取会话已失效，请重新拉取');
        const session = state.session;
        try {
            const unlocked = await core.unlockWithMaster(pending.payload, password);
            assertSyncSession(session);
            localRevisionChanged(pending.revision);
            core.validateVault(unlocked.vault);
            unlocked.vault.sync = pending.sync;
            stopSyncSession();
            state.record = pending.payload;
            state.vaultKey = unlocked.vaultKey;
            state.rawVaultKey = unlocked.rawVaultKey;
            state.vault = unlocked.vault;
            state.record.lastSyncedAt = new Date().toISOString();
            await persistVault({ dirty: false });
            state.pendingRemote = null;
            state.modal = null;
            syncSelectedEntry();
            notify();
            resetLockTimer();
            startSyncSession();
            api.toast('已从远端拉取，保险库保持解锁');
        } catch (error: any) {
            if (error?.name === 'OperationError') throw new Error('远端主密码错误，无法完成拉取');
            throw error;
        }
    }

    async function submitEntry(values: EntryFormValues): Promise<void> {
        if (!state.vault) return;
        const now = new Date().toISOString();
        const entry = {
            title: values.title.trim(),
            username: values.username.trim(),
            password: values.password,
            category: values.category,
            url: values.url.trim(),
            notes: values.notes.trim(),
            favorite: Boolean(values.favorite),
            updatedAt: now,
        };
        if (!entry.title || !entry.username || !entry.password) throw new Error('请填写站点、账户和密码');
        if (state.modal?.type === 'edit') {
            const original = state.modal.entry;
            const index = state.vault.entries.findIndex((item) => item.id === original.id);
            if (index < 0 || !sameValue(state.vault.entries[index], original)) {
                throw new Error('此条目已在后台更新或删除，请关闭编辑窗口后重新打开');
            }
            state.vault.entries[index] = { ...state.vault.entries[index], ...entry };
            state.selectedId = state.vault.entries[index].id;
        } else {
            const created: VaultEntry = { ...entry, id: vaultCore.makeId(), createdAt: now };
            state.vault.entries.unshift(created);
            state.selectedId = created.id;
        }
        state.inspectorRevealed = false;
        if (state.revealTimer) runtime.clearTimeout(state.revealTimer);
        state.revealTimer = null;
        await persistVault();
        if (state.draftTimer) runtime.clearTimeout(state.draftTimer);
        state.draftTimer = null;
        state.formDraft = null;
        state.savedDraft = null;
        await queueStorage(() => core.clearEncryptedDraft());
        state.modal = null;
        syncSelectedEntry();
        notify();
        api.toast('已保存到密码库');
    }

    function parseSyncConfigInputs(inputs: { repositoryUrl: string; branch: string; path: string; token: string }): SyncConfig {
        const repository = parseGithubRepository(inputs.repositoryUrl || '');
        return {
            ...repository,
            branch: String(inputs.branch || '').trim() || 'main',
            path: String(inputs.path || '').trim().replace(/^\/+|\/+$/g, '') || 'passwmana.vault',
            token: String(inputs.token || '').trim(),
        };
    }

    async function testSyncConnection(inputs: { repositoryUrl: string; branch: string; path: string; token: string }): Promise<string> {
        const sync = parseSyncConfigInputs(inputs);
        if (!sync.token) throw new Error('请填写访问令牌');
        const repository = await remoteRequest('GET', sync, undefined, { repository: true });
        if (!repository.private) throw new Error('该仓库不是私有仓库，请换用私有仓库');
        if (repository.permissions && repository.permissions.push !== true) throw new Error('令牌缺少 Contents 写入权限');
        const controller = new AbortController();
        const timer = runtime.setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
        try {
            const response = await runtime.fetch(
                `https://api.github.com/repos/${encodeURIComponent(sync.owner)}/${encodeURIComponent(sync.repo)}/branches/${encodeURIComponent(sync.branch)}`,
                { headers: githubHeaders(sync.token), cache: 'no-store', signal: controller.signal },
            );
            if (!response.ok) throw new Error('分支不存在或无权读取，请检查高级设置');
        } finally {
            runtime.clearTimeout(timer);
        }
        return repository.permissions
            ? '连接正常，仓库为私有且具有写入权限。保存后选择导入或初始化。'
            : '已验证私有仓库和分支可读取；GitHub 未报告写入权限，请确认 Contents 读写授权。';
    }

    async function submitSyncConfig(inputs: { repositoryUrl: string; branch: string; path: string; token: string }): Promise<void> {
        if (!state.vault || !state.record) return;
        const previous = state.vault.sync;
        const next: SyncConfig = { ...parseSyncConfigInputs(inputs), automatic: previous.automatic !== false };
        if (!syncConfigured(next)) throw new Error('请完整填写仓库、分支、路径与令牌');
        const targetChanged = (['owner', 'repo', 'branch', 'path'] as const).some((key) => previous[key] !== next[key]);
        stopSyncSession();
        state.vault.sync = next;
        if (targetChanged) {
            state.record.remoteSha = null;
            state.record.remoteEtag = '';
            delete state.record.syncBase;
            delete state.record.syncKeyBase;
            delete state.record.lastSyncedAt;
        }
        await persistVault();
        state.modal = { type: 'sync' };
        notify();
        startSyncSession();
        api.toast('配置已加密保存，请完成首次连接');
    }

    async function submitBackupUnlock(password: string): Promise<void> {
        const session = state.session;
        const modal = state.modal;
        if (modal?.type !== 'backup-unlock') return;
        const data = modal.rollback ? await core.getRollbackRecord() : modal.data;
        if (!data) throw new Error('此设备没有可回滚的保险库');
        try {
            const prepared = await core.prepareBackupRestore(data, { masterPassword: password });
            assertSyncSession(session);
            const restore = await api.askConfirm({
                title: modal.rollback ? '恢复替换前的保险库' : '恢复加密备份',
                message: '备份已验证。恢复会替换本机保险库，并保留替换前的加密副本。继续？',
                confirmLabel: modal.rollback ? '回滚保险库' : '恢复备份',
                danger: true,
            });
            if (!restore) return;
            await queueStorage(async () => { assertSyncSession(session); await core.commitBackupRestore(prepared); });
            state.record = prepared.record;
            state.localSaveError = null;
            lockVault();
            api.toast('备份已安全恢复，请用备份主密码解锁');
        } catch (error: any) {
            if (error?.name === 'OperationError') throw new Error('备份主密码错误或密文已损坏，原保险库已保留');
            throw error;
        }
    }

    async function submitEnableDeviceUnlock(password: string): Promise<void> {
        const session = state.session;
        const record = state.record!;
        const rawVaultKey = state.rawVaultKey!;
        try {
            const key = await core.deriveKey(password, record.masterSalt);
            await core.decryptText(record.wrappedVaultKey, key);
            assertSyncSession(session);
            if (record !== state.record) throw new Error('保险库已在后台更新，请关闭窗口后重新验证');
            await enableDeviceUnlock(record, rawVaultKey);
            if (!state.deviceUnlock) throw new Error('无法在此浏览器保管设备密钥，请检查网站数据是否被禁止保存');
            state.modal = null;
            notify();
            api.toast('已开启免密自动解锁，下次打开直接进入');
        } catch (error: any) {
            if (error?.name === 'OperationError') throw new Error('当前主密码错误，请输入正确的密码');
            throw error;
        }
    }

    async function submitDisableDeviceUnlock(): Promise<void> {
        await disableDeviceUnlock({ keepOpen: true });
        state.modal = null;
        notify();
    }

    async function submitChangePassword(currentPassword: string, newPassword: string, confirmPassword: string): Promise<void> {
        if (newPassword.length < 12) throw new Error('主密码至少需要 12 个字符');
        if (newPassword !== confirmPassword) throw new Error('两次新密码不一致');
        const session = state.session;
        const record = state.record!;
        const rawVaultKey = state.rawVaultKey!;
        const originalWrapping = { masterSalt: record.masterSalt, wrappedVaultKey: structuredClone(record.wrappedVaultKey) };
        try {
            const currentKey = await core.deriveKey(currentPassword, record.masterSalt);
            await core.decryptText(record.wrappedVaultKey, currentKey);
            const newSalt = vaultCore.randomBase64(16);
            const newKey = await core.deriveKey(newPassword, newSalt);
            const wrappedVaultKey = await core.encryptText(rawVaultKey, newKey);
            assertSyncSession(session);
            if (record !== state.record) return;
            if (!sameValue(originalWrapping, { masterSalt: record.masterSalt, wrappedVaultKey: record.wrappedVaultKey })) {
                throw new Error('主密码已在后台更新，请关闭窗口后重新验证');
            }
            record.masterSalt = newSalt;
            record.wrappedVaultKey = wrappedVaultKey;
            await persistVault();
            await rotateDeviceUnlock();
            state.modal = null;
            notify();
            api.toast('主密码已更新');
        } catch (error: any) {
            if (error?.name === 'OperationError') throw new Error('当前主密码错误，请重新输入');
            throw error;
        }
    }

    async function submitRecoveryReset(recoveryCode: string, newPassword: string, confirmPassword: string): Promise<void> {
        if (newPassword.length < 12) throw new Error('主密码至少需要 12 个字符');
        if (newPassword !== confirmPassword) throw new Error('两次新密码不一致');
        await acquireVaultLock();
        try {
            await storageQueue;
            state.record = await core.dbGet();
            const session = state.session;
            const record = state.record!;
            const { rawVaultKey } = await core.unlockWithRecovery(record, recoveryCode);
            const masterSalt = vaultCore.randomBase64(16);
            const masterKey = await core.deriveKey(newPassword, masterSalt);
            const wrappedVaultKey = await core.encryptText(rawVaultKey, masterKey);
            if (session !== state.session || record !== state.record) return;
            const next: EncryptedRecord = { ...record, masterSalt, wrappedVaultKey, updatedAt: new Date().toISOString(), dirty: true };
            await queueStorage(() => core.dbPut(next));
            state.record = next;
            await core.clearDeviceUnlock().catch(() => {});
            state.deviceUnlock = null;
            releaseVaultLock();
            state.modal = null;
            notify();
            api.toast(state.vaultKey ? '主密码已重设，免密自动解锁需要重新开启' : '主密码已重设');
        } catch (error: any) {
            if (!state.vaultKey) releaseVaultLock();
            if (error?.name === 'OperationError') throw new Error('恢复密钥无效，无法重设主密码');
            throw error;
        }
    }

    async function submitConflicts(choices: Record<string, 'local' | 'remote'>): Promise<void> {
        await resolveSyncConflicts(choices);
        if (state.syncConflict) {
            notify();
            api.toast('版本已变化，请检查最新差异后重新选择');
        } else if (!state.syncLastError) {
            state.modal = null;
            notify();
        } else {
            throw state.syncLastError;
        }
    }

    async function setupServiceWorker(): Promise<void> {
        if (!('serviceWorker' in runtime.navigator) || !runtime.navigator.serviceWorker) return;
        try {
            const registration = await runtime.navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
            state.serviceWorkerRegistration = registration;
            const announce = () => {
                if (!registration.waiting || !runtime.navigator.serviceWorker?.controller) return;
                state.updateReady = true;
                notify();
            };
            registration.addEventListener('updatefound', () => {
                registration.installing?.addEventListener('statechange', announce);
            });
            announce();
            runtime.navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (updateRequested) runtime.window?.location?.reload();
            });
        } catch { /* Normal vault access remains available if offline installation fails. */ }
    }

    async function bootstrap(): Promise<void> {
        try {
            const savedMode = (readPreference('passwmana-mode') || 'system') as ThemeMode;
            const savedAccent = (readPreference('passwmana-accent') || 'emerald') as AccentColor;
            const savedSort = readPreference('passwmana-sort');
            state.mode = ['system', 'light', 'dark'].includes(savedMode) ? savedMode : 'system';
            state.accent = ['emerald', 'blue', 'cyan', 'rose', 'amber', 'graphite'].includes(savedAccent) ? savedAccent : 'emerald';
            state.sort = Object.hasOwn(SORT_LABELS, savedSort || '') ? (savedSort as SortMode) : 'updated';
            if (typeof globalThis.document !== 'undefined') {
                globalThis.document.documentElement.dataset.mode = state.mode;
                globalThis.document.documentElement.dataset.accent = state.accent;
            }
            applyThemeColor();
            state.record = await core.dbGet();
            state.deviceUnlock = state.record ? await core.hasDeviceUnlock() : false;
            const term = new URLSearchParams((runtime.window?.location?.hash || '').slice(1)).get('search');
            if (term) state.search = term.slice(0, 200);
            state.bootstrapped = true;
            notify();
            void setupServiceWorker();
            void requestStoragePersistence().finally(() => refreshStorageStatus());
            if (state.record && state.deviceUnlock) {
                runtime.setTimeout(() => { void tryAutoResume(); }, 400);
            }
        } catch (error: any) {
            state.bootstrapped = true;
            state.bootstrapError = error.message;
            notify();
        }
    }

    const api = {
        state,
        subscribe,
        getSnapshot,
        notify,
        toast,
        askConfirm,
        askPrompt,
        showMessage,
        settleModal,
        openModal,
        closeModal,
        openAddModal,
        openEditModal,
        openDetail,
        openQuickSwitch,
        closeQuickSwitch,
        quickSwitchMatches,
        setQuickQuery,
        moveQuickIndex,
        activateQuickSwitch,
        currentEntries,
        resolvedSelectedEntry,
        currentVaultHeading,
        syncConfigured,
        syncStatus,
        storageStatusText,
        refreshStorageStatus,
        persistVault,
        persistSyncRecord,
        resetLockTimer,
        lockVault,
        startSyncSession,
        stopSyncSession,
        scheduleAutoSync,
        syncOnForeground,
        synchronize,
        pullRemote,
        pushRemote,
        resolveSyncConflicts,
        remoteRequest,
        remoteRecord,
        copyText,
        toggleRevealPassword,
        hideRevealedPassword,
        setSearch,
        clearFilters,
        setSort,
        setView,
        navFavorites,
        navCategory,
        navTrash,
        handleMobileLeft,
        closeDrawer,
        selectSettingPanel,
        setThemeMode,
        setAccent,
        toggleFavorite,
        updateDraft,
        persistEntryDraft,
        resumeDraft,
        discardDraft,
        deleteEntry,
        restoreEntry,
        purgeEntry,
        addCategory,
        deleteCategory,
        toggleAutoSync,
        setLockMinutes,
        downloadBackup,
        openBackupFilePicker,
        openLegacyBackupPicker,
        openRollbackBackup,
        requestStoragePersistFromUser,
        checkUpdate,
        applyUpdate,
        submitSetup,
        submitRecoveryConfirm,
        submitUnlock,
        submitRemoteUnlock,
        submitEntry,
        parseSyncConfigInputs,
        testSyncConnection,
        submitSyncConfig,
        submitBackupUnlock,
        submitEnableDeviceUnlock,
        submitDisableDeviceUnlock,
        submitChangePassword,
        submitRecoveryReset,
        submitConflicts,
        applyThemeColor,
        bootstrap,
        isMobileViewport,
        getDialogTrigger: () => dialogTrigger,
        clearDialogTrigger: () => { dialogTrigger = null; },
        getUpdateRequested: () => updateRequested,
        // Test-only hooks exposed on window.__testApi when __PASSWMANA_ENABLE_TEST_API__ is set.
        convertLegacyBackup,
        validateVault: core.validateVault,
        encryptText: core.encryptText,
        decryptText: core.decryptText,
        createVault: core.createVault,
        dbGet: core.dbGet,
    };

    return api;
}

export type VaultStore = ReturnType<typeof createVaultStore>;
export const vaultStore = createVaultStore();
