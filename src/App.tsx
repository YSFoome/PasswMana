import { useEffect, useRef, useSyncExternalStore } from 'react';
import { MotionConfig } from 'motion/react';
import { ArrowLeft, LockKeyhole, Menu, Plus, RefreshCw } from 'lucide-react';
import { trapDialogKey } from '@/core/ui-helpers';
import { vaultStore } from '@/core/vault-store';
import { cn } from '@/lib/utils';
import { AmicroButton, AmicroToastStack } from './components/amicro';
import { RecoveryScreen, SetupScreen, UnlockScreen } from './components/LockScreens';
import { ModalHost } from './components/Modals';
import { SETTING_LABELS, SettingsView } from './components/SettingsView';
import { SidebarContent } from './components/Sidebar';
import { VaultWorkbench } from './components/VaultWorkbench';

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function App() {
    const { state } = useSyncExternalStore(vaultStore.subscribe, vaultStore.getSnapshot);
    const drawerRef = useRef<HTMLElement>(null);

    useEffect(() => {
        void vaultStore.bootstrap();
    }, []);

    useEffect(() => {
        const darkScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
        const onColorChange = () => vaultStore.applyThemeColor();
        darkScheme?.addEventListener?.('change', onColorChange);

        const onKeyDown = (event: KeyboardEvent) => {
            const command = event.ctrlKey || event.metaKey;
            if (command && !event.altKey && event.key.toLowerCase() === 'k') {
                if (!vaultStore.state.vaultKey || isTypingTarget(event.target)) return;
                event.preventDefault();
                if (vaultStore.state.modal?.type === 'quick-switch') vaultStore.closeQuickSwitch();
                else vaultStore.openQuickSwitch();
                return;
            }
            if (command && event.shiftKey && event.key.toLowerCase() === 'l') {
                if (vaultStore.state.vaultKey) {
                    event.preventDefault();
                    vaultStore.lockVault();
                }
                return;
            }
            if (event.key === '/' && vaultStore.state.vaultKey && !vaultStore.state.modal && !isTypingTarget(event.target)) {
                const field = document.querySelector<HTMLInputElement>('[data-input="search"]');
                if (field) {
                    event.preventDefault();
                    field.focus();
                    field.select?.();
                }
                return;
            }
            if (event.key === 'Escape' && vaultStore.state.drawerOpen && !vaultStore.state.modal) {
                event.preventDefault();
                vaultStore.closeDrawer();
                return;
            }
            if (vaultStore.state.drawerOpen && !vaultStore.state.modal) {
                trapDialogKey(event, drawerRef.current);
            }
        };

        const onActivity = () => vaultStore.resetLockTimer();
        const onOnline = () => {
            vaultStore.notify();
            vaultStore.scheduleAutoSync(0);
        };
        const onOffline = () => vaultStore.notify();
        const onFocus = () => vaultStore.syncOnForeground();
        const onVisibility = () => {
            if (document.visibilityState === 'visible') vaultStore.syncOnForeground();
        };
        const onResize = () => {
            if (!vaultStore.isMobileViewport()
                && (vaultStore.state.settingsDetail || vaultStore.state.modal?.type === 'detail')) {
                vaultStore.state.settingsDetail = false;
                if (vaultStore.state.modal?.type === 'detail') {
                    vaultStore.state.selectedId = vaultStore.state.modal.id;
                    vaultStore.state.modal = null;
                }
                vaultStore.notify();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        for (const name of ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const) {
            document.addEventListener(name, onActivity, { passive: true });
        }
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('resize', onResize);

        return () => {
            darkScheme?.removeEventListener?.('change', onColorChange);
            document.removeEventListener('keydown', onKeyDown);
            for (const name of ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const) {
                document.removeEventListener(name, onActivity);
            }
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('resize', onResize);
        };
    }, []);

    // Manage drawer focus & inert shell when drawerOpen changes
    useEffect(() => {
        const shell = document.querySelector<HTMLElement>('.app-shell');
        const drawer = drawerRef.current;
        if (drawer) drawer.inert = Boolean(state.modal || !state.drawerOpen);
        if (shell && !state.modal) shell.inert = Boolean(state.drawerOpen);

        if (state.drawerOpen && !state.modal && drawer) {
            drawer.querySelector<HTMLElement>('button, a[href]')?.focus();
        } else if (!state.drawerOpen && !state.modal) {
            const trigger = vaultStore.getDialogTrigger();
            if (trigger?.action === 'mobile-left') {
                vaultStore.clearDialogTrigger();
                document.querySelector<HTMLElement>('[data-action="mobile-left"]')?.focus();
            }
        }
    }, [state.drawerOpen, state.modal]);

    if (state.bootstrapError) {
        return (
            <main className="min-h-dvh grid place-items-center p-6 text-[var(--alert)]">
                无法初始化保险库: {state.bootstrapError}
            </main>
        );
    }

    if (!state.bootstrapped) {
        return <main className="min-h-dvh bg-[var(--paper)]" />;
    }

    const mobileTitle = state.view === 'vault'
        ? vaultStore.currentVaultHeading()
        : state.settingsDetail
            ? SETTING_LABELS[state.settingPanel]
            : '设置';

    return (
        <MotionConfig reducedMotion="user">
            {state.modal?.type === 'recovery-created' ? (
                <RecoveryScreen code={state.modal.code} />
            ) : !state.record ? (
                <SetupScreen />
            ) : !state.vaultKey ? (
                <>
                    <UnlockScreen deviceUnlock={Boolean(state.deviceUnlock)} />
                    <ModalHost state={state} />
                </>
            ) : (
                <>
                    <div className="app-shell">
                        <aside className="side-nav">
                            <SidebarContent state={state} scope="desktop" />
                        </aside>
                        <main className="content">
                            <header className="mobile-header">
                                <button
                                    type="button"
                                    className="icon-button w-8 h-8 inline-grid place-items-center rounded-lg border-0 bg-transparent text-[var(--ink)] cursor-pointer"
                                    id="mobile-left"
                                    data-action="mobile-left"
                                    title={state.settingsDetail ? '返回设置' : '打开导航'}
                                    aria-label={state.settingsDetail ? '返回设置' : '打开导航'}
                                    onClick={() => vaultStore.handleMobileLeft()}
                                >
                                    {state.settingsDetail ? <ArrowLeft className="w-4.5 h-4.5" strokeWidth={1.8} /> : <Menu className="w-4.5 h-4.5" strokeWidth={1.8} />}
                                </button>
                                <div className="mobile-title font-semibold text-[15px] text-[var(--ink)] truncate">{mobileTitle}</div>
                                <div className="mobile-header-actions flex items-center gap-1">
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
                                    <button
                                        type="button"
                                        className="icon-button w-8 h-8 inline-grid place-items-center rounded-lg border-0 bg-transparent text-[var(--faint)] cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--ink)]"
                                        data-action="open-sync"
                                        title="打开同步"
                                        aria-label="打开同步"
                                        onClick={() => vaultStore.openModal({ type: 'sync' }, { action: 'open-sync' })}
                                    >
                                        <RefreshCw className="w-4 h-4" strokeWidth={1.8} />
                                    </button>
                                </div>
                            </header>

                            <div className="global-notices empty:hidden px-3.5 pt-2.5 grid gap-2">
                                {state.savedDraft && (
                                    <div className="notice draft-notice p-3 rounded-xl border border-[var(--rule)] bg-[var(--card)] flex items-center justify-between gap-2.5 flex-wrap">
                                        <span className="text-[13px] font-medium text-[var(--ink)]">有一份未完成的密码编辑</span>
                                        <div className="empty-actions flex items-center gap-2 flex-wrap">
                                            <AmicroButton variant="secondary" data-action="resume-draft" onClick={() => void vaultStore.resumeDraft()}>
                                                继续编辑
                                            </AmicroButton>
                                            <AmicroButton variant="secondary" data-action="discard-draft" onClick={() => void vaultStore.discardDraft()}>
                                                放弃草稿
                                            </AmicroButton>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <VaultWorkbench state={state} />
                            <SettingsView state={state} />

                            <button
                                type="button"
                                className="mobile-fab"
                                data-action="open-add"
                                title="新增密码"
                                aria-label="新增密码"
                                onClick={() => vaultStore.openAddModal()}
                            >
                                <Plus className="w-5 h-5" strokeWidth={2.2} />
                            </button>
                        </main>
                    </div>

                    <div className={cn('scrim', state.drawerOpen && 'open')} data-action="close-drawer" onClick={() => vaultStore.closeDrawer()} />
                    <aside
                        ref={drawerRef}
                        className={cn('drawer', state.drawerOpen && 'open')}
                        role="dialog"
                        aria-modal={state.drawerOpen ? 'true' : undefined}
                        aria-label="导航"
                    >
                        <SidebarContent state={state} scope="drawer" />
                    </aside>

                    <ModalHost state={state} />

                    {state.updateReady && (
                        <div
                            className="update-notice fixed bottom-5 right-5 z-[75] max-w-[calc(100vw-24px)] p-3 rounded-xl border border-[var(--rule)] bg-[var(--card)] shadow-[var(--shadow-float)] flex items-center justify-between gap-3 flex-wrap"
                            data-update-notice=""
                            role="status"
                        >
                            <span className="text-[13px] font-medium text-[var(--ink)]">新版本已准备好</span>
                            <AmicroButton variant="secondary" data-action="apply-update" onClick={() => void vaultStore.applyUpdate()}>
                                保存草稿并更新
                            </AmicroButton>
                        </div>
                    )}
                    {state.lockWarningVisible && (
                        <div
                            className="lock-warning fixed top-4 left-1/2 -translate-x-1/2 z-[75] w-[min(480px,calc(100vw-24px))] p-3 rounded-xl border border-[var(--caution)]/30 bg-[var(--card)] shadow-[var(--shadow-float)] text-[var(--ink)] flex items-center justify-between gap-2.5 flex-wrap"
                            data-lock-warning=""
                            role="status"
                        >
                            <span className="text-[13px]">即将自动锁定，未完成的密码编辑会加密保存。</span>
                            <AmicroButton variant="secondary" data-action="extend-session" onClick={() => vaultStore.resetLockTimer()}>
                                继续使用
                            </AmicroButton>
                        </div>
                    )}
                </>
            )}

            <AmicroToastStack toasts={state.toasts} />
        </MotionConfig>
    );
}
