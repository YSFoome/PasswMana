import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AmicroButton, type AmicroButtonProps } from './AmicroButton';

export interface AmicroCopyButtonProps extends Omit<AmicroButtonProps, 'onClick' | 'children'> {
    onCopy: () => Promise<void> | void;
    label?: string;
}

export function AmicroCopyButton({ onCopy, label, variant = 'icon', className, ...props }: AmicroCopyButtonProps) {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    const handleClick = async () => {
        await onCopy();
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1400);
    };

    return (
        <AmicroButton
            variant={variant}
            className={cn(copied && 'bg-[var(--calm-soft)] text-[var(--calm)]', className)}
            onClick={() => void handleClick()}
            {...props}
        >
            <AnimatePresence mode="wait" initial={false}>
                {copied ? (
                    <motion.span
                        key="check"
                        initial={{ scale: 0.6, opacity: 0, rotate: -14 }}
                        animate={{ scale: 1, opacity: 1, rotate: 0 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                        className="inline-flex items-center gap-1.5 text-[var(--calm)]"
                    >
                        <Check className="w-4 h-4" strokeWidth={2.2} aria-hidden="true" />
                        {label ? <span>{label}</span> : null}
                    </motion.span>
                ) : (
                    <motion.span
                        key="copy"
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className="inline-flex items-center gap-1.5"
                    >
                        <Copy className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
                        {label ? <span>{label}</span> : null}
                    </motion.span>
                )}
            </AnimatePresence>
        </AmicroButton>
    );
}
