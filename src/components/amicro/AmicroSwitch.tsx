import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export interface AmicroSwitchProps {
    checked: boolean;
    onToggle: () => void;
    label: string;
    actionName?: string;
    className?: string;
}

export function AmicroSwitch({ checked, onToggle, label, actionName, className }: AmicroSwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-pressed={checked}
            aria-label={label}
            title={label}
            data-action={actionName}
            onClick={onToggle}
            className={cn(
                'switch relative w-11 h-6.5 rounded-full border p-0.5 cursor-pointer flex items-center flex-none transition-[background-color,border-color,box-shadow] duration-150',
                checked
                    ? 'bg-[var(--accent)] border-transparent justify-end shadow-[0_0_12px_-2px_var(--accent-glow)]'
                    : 'bg-[var(--card-2)] border-[var(--rule-strong)] justify-start',
                className,
            )}
        >
            <motion.span
                layout
                transition={{ type: 'spring', stiffness: 580, damping: 34 }}
                className="block w-5 h-5 rounded-full bg-[var(--on-accent)] shadow-sm"
            />
        </button>
    );
}
