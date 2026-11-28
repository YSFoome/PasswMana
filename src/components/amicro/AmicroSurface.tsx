import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export interface AmicroSurfaceProps {
    children: ReactNode;
    className?: string;
    delay?: number;
}

export function AmicroSurface({ children, className, delay = 0 }: AmicroSurfaceProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay, ease: [0.22, 1, 0.36, 1] }}
            className={cn(className)}
        >
            {children}
        </motion.div>
    );
}
