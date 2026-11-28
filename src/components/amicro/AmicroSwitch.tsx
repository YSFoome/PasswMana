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
                'switch relative w-11 h-6.5 rounded-full border-0 p-0.5 cursor-pointer flex items-center flex-none transition-colors duration-150',
                checked ? 'bg-[var(--accent)] justify-end' : 'bg-[var(--rule-strong)] justify-start',
                className,
            )}
        >
            <motion.span
                layout
                transition={{ type: 'spring', stiffness: 560, damping: 34 }}
                className="block w-5.5 h-5.5 rounded-full bg-[var(--bg-list)] shadow-sm"
            />
        </button>
    );
}
