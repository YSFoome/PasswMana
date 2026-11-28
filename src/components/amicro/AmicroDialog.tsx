import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { trapDialogKey } from '@/core/ui-helpers';
import { vaultStore } from '@/core/vault-store';
import { cn } from '@/lib/utils';

export interface AmicroDialogProps {
    title: string;
    hideTitle?: boolean;
    formName?: string;
    role?: 'dialog' | 'alertdialog';
    hideClose?: boolean;
    className?: string;
    layerClassName?: string;
    onClose: () => void;
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
    footer?: ReactNode;
    children: ReactNode;
}

export function AmicroDialog({
    title,
    hideTitle = false,
    formName,
    role = 'dialog',
    hideClose = false,
    className,
    layerClassName,
    onClose,
    onSubmit,
    footer,
    children,
}: AmicroDialogProps) {
    const dialogRef = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const shell = document.querySelector<HTMLElement>('.app-shell');
        const lockScreen = document.querySelector<HTMLElement>('.lock-screen');
        if (shell) shell.inert = true;
        if (lockScreen) lockScreen.inert = true;

        const dialog = dialogRef.current;
        if (dialog) {
            const focusTarget = dialog.querySelector<HTMLElement>('[data-autofocus]')
                || dialog.querySelector<HTMLElement>('input:not([type="checkbox"]), select, textarea')
                || dialog.querySelector<HTMLElement>('.modal-foot .primary-button')
                || dialog.querySelector<HTMLElement>('.modal-foot .secondary-button')
                || dialog.querySelector<HTMLElement>('button, a[href]');
            focusTarget?.focus();
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onCloseRef.current();
                return;
            }
            trapDialogKey(event, dialogRef.current);
        };
        document.addEventListener('keydown', onKeyDown, true);

        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            const anotherModalOpen = Boolean(document.querySelector('[data-modal-layer]'));
            if (!anotherModalOpen) {
                if (shell) shell.inert = false;
                if (lockScreen) lockScreen.inert = false;
                const trigger = vaultStore.getDialogTrigger();
                if (trigger) {
                    vaultStore.clearDialogTrigger();
                    const controls = [...document.querySelectorAll<HTMLElement>('[data-action]')];
                    const target = controls.find((node) => node.dataset.action === trigger.action
                        && (trigger.id === undefined || node.dataset.id === trigger.id)
                        && (trigger.panel === undefined || node.dataset.panel === trigger.panel)
                        && node.getClientRects().length);
                    queueMicrotask(() => target?.focus());
                }
            }
        };
    }, []);

    const bodyAndFoot = (
        <>
            <header className="modal-head flex items-center justify-between gap-3 px-5.5 pt-5 pb-3.5 border-b border-[var(--rule)]">
                <h2 id={titleId} className={cn('m-0 text-[16.5px] font-semibold tracking-tight', hideTitle && 'visually-hidden')}>
                    {title}
                </h2>
                {!hideClose && (
                    <button
                        className="icon-button w-8 h-8 inline-grid place-items-center rounded-lg border-0 bg-transparent text-[var(--faint)] cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--ink)]"
                        type="button"
                        data-action="close-modal"
                        title="关闭"
                        aria-label="关闭"
                        onClick={onClose}
                    >
                        <X className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
                    </button>
                )}
            </header>
            <div className="modal-body overflow-y-auto px-5.5 py-4.5 text-[14.5px] leading-relaxed">
                {children}
            </div>
            {footer && (
                <footer className="modal-foot flex items-center justify-end gap-2.5 px-5.5 py-3.5 border-t border-[var(--rule)] bg-[var(--bg-inspector)]">
                    {footer}
                </footer>
            )}
        </>
    );

    return (
        <motion.div
            data-modal-layer=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            className={cn('modal-layer open', formName && 'form-open', layerClassName)}
        >
            {formName ? (
                <motion.form
                    ref={(node) => { dialogRef.current = node; }}
                    data-form={formName}
                    role={role}
                    aria-modal="true"
                    aria-labelledby={titleId}
                    noValidate
                    onSubmit={onSubmit}
                    initial={{ opacity: 0, scale: 0.96, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 6 }}
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    className={cn('modal', className)}
                >
                    {bodyAndFoot}
                </motion.form>
            ) : (
                <motion.section
                    ref={(node) => { dialogRef.current = node; }}
                    role={role}
                    aria-modal="true"
                    aria-labelledby={titleId}
                    initial={{ opacity: 0, scale: 0.96, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 6 }}
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    className={cn('modal', className)}
                >
                    {bodyAndFoot}
                </motion.section>
            )}
        </motion.div>
    );
}
