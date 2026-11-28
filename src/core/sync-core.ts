// Pure three-way merge helpers. Credentials are deliberately excluded from conflict snapshots.
import type {
    EncryptedRecord,
    KeyMetadata,
    TrashedEntry,
    VaultConflictItem,
    VaultData,
    VaultEntry,
} from './types';
import { VaultError } from './vault-core';

export function comparable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(comparable);
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(
            Object.keys(record).sort().filter((key) => key !== 'updatedAt')
                .map((key) => [key, comparable(record[key])]),
        );
    }
    return value;
}

export function sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function conflictError(): VaultError {
    return new VaultError('两台设备修改了同一条目或设置。请查看冲突并选择要保留的版本。', 'conflict', false);
}

function conflictPart(value: unknown): string {
    // JSON escapes lone UTF-16 surrogates accepted in legacy imported IDs.
    return encodeURIComponent(JSON.stringify(value));
}

export function mergeValue<T>(base: T, local: T, remote: T): T {
    if (sameValue(local, remote) || sameValue(remote, base)) return local;
    if (sameValue(local, base)) return remote;
    throw conflictError();
}

export type VaultItemLocation = { location: 'entries'; entry: VaultEntry } | { location: 'trash'; entry: TrashedEntry };

export function vaultItems(vault: Pick<VaultData, 'entries' | 'trash'>): Map<string, VaultItemLocation> {
    return new Map<string, VaultItemLocation>([
        ...vault.entries.map((entry): [string, VaultItemLocation] => [entry.id, { location: 'entries', entry }]),
        ...vault.trash.map((entry): [string, VaultItemLocation] => [entry.id, { location: 'trash', entry }]),
    ]);
}

export function conflictVaultSnapshot(vault: VaultData): Pick<VaultData, 'entries' | 'trash' | 'categories' | 'preferences'> {
    return structuredClone({
        entries: vault.entries,
        trash: vault.trash,
        categories: vault.categories,
        preferences: vault.preferences,
    });
}

// This strict interface keeps compatibility for callers expecting one conflict per item.
export function mergeVaults(base: VaultData, local: VaultData, remote: VaultData): VaultData {
    const result = mergeVaultChanges(base, local, remote, { fieldMerge: false });
    if (result.conflicts.length) throw conflictError();
    return result.vault;
}

export function collectVaultConflicts(base: VaultData, local: VaultData, remote: VaultData): VaultConflictItem[] {
    return mergeVaultChanges(base, local, remote).conflicts;
}

export function mergeVaultChanges(
    base: VaultData,
    local: VaultData,
    remote: VaultData,
    { choices = {}, fieldMerge = true }: { choices?: Record<string, 'local' | 'remote'>; fieldMerge?: boolean } = {},
): { vault: VaultData; conflicts: VaultConflictItem[] } {
    const conflicts: VaultConflictItem[] = [];
    const merged: VaultData = { ...local, entries: [], trash: [], categories: [], preferences: {} };
    const decide = <T>(
        before: T,
        here: T,
        there: T,
        details: Omit<VaultConflictItem, 'base' | 'local' | 'remote'>,
    ): T => {
        try { return mergeValue(before, here, there); }
        catch {
            const choice = Object.hasOwn(choices, details.id) ? choices[details.id] : undefined;
            if (choice === 'local') return here;
            if (choice === 'remote') return there;
            conflicts.push({ ...details, base: structuredClone(before), local: structuredClone(here), remote: structuredClone(there) });
            return here;
        }
    };
    const baseItems = vaultItems(base);
    const localItems = vaultItems(local);
    const remoteItems = vaultItems(remote);
    for (const id of new Set([...localItems.keys(), ...remoteItems.keys(), ...baseItems.keys()])) {
        const before = baseItems.get(id);
        const here = localItems.get(id);
        const there = remoteItems.get(id);
        const details: Omit<VaultConflictItem, 'base' | 'local' | 'remote'> = {
            id: `entry:${conflictPart(id)}:record`,
            kind: 'entry',
            entryId: id,
            title: here?.entry.title || there?.entry.title || before?.entry.title || id,
            field: 'record',
        };
        let item: VaultItemLocation | undefined;
        if (fieldMerge && before && here && there && before.location === here.location && here.location === there.location
            && !sameValue(here, there) && !sameValue(before, here) && !sameValue(before, there)) {
            const entry: Record<string, unknown> = {};
            const beforeRecord = before.entry as unknown as Record<string, unknown>;
            const hereRecord = here.entry as unknown as Record<string, unknown>;
            const thereRecord = there.entry as unknown as Record<string, unknown>;
            for (const field of new Set([...Object.keys(beforeRecord), ...Object.keys(hereRecord), ...Object.keys(thereRecord)])) {
                if (field === 'updatedAt') continue;
                const value = decide(
                    beforeRecord[field],
                    hereRecord[field],
                    thereRecord[field],
                    { ...details, id: `entry:${conflictPart(id)}:${conflictPart(field)}`, field },
                );
                if (value !== undefined) {
                    Object.defineProperty(entry, field, {
                        value: structuredClone(value),
                        writable: true,
                        enumerable: true,
                        configurable: true,
                    });
                }
            }
            entry.updatedAt = [before.entry.updatedAt, here.entry.updatedAt, there.entry.updatedAt].filter(Boolean).sort().at(-1);
            item = { location: here.location, entry: entry as unknown as VaultEntry } as VaultItemLocation;
        } else {
            item = decide(before, here, there, details);
        }
        if (item) {
            if (item.location === 'trash') merged.trash.push(structuredClone(item.entry));
            else merged.entries.push(structuredClone(item.entry));
        }
    }
    for (const category of new Set([...local.categories, ...remote.categories, ...base.categories])) {
        if (mergeValue(base.categories.includes(category), local.categories.includes(category), remote.categories.includes(category))) {
            merged.categories.push(category);
        }
    }
    for (const entry of [...merged.entries, ...merged.trash]) {
        if (entry.category && !merged.categories.includes(entry.category)) merged.categories.push(entry.category);
    }
    for (const field of new Set([...Object.keys(base.preferences || {}), ...Object.keys(local.preferences || {}), ...Object.keys(remote.preferences || {})])) {
        const value = decide(
            base.preferences?.[field],
            local.preferences?.[field],
            remote.preferences?.[field],
            { id: `preference:${conflictPart(field)}`, kind: 'preference', title: '偏好设置', field },
        );
        if (value !== undefined) {
            Object.defineProperty(merged.preferences, field, {
                value: structuredClone(value),
                writable: true,
                enumerable: true,
                configurable: true,
            });
        }
    }
    return { vault: merged, conflicts };
}

export function keyMetadata(record: Pick<EncryptedRecord, 'masterSalt' | 'wrappedVaultKey' | 'recoverySalt' | 'recoveryWrappedVaultKey'>): KeyMetadata {
    return structuredClone({
        masterSalt: record.masterSalt,
        wrappedVaultKey: record.wrappedVaultKey,
        recoverySalt: record.recoverySalt,
        recoveryWrappedVaultKey: record.recoveryWrappedVaultKey,
    });
}

// Salts and wrappers form one atomic version: they must never be combined field by field.
export function mergeKeyMetadata(
    base: KeyMetadata | null | undefined,
    local: KeyMetadata,
    remote: KeyMetadata,
    choice?: 'local' | 'remote',
): { metadata: KeyMetadata; conflicts: VaultConflictItem[] } {
    if (sameValue(local, remote)) return { metadata: local, conflicts: [] };
    if (base) {
        if (sameValue(remote, base)) return { metadata: local, conflicts: [] };
        if (sameValue(local, base)) return { metadata: remote, conflicts: [] };
    }
    if (choice === 'local' || choice === 'remote') return { metadata: choice === 'local' ? local : remote, conflicts: [] };
    return {
        metadata: local,
        conflicts: [{
            id: 'key:master-password',
            kind: 'master-password',
            title: '主密码与恢复密钥',
            field: 'masterPassword',
            base: base ? '最后一次同步时的密码设置' : '旧版记录未保存密码同步基线',
            local: '保留此设备的主密码与恢复密钥',
            remote: '采用远端设备的主密码与恢复密钥',
        }],
    };
}
