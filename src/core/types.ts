export interface EncryptedValue {
    iv: string;
    data: string;
}

export interface KeyMetadata {
    masterSalt: string;
    recoverySalt: string;
    wrappedVaultKey: EncryptedValue;
    recoveryWrappedVaultKey: EncryptedValue;
}

export interface EncryptedRecord extends KeyMetadata {
    format: 'passwmana-v1';
    createdAt: string;
    updatedAt: string;
    encryptedVault: EncryptedValue;
    syncBase?: EncryptedValue | null;
    syncKeyBase?: KeyMetadata | null;
    remoteSha: string | null;
    remoteEtag?: string;
    dirty?: boolean;
    lastSyncedAt?: string;
}

export interface VaultEntry {
    id: string;
    title: string;
    username: string;
    password: string;
    category: string;
    url: string;
    notes: string;
    favorite: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface TrashedEntry extends VaultEntry {
    deletedAt: string;
}

export interface VaultPreferences {
    lockMinutes?: number;
    [key: string]: string | number | boolean | null | undefined;
}

export interface SyncConfig {
    owner: string;
    repo: string;
    branch: string;
    path: string;
    token: string;
    automatic?: boolean;
}

export interface VaultData {
    entries: VaultEntry[];
    trash: TrashedEntry[];
    categories: string[];
    preferences: VaultPreferences;
    sync: SyncConfig;
}

export interface EntryFormValues {
    title: string;
    username: string;
    password: string;
    category: string;
    url: string;
    notes: string;
    favorite: boolean;
}

export interface EntryDraft {
    type: 'add-entry' | 'edit-entry';
    values: Partial<EntryFormValues>;
    entryId?: string;
    entry?: VaultEntry;
}

export interface VaultConflictItem {
    id: string;
    kind: 'entry' | 'preference' | 'master-password';
    entryId?: string;
    title: string;
    field: string;
    base: unknown;
    local: unknown;
    remote: unknown;
}

export interface SyncConflictState {
    sha: string;
    revision: number;
    base: Pick<VaultData, 'entries' | 'trash' | 'categories' | 'preferences'>;
    local: Pick<VaultData, 'entries' | 'trash' | 'categories' | 'preferences'>;
    remote: Pick<VaultData, 'entries' | 'trash' | 'categories' | 'preferences'>;
    conflicts: VaultConflictItem[];
}

export interface PendingRemoteState {
    payload: EncryptedRecord;
    sync: SyncConfig;
    revision: number;
}

export type SortMode = 'updated' | 'title' | 'created';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentColor = 'emerald' | 'blue' | 'cyan' | 'rose' | 'amber' | 'graphite';
export type AppView = 'vault' | 'settings';
export type SettingPanel = 'sync' | 'security' | 'appearance' | 'categories' | 'trash';

export interface StorageStatus {
    supported: boolean;
    persisted?: boolean;
    usage?: number | null;
    quota?: number | null;
}

export interface SyncStatusInfo {
    label: string;
    detail: string;
    status: 'local' | 'syncing' | 'pending' | 'synced' | 'error';
    icon: 'hard-drive' | 'refresh-cw' | 'cloud-off' | 'cloud-upload' | 'circle-alert';
}

export interface ToastItem {
    id: number;
    message: string;
}

export type ModalState =
    | { type: 'recovery-created'; code: string }
    | { type: 'confirm'; title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; previousModal?: ModalState | null; resolve?: (value: boolean) => void }
    | { type: 'prompt'; title: string; message?: string; label?: string; value?: string; placeholder?: string; confirmLabel?: string; previousModal?: ModalState | null; resolve?: (value: string | null) => void }
    | { type: 'message'; title: string; message: string; confirmLabel?: string }
    | { type: 'add'; draft?: EntryDraft }
    | { type: 'edit'; entry: VaultEntry; draft?: EntryDraft }
    | { type: 'detail'; id: string; revealed: boolean }
    | { type: 'sync' }
    | { type: 'sync-result'; title: string; message: string }
    | { type: 'conflicts' }
    | { type: 'remote-unlock' }
    | { type: 'quick-switch'; query: string; index: number; previousModal?: ModalState | null }
    | { type: 'backup-unlock'; rollback?: boolean; data?: unknown }
    | { type: 'sync-config'; step?: 1 | 2; configDraft?: Partial<SyncConfig>; connectionResult?: string }
    | { type: 'enable-device-unlock' }
    | { type: 'disable-device-unlock' }
    | { type: 'change-password' }
    | { type: 'recovery-reset' };
