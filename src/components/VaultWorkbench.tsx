import { CircleAlert, CloudOff, CloudUpload, ExternalLink, Eye, EyeOff, HardDrive, Plus, RefreshCw, Search, ShieldCheck, Star, Trash2, Upload, Vault } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { formatShortDate, hostOf, identityTab, monogramOf, safeWebUrl, tokenizePassword } from '@/core/ui-helpers';
import { SORT_LABELS, vaultStore, type VaultState } from '@/core/vault-store';
import type { SortMode, VaultEntry } from '@/core/types';
import { cn } from '@/lib/utils';
import { AmicroButton, AmicroCopyButton, AmicroFavoriteButton } from './amicro';

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
    const tokens = revealed ? tokenizePassword(entry.password) : null;

    return (
        <dl className="detail-fields m-0 grid gap-1 rounded-2xl border border-[var(--rule)] bg-[var(--card)] divide-y divide-[var(--rule)]">
            <div className="detail-row px-4 py-3.5 grid gap-1">
                <dt className="text-[12px] font-medium text-[var(--faint)]">账户</dt>
                <dd className="detail-val-row m-0 flex items-center justify-between gap-2 min-w-0">
                    <span className="machine text-[14px] text-[var(--ink)] break-all">{entry.username || '未设置'}</span>
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
            </div>
            <div className="detail-row px-4 py-3.5 grid gap-1">
                <dt className="text-[12px] font-medium text-[var(--faint)]">密码</dt>
                <dd className="detail-val-row m-0 flex items-center justify-between gap-2 min-w-0">
                    <span
                        className={cn(
                            'detail-secret machine text-[14.5px] break-all select-all',
                            revealed ? 'revealed text-[var(--ink)]' : 'masked text-[var(--muted)] tracking-[0.14em]',
                        )}
                        data-secret-value=""
                    >
                        {tokens
                            ? tokens.map((t, i) => (
                                <span key={i} className={t.kind === 'digit' ? 'pw-d' : t.kind === 'symbol' ? 'pw-s' : undefined}>
                                    {t.char}
                                </span>
                            ))
                            : '••••••••••••••••'}
                    </span>
                    <span className="detail-actions flex items-center gap-1 flex-none">
                        <button
                            type="button"
                            className="icon-button w-8 h-8 inline-grid place-items-center rounded-lg border-0 bg-transparent text-[var(--faint)] cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--ink)]"
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
            </div>
            <div className="detail-row px-4 py-3.5 grid gap-1">
                <dt className="text-[12px] font-medium text-[var(--faint)]">网站</dt>
                <dd className="detail-val-row m-0 flex items-center justify-between gap-2 min-w-0">
                    {safeUrl ? (
                        <>
                            <a
                                className="detail-link inline-flex items-center gap-1.5 text-[14px] text-[var(--accent)] hover:underline break-all min-w-0"
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
                        <span className="text-[14px] text-[var(--muted)] break-all">{entry.url || '未设置'}</span>
                    )}
                </dd>
            </div>
            {entry.notes ? (
                <div className="detail-row px-4 py-3.5 grid gap-1">
                    <dt className="text-[12px] font-medium text-[var(--faint)]">备注</dt>
                    <dd className="detail-note m-0 text-[14px] text-[var(--ink)] whitespace-pre-wrap break-words leading-relaxed">{entry.notes}</dd>
                </div>
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
                    <span className="entry-account text-[12.5px] text-[var(--muted)] truncate">
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
                <ShieldCheck className="w-9 h-9 opacity-45" strokeWidth={1.5} />
                <div>{state.vault?.entries.length ? '选择一条密码查看详情' : '添加密码后可在此查看详情'}</div>
            </div>
        );
    }

    const tone = identityTab(selected);
    const revealed = Boolean(state.inspectorRevealed && state.selectedId === selected.id);

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="inspector-inner max-w-[560px] mx-auto grid gap-6"
            >
                <header className="insp-header flex items-center gap-3.5">
                    <span className="monogram lg" data-tab={tone}>{monogramOf(selected)}</span>
                    <h2 className="insp-title m-0 flex-1 min-w-0 text-[21px] font-bold tracking-tight text-[var(--ink)] break-words">
                        {selected.title}
                    </h2>
                    <div className="insp-header-actions flex items-center gap-1.5 flex-none">
                        <AmicroFavoriteButton
                            favorite={Boolean(selected.favorite)}
                            justFavorited={state.lastFavoriteAnimationId === selected.id}
                            entryId={selected.id}
                            title={selected.title}
                            onToggle={() => void vaultStore.toggleFavorite(selected.id)}
                        />
                        <AmicroButton
                            variant="text"
                            data-action="open-edit"
                            data-id={selected.id}
                            onClick={() => vaultStore.openEditModal(selected.id)}
                        >
                            编辑
                        </AmicroButton>
                    </div>
                </header>

                <DetailFields entry={selected} revealed={revealed} />

                <footer className="insp-footer flex items-center justify-between gap-3 flex-wrap pt-1">
                    <span className="insp-meta text-[12.5px] text-[var(--faint)]">
                        {selected.category || '未分类'} · 更新于 {formatShortDate(selected.updatedAt)}
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
                    <div className="toolbar flex items-center gap-2.5 p-3.5 sm:px-4">
                        <div className="search relative flex-1 min-w-0 flex items-center">
                            <Search className="w-4 h-4 text-[var(--faint)] absolute left-3 pointer-events-none" strokeWidth={1.8} />
                            <input
                                className="field pl-9"
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
                        </div>
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

                    <div className="stream-scroll flex-1 overflow-y-auto px-3 pb-24 sm:pb-6">
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

                        <div className="list-heading-row flex items-center justify-between gap-2 px-1.5 pt-1 pb-2.5 flex-wrap">
                            <h1 className="list-heading m-0 text-[18px] font-bold tracking-tight text-[var(--ink)]">
                                {vaultStore.currentVaultHeading()}
                            </h1>
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

                        <div className="vault-list grid gap-0.5" data-vault-list="">
                            {!state.vault.entries.length ? (
                                <div className="empty-state py-14 px-4 text-center grid justify-items-center gap-2.5 text-[var(--muted)]">
                                    <Vault className="w-10 h-10 text-[var(--faint)] opacity-60" strokeWidth={1.5} />
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
                                    <div className="group-heading px-2.5 pt-2 pb-1 text-[11.5px] font-semibold text-[var(--faint)] uppercase tracking-wide">
                                        收藏
                                    </div>
                                    {entries.filter((e) => e.favorite).map((entry) => (
                                        <EntryRow key={entry.id} entry={entry} selected={selected?.id === entry.id} />
                                    ))}
                                    <div className="group-heading px-2.5 pt-3 pb-1 text-[11.5px] font-semibold text-[var(--faint)] uppercase tracking-wide">
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
