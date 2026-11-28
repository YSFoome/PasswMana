import { motion } from 'motion/react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AmicroFavoriteButtonProps {
    favorite: boolean;
    justFavorited?: boolean;
    entryId: string;
    title: string;
    onToggle: () => void;
    className?: string;
}

export function AmicroFavoriteButton({
    favorite,
    justFavorited = false,
    entryId,
    title,
    onToggle,
    className,
}: AmicroFavoriteButtonProps) {
    const label = `${favorite ? '取消收藏' : '收藏'} ${title}`;
    return (
        <motion.button
            type="button"
            data-action="toggle-favorite"
            data-id={entryId}
            aria-pressed={favorite}
            title={label}
            aria-label={label}
            whileTap={{ scale: 0.9 }}
            onClick={onToggle}
            className={cn(
                'icon-button favorite-button w-8 h-8 inline-grid place-items-center rounded-lg border-0 bg-transparent text-[var(--faint)] cursor-pointer flex-none hover:bg-[var(--bg-hover)] hover:text-[var(--ink)] transition-colors duration-150',
                favorite && 'is-favorite text-[var(--star)]',
                className,
            )}
        >
            <motion.span
                className="inline-flex items-center justify-center"
                animate={justFavorited ? { scale: [1, 1.38, 0.92, 1.08, 1], rotate: [0, -10, 8, 0] } : { scale: 1, rotate: 0 }}
                transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
            >
                <Star className={cn('w-4 h-4', favorite && 'starred')} strokeWidth={1.8} aria-hidden="true" />
            </motion.span>
        </motion.button>
    );
}
