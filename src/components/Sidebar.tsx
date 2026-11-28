import { motion } from 'motion/react';
import { LockKeyhole, Plus, Settings2, ShieldCheck, Star, Trash2, Vault } from 'lucide-react';
import { categoryTone } from '@/core/ui-helpers';
import { vaultStore, type VaultState } from '@/core/vault-store';
import { cn } from '@/lib/utils';

function ActivePill({ layoutId }: { layoutId: string }) {
    return (
        <motion.span
            layoutId={layoutId}
            transition={{ type: 'spring', stiffness: 480, damping: 36 }}
            className="absolute inset-0 rounded-[10px] bg-[var(--bg-selected)] border border-[var(--rule)] shadow-[var(--specular)] pointer-events-none"
            aria-hidden="true"
        />
    );
}

export function SidebarContent({ state, scope = 'desktop' }: { state: VaultState; scope?: 'desktop' | 'drawer' }) {
    const status = vaultStore.syncStatus();
    const isAll = state.view === 'vault' && !state.favoriteOnly && !state.category;
    const isFav = state.view === 'vault' && state.favoriteOnly;
    const isTrash = state.view === 'settings' && state.settingPanel === 'trash';
    const isSettings = state.view === 'settings' && state.settingPanel !== 'trash';
    const entries = state.vault?.entries || [];
    const trashCount = state.vault?.trash.length || 0;
    const categories = state.vault?.categories || [];
    const pillId = `sidebar-active-pill-${scope}`;

    const favCount = entries.reduce((acc, e) => acc + (e.favorite ? 1 : 0), 0);
    const catCounts = new Map<string, number>();
    for (const entry of entries) {
        if (entry.category) catCounts.set(entry.category, (catCounts.get(entry.category) || 0) + 1);
    }

    return (
        <>
            <div className="brand flex items-center justify-between gap-2 px-2">
                <div className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight text-[var(--ink)]">
                    <span className="brand-mark w-7.5 h-7.5 rounded-[10px] grid place-items-center bg-[var(--accent-soft)] border border-[var(--accent)]/25 text-[var(--accent)] shadow-[0_0_16px_-4px_var(--accent-glow)]">
                        <ShieldCheck className="w-4 h-4" strokeWidth={2} />
                    </span>
                    <span>PasswMana</span>
                </div>
                <span className="text-[11px] machine px-1.5 py-0.5 rounded-md bg-[var(--card-2)] border border-[var(--rule)] text-[var(--faint)]">
                    {entries.length}
                </span>
            </div>

            <nav className="nav-group grid gap-0.5" aria-label="主导航">
                <button
                    type="button"
                    className={cn('nav-link', isAll && 'active')}
                    data-action="view"
                    data-view-name="vault"
                    onClick={() => vaultStore.setView('vault')}
                >
                    {isAll && <ActivePill layoutId={pillId} />}
                    <Vault className="w-4 h-4 flex-none relative z-[1]" strokeWidth={1.8} />
                    <span className="relative z-[1] flex-1">全部密码</span>
                    <span className="relative z-[1] text-[11.5px] machine text-[var(--faint)]">{entries.length}</span>
                </button>
                <button
                    type="button"
                    className={cn('nav-link', isFav && 'active')}
                    data-action="nav-favorites"
                    onClick={() => vaultStore.navFavorites()}
                >
                    {isFav && <ActivePill layoutId={pillId} />}
                    <Star className="w-4 h-4 flex-none relative z-[1]" strokeWidth={1.8} />
                    <span className="relative z-[1] flex-1">收藏</span>
                    {favCount > 0 && <span className="relative z-[1] text-[11.5px] machine text-[var(--faint)]">{favCount}</span>}
                </button>
            </nav>

            <div className="nav-group grid gap-0.5">
                <div className="nav-heading flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold tracking-wider text-[var(--faint)] uppercase">
                    <span>分类</span>
                    <button
                        type="button"
                        className="icon-button w-6 h-6 inline-grid place-items-center rounded-md border-0 bg-transparent text-[var(--faint)] cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--ink)]"
                        data-action="add-category"
                        title="新增分类"
                        aria-label="新增分类"
                        onClick={() => void vaultStore.addCategory()}
                    >
                        <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                </div>
                {categories.map((category) => {
                    const active = state.view === 'vault' && !state.favoriteOnly && state.category === category;
                    const count = catCounts.get(category) || 0;
                    return (
                        <button
                            type="button"
                            key={category}
                            className={cn('nav-link', active && 'active')}
                            data-action="nav-category"
                            data-category={category}
                            onClick={() => vaultStore.navCategory(category)}
                        >
                            {active && <ActivePill layoutId={pillId} />}
                            <i className="category-dot relative z-[1]" data-tab={categoryTone(category)} />
                            <span className="relative z-[1] flex-1 truncate">{category}</span>
                            {count > 0 && <span className="relative z-[1] text-[11.5px] machine text-[var(--faint)]">{count}</span>}
                        </button>
                    );
                })}
            </div>

            <nav className="nav-group grid gap-0.5" aria-label="系统导航">
                <button
                    type="button"
                    className={cn('nav-link', isTrash && 'active')}
                    data-action="nav-trash"
                    onClick={() => vaultStore.navTrash()}
                >
                    {isTrash && <ActivePill layoutId={pillId} />}
                    <Trash2 className="w-4 h-4 flex-none relative z-[1]" strokeWidth={1.8} />
                    <span className="relative z-[1] flex-1">回收站</span>
                    {trashCount > 0 && <span className="relative z-[1] text-[11.5px] machine text-[var(--faint)]">{trashCount}</span>}
                </button>
                <button
                    type="button"
                    className={cn('nav-link', isSettings && 'active')}
                    data-action="view"
                    data-view-name="settings"
                    onClick={() => vaultStore.setView('settings')}
                >
                    {isSettings && <ActivePill layoutId={pillId} />}
                    <Settings2 className="w-4 h-4 flex-none relative z-[1]" strokeWidth={1.8} />
                    <span className="relative z-[1] flex-1">设置</span>
                </button>
            </nav>

            <div className="nav-footer mt-auto pt-3 border-t border-[var(--rule)] flex items-center justify-between gap-2">
                <button
                    type="button"
                    className="nav-status flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 rounded-xl border border-[var(--rule)] bg-[var(--card-2)] text-[12.5px] font-medium text-[var(--muted)] cursor-pointer hover:bg-[var(--bg-hover)] hover:border-[var(--rule-strong)] hover:text-[var(--ink)] text-left transition-colors"
                    data-action="open-sync"
                    data-sync-status={status.status}
                    title={status.detail}
                    onClick={() => vaultStore.openModal({ type: 'sync' }, { action: 'open-sync' })}
                >
                    <span className="sync-dot" />
                    <span data-sync-label="" className="truncate">{status.label}</span>
                </button>
                <button
                    type="button"
                    className="icon-button w-9 h-9 inline-grid place-items-center rounded-xl border border-[var(--rule)] bg-[var(--card-2)] text-[var(--faint)] cursor-pointer hover:bg-[var(--bg-hover)] hover:border-[var(--rule-strong)] hover:text-[var(--ink)] transition-colors"
                    data-action="lock"
                    title="立即锁定 (Ctrl+Shift+L)"
                    aria-label="立即锁定"
                    onClick={() => vaultStore.lockVault()}
                >
                    <LockKeyhole className="w-4 h-4" strokeWidth={1.8} />
                </button>
            </div>
        </>
    );
}
