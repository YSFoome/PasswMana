import { forwardRef, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AmicroButtonVariant = 'primary' | 'secondary' | 'danger' | 'text' | 'danger-text' | 'icon';

export interface AmicroButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
    variant?: AmicroButtonVariant;
    loading?: boolean;
    children?: ReactNode;
}

const variantStyles: Record<AmicroButtonVariant, string> = {
    primary: 'primary-button min-h-9 inline-flex items-center justify-center gap-[7px] px-3.5 rounded-[9px] border-0 bg-[var(--accent)] text-[var(--on-accent)] text-[13.5px] font-semibold whitespace-nowrap cursor-pointer hover:brightness-105 disabled:cursor-wait disabled:opacity-50 transition-[background-color,color,filter,opacity] duration-150',
    secondary: 'secondary-button min-h-9 inline-flex items-center justify-center gap-[7px] px-3.5 rounded-[9px] border-0 bg-[var(--card-2)] text-[var(--ink)] text-[13.5px] font-semibold whitespace-nowrap cursor-pointer hover:bg-[var(--bg-selected)] disabled:cursor-wait disabled:opacity-50 transition-[background-color,color,opacity] duration-150',
    danger: 'danger-button min-h-9 inline-flex items-center justify-center gap-[7px] px-3.5 rounded-[9px] border-0 bg-[var(--alert-soft)] text-[var(--alert)] text-[13.5px] font-semibold whitespace-nowrap cursor-pointer hover:brightness-95 disabled:cursor-wait disabled:opacity-50 transition-[background-color,color,opacity] duration-150',
    text: 'text-button min-h-8 inline-flex items-center justify-center gap-[7px] px-2.5 rounded-[9px] border-0 bg-transparent text-[var(--muted)] text-[13.5px] font-medium whitespace-nowrap cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-50 transition-[background-color,color,opacity] duration-150',
    'danger-text': 'danger-text-button min-h-8 inline-flex items-center gap-[5px] px-2 rounded-lg border-0 bg-transparent text-[var(--faint)] text-[12px] font-medium whitespace-nowrap cursor-pointer hover:text-[var(--alert)] hover:bg-[var(--alert-soft)] disabled:cursor-wait disabled:opacity-50 transition-[color,background-color] duration-150',
    icon: 'icon-button w-8 h-8 inline-grid place-items-center rounded-lg border-0 bg-transparent text-[var(--faint)] cursor-pointer flex-none hover:bg-[var(--bg-hover)] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-50 transition-[background-color,color] duration-150',
};

export const AmicroButton = forwardRef<HTMLButtonElement, AmicroButtonProps>(
    ({ variant = 'secondary', loading = false, disabled, className, type = 'button', children, ...props }, ref) => {
        const isDisabled = Boolean(disabled || loading);
        return (
            <motion.button
                ref={ref}
                type={type}
                disabled={isDisabled}
                whileTap={isDisabled ? undefined : { scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 520, damping: 32, mass: 0.7 }}
                className={cn(variantStyles[variant], className)}
                {...props}
            >
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                {children}
            </motion.button>
        );
    },
);
AmicroButton.displayName = 'AmicroButton';
