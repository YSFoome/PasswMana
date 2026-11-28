import { useCallback, useRef, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface AmicroSpotlightCardProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
}

export function AmicroSpotlightCard({ children, className, onMouseMove, ...props }: AmicroSpotlightCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);

    const handleMouseMove = useCallback(
        (event: MouseEvent<HTMLDivElement>) => {
            const el = cardRef.current;
            if (el) {
                const rect = el.getBoundingClientRect();
                el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
                el.style.setProperty('--my', `${event.clientY - rect.top}px`);
            }
            onMouseMove?.(event);
        },
        [onMouseMove],
    );

    return (
        <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            className={cn(
                'amicro-spotlight rounded-2xl border border-[var(--rule)] bg-[var(--card)] hover:border-[var(--rule-strong)]',
                className,
            )}
            {...props}
        >
            {children}
        </div>
    );
}
