import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { passwordStrengthLevel } from '@/core/ui-helpers';
import { cn } from '@/lib/utils';

export function FormErrorBanner({ id, message }: { id?: string; message: string | null }) {
    if (!message) return null;
    return (
        <p id={id} data-form-error="" className="form-error" role="alert">
            {message}
        </p>
    );
}

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    toggleLabel?: string;
    hideLabel?: string;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
    ({ className, toggleLabel = '显示密码', hideLabel = '隐藏密码', ...props }, ref) => {
        const [visible, setVisible] = useState(false);
        return (
            <div className="password-field relative flex items-center">
                <input
                    ref={ref}
                    type={visible ? 'text' : 'password'}
                    className={cn('field pr-11', className)}
                    {...props}
                />
                <button
                    className="icon-button absolute right-1.5 w-8 h-8 inline-grid place-items-center rounded-lg border-0 bg-transparent text-[var(--faint)] cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--ink)]"
                    type="button"
                    data-action="toggle-password"
                    title={visible ? hideLabel : toggleLabel}
                    aria-label={visible ? hideLabel : toggleLabel}
                    aria-pressed={visible}
                    onClick={() => setVisible((prev) => !prev)}
                >
                    {visible ? <EyeOff className="w-4 h-4" strokeWidth={1.8} /> : <Eye className="w-4 h-4" strokeWidth={1.8} />}
                </button>
            </div>
        );
    },
);
PasswordField.displayName = 'PasswordField';

export function PasswordStrengthHint({ password, id }: { password: string; id?: string }) {
    const info = passwordStrengthLevel(password);
    const barColor = info.tone === 'strong'
        ? 'bg-[var(--calm)]'
        : info.tone === 'fair'
            ? 'bg-[var(--caution)]'
            : 'bg-[var(--alert)]';
    return (
        <div className="space-y-1.5">
            <div className="grid grid-cols-3 gap-1.5 h-1" aria-hidden="true">
                {[1, 2, 3].map((step) => (
                    <span
                        key={step}
                        className={cn(
                            'rounded-full transition-colors duration-200',
                            info.score >= step ? barColor : 'bg-[var(--rule-strong)]',
                        )}
                    />
                ))}
            </div>
            <p className="form-help m-0 text-[var(--faint)] text-[12px] leading-relaxed" id={id} data-password-strength="">
                {info.label}
            </p>
        </div>
    );
}
