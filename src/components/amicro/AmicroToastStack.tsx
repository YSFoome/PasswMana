import { AnimatePresence, motion } from 'motion/react';
import type { ToastItem } from '@/core/types';

export function AmicroToastStack({ toasts }: { toasts: ToastItem[] }) {
    return (
        <div
            className="toast-wrap fixed bottom-5 left-1/2 -translate-x-1/2 z-[90] flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-[440px]"
            id="toast-wrap"
            role="status"
            aria-live="polite"
            aria-atomic="true"
        >
            <AnimatePresence initial={false}>
                {toasts.map((item) => (
                    <motion.div
                        key={item.id}
                        layout
                        initial={{ opacity: 0, y: 12, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                        className="toast inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--rule-strong)] bg-[var(--ink)] text-[var(--on-ink)] text-[13px] font-medium shadow-[var(--shadow-float)] text-center max-w-full"
                    >
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-none" aria-hidden="true" />
                        <span>{item.message}</span>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
