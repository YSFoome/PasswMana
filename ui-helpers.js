export function passwordStrength(password = '') {
    if (password.length < 12) return '至少使用 12 个字符；建议采用较长的密码短语。';
    const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((pattern) => pattern.test(password)).length;
    if (/^(.)\1+$/.test(password) || /^(123456|password|qwerty)/i.test(password)) return '容易猜测，请避免重复字符和常见密码。';
    return password.length >= 20 || groups >= 3 ? '长度和字符组合较好；请使用独有的主密码。' : '可以使用；增加长度或使用多个无关词语会更好。';
}

export function generatePassword(length = 20, random = crypto.getRandomValues.bind(crypto)) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_+';
    const size = Math.max(12, Math.min(64, Number(length) || 20));
    const limit = Math.floor(256 / alphabet.length) * alphabet.length;
    let password = '';
    while (password.length < size) {
        for (const byte of random(new Uint8Array(size * 2))) {
            if (byte < limit && password.length < size) password += alphabet[byte % alphabet.length];
        }
    }
    return password;
}

export function safeWebUrl(value) {
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export function parseGithubRepository(value) {
    try {
        const url = new URL(value);
        const segments = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '').split('/').filter(Boolean);
        if (url.protocol !== 'https:' || url.hostname !== 'github.com' || segments.length !== 2 || url.username || url.password) throw new Error();
        return { owner: segments[0], repo: segments[1] };
    } catch { throw new Error('请输入完整仓库地址，例如 https://github.com/owner/private-vault'); }
}

export function createClipboardManager(clipboard, schedule = setTimeout, cancel = clearTimeout) {
    let timer;
    let generation = 0;
    return {
        async copy(value) {
            await clipboard.writeText(value);
            const current = ++generation;
            cancel(timer);
            timer = schedule(async () => {
                if (generation !== current || typeof clipboard.readText !== 'function') return;
                try {
                    const contents = await clipboard.readText();
                    if (generation === current && contents === value) await clipboard.writeText('');
                } catch { /* Do not erase unrelated clipboard data when read access is unavailable. */ }
            }, 30000);
        },
    };
}

export function formValues(form) {
    return Object.fromEntries(new FormData(form));
}

export function showFormError(form, message, fieldName) {
    let error = form.querySelector('[data-form-error]');
    if (!error) {
        error = document.createElement('p');
        error.dataset.formError = '';
        error.className = 'form-error';
        error.id = `form-error-${form.dataset.form}`;
        error.setAttribute('role', 'alert');
        (form.querySelector('.modal-body') || form).append(error);
    }
    error.textContent = message;
    const field = fieldName ? form.elements.namedItem(fieldName) : form.querySelector('input:not([type="checkbox"])');
    if (field instanceof HTMLElement) {
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', error.id);
        field.focus();
    }
}

export function enhanceDialogs(root, { drawerOpen = false, trigger = null } = {}) {
    const modal = root.querySelector('.modal-layer.open .modal');
    const drawer = root.querySelector('.drawer');
    const shell = root.querySelector('.app-shell');
    if (shell) shell.inert = Boolean(modal || drawerOpen);
    if (drawer) drawer.inert = Boolean(modal || !drawerOpen);
    const lockScreen = root.querySelector('.lock-screen');
    if (lockScreen) lockScreen.inert = Boolean(modal);
    const dialog = modal || (drawerOpen ? drawer : null);
    if (dialog) {
        if (dialog.getAttribute('role') !== 'alertdialog') dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        const heading = dialog.querySelector('h2');
        if (heading) { heading.id ||= 'active-dialog-title'; dialog.setAttribute('aria-labelledby', heading.id); }
        else dialog.setAttribute('aria-label', '导航');
        (dialog.querySelector('input:not([type="checkbox"]), select, textarea') || dialog.querySelector('button, a[href]'))?.focus();
    } else if (trigger) {
        const controls = [...root.querySelectorAll('[data-action]')];
        const target = controls.find((node) => node.dataset.action === trigger.action
            && (trigger.id === undefined || node.dataset.id === trigger.id)
            && (trigger.panel === undefined || node.dataset.panel === trigger.panel)
            && node.getClientRects().length);
        target?.focus();
    }
    return dialog;
}

export function trapDialogKey(event, dialog) {
    if (event.key !== 'Tab' || !dialog) return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')]
        .filter((node) => node.getClientRects().length);
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0];
    const last = controls.at(-1);
    if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
