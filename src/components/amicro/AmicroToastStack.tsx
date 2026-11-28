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
                        transition={{ type: 'spring', stiffness: 480, damping: 32 }}
                        className="toast px-4 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--on-ink)] text-[13.5px] font-medium shadow-[var(--shadow-float)] text-center max-w-full"
                    >
                        {item.message}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
