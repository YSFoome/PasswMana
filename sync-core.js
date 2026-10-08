// Pure three-way merge helpers. Credentials are deliberately excluded from conflict snapshots.
export function comparable(value) {
    if (Array.isArray(value)) return value.map(comparable);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().filter((key) => key !== 'updatedAt')
            .map((key) => [key, comparable(value[key])]));
    }
    return value;
}

export function sameValue(left, right) {
    return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function conflictError() {
    const error = new Error('两台设备修改了同一条目或设置。请查看冲突并选择要保留的版本。');
    error.code = 'conflict';
    error.retryable = false;
    return error;
}

function conflictPart(value) {
    // JSON escapes lone UTF-16 surrogates accepted in legacy imported IDs.
    return encodeURIComponent(JSON.stringify(value));
}

export function mergeValue(base, local, remote) {
    if (sameValue(local, remote) || sameValue(remote, base)) return local;
    if (sameValue(local, base)) return remote;
    throw conflictError();
}

export function vaultItems(vault) {
    return new Map([
        ...vault.entries.map((entry) => [entry.id, { location: 'entries', entry }]),
        ...vault.trash.map((entry) => [entry.id, { location: 'trash', entry }]),
    ]);
}

export function conflictVaultSnapshot(vault) {
    return structuredClone({ entries: vault.entries, trash: vault.trash,
        categories: vault.categories, preferences: vault.preferences });
}

// This strict interface keeps compatibility for callers expecting one conflict per item.
export function mergeVaults(base, local, remote) {
    const result = mergeVaultChanges(base, local, remote, { fieldMerge: false });
    if (result.conflicts.length) throw conflictError();
    return result.vault;
}

export function collectVaultConflicts(base, local, remote) {
    return mergeVaultChanges(base, local, remote).conflicts;
}

export function mergeVaultChanges(base, local, remote, { choices = {}, fieldMerge = true } = {}) {
    const conflicts = [];
    const merged = { ...local, entries: [], trash: [], categories: [], preferences: {} };
    const decide = (before, here, there, details) => {
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
        const details = { id: `entry:${conflictPart(id)}:record`, kind: 'entry', entryId: id,
            title: here?.entry.title || there?.entry.title || before?.entry.title || id, field: 'record' };
        let item;
        if (fieldMerge && before && here && there && before.location === here.location && here.location === there.location
            && !sameValue(here, there) && !sameValue(before, here) && !sameValue(before, there)) {
            const entry = {};
            for (const field of new Set([...Object.keys(before.entry), ...Object.keys(here.entry), ...Object.keys(there.entry)])) {
                if (field === 'updatedAt') continue;
                const value = decide(before.entry[field], here.entry[field], there.entry[field],
                    { ...details, id: `entry:${conflictPart(id)}:${conflictPart(field)}`, field });
                if (value !== undefined) Object.defineProperty(entry, field, { value: structuredClone(value), writable: true, enumerable: true, configurable: true });
            }
            entry.updatedAt = [before.entry.updatedAt, here.entry.updatedAt, there.entry.updatedAt].filter(Boolean).sort().at(-1);
            item = { location: here.location, entry };
        } else {
            item = decide(before, here, there, details);
        }
        if (item) merged[item.location].push(structuredClone(item.entry));
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
        const value = decide(base.preferences?.[field], local.preferences?.[field], remote.preferences?.[field],
            { id: `preference:${conflictPart(field)}`, kind: 'preference', title: '偏好设置', field });
        if (value !== undefined) Object.defineProperty(merged.preferences, field,
            { value: structuredClone(value), writable: true, enumerable: true, configurable: true });
    }
    return { vault: merged, conflicts };
}

export function keyMetadata(record) {
    return structuredClone({ masterSalt: record.masterSalt, wrappedVaultKey: record.wrappedVaultKey,
        recoverySalt: record.recoverySalt, recoveryWrappedVaultKey: record.recoveryWrappedVaultKey });
}

// Salts and wrappers form one atomic version: they must never be combined field by field.
export function mergeKeyMetadata(base, local, remote, choice) {
    if (sameValue(local, remote)) return { metadata: local, conflicts: [] };
    if (base) {
        if (sameValue(remote, base)) return { metadata: local, conflicts: [] };
        if (sameValue(local, base)) return { metadata: remote, conflicts: [] };
    }
    if (choice === 'local' || choice === 'remote') return { metadata: choice === 'local' ? local : remote, conflicts: [] };
    return { metadata: local, conflicts: [{ id: 'key:master-password', kind: 'master-password', title: '主密码与恢复密钥', field: 'masterPassword',
        base: base ? '最后一次同步时的密码设置' : '旧版记录未保存密码同步基线',
        local: '保留此设备的主密码与恢复密钥', remote: '采用远端设备的主密码与恢复密钥' }] };
}
