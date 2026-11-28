import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function AmicroKbd({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <kbd
            className={cn(
                'inline-flex items-center justify-center px-1.5 py-0.5 min-w-[20px] rounded-md border border-[var(--rule-strong)] bg-[var(--card-2)] text-[11px] font-medium machine text-[var(--muted)] shadow-[inset_0_-1px_0_var(--rule-strong)] select-none',
                className,
            )}
        >
            {children}
        </kbd>
    );
}
