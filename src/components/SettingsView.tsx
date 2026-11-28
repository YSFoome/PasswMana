import { Check, Download, Paintbrush, Plus, RefreshCw, ShieldCheck, Tags, Trash2, Upload } from 'lucide-react';
import { categoryTone, timeLabel } from '@/core/ui-helpers';
import { vaultStore, type VaultState } from '@/core/vault-store';
import type { AccentColor, SettingPanel, ThemeMode } from '@/core/types';
import { cn } from '@/lib/utils';
import { AmicroButton, AmicroSwitch } from './amicro';

export const SETTING_LABELS: Record<SettingPanel, string> = {
    sync: '同步与备份',
    security: '安全',
    appearance: '外观',
    categories: '分类',
    trash: '回收站',
};

const ACCENT_NAMES: Record<AccentColor, string> = {
    emerald: '松绿',
    blue: '靛蓝',
    cyan: '深青',
    rose: '绛红',
    amber: '赭黄',
    graphite: '石墨',
};

const PANEL_ICONS: Record<SettingPanel, typeof RefreshCw> = {
    sync: RefreshCw,
    security: ShieldCheck,
    appearance: Paintbrush,
    categories: Tags,
    trash: Trash2,
};

export function SettingsView({ state }: { state: VaultState }) {
    if (!state.vault) return null;
    const sync = state.vault.sync;
    const repo = sync.owner && sync.repo ? `${sync.owner} / ${sync.repo}` : '尚未配置私有仓库';
    const storageButtonHidden = !state.storage?.supported || Boolean(state.storage.persisted);
    const trashEntries = [...state.vault.trash].sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));

    return (
        <section
            className={cn(
                'view flex-1 flex flex-col min-h-0',
                state.view !== 'settings' && 'hidden',
                state.settingsDetail && 'settings-detail',
            )}
            data-view="settings"
        >
            <div className="settings-scroll flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-10">
                <div className="settings-container max-w-[900px] mx-auto">
                    <header className="settings-head mb-7">
                        <h1 className="m-0 mb-1.5 text-[24px] font-bold tracking-tight text-[var(--ink)]">设置</h1>
                        <p className="m-0 text-[13.5px] text-[var(--muted)]">管理同步、安全策略与界面外观。</p>
                    </header>

                    <div className="settings-layout">
                        <nav className="settings-nav" aria-label="设置分类">
                            {(Object.keys(SETTING_LABELS) as SettingPanel[]).map((key) => {
                                const Icon = PANEL_ICONS[key];
                                const active = state.settingPanel === key;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        className={cn(active && 'active')}
                                        aria-current={active ? 'page' : undefined}
                                        data-action="setting-panel"
                                        data-panel={key}
                                        onClick={() => vaultStore.selectSettingPanel(key)}
                                    >
                                        <Icon className="w-4 h-4 flex-none" strokeWidth={1.8} />
                                        <span>{SETTING_LABELS[key]}</span>
                                    </button>
                                );
                            })}
                        </nav>

                        <div className="min-w-0">
                            {/* Sync & Backup */}
                            <section
                                className={cn('settings-panel', state.settingPanel === 'sync' && 'active')}
                                data-panel="sync"
                            >
                                <h2 className="m-0 mb-1.5 text-[18px] font-bold text-[var(--ink)]">同步与备份</h2>
                                <p className="panel-intro m-0 mb-5 text-[13.5px] text-[var(--muted)]">
                                    首次连接后，解锁、保存改动和恢复联网时自动同步密文。
                                </p>
                                <div className="setting-list rounded-2xl border border-[var(--rule)] bg-[var(--card)] divide-y divide-[var(--rule)]">
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">私有仓库</strong>
                                            <span className="machine text-[12.5px] text-[var(--muted)] break-all">{repo}</span>
                                        </div>
                                        <AmicroButton
                                            variant="secondary"
                                            data-action="open-sync-config"
                                            onClick={() => vaultStore.openModal({ type: 'sync-config', step: 1 }, { action: 'open-sync-config' })}
                                        >
                                            配置
                                        </AmicroButton>
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">后台自动同步</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">保存后静默同步；锁定或关闭页面时暂停</span>
                                        </div>
                                        <AmicroSwitch
                                            checked={sync.automatic !== false}
                                            actionName="toggle-auto-sync"
                                            label="后台自动同步"
                                            onToggle={() => void vaultStore.toggleAutoSync()}
                                        />
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">同步状态</strong>
                                            <span data-sync-detail="" className="text-[12.5px] text-[var(--muted)] break-words">
                                                {vaultStore.syncStatus().detail}
                                            </span>
                                        </div>
                                        <AmicroButton
                                            variant="secondary"
                                            data-action="open-sync"
                                            onClick={() => vaultStore.openModal({ type: 'sync' }, { action: 'open-sync' })}
                                        >
                                            详情
                                        </AmicroButton>
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">加密备份</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">导出当前保险库为 .passwmana 密文文件</span>
                                        </div>
                                        <AmicroButton
                                            variant="secondary"
                                            data-action="export-backup"
                                            onClick={() => void vaultStore.downloadBackup()}
                                        >
                                            <Download className="w-4 h-4" strokeWidth={1.8} />
                                            <span>导出</span>
                                        </AmicroButton>
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">恢复加密备份</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">使用 .passwmana 文件替换本机保险库</span>
                                        </div>
                                        <AmicroButton
                                            variant="secondary"
                                            data-action="import-backup"
                                            onClick={() => vaultStore.openBackupFilePicker()}
                                        >
                                            <Upload className="w-4 h-4" strokeWidth={1.8} />
                                            <span>恢复</span>
                                        </AmicroButton>
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">恢复替换前的保险库</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">备份恢复后，可使用旧库主密码回滚</span>
                                        </div>
                                        <AmicroButton
                                            variant="text"
                                            data-action="restore-previous"
                                            onClick={() => void vaultStore.openRollbackBackup()}
                                        >
                                            回滚
                                        </AmicroButton>
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">应用更新</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">更新前会保存加密草稿并锁定</span>
                                        </div>
                                        <AmicroButton
                                            variant="text"
                                            data-action="check-update"
                                            onClick={() => void vaultStore.checkUpdate()}
                                        >
                                            检查更新
                                        </AmicroButton>
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">迁移旧版备份</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">从旧版明文 JSON 本地合并并重新加密</span>
                                        </div>
                                        <AmicroButton
                                            variant="text"
                                            data-action="import-legacy"
                                            onClick={() => vaultStore.openLegacyBackupPicker()}
                                        >
                                            迁移
                                        </AmicroButton>
                                    </div>
                                </div>
                            </section>

                            {/* Security */}
                            <section
                                className={cn('settings-panel', state.settingPanel === 'security' && 'active')}
                                data-panel="security"
                            >
                                <h2 className="m-0 mb-1.5 text-[18px] font-bold text-[var(--ink)]">安全</h2>
                                <p className="panel-intro m-0 mb-5 text-[13.5px] text-[var(--muted)]">
                                    主密码不会离开本设备，解锁后的密钥仅保存在当前会话内存中。
                                </p>
                                <div className="setting-list rounded-2xl border border-[var(--rule)] bg-[var(--card)] divide-y divide-[var(--rule)]">
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">自动锁定</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">无操作后清除解锁密钥</span>
                                        </div>
                                        <select
                                            className="field inline-select w-auto min-w-[110px]"
                                            data-input="lock-minutes"
                                            value={String(state.vault.preferences.lockMinutes ?? 5)}
                                            onChange={(e) => void vaultStore.setLockMinutes(Number(e.target.value))}
                                        >
                                            <option value="0">关闭</option>
                                            <option value="1">1 分钟</option>
                                            <option value="5">5 分钟</option>
                                            <option value="15">15 分钟</option>
                                            <option value="30">30 分钟</option>
                                        </select>
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">免密自动解锁</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">
                                                {state.deviceUnlock
                                                    ? '已开启。密钥由浏览器保管，打开或刷新后直接进入密码库。'
                                                    : '验证主密码后可将密钥交给浏览器保管在本机，免去逐次输入。'}
                                            </span>
                                        </div>
                                        {state.deviceUnlock ? (
                                            <AmicroButton
                                                variant="secondary"
                                                data-action="open-disable-device-unlock"
                                                onClick={() => vaultStore.openModal({ type: 'disable-device-unlock' }, { action: 'open-disable-device-unlock' })}
                                            >
                                                关闭
                                            </AmicroButton>
                                        ) : (
                                            <AmicroButton
                                                variant="secondary"
                                                data-action="open-enable-device-unlock"
                                                onClick={() => vaultStore.openModal({ type: 'enable-device-unlock' }, { action: 'open-enable-device-unlock' })}
                                            >
                                                开启
                                            </AmicroButton>
                                        )}
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">主密码</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">只更新保险库密钥的主密码包装</span>
                                        </div>
                                        <AmicroButton
                                            variant="secondary"
                                            data-action="open-change-password"
                                            onClick={() => vaultStore.openModal({ type: 'change-password' }, { action: 'open-change-password' })}
                                        >
                                            修改
                                        </AmicroButton>
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">恢复密钥</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">创建时生成，请保存在离线可信位置</span>
                                        </div>
                                        <span className="insp-meta text-[12.5px] text-[var(--faint)]">不可再次显示</span>
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">本地存储保护</strong>
                                            <span data-storage-detail="" className="text-[12.5px] text-[var(--muted)] break-words">
                                                {vaultStore.storageStatusText()}
                                            </span>
                                        </div>
                                        <AmicroButton
                                            variant="secondary"
                                            data-action="request-storage-persist"
                                            hidden={storageButtonHidden}
                                            onClick={() => void vaultStore.requestStoragePersistFromUser()}
                                        >
                                            申请
                                        </AmicroButton>
                                    </div>
                                </div>
                            </section>

                            {/* Appearance */}
                            <section
                                className={cn('settings-panel', state.settingPanel === 'appearance' && 'active')}
                                data-panel="appearance"
                            >
                                <h2 className="m-0 mb-1.5 text-[18px] font-bold text-[var(--ink)]">外观</h2>
                                <p className="panel-intro m-0 mb-5 text-[13.5px] text-[var(--muted)]">
                                    显示模式和标识色只保存在当前设备。
                                </p>
                                <div className="setting-list rounded-2xl border border-[var(--rule)] bg-[var(--card)] divide-y divide-[var(--rule)]">
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">显示模式</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">按系统偏好或固定浅色 / 深色</span>
                                        </div>
                                        <div className="segmented inline-flex flex-wrap gap-1 p-1 rounded-[11px] bg-[var(--card-2)]" role="group" aria-label="显示模式">
                                            {([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => (
                                                <button
                                                    key={value}
                                                    type="button"
                                                    className={cn(
                                                        'px-3 py-1.5 rounded-lg border-0 text-[12.5px] font-medium cursor-pointer transition-colors',
                                                        state.mode === value
                                                            ? 'active bg-[var(--bg-list)] text-[var(--ink)] shadow-xs font-semibold'
                                                            : 'bg-transparent text-[var(--muted)] hover:text-[var(--ink)]',
                                                    )}
                                                    data-action="set-mode"
                                                    data-mode={value}
                                                    onClick={() => vaultStore.setThemeMode(value as ThemeMode)}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                            <strong className="text-[14px] font-semibold text-[var(--ink)]">标识色</strong>
                                            <span className="text-[12.5px] text-[var(--muted)]">{ACCENT_NAMES[state.accent]}</span>
                                        </div>
                                        <div className="swatches flex items-center gap-2.5 flex-wrap" role="group" aria-label="标识色">
                                            {(Object.entries(ACCENT_NAMES) as [AccentColor, string][]).map(([value, label]) => (
                                                <button
                                                    key={value}
                                                    type="button"
                                                    className={cn('swatch', state.accent === value && 'active')}
                                                    data-accent={value}
                                                    data-action="set-accent"
                                                    title={label}
                                                    aria-label={label}
                                                    onClick={() => vaultStore.setAccent(value)}
                                                >
                                                    {state.accent === value ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} /> : null}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* Categories */}
                            <section
                                className={cn('settings-panel', state.settingPanel === 'categories' && 'active')}
                                data-panel="categories"
                            >
                                <h2 className="m-0 mb-1.5 text-[18px] font-bold text-[var(--ink)]">分类</h2>
                                <p className="panel-intro m-0 mb-5 text-[13.5px] text-[var(--muted)]">
                                    按你的习惯整理和筛选密码条目。
                                </p>
                                <div className="category-list rounded-2xl border border-[var(--rule)] bg-[var(--card)] divide-y divide-[var(--rule)] mb-4">
                                    {state.vault.categories.map((category) => (
                                        <div key={category} className="category-row px-4 py-3 flex items-center justify-between gap-3">
                                            <span className="inline-flex items-center gap-2.5 text-[14px] font-medium text-[var(--ink)] min-w-0 break-words">
                                                <i className="category-dot" data-tab={categoryTone(category)} />
                                                <span>{category}</span>
                                            </span>
                                            <AmicroButton
                                                variant="danger-text"
                                                data-action="delete-category"
                                                data-category={category}
                                                title="删除分类"
                                                aria-label={`删除 ${category}`}
                                                onClick={() => void vaultStore.deleteCategory(category)}
                                            >
                                                删除
                                            </AmicroButton>
                                        </div>
                                    ))}
                                </div>
                                <AmicroButton
                                    variant="secondary"
                                    data-action="add-category"
                                    onClick={() => void vaultStore.addCategory()}
                                >
                                    <Plus className="w-4 h-4" strokeWidth={2} />
                                    <span>新增分类</span>
                                </AmicroButton>
                            </section>

                            {/* Trash */}
                            <section
                                className={cn('settings-panel', state.settingPanel === 'trash' && 'active')}
                                data-panel="trash"
                            >
                                <h2 className="m-0 mb-1.5 text-[18px] font-bold text-[var(--ink)]">回收站</h2>
                                <p className="panel-intro m-0 mb-5 text-[13.5px] text-[var(--muted)]">
                                    删除的条目保留 30 天，之后会自动永久清除。
                                </p>
                                <div className="setting-list rounded-2xl border border-[var(--rule)] bg-[var(--card)] divide-y divide-[var(--rule)]">
                                    {trashEntries.length ? trashEntries.map((entry) => (
                                        <div key={entry.id} className="setting-row p-4 flex items-center justify-between gap-3 flex-wrap">
                                            <div className="setting-copy min-w-0 flex-1 grid gap-0.5">
                                                <strong className="text-[14px] font-semibold text-[var(--ink)] break-words">{entry.title}</strong>
                                                <span className="text-[12.5px] text-[var(--muted)]">删除于 {timeLabel(entry.deletedAt)}</span>
                                            </div>
                                            <div className="setting-actions flex items-center gap-2 flex-wrap">
                                                <AmicroButton
                                                    variant="secondary"
                                                    data-action="restore-entry"
                                                    data-id={entry.id}
                                                    onClick={() => void vaultStore.restoreEntry(entry.id)}
                                                >
                                                    恢复
                                                </AmicroButton>
                                                <AmicroButton
                                                    variant="danger-text"
                                                    data-action="purge-entry"
                                                    data-id={entry.id}
                                                    title="永久删除"
                                                    aria-label={`永久删除 ${entry.title}`}
                                                    onClick={() => void vaultStore.purgeEntry(entry.id)}
                                                >
                                                    彻底删除
                                                </AmicroButton>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="empty-state py-12 px-4 text-center grid justify-items-center gap-2 text-[var(--faint)]">
                                            <Trash2 className="w-8 h-8 opacity-50" strokeWidth={1.5} />
                                            <div>回收站是空的</div>
                                        </div>
                                    )}
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
