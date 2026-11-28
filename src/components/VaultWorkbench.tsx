import {
    CircleAlert,
    CloudOff,
    CloudUpload,
    ExternalLink,
    Eye,
    EyeOff,
    FileText,
    Globe,
    HardDrive,
    KeyRound,
    Plus,
    RefreshCw,
    Search,
    ShieldCheck,
    Star,
    Trash2,
    Upload,
    User,
    Vault,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { formatShortDate, hostOf, identityTab, monogramOf, passwordStrengthLevel, safeWebUrl } from '@/core/ui-helpers';
import { SORT_LABELS, vaultStore, type VaultState } from '@/core/vault-store';
import type { SortMode, VaultEntry } from '@/core/types';
import { cn } from '@/lib/utils';
import {
    AmicroButton,
    AmicroCopyButton,
    AmicroFavoriteButton,
    AmicroKbd,
    AmicroSecretReveal,
    AmicroSpotlightCard,
} from './amicro';

export function SyncIcon({ icon, spinning }: { icon: string; spinning: boolean }) {
    const className = cn('w-4 h-4 flex-none', spinning && 'is-spinning');
    switch (icon) {
        case 'circle-alert': return <CircleAlert className={className} strokeWidth={1.8} />;
        case 'hard-drive': return <HardDrive className={className} strokeWidth={1.8} />;
        case 'cloud-off': return <CloudOff className={className} strokeWidth={1.8} />;
        case 'cloud-upload': return <CloudUpload className={className} strokeWidth={1.8} />;
        default: return <RefreshCw className={className} strokeWidth={1.8} />;
    }
}

export function DetailFields({ entry, revealed }: { entry: VaultEntry; revealed: boolean }) {
    const safeUrl = safeWebUrl(entry.url);
    const host = hostOf(entry);
    const strength = passwordStrengthLevel(entry.password);
    const strengthTone = strength.tone === 'strong'
        ? 'text-[var(--calm)] bg-[var(--calm-soft)] border-[var(--calm)]/20'
        : strength.tone === 'fair'
            ? 'text-[var(--caution)] bg-[var(--caution-soft)] border-[var(--caution)]/20'
            : 'text-[var(--alert)] bg-[var(--alert-soft)] border-[var(--alert)]/20';
    const strengthWord = strength.tone === 'strong' ? '强密码' : strength.tone === 'fair' ? '中等' : '较弱';

    return (
        <dl className="detail-fields m-0 grid gap-3">
            {/* Password Bento Spotlight Stage */}
            <AmicroSpotlightCard className="detail-row p-4 grid gap-2.5 bg-[var(--card)]">
                <dt className="flex items-center justify-between gap-2 text-[12px] font-medium text-[var(--faint)]">
                    <span className="inline-flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-[var(--accent)]" strokeWidth={1.9} />
                        <span>密码密钥</span>
                    </span>
                    <span className={cn('px-2 py-0.5 rounded-full border text-[11px] font-semibold', strengthTone)}>
                        {strengthWord}
                    </span>
                </dt>
                <dd className="detail-val-row m-0 flex items-center justify-between gap-2 min-w-0 pt-0.5">
                    <AmicroSecretReveal password={entry.password} revealed={revealed} />
                    <span className="detail-actions flex items-center gap-1 flex-none">
                        <button
                            type="button"
                            className="icon-button w-8 h-8 inline-grid place-items-center rounded-lg border border-transparent bg-transparent text-[var(--faint)] cursor-pointer hover:bg-[var(--bg-hover)] hover:border-[var(--rule)] hover:text-[var(--ink)]"
                            data-action="reveal-password"
                            data-id={entry.id}
                            title={revealed ? '隐藏密码' : '显示密码'}
                            aria-label={revealed ? '隐藏密码' : '显示密码'}
                            aria-pressed={revealed}
                            onClick={() => vaultStore.toggleRevealPassword(entry.id)}
                        >
                            {revealed ? <EyeOff className="w-4 h-4" strokeWidth={1.8} /> : <Eye className="w-4 h-4" strokeWidth={1.8} />}
                        </button>
                        <AmicroCopyButton
                            data-action="copy-password"
                            data-id={entry.id}
                            title="复制密码"
                            aria-label="复制密码"
                            onCopy={() => vaultStore.copyText(entry.password)}
                        />
                    </span>
                </dd>
            </AmicroSpotlightCard>

            {/* 2-Column Bento Credential Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <AmicroSpotlightCard className="detail-row p-4 grid gap-1.5 bg-[var(--card)]">
                    <dt className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--faint)]">
                        <User className="w-3.5 h-3.5" strokeWidth={1.8} />
                        <span>账户</span>
                    </dt>
                    <dd className="detail-val-row m-0 flex items-center justify-between gap-2 min-w-0">
                        <span className="machine text-[13.5px] text-[var(--ink)] [overflow-wrap:anywhere] min-w-0">{entry.username || '未设置'}</span>
                        <span className="detail-actions flex items-center gap-1 flex-none">
                            <AmicroCopyButton
                                data-action="copy-account"
                                data-id={entry.id}
                                title="复制账户"
                                aria-label="复制账户"
                                onCopy={() => vaultStore.copyText(entry.username, '账户已复制', { clearAfter: 0 })}
                            />
                        </span>
                    </dd>
                </AmicroSpotlightCard>

                <AmicroSpotlightCard className="detail-row p-4 grid gap-1.5 bg-[var(--card)]">
                    <dt className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--faint)]">
                        <Globe className="w-3.5 h-3.5" strokeWidth={1.8} />
                        <span>网站</span>
                    </dt>
                    <dd className="detail-val-row m-0 flex items-center justify-between gap-2 min-w-0">
                        {safeUrl ? (
                            <>
                                <a
                                    className="detail-link inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--accent)] hover:underline break-all min-w-0"
                                    href={safeUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <span className="truncate">{host || safeUrl}</span>
                                    <ExternalLink className="w-3.5 h-3.5 flex-none" strokeWidth={1.8} />
                                </a>
                                <span className="detail-actions flex items-center gap-1 flex-none">
                                    <AmicroCopyButton
                                        data-action="copy-url"
                                        data-id={entry.id}
                                        title="复制网址"
                                        aria-label="复制网址"
                                        onCopy={() => vaultStore.copyText(entry.url, '网址已复制', { clearAfter: 0 })}
                                    />
                                </span>
                            </>
                        ) : (
                            <span className="text-[13.5px] text-[var(--muted)] break-all">{entry.url || '未设置'}</span>
                        )}
                    </dd>
                </AmicroSpotlightCard>
            </div>

            {entry.notes ? (
                <AmicroSpotlightCard className="detail-row p-4 grid gap-1.5 bg-[var(--card)]">
                    <dt className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--faint)]">
                        <FileText className="w-3.5 h-3.5" strokeWidth={1.8} />
                        <span>备注</span>
                    </dt>
                    <dd className="detail-note m-0 text-[13.5px] text-[var(--ink)] whitespace-pre-wrap break-words leading-relaxed">
                        {entry.notes}
                    </dd>
                </AmicroSpotlightCard>
            ) : null}
        </dl>
    );
}

function EntryRow({
    entry,
    selected,
}: {
    entry: VaultEntry;
    selected: boolean;
}) {
    const tone = identityTab(entry);
    return (
        <div className={cn('entry-row', selected && 'selected')} data-entry-id={entry.id}>
            {selected && (
                <span
                    className="w-1 h-5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent-glow)] ml-1 flex-none"
                    aria-hidden="true"
                />
            )}
            <button
                type="button"
                className="entry flex-1 min-w-0 flex items-center gap-3 px-2.5 py-2 border-0 bg-transparent text-left cursor-pointer rounded-[10px]"
                data-action="open-detail"
                data-id={entry.id}
                onClick={() => vaultStore.openDetail(entry.id)}
            >
                <span className="monogram" data-tab={tone}>{monogramOf(entry)}</span>
                <span className="entry-copy min-w-0 grid gap-0.5">
                    <span className="entry-name flex items-center gap-1.5 text-[14px] font-semibold text-[var(--ink)] truncate">
                        <span className="truncate">{entry.title}</span>
                        {entry.favorite && <Star className="w-3.5 h-3.5 starred flex-none" strokeWidth={1.8} />}
                    </span>
                    <span className="entry-account text-[12px] text-[var(--muted)] truncate">
                        {entry.username || '未设置账户'}
                    </span>
                </span>
            </button>
            <AmicroCopyButton
                className="entry-copy-btn"
                data-action="copy-password"
                data-id={entry.id}
                title="复制密码"
                aria-label={`复制 ${entry.title} 的密码`}
                onCopy={() => vaultStore.copyText(entry.password)}
            />
        </div>
    );
}

function VaultInspector({
    state,
    selected,
}: {
    state: VaultState;
    selected: VaultEntry | null;
}) {
    if (state.modal?.type === 'detail') return null;
    if (!selected) {
        return (
            <div className="inspector-empty h-full min-h-[320px] grid place-content-center justify-items-center gap-3 text-center text-[var(--faint)] text-[14px]">
                <span className="w-14 h-14 rounded-2xl grid place-items-center bg-[var(--card-2)] border border-[var(--rule)]">
                    <ShieldCheck className="w-7 h-7 opacity-55" strokeWidth={1.5} />
                </span>
                <div>{state.vault?.entries.length ? '选择一条密码查看详情' : '添加密码后可在此查看详情'}</div>
            </div>
        );
    }

    const tone = identityTab(selected);
    const revealed = Boolean(state.inspectorRevealed && state.selectedId === selected.id);
    const host = hostOf(selected);

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="inspector-inner max-w-[640px] mx-auto grid gap-4"
            >
                {/* Hero Bento Spotlight Card */}
                <AmicroSpotlightCard className="p-5 bg-[var(--card)]">
                    <header className="insp-header flex items-center gap-4">
                        <span className="monogram lg" data-tab={tone}>{monogramOf(selected)}</span>
                        <div className="min-w-0 flex-1 grid gap-1">
                            <h2 className="insp-title m-0 text-[21px] font-bold tracking-tight text-[var(--ink)] break-words">
                                {selected.title}
                            </h2>
                            <div className="flex items-center gap-1.5 flex-wrap text-[11.5px] text-[var(--muted)]">
                                <span className="px-2 py-0.5 rounded-full bg-[var(--card-2)] border border-[var(--rule)]">
                                    {selected.category || '未分类'}
                                </span>
                                {host && (
                                    <span className="machine px-2 py-0.5 rounded-full bg-[var(--card-2)] border border-[var(--rule)] truncate max-w-[200px]">
                                        {host}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="insp-header-actions flex items-center gap-1.5 flex-none">
                            <AmicroFavoriteButton
                                favorite={Boolean(selected.favorite)}
                                justFavorited={state.lastFavoriteAnimationId === selected.id}
                                entryId={selected.id}
                                title={selected.title}
                                onToggle={() => void vaultStore.toggleFavorite(selected.id)}
                            />
                            <AmicroButton
                                variant="secondary"
                                data-action="open-edit"
                                data-id={selected.id}
                                onClick={() => vaultStore.openEditModal(selected.id)}
                            >
                                编辑
                            </AmicroButton>
                        </div>
                    </header>
                </AmicroSpotlightCard>

                <DetailFields entry={selected} revealed={revealed} />

                <footer className="insp-footer flex items-center justify-between gap-3 flex-wrap px-1 pt-1">
                    <span className="insp-meta text-[12px] text-[var(--faint)]">
                        最近更新 {formatShortDate(selected.updatedAt)}
                    </span>
                    <AmicroButton
                        variant="danger-text"
                        data-action="delete-entry"
                        data-id={selected.id}
                        onClick={() => void vaultStore.deleteEntry(selected.id)}
                    >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                        <span>移至回收站</span>
                    </AmicroButton>
                </footer>
            </motion.div>
        </AnimatePresence>
    );
}

export function VaultWorkbench({ state }: { state: VaultState }) {
    if (!state.vault) return null;
    const entries = vaultStore.currentEntries();
    const selected = vaultStore.resolvedSelectedEntry(entries);
    const status = vaultStore.syncStatus();
    const actionable = status.status === 'error' || (vaultStore.syncConfigured() && !state.record?.remoteSha);
    const isGrouped = state.sort === 'updated' && !state.favoriteOnly && entries.some((e) => e.favorite) && entries.some((e) => !e.favorite);

    return (
        <section className={cn('view flex-1 flex flex-col min-h-0', state.view !== 'vault' && 'hidden')} data-view="vault">
            <div className="vault-workbench">
                <div className="vault-stream">
                    <div className="toolbar flex items-center gap-2 p-3.5 border-b border-[var(--rule)]">
                        <div className="search relative flex-1 min-w-0 flex items-center">
                            <Search className="w-4 h-4 text-[var(--faint)] absolute left-3 pointer-events-none" strokeWidth={1.8} />
                            <input
                                className="field pl-9 pr-9"
                                type="search"
                                data-input="search"
                                placeholder="搜索"
                                value={state.search}
                                onChange={(e) => vaultStore.setSearch(e.target.value)}
                                aria-label="搜索密码库"
                                autoComplete="off"
                                spellCheck={false}
                                autoCapitalize="off"
                            />
                            {!state.search && (
                                <span className="max-[899px]:hidden absolute right-2.5 pointer-events-none">
                                    <AmicroKbd>/</AmicroKbd>
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => vaultStore.openQuickSwitch()}
                            title="快速切换 (Ctrl+K)"
                            aria-label="快速切换"
                            className="max-[899px]:hidden h-9 px-2.5 inline-flex items-center gap-1 rounded-[10px] border border-[var(--rule)] bg-[var(--card-2)] text-[var(--muted)] cursor-pointer hover:border-[var(--rule-strong)] hover:text-[var(--ink)] transition-colors flex-none"
                        >
                            <AmicroKbd className="border-0 bg-transparent shadow-none px-0">Ctrl K</AmicroKbd>
                        </button>
                        <AmicroButton
                            variant="primary"
                            data-action="open-add"
                            onClick={() => vaultStore.openAddModal()}
                            className="max-[899px]:hidden"
                        >
                            <Plus className="w-4 h-4" strokeWidth={2} />
                            <span>新增</span>
                        </AmicroButton>
                    </div>

                    <div className="mobile-cats">
                        <button
                            type="button"
                            className={cn(
                                'mobile-cat shrink-0 px-3 py-1.5 rounded-full border text-[12.5px] font-medium cursor-pointer transition-colors',
                                !state.category && !state.favoriteOnly
                                    ? 'active bg-[var(--ink)] text-[var(--on-ink)] border-[var(--ink)]'
                                    : 'bg-transparent text-[var(--muted)] border-[var(--rule)]',
                            )}
                            data-action="view"
                            data-view-name="vault"
                            onClick={() => vaultStore.setView('vault')}
                        >
                            全部
                        </button>
                        <button
                            type="button"
                            className={cn(
                                'mobile-cat shrink-0 px-3 py-1.5 rounded-full border text-[12.5px] font-medium cursor-pointer transition-colors',
                                state.favoriteOnly
                                    ? 'active bg-[var(--ink)] text-[var(--on-ink)] border-[var(--ink)]'
                                    : 'bg-transparent text-[var(--muted)] border-[var(--rule)]',
                            )}
                            data-action="nav-favorites"
                            onClick={() => vaultStore.navFavorites()}
                        >
                            收藏
                        </button>
                        {state.vault.categories.map((category) => (
                            <button
                                type="button"
                                key={category}
                                className={cn(
                                    'mobile-cat shrink-0 px-3 py-1.5 rounded-full border text-[12.5px] font-medium cursor-pointer transition-colors',
                                    !state.favoriteOnly && state.category === category
                                        ? 'active bg-[var(--ink)] text-[var(--on-ink)] border-[var(--ink)]'
                                        : 'bg-transparent text-[var(--muted)] border-[var(--rule)]',
                                )}
                                data-action="nav-category"
                                data-category={category}
                                onClick={() => vaultStore.navCategory(category)}
                            >
                                {category}
                            </button>
                        ))}
                    </div>

                    <div className="stream-scroll flex-1 overflow-y-auto px-3 py-3 pb-24 sm:pb-5">
                        {actionable && (
                            <div
                                className="notice mb-3 p-3 rounded-xl border border-[var(--rule)] bg-[var(--card-2)] flex items-center justify-between gap-2.5 flex-wrap"
                                data-sync-status={status.status}
                            >
                                <div className="notice-copy flex items-center gap-2 text-[12.5px] text-[var(--ink)] min-w-0 flex-1">
                                    <span data-sync-icon=""><SyncIcon icon={status.icon} spinning={Boolean(state.syncing)} /></span>
                                    <span data-sync-detail="" className="break-words">{status.detail}</span>
                                </div>
                                <AmicroButton
                                    variant="secondary"
                                    data-action="open-sync"
                                    onClick={() => vaultStore.openModal({ type: 'sync' }, { action: 'open-sync' })}
                                >
                                    同步详情
                                </AmicroButton>
                            </div>
                        )}

                        <div className="list-heading-row flex items-center justify-between gap-2 px-1.5 pb-2.5 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                                <h1 className="list-heading m-0 text-[17px] font-bold tracking-tight text-[var(--ink)] truncate">
                                    {vaultStore.currentVaultHeading()}
                                </h1>
                                <span className="text-[11px] machine px-1.5 py-0.5 rounded-md bg-[var(--card-2)] border border-[var(--rule)] text-[var(--faint)]">
                                    {entries.length}
                                </span>
                            </div>
                            <select
                                className="sort-filter border border-[var(--rule)] rounded-lg bg-[var(--card-2)] text-[var(--muted)] text-[12px] font-medium px-2.5 py-1 cursor-pointer"
                                data-input="sort"
                                aria-label="排序方式"
                                value={state.sort}
                                onChange={(e) => vaultStore.setSort(e.target.value as SortMode)}
                            >
                                {Object.entries(SORT_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="vault-list grid gap-1" data-vault-list="">
                            {!state.vault.entries.length ? (
                                <div className="empty-state py-14 px-4 text-center grid justify-items-center gap-2.5 text-[var(--muted)]">
                                    <span className="w-12 h-12 rounded-2xl grid place-items-center bg-[var(--card-2)] border border-[var(--rule)]">
                                        <Vault className="w-6 h-6 text-[var(--faint)]" strokeWidth={1.6} />
                                    </span>
                                    <h2 className="m-0 text-[16.5px] font-semibold text-[var(--ink)]">这里还空着</h2>
                                    <p className="m-0 text-[13.5px] text-[var(--muted)] max-w-[260px]">
                                        记下第一个账号，它只会加密保存在这台设备。
                                    </p>
                                    <div className="empty-actions flex items-center justify-center gap-2 flex-wrap mt-2">
                                        <AmicroButton variant="primary" data-action="open-add" onClick={() => vaultStore.openAddModal()}>
                                            <Plus className="w-4 h-4" strokeWidth={2} />
                                            <span>添加第一条密码</span>
                                        </AmicroButton>
                                        <AmicroButton variant="secondary" data-action="import-backup" onClick={() => vaultStore.openBackupFilePicker()}>
                                            <Upload className="w-4 h-4" strokeWidth={1.8} />
                                            <span>从备份导入</span>
                                        </AmicroButton>
                                    </div>
                                </div>
                            ) : !entries.length ? (
                                <div className="empty-state py-14 px-4 text-center grid justify-items-center gap-2.5 text-[var(--muted)]">
                                    <Search className="w-9 h-9 text-[var(--faint)] opacity-60" strokeWidth={1.5} />
                                    <h2 className="m-0 text-[16.5px] font-semibold text-[var(--ink)]">没有找到匹配的条目</h2>
                                    <p className="m-0 text-[13.5px] text-[var(--muted)]">换个关键词，或者清除当前的筛选。</p>
                                    <AmicroButton variant="secondary" data-action="clear-filters" onClick={() => vaultStore.clearFilters()} className="mt-1">
                                        清除筛选
                                    </AmicroButton>
                                </div>
                            ) : isGrouped ? (
                                <>
                                    <div className="group-heading px-2.5 pt-1.5 pb-1 text-[11px] font-semibold text-[var(--faint)] uppercase tracking-wider">
                                        收藏
                                    </div>
                                    {entries.filter((e) => e.favorite).map((entry) => (
                                        <EntryRow key={entry.id} entry={entry} selected={selected?.id === entry.id} />
                                    ))}
                                    <div className="group-heading px-2.5 pt-3 pb-1 text-[11px] font-semibold text-[var(--faint)] uppercase tracking-wider">
                                        其他
                                    </div>
                                    {entries.filter((e) => !e.favorite).map((entry) => (
                                        <EntryRow key={entry.id} entry={entry} selected={selected?.id === entry.id} />
                                    ))}
                                </>
                            ) : (
                                entries.map((entry) => (
                                    <EntryRow key={entry.id} entry={entry} selected={selected?.id === entry.id} />
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <aside className="vault-inspector" data-vault-inspector="">
                    <VaultInspector state={state} selected={selected} />
                </aside>
            </div>
        </section>
    );
}
