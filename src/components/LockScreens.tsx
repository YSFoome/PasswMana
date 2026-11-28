import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, Fingerprint, LockKeyhole, ShieldCheck } from 'lucide-react';
import { vaultStore } from '@/core/vault-store';
import { AmicroButton, AmicroSpotlightCard, AmicroSurface } from './amicro';
import { FormErrorBanner, PasswordField, PasswordStrengthHint } from './FormHelpers';

function LockTrustFooter() {
    return (
        <div className="device-plate mt-6 pt-4 border-t border-[var(--rule)] flex items-center justify-center gap-2 flex-wrap text-[11.5px] text-[var(--faint)]">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--card-2)] border border-[var(--rule)]">
                <LockKeyhole className="w-3 h-3 text-[var(--accent)]" strokeWidth={2} />
                AES-256-GCM
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--card-2)] border border-[var(--rule)]">
                PBKDF2 · 600K
            </span>
            <span>本机加密 · 密钥不离开设备</span>
        </div>
    );
}

export function SetupScreen() {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [invalidField, setInvalidField] = useState<'password' | 'confirmPassword' | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const passwordRef = useRef<HTMLInputElement>(null);
    const confirmRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        passwordRef.current?.focus();
    }, []);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (submitting) return;
        setError(null);
        setInvalidField(null);

        if (!password) {
            setError('请填写此项');
            setInvalidField('password');
            passwordRef.current?.focus();
            return;
        }
        if (password.length < 12) {
            setError('主密码至少需要 12 个字符');
            setInvalidField('password');
            passwordRef.current?.focus();
            return;
        }
        if (!confirmPassword) {
            setError('请填写此项');
            setInvalidField('confirmPassword');
            confirmRef.current?.focus();
            return;
        }
        if (password !== confirmPassword) {
            setError('两次主密码不一致');
            setInvalidField('confirmPassword');
            confirmRef.current?.focus();
            return;
        }

        setSubmitting(true);
        try {
            await vaultStore.submitSetup(password, confirmPassword);
        } catch (err: any) {
            setError(err?.message || '创建失败');
            setInvalidField('password');
            passwordRef.current?.focus();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="lock-screen min-h-dvh grid place-items-center p-4 sm:p-6">
            <AmicroSurface className="w-full max-w-[444px]">
                <AmicroSpotlightCard className="lock-panel rounded-[24px] p-6 sm:p-8">
                    <form data-form="setup" noValidate onSubmit={handleSubmit}>
                        <div className="lock-brand inline-flex items-center gap-2.5 mb-5 px-2.5 py-1 rounded-full bg-[var(--card-2)] border border-[var(--rule)] text-[13px] font-semibold text-[var(--ink)]">
                            <span className="brand-mark w-5.5 h-5.5 rounded-full grid place-items-center bg-[var(--accent-soft)] text-[var(--accent)]">
                                <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2.1} />
                            </span>
                            <span>PasswMana</span>
                        </div>
                        <h1 className="m-0 mb-2 text-[24px] font-bold tracking-tight text-[var(--ink)]">创建本地保险库</h1>
                        <p className="m-0 mb-6 text-[13.5px] leading-relaxed text-[var(--muted)]">
                            主密码只在本设备用于解密，请使用独有的长密码短语。
                        </p>
                        <div className="form-stack grid gap-4">
                            <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                                <span>主密码</span>
                                <PasswordField
                                    ref={passwordRef}
                                    name="password"
                                    autoComplete="new-password"
                                    minLength={12}
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        if (invalidField === 'password') setInvalidField(null);
                                    }}
                                    aria-describedby="password-help"
                                    aria-invalid={invalidField === 'password' ? 'true' : undefined}
                                    required
                                />
                            </label>
                            <PasswordStrengthHint password={password} id="password-help" />
                            <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                                <span>确认主密码</span>
                                <input
                                    ref={confirmRef}
                                    className="field"
                                    name="confirmPassword"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={12}
                                    value={confirmPassword}
                                    onChange={(e) => {
                                        setConfirmPassword(e.target.value);
                                        if (invalidField === 'confirmPassword') setInvalidField(null);
                                    }}
                                    aria-invalid={invalidField === 'confirmPassword' ? 'true' : undefined}
                                    required
                                />
                            </label>
                            <AmicroButton variant="primary" type="submit" loading={submitting} className="w-full min-h-11 mt-1">
                                创建保险库
                            </AmicroButton>
                        </div>
                        <FormErrorBanner id="form-error-setup" message={error} />
                        <LockTrustFooter />
                    </form>
                </AmicroSpotlightCard>
            </AmicroSurface>
        </main>
    );
}

export function RecoveryScreen({ code }: { code: string }) {
    const [suffix, setSuffix] = useState('');
    const [error, setError] = useState<string | null>(null);
    const suffixRef = useRef<HTMLInputElement>(null);

    const expectedSuffix = code.split('-').at(-1) || '';
    const isMatch = suffix.trim().toUpperCase() === expectedSuffix;

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        setError(null);
        try {
            vaultStore.submitRecoveryConfirm(suffix);
        } catch (err: any) {
            setError(err?.message || '核验失败');
            suffixRef.current?.focus();
        }
    };

    return (
        <main className="lock-screen min-h-dvh grid place-items-center p-4 sm:p-6">
            <AmicroSurface className="w-full max-w-[476px]">
                <AmicroSpotlightCard className="lock-panel rounded-[24px] p-6 sm:p-8">
                    <section>
                        <div className="lock-brand inline-flex items-center gap-2.5 mb-5 px-2.5 py-1 rounded-full bg-[var(--card-2)] border border-[var(--rule)] text-[13px] font-semibold text-[var(--ink)]">
                            <span className="brand-mark w-5.5 h-5.5 rounded-full grid place-items-center bg-[var(--accent-soft)] text-[var(--accent)]">
                                <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2.1} />
                            </span>
                            <span>PasswMana</span>
                        </div>
                        <h1 className="m-0 mb-2 text-[24px] font-bold tracking-tight text-[var(--ink)]">保存恢复密钥</h1>
                        <p className="m-0 mb-5 text-[13.5px] leading-relaxed text-[var(--muted)]">
                            忘记主密码时，它是重新访问保险库的唯一方式。请先离线保存，再核验最后 4 位。
                        </p>
                        <div className="recovery-box rounded-2xl border border-[var(--rule-strong)] bg-[var(--card-2)] p-4 mb-5">
                            <div className="recovery-surface rounded-xl bg-[var(--bg-list)] px-3.5 py-3.5 text-center border border-[var(--rule)] shadow-inner">
                                <span className="recovery-code machine text-[15.5px] sm:text-[17px] font-semibold tracking-wider text-[var(--ink)] break-all select-all">
                                    {code}
                                </span>
                            </div>
                            <div className="recovery-actions mt-3 flex justify-center">
                                <AmicroButton
                                    variant="secondary"
                                    data-action="copy-recovery"
                                    data-code={code}
                                    onClick={() => void vaultStore.copyText(code, '恢复密钥已复制；2 分钟后尝试清除', { clearAfter: 120000 })}
                                >
                                    <Copy className="w-4 h-4" strokeWidth={1.8} />
                                    <span>复制恢复密钥</span>
                                </AmicroButton>
                            </div>
                        </div>
                        <form className="form-stack grid gap-4" data-form="recovery-confirm" noValidate onSubmit={handleSubmit}>
                            <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                                <span>核验已保存的密钥最后 4 位</span>
                                <input
                                    ref={suffixRef}
                                    className="field machine uppercase"
                                    name="recoverySuffix"
                                    maxLength={4}
                                    autoComplete="off"
                                    autoCapitalize="characters"
                                    value={suffix}
                                    onChange={(e) => setSuffix(e.target.value)}
                                    required
                                />
                            </label>
                            <p className="form-help m-0 text-[var(--faint)] text-[12px] leading-relaxed">
                                请从你保存的位置读取。确认之前不会自动隐藏此页面；刷新或关闭页面将无法再次显示密钥。
                            </p>
                            <AmicroButton variant="primary" type="submit" data-action="finish-setup" disabled={!isMatch} className="w-full min-h-11">
                                已保存并核验，进入密码库
                            </AmicroButton>
                            <FormErrorBanner id="form-error-recovery-confirm" message={error} />
                        </form>
                    </section>
                </AmicroSpotlightCard>
            </AmicroSurface>
        </main>
    );
}

export function UnlockScreen({ deviceUnlock }: { deviceUnlock: boolean }) {
    const [password, setPassword] = useState('');
    const [keepDeviceUnlock, setKeepDeviceUnlock] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [invalid, setInvalid] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const passwordRef = useRef<HTMLInputElement>(null);
    const checkboxRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!document.querySelector('[data-modal-layer]')) {
            passwordRef.current?.focus();
        }
    }, []);

    const executeUnlock = async (useDevice: boolean) => {
        if (submitting) return;
        setError(null);
        setInvalid(false);

        if (!useDevice && !password) {
            setError('请填写此项');
            setInvalid(true);
            passwordRef.current?.focus();
            return;
        }

        setSubmitting(true);
        try {
            await vaultStore.submitUnlock(password, useDevice || keepDeviceUnlock);
        } catch (err: any) {
            setError(err?.message || '解锁失败');
            setInvalid(true);
            passwordRef.current?.focus();
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        void executeUnlock(false);
    };

    return (
        <main className="lock-screen min-h-dvh grid place-items-center p-4 sm:p-6">
            <AmicroSurface className="w-full max-w-[430px]">
                <AmicroSpotlightCard className="lock-panel rounded-[24px] p-6 sm:p-8">
                    <form data-form="unlock" noValidate onSubmit={handleSubmit}>
                        <div className="lock-brand inline-flex items-center gap-2.5 mb-5 px-2.5 py-1 rounded-full bg-[var(--card-2)] border border-[var(--rule)] text-[13px] font-semibold text-[var(--ink)]">
                            <span className="brand-mark w-5.5 h-5.5 rounded-full grid place-items-center bg-[var(--accent-soft)] text-[var(--accent)]">
                                <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2.1} />
                            </span>
                            <span>PasswMana</span>
                        </div>
                        <h1 className="m-0 mb-2 text-[24px] font-bold tracking-tight text-[var(--ink)]">解锁保险库</h1>
                        <p className="m-0 mb-6 text-[13.5px] leading-relaxed text-[var(--muted)]">
                            {deviceUnlock ? '已在此设备记住密钥，可直接继续或改用主密码。' : '输入主密码以在本设备解密保险库。'}
                        </p>
                        <div className="form-stack grid gap-4">
                            {deviceUnlock && (
                                <>
                                    <AmicroButton
                                        variant="primary"
                                        className="device-unlock-button w-full min-h-11"
                                        type="button"
                                        data-submit-as="device"
                                        loading={submitting}
                                        onClick={() => {
                                            if (checkboxRef.current) checkboxRef.current.checked = true;
                                            setKeepDeviceUnlock(true);
                                            void executeUnlock(true);
                                        }}
                                    >
                                        <Fingerprint className="w-4 h-4" strokeWidth={1.9} />
                                        <span>用此设备继续</span>
                                    </AmicroButton>
                                    <div className="lock-divider flex items-center gap-3 text-[12px] text-[var(--faint)] before:content-[''] before:flex-1 before:h-px before:bg-[var(--rule)] after:content-[''] after:flex-1 after:h-px after:bg-[var(--rule)]">
                                        或使用主密码
                                    </div>
                                </>
                            )}
                            <label className="form-field grid gap-1.5 text-[var(--muted)] text-[12px] font-semibold">
                                <span>主密码</span>
                                <PasswordField
                                    ref={passwordRef}
                                    name="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        if (invalid) setInvalid(false);
                                    }}
                                    aria-invalid={invalid ? 'true' : undefined}
                                    required={!deviceUnlock}
                                />
                            </label>
                            <label className="check-field inline-flex items-center gap-2.5 text-[13.5px] text-[var(--muted)] cursor-pointer select-none">
                                <input
                                    ref={checkboxRef}
                                    type="checkbox"
                                    name="keepDeviceUnlock"
                                    checked={keepDeviceUnlock}
                                    onChange={(e) => setKeepDeviceUnlock(e.target.checked)}
                                    className="w-4 h-4 accent-[var(--accent)] rounded cursor-pointer"
                                />
                                <span>在此设备免密自动解锁</span>
                            </label>
                            <AmicroButton
                                variant={deviceUnlock ? 'secondary' : 'primary'}
                                type="submit"
                                loading={submitting}
                                className="w-full min-h-11"
                            >
                                主密码解锁
                            </AmicroButton>
                            <AmicroButton
                                variant="text"
                                type="button"
                                data-action="open-recovery-reset"
                                onClick={() => vaultStore.openModal({ type: 'recovery-reset' }, { action: 'open-recovery-reset' })}
                                className="justify-center"
                            >
                                使用恢复密钥
                            </AmicroButton>
                        </div>
                        <FormErrorBanner id="form-error-unlock" message={error} />
                        <LockTrustFooter />
                    </form>
                </AmicroSpotlightCard>
            </AmicroSurface>
        </main>
    );
}
