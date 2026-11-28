import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, Download, Plug, RefreshCw, Search, Star, Trash2, X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import {
    formatShortDate,
    identityTab,
    monogramOf,
    parseGithubRepository,
    trapDialogKey,
} from '@/core/ui-helpers';
import { vaultStore, type VaultState } from '@/core/vault-store';
import type { EntryFormValues, ModalState, VaultConflictItem } from '@/core/types';
import { cn } from '@/lib/utils';
import { AmicroButton, AmicroDialog, AmicroFavoriteButton } from './amicro';
import { FormErrorBanner, PasswordField, PasswordStrengthHint } from './FormHelpers';
import { DetailFields, SyncIcon } from './VaultWorkbench';

const CONFLICT_FIELD_LABELS: Record<string, string> = {
    password: '密码',
    username: '账户',
    title: '名称',
    notes: '备注',
    url: '网址',
    category: '分类',
    favorite: '收藏',
    lockMinutes: '自动锁定',
    record: '条目状态',
};

function previewConflictValue(conflict: VaultConflictItem, value: unknown): string {
    if (conflict.kind === 'master-password') return String(value ?? '没有记录');
    if (conflict.field === 'password') return value === undefined ? '已删除' : '••••••••（密码不同）';
    if (value === undefined) return '已删除 / 未设置';
    if (typeof value === 'object' && value !== null) {
        const obj = value as { location?: string; entry?: { title?: string; username?: string; category?: string; notes?: string } };
        if (obj.entry) {
            return `${obj.location === 'trash' ? '回收站' : '密码库'}：${obj.entry.title}\n账户：${obj.entry.username || '未设置'}\n分类：${obj.entry.category || '未设置'}\n备注：${obj.entry.notes || '无'}\n密码已隐藏`;
        }
        return '条目变更';
    }
    return String(value);
}

function ConfirmModal({ modal }: { modal: Extract<ModalState, { type: 'confirm' }> }) {
    return (
        <AmicroDialog
            title={modal.title}
            formName="confirm"
            role="alertdialog"
            hideClose
            onClose={() => vaultStore.settleModal(false)}
            onSubmit={(e) => {
                e.preventDefault();
                vaultStore.settleModal(true);
            }}
            footer={
                <>
                    <AmicroButton
                        variant="secondary"
                        type="button"
                        data-action="close-modal"
                        data-autofocus=""
                        onClick={() => vaultStore.settleModal(false)}
                    >
                        {modal.cancelLabel || '取消'}
                    </AmicroButton>
                    <AmicroButton variant={modal.danger ? 'danger' : 'primary'} type="submit">
                        {modal.confirmLabel || '继续'}
                    </AmicroButton>
                </>
            }
        >
            {modal.message ? <p className="m-0 text-[var(--muted)]">{modal.message}</p> : null}
        </AmicroDialog>
    );
}

function PromptModal({ modal }: { modal: Extract<ModalState, { type: 'prompt' }> }) {
    const [value, setValue] = useState(modal.value || '');
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) {
            setError('请输入名称');
            inputRef.current?.focus();
            return;
        }
        vaultStore.settleModal(trimmed);
    };

    return (
        <AmicroDialog
            title={modal.title}
            formName="prompt"
            hideClose
            onClose={() => vaultStore.settleModal(null)}
            onSubmit={handleSubmit}
            footer={
                <>
                    <AmicroButton variant="text" type="button" data-action="close-modal" onClick={() => vaultStore.settleModal(null)}>
                        取消
                    </AmicroButton>
                    <AmicroButton variant="primary" type="submit">
                        {modal.confirmLabel || '保存'}
                    </AmicroButton>
                </>
            }
        >
            {modal.message ? <p className="mt-0 mb-3 text-[var(--muted)]">{modal.message}</p> : null}
            <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                <span>{modal.label || '名称'}</span>
                <input
                    ref={inputRef}
                    className="field"
                    name="value"
                    value={value}
                    placeholder={modal.placeholder || ''}
                    autoComplete="off"
                    aria-invalid={error ? 'true' : undefined}
                    onChange={(e) => {
                        setValue(e.target.value);
                        setError(null);
                    }}
                    required
                />
            </label>
            <FormErrorBanner id="form-error-prompt" message={error} />
        </AmicroDialog>
    );
}

function MessageModal({ modal }: { modal: Extract<ModalState, { type: 'message' }> }) {
    return (
        <AmicroDialog
            title={modal.title}
            onClose={() => void vaultStore.closeModal()}
            footer={
                <AmicroButton
                    variant="primary"
                    type="button"
                    data-action="close-modal"
                    data-autofocus=""
                    onClick={() => void vaultStore.closeModal()}
                >
                    {modal.confirmLabel || '知道了'}
                </AmicroButton>
            }
        >
            <div className="message-body whitespace-pre-wrap text-[var(--muted)]" role="status">
                {modal.message}
            </div>
        </AmicroDialog>
    );
}

function AddEditEntryModal({
    modal,
    categories: vaultCategories,
}: {
    modal: Extract<ModalState, { type: 'add' | 'edit' }>;
    categories: string[];
}) {
    const isEdit = modal.type === 'edit';
    const initial = useMemo<EntryFormValues>(() => {
        const base: EntryFormValues = {
            title: '',
            username: '',
            password: '',
            category: vaultCategories[0] || '',
            url: '',
            notes: '',
            favorite: false,
            ...(isEdit ? modal.entry : {}),
            ...(modal.draft?.values || {}),
        };
        return base;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [values, setValues] = useState<EntryFormValues>(initial);
    const [error, setError] = useState<string | null>(null);
    const [invalidField, setInvalidField] = useState<keyof EntryFormValues | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const titleRef = useRef<HTMLInputElement>(null);
    const usernameRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);

    const categories = useMemo(
        () => [...new Set([...vaultCategories, values.category].filter(Boolean))],
        [vaultCategories, values.category],
    );

    const isDirty = JSON.stringify(values) !== JSON.stringify(initial);

    useEffect(() => {
        const onPageHide = () => {
            void vaultStore.persistEntryDraft().catch(() => {});
        };
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (isDirty && !vaultStore.getUpdateRequested()) {
                event.preventDefault();
                event.returnValue = '';
            }
        };
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('beforeunload', onBeforeUnload);
        };
    }, [isDirty]);

    const updateField = <K extends keyof EntryFormValues>(field: K, value: EntryFormValues[K]) => {
        const next = { ...values, [field]: value };
        setValues(next);
        if (invalidField === field) setInvalidField(null);
        setError(null);
        vaultStore.updateDraft(next, isEdit, isEdit ? modal.entry : undefined);
        vaultStore.resetLockTimer();
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setError(null);
        setInvalidField(null);

        if (!values.title.trim()) {
            setError('请填写此项');
            setInvalidField('title');
            titleRef.current?.focus();
            return;
        }
        if (!values.username.trim()) {
            setError('请填写此项');
            setInvalidField('username');
            usernameRef.current?.focus();
            return;
        }
        if (!values.password) {
            setError('请填写此项');
            setInvalidField('password');
            passwordRef.current?.focus();
            return;
        }

        setSubmitting(true);
        try {
            await vaultStore.submitEntry(values);
        } catch (err: any) {
            setError(err?.message || '保存失败');
            setInvalidField('title');
            titleRef.current?.focus();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AmicroDialog
            title={isEdit ? '编辑密码' : '新增密码'}
            formName={isEdit ? 'edit-entry' : 'add-entry'}
            onClose={() => void vaultStore.closeModal(isDirty)}
            onSubmit={handleSubmit}
            footer={
                <>
                    <AmicroButton
                        variant="text"
                        type="button"
                        data-action="close-modal"
                        onClick={() => void vaultStore.closeModal(isDirty)}
                    >
                        取消
                    </AmicroButton>
                    <AmicroButton variant="primary" type="submit" loading={submitting}>
                        保存
                    </AmicroButton>
                </>
            }
        >
            <div className="form-grid grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>站点或应用</span>
                    <input
                        ref={titleRef}
                        className="field"
                        name="title"
                        value={values.title}
                        onChange={(e) => updateField('title', e.target.value)}
                        aria-invalid={invalidField === 'title' ? 'true' : undefined}
                        required
                    />
                </label>
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>分类</span>
                    <select
                        className="field"
                        name="category"
                        value={values.category}
                        onChange={(e) => updateField('category', e.target.value)}
                    >
                        {categories.map((category) => (
                            <option key={category} value={category}>{category}</option>
                        ))}
                    </select>
                </label>
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>账户名</span>
                    <input
                        ref={usernameRef}
                        className="field machine"
                        name="username"
                        value={values.username}
                        onChange={(e) => updateField('username', e.target.value)}
                        aria-invalid={invalidField === 'username' ? 'true' : undefined}
                        required
                    />
                </label>
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>密码</span>
                    <PasswordField
                        ref={passwordRef}
                        className="machine"
                        name="password"
                        value={values.password}
                        autoComplete="off"
                        onChange={(e) => updateField('password', e.target.value)}
                        aria-invalid={invalidField === 'password' ? 'true' : undefined}
                        required
                    />
                </label>
                <label className="form-field full sm:col-span-2 grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>网站</span>
                    <input
                        className="field machine"
                        name="url"
                        type="url"
                        value={values.url}
                        placeholder="https://example.com"
                        onChange={(e) => updateField('url', e.target.value)}
                    />
                </label>
                <label className="form-field full sm:col-span-2 grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>备注</span>
                    <textarea
                        className="field"
                        name="notes"
                        value={values.notes}
                        placeholder="可选备注"
                        onChange={(e) => updateField('notes', e.target.value)}
                    />
                </label>
                <label className="check-field full sm:col-span-2 inline-flex items-center gap-2 text-[13.5px] text-[var(--muted)] cursor-pointer">
                    <input
                        name="favorite"
                        type="checkbox"
                        checked={values.favorite}
                        onChange={(e) => updateField('favorite', e.target.checked)}
                        className="w-4 h-4 accent-[var(--accent)] rounded cursor-pointer"
                    />
                    <span>收藏此条目</span>
                </label>
            </div>
            <FormErrorBanner id={`form-error-${isEdit ? 'edit-entry' : 'add-entry'}`} message={error} />
        </AmicroDialog>
    );
}

function DetailModal({ modal, state }: { modal: Extract<ModalState, { type: 'detail' }>; state: VaultState }) {
    const entry = state.vault?.entries.find((item) => item.id === modal.id);
    if (!entry) return null;

    return (
        <AmicroDialog
            title={entry.title}
            onClose={() => void vaultStore.closeModal()}
            footer={
                <div className="w-full flex items-center justify-between gap-2">
                    <AmicroButton
                        variant="danger-text"
                        data-action="delete-entry"
                        data-id={entry.id}
                        onClick={() => void vaultStore.deleteEntry(entry.id)}
                    >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                        <span>移至回收站</span>
                    </AmicroButton>
                    <div className="flex items-center gap-2">
                        <AmicroFavoriteButton
                            favorite={Boolean(entry.favorite)}
                            justFavorited={state.lastFavoriteAnimationId === entry.id}
                            entryId={entry.id}
                            title={entry.title}
                            onToggle={() => void vaultStore.toggleFavorite(entry.id)}
                        />
                        <AmicroButton
                            variant="secondary"
                            data-action="open-edit"
                            data-id={entry.id}
                            onClick={() => vaultStore.openEditModal(entry.id)}
                        >
                            编辑
                        </AmicroButton>
                    </div>
                </div>
            }
        >
            <DetailFields entry={entry} revealed={modal.revealed} />
            <div className="insp-meta mt-4 text-[12.5px] text-[var(--faint)]">
                {entry.category || '未分类'} · 更新于 {formatShortDate(entry.updatedAt)}
            </div>
        </AmicroDialog>
    );
}

function SyncModal({ state }: { state: VaultState }) {
    const first = !state.record?.remoteSha;
    const status = vaultStore.syncStatus();
    const configured = vaultStore.syncConfigured();

    return (
        <AmicroDialog title={first ? '完成首次连接' : '同步详情'} onClose={() => void vaultStore.closeModal()}>
            <div
                className="sync-state inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--card-2)] text-[13px] font-semibold mb-3"
                data-sync-status={status.status}
            >
                <span data-sync-icon=""><SyncIcon icon={status.icon} spinning={Boolean(state.syncing)} /></span>
                <span data-sync-label="">{status.label}</span>
            </div>
            <p data-sync-detail="" className="mt-0 mb-3 text-[13.5px] text-[var(--muted)] break-words">
                {status.detail}
            </p>
            {configured ? (
                <div className="grid gap-3">
                    <p className="m-0 text-[13px] text-[var(--muted)]">
                        {first
                            ? '已有远端保险库请选择导入；远端没有文件请选择初始化。'
                            : '不同字段自动合并；冲突可逐项选择。采用远端版本会替换本地条目。'}
                    </p>
                    <div className="sync-actions flex items-center gap-2.5 flex-wrap">
                        <AmicroButton
                            variant="secondary"
                            data-action="pull-remote"
                            disabled={Boolean(state.syncing)}
                            onClick={() => void vaultStore.pullRemote()}
                        >
                            <Download className="w-4 h-4" strokeWidth={1.8} />
                            <span>{first ? '从远端导入' : '采用远端版本'}</span>
                        </AmicroButton>
                        <AmicroButton
                            variant="primary"
                            data-action="push-remote"
                            disabled={Boolean(state.syncing)}
                            onClick={() => void vaultStore.pushRemote()}
                        >
                            <RefreshCw className="w-4 h-4" strokeWidth={1.8} />
                            <span>{first ? '初始化远端' : '立即同步'}</span>
                        </AmicroButton>
                    </div>
                    {state.syncConflict ? (
                        <AmicroButton
                            variant="primary"
                            className="sync-backup w-full"
                            data-action="open-conflicts"
                            onClick={() => vaultStore.openModal({ type: 'conflicts' })}
                        >
                            查看并处理冲突
                        </AmicroButton>
                    ) : null}
                    <AmicroButton
                        variant="secondary"
                        className="sync-backup w-full"
                        data-action="export-backup"
                        onClick={() => void vaultStore.downloadBackup()}
                    >
                        <Download className="w-4 h-4" strokeWidth={1.8} />
                        <span>先导出加密备份</span>
                    </AmicroButton>
                </div>
            ) : (
                <AmicroButton
                    variant="primary"
                    data-action="open-sync-config"
                    onClick={() => vaultStore.openModal({ type: 'sync-config', step: 1 })}
                >
                    配置私有仓库
                </AmicroButton>
            )}
        </AmicroDialog>
    );
}

function SyncResultModal({
    modal,
    hasConflict,
}: {
    modal: Extract<ModalState, { type: 'sync-result' }>;
    hasConflict: boolean;
}) {
    return (
        <AmicroDialog
            title={modal.title}
            onClose={() => void vaultStore.closeModal()}
            footer={
                <AmicroButton variant="primary" data-action="close-modal" onClick={() => void vaultStore.closeModal()}>
                    知道了
                </AmicroButton>
            }
        >
            <div className="sync-result flex items-start gap-2.5 p-3.5 rounded-xl bg-[var(--alert-soft)] text-[var(--alert)] text-[13.5px]" role="alert">
                <CircleAlert className="w-4.5 h-4.5 flex-none mt-0.5" strokeWidth={1.8} />
                <span className="break-words">{modal.message}</span>
            </div>
            {hasConflict ? (
                <AmicroButton
                    variant="primary"
                    className="sync-backup w-full mt-3"
                    data-action="open-conflicts"
                    onClick={() => vaultStore.openModal({ type: 'conflicts' })}
                >
                    查看冲突差异
                </AmicroButton>
            ) : null}
        </AmicroDialog>
    );
}

function ConflictsModal({ state }: { state: VaultState }) {
    const conflicts = state.syncConflict?.conflicts || [];
    const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({});
    const [revealedSecrets, setRevealedSecrets] = useState<Record<number, boolean>>({});
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setError(null);
        for (let i = 0; i < conflicts.length; i += 1) {
            if (!choices[conflicts[i].id]) {
                setError('请为每个冲突选择此设备或远端版本');
                return;
            }
        }
        setSubmitting(true);
        try {
            await vaultStore.submitConflicts(choices);
        } catch (err: any) {
            setError(err?.message || '应用选择失败');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AmicroDialog
            title="选择冲突版本"
            formName="resolve-conflicts"
            onClose={() => void vaultStore.closeModal()}
            onSubmit={handleSubmit}
            footer={
                <>
                    <AmicroButton variant="text" data-action="close-modal" onClick={() => void vaultStore.closeModal()}>
                        取消
                    </AmicroButton>
                    <AmicroButton variant="primary" type="submit" loading={submitting}>
                        应用选择并同步
                    </AmicroButton>
                </>
            }
        >
            <p className="mt-0 mb-3 text-[13.5px] text-[var(--muted)]">
                先保存一份本地备份，再逐项选择。密码默认隐藏；新远端修改会重新检查。
            </p>
            <AmicroButton
                variant="secondary"
                className="w-full mb-4"
                data-action="export-backup"
                onClick={() => void vaultStore.downloadBackup()}
            >
                <Download className="w-4 h-4" strokeWidth={1.8} />
                <span>导出本地加密备份</span>
            </AmicroButton>
            <div className="conflict-list grid gap-3">
                {conflicts.map((conflict, index) => {
                    const revealed = Boolean(revealedSecrets[index]);
                    const passwordVal = (value: unknown) =>
                        typeof value === 'object' && value !== null ? (value as { entry?: { password?: string } }).entry?.password : value;
                    const secretText = revealed
                        ? `本地：${String(passwordVal(conflict.local) ?? '已删除')}\n远端：${String(passwordVal(conflict.remote) ?? '已删除')}`
                        : '';
                    return (
                        <fieldset key={conflict.id} className="conflict-item rounded-xl border border-[var(--rule)] p-3.5 grid gap-2 m-0">
                            <legend className="px-1.5 text-[12.5px] font-semibold text-[var(--ink)]">
                                {conflict.title || '条目'} · {CONFLICT_FIELD_LABELS[conflict.field] || conflict.field || '版本'}
                            </legend>
                            <label className="flex items-start gap-2 text-[13px] cursor-pointer whitespace-pre-wrap break-words">
                                <input
                                    type="radio"
                                    name={`choice-${index}`}
                                    value="local"
                                    checked={choices[conflict.id] === 'local'}
                                    onChange={() => setChoices((prev) => ({ ...prev, [conflict.id]: 'local' }))}
                                    required
                                    className="mt-1 accent-[var(--accent)]"
                                />
                                <span>本地：{previewConflictValue(conflict, conflict.local)}</span>
                            </label>
                            <label className="flex items-start gap-2 text-[13px] cursor-pointer whitespace-pre-wrap break-words">
                                <input
                                    type="radio"
                                    name={`choice-${index}`}
                                    value="remote"
                                    checked={choices[conflict.id] === 'remote'}
                                    onChange={() => setChoices((prev) => ({ ...prev, [conflict.id]: 'remote' }))}
                                    required
                                    className="mt-1 accent-[var(--accent)]"
                                />
                                <span>远端：{previewConflictValue(conflict, conflict.remote)}</span>
                            </label>
                            {(conflict.field === 'password' || conflict.field === 'record') && (
                                <>
                                    <AmicroButton
                                        variant="secondary"
                                        data-action="reveal-conflict"
                                        data-index={index}
                                        onClick={() => setRevealedSecrets((prev) => ({ ...prev, [index]: !prev[index] }))}
                                    >
                                        {revealed ? '隐藏密码差异' : '查看密码差异'}
                                    </AmicroButton>
                                    <div
                                        data-conflict-secret={index}
                                        hidden={!revealed}
                                        className="machine text-[12.5px] p-2.5 rounded-lg bg-[var(--card-2)] whitespace-pre-wrap break-all"
                                    >
                                        {secretText}
                                    </div>
                                </>
                            )}
                        </fieldset>
                    );
                })}
            </div>
            <FormErrorBanner id="form-error-resolve-conflicts" message={error} />
        </AmicroDialog>
    );
}

function QuickSwitchModal({ modal }: { modal: Extract<ModalState, { type: 'quick-switch' }> }) {
    const dialogRef = useRef<HTMLElement | null>(null);
    const matches = vaultStore.quickSwitchMatches();
    const index = matches.length ? Math.min(modal.index || 0, matches.length - 1) : 0;
    const activeEntryRef = useRef(matches[index]);
    activeEntryRef.current = matches[index];

    useEffect(() => {
        const shell = document.querySelector<HTMLElement>('.app-shell');
        if (shell) shell.inert = true;
        const input = dialogRef.current?.querySelector<HTMLInputElement>('input[name="quickQuery"]');
        input?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                vaultStore.closeQuickSwitch();
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                vaultStore.moveQuickIndex(event.key === 'ArrowDown' ? 1 : -1);
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                void vaultStore.activateQuickSwitch(activeEntryRef.current);
                return;
            }
            trapDialogKey(event, dialogRef.current);
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            if (!document.querySelector('[data-modal-layer]') && shell) shell.inert = false;
        };
    }, []);

    return (
        <div
            className="modal-layer open"
            data-modal-layer=""
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) vaultStore.closeQuickSwitch();
            }}
        >
            <section
                ref={(node) => { dialogRef.current = node; }}
                className="modal quick-switch"
                role="dialog"
                aria-modal="true"
                aria-labelledby="quick-switch-title"
            >
                <h2 className="visually-hidden" id="quick-switch-title">快速查找密码</h2>
                <div className="quick-head flex items-center gap-2.5 px-4 py-3 border-b border-[var(--rule)]">
                    <Search className="w-4 h-4 text-[var(--faint)] flex-none" strokeWidth={1.8} />
                    <input
                        className="field quick-input border-0 bg-transparent shadow-none focus:shadow-none focus:bg-transparent px-0"
                        name="quickQuery"
                        value={modal.query}
                        placeholder="快速查找并复制密码…"
                        aria-label="搜索并复制密码"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => vaultStore.setQuickQuery(e.target.value)}
                    />
                    <button
                        className="icon-button w-8 h-8 inline-grid place-items-center rounded-lg border-0 bg-transparent text-[var(--faint)] cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--ink)]"
                        type="button"
                        data-action="close-modal"
                        title="关闭"
                        aria-label="关闭"
                        onClick={() => vaultStore.closeQuickSwitch()}
                    >
                        <X className="w-4 h-4" strokeWidth={1.8} />
                    </button>
                </div>
                <div className="quick-list p-2 max-h-[380px] overflow-y-auto grid gap-0.5" data-quick-list="">
                    {matches.length ? matches.slice(0, 8).map((entry, position) => (
                        <button
                            key={entry.id}
                            type="button"
                            className={cn(
                                'quick-row w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-0 bg-transparent text-left cursor-pointer transition-colors',
                                position === index ? 'active bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]',
                            )}
                            data-action="quick-select"
                            data-id={entry.id}
                            aria-selected={position === index}
                            onClick={() => void vaultStore.activateQuickSwitch(entry)}
                        >
                            <span className="monogram" data-tab={identityTab(entry)}>{monogramOf(entry)}</span>
                            <span className="quick-copy flex-1 min-w-0 grid gap-0.5">
                                <strong className="text-[14px] font-semibold text-[var(--ink)] truncate">{entry.title}</strong>
                                <span className="text-[12.5px] text-[var(--muted)] truncate">{entry.username || '未设置账户'}</span>
                            </span>
                            {entry.favorite && <Star className="w-3.5 h-3.5 starred flex-none" strokeWidth={1.8} />}
                        </button>
                    )) : (
                        <div className="empty-state py-10 text-center grid justify-items-center gap-2 text-[var(--faint)]">
                            <Search className="w-7 h-7 opacity-50" strokeWidth={1.6} />
                            <div>没有找到匹配的条目</div>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

function SyncConfigModal({ modal, state }: { modal: Extract<ModalState, { type: 'sync-config' }>; state: VaultState }) {
    const sync = state.vault?.sync;
    const [step, setStep] = useState<1 | 2>(modal.step || 1);
    const [repositoryUrl, setRepositoryUrl] = useState(
        sync?.owner && sync?.repo ? `https://github.com/${sync.owner}/${sync.repo}` : '',
    );
    const [branch, setBranch] = useState(sync?.branch || 'main');
    const [path, setPath] = useState(sync?.path || 'passwmana.vault');
    const [token, setToken] = useState(sync?.token || '');
    const [connectionResult, setConnectionResult] = useState(
        modal.connectionResult || '验证仓库、分支和当前令牌的读写权限。',
    );
    const [testing, setTesting] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [invalidField, setInvalidField] = useState<'repositoryUrl' | 'token' | null>(null);

    const repoRef = useRef<HTMLInputElement>(null);
    const tokenRef = useRef<HTMLInputElement>(null);

    const handleNext = () => {
        setError(null);
        setInvalidField(null);
        try {
            parseGithubRepository(repositoryUrl);
            setStep(2);
        } catch (err: any) {
            setError(err?.message || '仓库地址无效');
            setInvalidField('repositoryUrl');
            repoRef.current?.focus();
        }
    };

    const handleTest = async () => {
        if (testing) return;
        setTesting(true);
        setError(null);
        setInvalidField(null);
        setConnectionResult('正在检查仓库、令牌权限和分支…');
        try {
            const msg = await vaultStore.testSyncConnection({ repositoryUrl, branch, path, token });
            setConnectionResult(msg);
        } catch (err: any) {
            const msg = err?.message || '连接失败';
            setConnectionResult(`连接未通过：${msg}`);
            setError(msg);
            setInvalidField('token');
            tokenRef.current?.focus();
        } finally {
            setTesting(false);
        }
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setError(null);
        setInvalidField(null);
        setSubmitting(true);
        try {
            await vaultStore.submitSyncConfig({ repositoryUrl, branch, path, token });
        } catch (err: any) {
            setError(err?.message || '保存配置失败');
            setInvalidField(step === 1 ? 'repositoryUrl' : 'token');
            (step === 1 ? repoRef : tokenRef).current?.focus();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AmicroDialog
            title="连接 GitHub 私有仓库"
            formName="sync-config"
            onClose={() => void vaultStore.closeModal()}
            onSubmit={handleSubmit}
            footer={
                <>
                    <AmicroButton variant="text" data-action="close-modal" onClick={() => void vaultStore.closeModal()}>
                        取消
                    </AmicroButton>
                    {step === 1 ? (
                        <AmicroButton variant="primary" data-action="wizard-next" onClick={handleNext}>
                            下一步
                        </AmicroButton>
                    ) : (
                        <>
                            <AmicroButton variant="secondary" data-action="wizard-back" onClick={() => setStep(1)}>
                                上一步
                            </AmicroButton>
                            <AmicroButton variant="primary" type="submit" loading={submitting}>
                                保存并完成连接
                            </AmicroButton>
                        </>
                    )}
                </>
            }
        >
            <ol className="wizard-steps flex items-center gap-2 list-none p-0 m-0 mb-5 text-[12.5px] text-[var(--faint)]">
                <li className={cn('px-2.5 py-1 rounded-full', step === 1 && 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold')} aria-current={step === 1 ? 'step' : undefined}>
                    1. 仓库
                </li>
                <li className={cn('px-2.5 py-1 rounded-full', step === 2 && 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold')} aria-current={step === 2 ? 'step' : undefined}>
                    2. 访问令牌
                </li>
                <li className="px-2.5 py-1 rounded-full">3. 首次连接</li>
            </ol>

            <div hidden={step !== 1} className="grid gap-3">
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>仓库地址</span>
                    <input
                        ref={repoRef}
                        className="field"
                        name="repositoryUrl"
                        type="url"
                        value={repositoryUrl}
                        placeholder="https://github.com/owner/private-vault"
                        aria-invalid={invalidField === 'repositoryUrl' ? 'true' : undefined}
                        onChange={(e) => {
                            setRepositoryUrl(e.target.value);
                            setError(null);
                        }}
                    />
                </label>
                <p className="form-help m-0 text-[12px] text-[var(--faint)]">
                    使用你创建的私有仓库，密码库只上传密文。
                </p>
                <details className="rounded-xl border border-[var(--rule)] p-3 bg-[var(--card-2)]">
                    <summary className="text-[13px] font-medium cursor-pointer text-[var(--ink)]">高级设置</summary>
                    <div className="form-stack grid gap-3 mt-3">
                        <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                            <span>分支</span>
                            <input className="field" name="branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
                        </label>
                        <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                            <span>密文文件路径</span>
                            <input className="field" name="path" value={path} onChange={(e) => setPath(e.target.value)} />
                        </label>
                    </div>
                </details>
            </div>

            <div hidden={step !== 2} className="grid gap-3.5">
                <p className="m-0 text-[13px] text-[var(--muted)] leading-relaxed">
                    <a
                        href="https://github.com/settings/personal-access-tokens/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent)] hover:underline font-medium"
                    >
                        创建 Fine-grained PAT
                    </a>
                    ：仅选此私有仓库，授予 Contents 读写权限，并设置有效期。
                </p>
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>Fine-grained PAT</span>
                    <PasswordField
                        ref={tokenRef}
                        name="token"
                        value={token}
                        autoComplete="off"
                        toggleLabel="显示令牌"
                        hideLabel="隐藏令牌"
                        aria-invalid={invalidField === 'token' ? 'true' : undefined}
                        onChange={(e) => {
                            setToken(e.target.value);
                            setError(null);
                        }}
                    />
                </label>
                <AmicroButton
                    variant="secondary"
                    className="sync-backup w-full"
                    data-action="test-sync-connection"
                    loading={testing}
                    onClick={() => void handleTest()}
                >
                    <Plug className="w-4 h-4" strokeWidth={1.8} />
                    <span>测试连接</span>
                </AmicroButton>
                <p role="status" data-connection-result="" className="m-0 text-[12.5px] text-[var(--muted)]">
                    {connectionResult}
                </p>
            </div>
            <FormErrorBanner id="form-error-sync-config" message={error} />
        </AmicroDialog>
    );
}

function SimplePasswordFormModal({
    formName,
    title,
    intro,
    label,
    submitLabel,
    fieldName = 'password',
    autoComplete = 'current-password',
    onSubmitPassword,
}: {
    formName: string;
    title: string;
    intro: string;
    label: string;
    submitLabel: string;
    fieldName?: string;
    autoComplete?: string;
    onSubmitPassword: (password: string) => Promise<void>;
}) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setError(null);
        if (!password) {
            setError('请填写此项');
            inputRef.current?.focus();
            return;
        }
        setSubmitting(true);
        try {
            await onSubmitPassword(password);
        } catch (err: any) {
            setError(err?.message || '操作失败');
            inputRef.current?.focus();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AmicroDialog
            title={title}
            formName={formName}
            onClose={() => void vaultStore.closeModal()}
            onSubmit={handleSubmit}
            footer={
                <>
                    <AmicroButton variant="text" data-action="close-modal" onClick={() => void vaultStore.closeModal()}>
                        取消
                    </AmicroButton>
                    <AmicroButton variant="primary" type="submit" loading={submitting}>
                        {submitLabel}
                    </AmicroButton>
                </>
            }
        >
            <p className="mt-0 mb-4 text-[13.5px] text-[var(--muted)]">{intro}</p>
            <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                <span>{label}</span>
                <PasswordField
                    ref={inputRef}
                    name={fieldName}
                    value={password}
                    autoComplete={autoComplete}
                    aria-invalid={error ? 'true' : undefined}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                    }}
                    required
                />
            </label>
            <FormErrorBanner id={`form-error-${formName}`} message={error} />
        </AmicroDialog>
    );
}

function EnableDeviceUnlockModal() {
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setError(null);
        if (!password) {
            setError('请填写此项');
            inputRef.current?.focus();
            return;
        }
        setSubmitting(true);
        try {
            await vaultStore.submitEnableDeviceUnlock(password);
        } catch (err: any) {
            setError(err?.message || '操作失败');
            inputRef.current?.focus();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AmicroDialog
            title="开启免密自动解锁"
            formName="enable-device-unlock"
            onClose={() => void vaultStore.closeModal()}
            onSubmit={handleSubmit}
            footer={
                <>
                    <AmicroButton variant="text" data-action="close-modal" onClick={() => void vaultStore.closeModal()}>
                        取消
                    </AmicroButton>
                    <AmicroButton variant="primary" type="submit" loading={submitting}>
                        验证并开启
                    </AmicroButton>
                </>
            }
        >
            <p className="mt-0 mb-3 text-[13.5px] text-[var(--muted)]">
                验证一次主密码后，保险库密钥会交给浏览器保管，并只留在本机。之后打开或刷新页面直接进入密码库，不必每次输入。
            </p>
            <ul className="form-list pl-4.5 mt-0 mb-4 grid gap-1.5 text-[12.5px] text-[var(--muted)]">
                <li>密钥不会上传，也不会进入同步、备份或草稿。</li>
                <li>浏览器会把它与网站数据一同视为可删除的数据；申请持久化存储可降低被清理的风险。</li>
                <li>锁定只清除当前页面；在设置 → 安全中关闭，或修改主密码、用恢复密钥重设后，都需要重新输入主密码。</li>
                <li>在共用或不受信任的电脑上请保持关闭。</li>
            </ul>
            <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                <span>主密码</span>
                <PasswordField
                    ref={inputRef}
                    name="password"
                    value={password}
                    autoComplete="current-password"
                    aria-invalid={error ? 'true' : undefined}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                    }}
                    required
                />
            </label>
            <FormErrorBanner id="form-error-enable-device-unlock" message={error} />
        </AmicroDialog>
    );
}

function DisableDeviceUnlockModal() {
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
            await vaultStore.submitDisableDeviceUnlock();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AmicroDialog
            title="关闭免密自动解锁"
            formName="disable-device-unlock"
            onClose={() => void vaultStore.closeModal()}
            onSubmit={handleSubmit}
            footer={
                <>
                    <AmicroButton variant="text" data-action="close-modal" onClick={() => void vaultStore.closeModal()}>
                        取消
                    </AmicroButton>
                    <AmicroButton variant="danger" type="submit" loading={submitting}>
                        关闭并删除密钥
                    </AmicroButton>
                </>
            }
        >
            <p className="m-0 text-[13.5px] text-[var(--muted)]">
                将删除浏览器保管的保险库密钥。本页面保持开启，刷新或重新打开后需要输入主密码。
            </p>
        </AmicroDialog>
    );
}

function ChangePasswordModal() {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [invalidField, setInvalidField] = useState<'currentPassword' | 'newPassword' | 'confirmPassword' | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const currentRef = useRef<HTMLInputElement>(null);
    const newRef = useRef<HTMLInputElement>(null);
    const confirmRef = useRef<HTMLInputElement>(null);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setError(null);
        setInvalidField(null);

        if (!currentPassword) {
            setError('请填写此项');
            setInvalidField('currentPassword');
            currentRef.current?.focus();
            return;
        }
        if (newPassword.length < 12) {
            setError('主密码至少需要 12 个字符');
            setInvalidField('newPassword');
            newRef.current?.focus();
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('两次新密码不一致');
            setInvalidField('confirmPassword');
            confirmRef.current?.focus();
            return;
        }

        setSubmitting(true);
        try {
            await vaultStore.submitChangePassword(currentPassword, newPassword, confirmPassword);
        } catch (err: any) {
            const msg = err?.message || '修改失败';
            setError(msg);
            const target = /两次/.test(msg) ? 'confirmPassword' : 'currentPassword';
            setInvalidField(target);
            (target === 'confirmPassword' ? confirmRef : currentRef).current?.focus();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AmicroDialog
            title="修改主密码"
            formName="change-password"
            onClose={() => void vaultStore.closeModal()}
            onSubmit={handleSubmit}
            footer={
                <>
                    <AmicroButton variant="text" data-action="close-modal" onClick={() => void vaultStore.closeModal()}>
                        取消
                    </AmicroButton>
                    <AmicroButton variant="primary" type="submit" loading={submitting}>
                        保存新密码
                    </AmicroButton>
                </>
            }
        >
            <p className="mt-0 mb-4 text-[13.5px] text-[var(--muted)]">
                新主密码会同步到其他设备；并发修改时会要求选择版本。
            </p>
            <div className="form-stack grid gap-3.5">
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>当前主密码</span>
                    <input
                        ref={currentRef}
                        className="field"
                        name="currentPassword"
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        aria-invalid={invalidField === 'currentPassword' ? 'true' : undefined}
                        onChange={(e) => {
                            setCurrentPassword(e.target.value);
                            if (invalidField === 'currentPassword') setInvalidField(null);
                        }}
                        required
                    />
                </label>
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>新主密码</span>
                    <input
                        ref={newRef}
                        className="field"
                        name="newPassword"
                        type="password"
                        autoComplete="new-password"
                        minLength={12}
                        value={newPassword}
                        aria-describedby="new-password-help"
                        aria-invalid={invalidField === 'newPassword' ? 'true' : undefined}
                        onChange={(e) => {
                            setNewPassword(e.target.value);
                            if (invalidField === 'newPassword') setInvalidField(null);
                        }}
                        required
                    />
                </label>
                <PasswordStrengthHint password={newPassword} id="new-password-help" />
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>确认新主密码</span>
                    <input
                        ref={confirmRef}
                        className="field"
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        minLength={12}
                        value={confirmPassword}
                        aria-invalid={invalidField === 'confirmPassword' ? 'true' : undefined}
                        onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            if (invalidField === 'confirmPassword') setInvalidField(null);
                        }}
                        required
                    />
                </label>
            </div>
            <FormErrorBanner id="form-error-change-password" message={error} />
        </AmicroDialog>
    );
}

function RecoveryResetModal() {
    const [recoveryCode, setRecoveryCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [invalidField, setInvalidField] = useState<'recoveryCode' | 'newPassword' | 'confirmPassword' | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const codeRef = useRef<HTMLInputElement>(null);
    const newRef = useRef<HTMLInputElement>(null);
    const confirmRef = useRef<HTMLInputElement>(null);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setError(null);
        setInvalidField(null);

        if (!recoveryCode.trim()) {
            setError('请填写此项');
            setInvalidField('recoveryCode');
            codeRef.current?.focus();
            return;
        }
        if (newPassword.length < 12) {
            setError('主密码至少需要 12 个字符');
            setInvalidField('newPassword');
            newRef.current?.focus();
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('两次新密码不一致');
            setInvalidField('confirmPassword');
            confirmRef.current?.focus();
            return;
        }

        setSubmitting(true);
        try {
            await vaultStore.submitRecoveryReset(recoveryCode, newPassword, confirmPassword);
        } catch (err: any) {
            const msg = err?.message || '重设失败';
            setError(msg);
            const target = /两次/.test(msg) ? 'confirmPassword' : 'recoveryCode';
            setInvalidField(target);
            (target === 'confirmPassword' ? confirmRef : codeRef).current?.focus();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AmicroDialog
            title="使用恢复密钥"
            formName="recovery-reset"
            onClose={() => void vaultStore.closeModal()}
            onSubmit={handleSubmit}
            footer={
                <>
                    <AmicroButton variant="text" data-action="close-modal" onClick={() => void vaultStore.closeModal()}>
                        取消
                    </AmicroButton>
                    <AmicroButton variant="primary" type="submit" loading={submitting}>
                        验证并重设主密码
                    </AmicroButton>
                </>
            }
        >
            <p className="mt-0 mb-4 text-[13.5px] text-[var(--muted)]">
                恢复密钥在本机验证；重设的主密码会随保险库同步到其他设备。请先锁定其他打开的标签页。
            </p>
            <div className="form-stack grid gap-3.5">
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>恢复密钥</span>
                    <input
                        ref={codeRef}
                        className="field machine"
                        name="recoveryCode"
                        autoComplete="off"
                        value={recoveryCode}
                        aria-invalid={invalidField === 'recoveryCode' ? 'true' : undefined}
                        onChange={(e) => {
                            setRecoveryCode(e.target.value);
                            if (invalidField === 'recoveryCode') setInvalidField(null);
                        }}
                        required
                    />
                </label>
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>新主密码</span>
                    <input
                        ref={newRef}
                        className="field"
                        name="newPassword"
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        value={newPassword}
                        aria-invalid={invalidField === 'newPassword' ? 'true' : undefined}
                        onChange={(e) => {
                            setNewPassword(e.target.value);
                            if (invalidField === 'newPassword') setInvalidField(null);
                        }}
                        required
                    />
                </label>
                <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                    <span>确认新主密码</span>
                    <input
                        ref={confirmRef}
                        className="field"
                        name="confirmPassword"
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        value={confirmPassword}
                        aria-invalid={invalidField === 'confirmPassword' ? 'true' : undefined}
                        onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            if (invalidField === 'confirmPassword') setInvalidField(null);
                        }}
                        required
                    />
                </label>
            </div>
            <FormErrorBanner id="form-error-recovery-reset" message={error} />
        </AmicroDialog>
    );
}

export function ModalHost({ state }: { state: VaultState }) {
    const modal = state.modal;
    if (!modal || modal.type === 'recovery-created') return null;

    if (modal.type === 'quick-switch') {
        return <QuickSwitchModal modal={modal} />;
    }

    return (
        <AnimatePresence>
            {modal.type === 'confirm' && <ConfirmModal key="confirm" modal={modal} />}
            {modal.type === 'prompt' && <PromptModal key="prompt" modal={modal} />}
            {modal.type === 'message' && <MessageModal key="message" modal={modal} />}
            {(modal.type === 'add' || modal.type === 'edit') && (
                <AddEditEntryModal
                    key={modal.type === 'edit' ? `edit-${modal.entry.id}` : 'add-new'}
                    modal={modal}
                    categories={state.vault?.categories || []}
                />
            )}
            {modal.type === 'detail' && <DetailModal key={`detail-${modal.id}`} modal={modal} state={state} />}
            {modal.type === 'sync' && <SyncModal key="sync" state={state} />}
            {modal.type === 'sync-result' && (
                <SyncResultModal key="sync-result" modal={modal} hasConflict={Boolean(state.syncConflict)} />
            )}
            {modal.type === 'conflicts' && <ConflictsModal key="conflicts" state={state} />}
            {modal.type === 'remote-unlock' && (
                <SimplePasswordFormModal
                    key="remote-unlock"
                    formName="remote-unlock"
                    title="首次导入保险库"
                    intro="输入远端主密码以验证并导入。导入成功后保持解锁。"
                    label="远端主密码"
                    submitLabel="验证并导入"
                    onSubmitPassword={(pw) => vaultStore.submitRemoteUnlock(pw)}
                />
            )}
            {modal.type === 'backup-unlock' && (
                <SimplePasswordFormModal
                    key={`backup-unlock-${modal.rollback ? 'rollback' : 'file'}`}
                    formName="backup-unlock"
                    title={modal.rollback ? '恢复替换前的保险库' : '验证加密备份'}
                    intro="先验证密码和全部数据，验证失败不会覆盖当前保险库。恢复成功后会保留替换前的加密副本。"
                    label="备份主密码"
                    submitLabel="验证并恢复"
                    autoComplete="off"
                    onSubmitPassword={(pw) => vaultStore.submitBackupUnlock(pw)}
                />
            )}
            {modal.type === 'sync-config' && <SyncConfigModal key="sync-config" modal={modal} state={state} />}
            {modal.type === 'enable-device-unlock' && <EnableDeviceUnlockModal key="enable-device" />}
            {modal.type === 'disable-device-unlock' && <DisableDeviceUnlockModal key="disable-device" />}
            {modal.type === 'change-password' && <ChangePasswordModal key="change-password" />}
            {modal.type === 'recovery-reset' && <RecoveryResetModal key="recovery-reset" />}
        </AnimatePresence>
    );
}
