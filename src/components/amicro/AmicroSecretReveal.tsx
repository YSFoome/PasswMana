import { motion } from 'motion/react';
import { tokenizePassword } from '@/core/ui-helpers';
import { cn } from '@/lib/utils';

export interface AmicroSecretRevealProps {
    password: string;
    revealed: boolean;
    className?: string;
}

export function AmicroSecretReveal({ password, revealed, className }: AmicroSecretRevealProps) {
    const tokens = revealed ? tokenizePassword(password) : null;

    return (
        <span
            className={cn(
                'detail-secret machine text-[15px] break-all select-all inline-block min-w-0',
                revealed ? 'revealed text-[var(--ink)]' : 'masked text-[var(--muted)] tracking-[0.16em]',
                className,
            )}
            data-secret-value=""
        >
            <motion.span
                key={revealed ? 'revealed' : 'masked'}
                initial={{ opacity: 0.25, filter: 'blur(6px)' }}
                animate={{ opacity: 1, filter: 'blur(0px)' }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="inline"
            >
                {tokens
                    ? tokens.map((t, i) => (
                        <span key={i} className={t.kind === 'digit' ? 'pw-d' : t.kind === 'symbol' ? 'pw-s' : undefined}>
                            {t.char}
                        </span>
                    ))
                    : '••••••••••••••••'}
            </motion.span>
        </span>
    );
}
