import { LockKeyhole, Plus, Settings2, ShieldCheck, Star, Trash2, Vault } from 'lucide-react';
import { categoryTone } from '@/core/ui-helpers';
import { vaultStore, type VaultState } from '@/core/vault-store';
import { cn } from '@/lib/utils';

export function SidebarContent({ state }: { state: VaultState }) {
    const status = vaultStore.syncStatus();
    const isAll = state.view === 'vault' && !state.favoriteOnly && !state.category;
    const isFav = state.view === 'vault' && state.favoriteOnly;
    const isTrash = state.view === 'settings' && state.settingPanel === 'trash';
    const isSettings = state.view === 'settings' && state.settingPanel !== 'trash';
    const categories = state.vault?.categories || [];

    return (
        <>
            <div className="brand flex items-center gap-2.5 px-2.5 text-[15px] font-bold tracking-tight text-[var(--ink)]">
                <span className="brand-mark w-7 h-7 rounded-[9px] grid place-items-center bg-[var(--accent-soft)] text-[var(--accent)]">
                    <ShieldCheck className="w-4 h-4" strokeWidth={2} />
                </span>
                <span>PasswMana</span>
            </div>

            <nav className="nav-group grid gap-0.5" aria-label="主导航">
                <button
                    type="button"
                    className={cn('nav-link', isAll && 'active')}
                    data-action="view"
                    data-view-name="vault"
                    onClick={() => vaultStore.setView('vault')}
                >
                    <Vault className="w-4 h-4 flex-none" strokeWidth={1.8} />
                    <span>全部密码</span>
                </button>
                <button
                    type="button"
                    className={cn('nav-link', isFav && 'active')}
                    data-action="nav-favorites"
                    onClick={() => vaultStore.navFavorites()}
                >
                    <Star className="w-4 h-4 flex-none" strokeWidth={1.8} />
                    <span>收藏</span>
                </button>
            </nav>

            <div className="nav-group grid gap-0.5">
                <div className="nav-heading flex items-center justify-between px-2.5 py-1 text-[11.5px] font-semibold tracking-wide text-[var(--faint)] uppercase">
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
                {categories.map((category) => (
                    <button
                        type="button"
                        key={category}
                        className={cn('nav-link', state.view === 'vault' && !state.favoriteOnly && state.category === category && 'active')}
                        data-action="nav-category"
                        data-category={category}
                        onClick={() => vaultStore.navCategory(category)}
                    >
                        <i className="category-dot" data-tab={categoryTone(category)} />
                        <span className="truncate">{category}</span>
                    </button>
                ))}
            </div>

            <nav className="nav-group grid gap-0.5" aria-label="系统导航">
                <button
                    type="button"
                    className={cn('nav-link', isTrash && 'active')}
                    data-action="nav-trash"
                    onClick={() => vaultStore.navTrash()}
                >
                    <Trash2 className="w-4 h-4 flex-none" strokeWidth={1.8} />
                    <span>回收站</span>
                </button>
                <button
                    type="button"
                    className={cn('nav-link', isSettings && 'active')}
                    data-action="view"
                    data-view-name="settings"
                    onClick={() => vaultStore.setView('settings')}
                >
                    <Settings2 className="w-4 h-4 flex-none" strokeWidth={1.8} />
                    <span>设置</span>
                </button>
            </nav>

            <div className="nav-footer mt-auto pt-3 border-t border-[var(--rule)] flex items-center justify-between gap-2">
                <button
                    type="button"
                    className="nav-status flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 rounded-[9px] border-0 bg-transparent text-[12.5px] font-medium text-[var(--muted)] cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--ink)] text-left"
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
                    className="icon-button w-8 h-8 inline-grid place-items-center rounded-lg border-0 bg-transparent text-[var(--faint)] cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--ink)]"
                    data-action="lock"
                    title="立即锁定"
                    aria-label="立即锁定"
                    onClick={() => vaultStore.lockVault()}
                >
                    <LockKeyhole className="w-4 h-4" strokeWidth={1.8} />
                </button>
            </div>
        </>
    );
}
