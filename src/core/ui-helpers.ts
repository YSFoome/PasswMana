import type { SortMode, VaultData, VaultEntry } from './types';
import { DEFAULT_CATEGORIES, makeId } from './vault-core';

export function passwordStrength(password = ''): string {
    if (password.length < 12) return '至少使用 12 个字符；建议采用较长的密码短语。';
    const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((pattern) => pattern.test(password)).length;
    if (/^(.)\1+$/.test(password) || /^(123456|password|qwerty)/i.test(password)) return '容易猜测，请避免重复字符和常见密码。';
    return password.length >= 20 || groups >= 3 ? '长度和字符组合较好；请使用独有的主密码。' : '可以使用；增加长度或使用多个无关词语会更好。';
}

export function passwordStrengthLevel(password = ''): { score: number; label: string; tone: 'weak' | 'fair' | 'strong' } {
    if (!password) return { score: 0, label: passwordStrength(password), tone: 'weak' };
    if (password.length < 12) return { score: 1, label: passwordStrength(password), tone: 'weak' };
    if (/^(.)\1+$/.test(password) || /^(123456|password|qwerty)/i.test(password)) return { score: 1, label: passwordStrength(password), tone: 'weak' };
    const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((pattern) => pattern.test(password)).length;
    if (password.length >= 20 || groups >= 3) return { score: 3, label: passwordStrength(password), tone: 'strong' };
    return { score: 2, label: passwordStrength(password), tone: 'fair' };
}

// Default order pins favorites, matching the existing register. Explicit name
// and creation orders are pure so the chosen key is predictable across the list.
export function sortEntries<T extends Pick<VaultEntry, 'title' | 'favorite' | 'createdAt' | 'updatedAt'>>(
    entries: readonly T[],
    mode: SortMode = 'updated',
): T[] {
    const byTitle = (left: T, right: T) => String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN', { sensitivity: 'base', numeric: true });
    const byTime = (field: 'updatedAt' | 'createdAt') => (left: T, right: T) => (Date.parse(right[field]) || 0) - (Date.parse(left[field]) || 0);
    const byUpdated = byTime('updatedAt');
    const byCreated = byTime('createdAt');
    const compare = mode === 'title'
        ? (left: T, right: T) => byTitle(left, right) || byUpdated(left, right)
        : mode === 'created'
            ? (left: T, right: T) => byCreated(left, right) || byTitle(left, right)
            : (left: T, right: T) => Number(Boolean(right.favorite)) - Number(Boolean(left.favorite)) || byUpdated(left, right) || byTitle(left, right);
    return [...entries].sort(compare);
}

export function safeWebUrl(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export function parseGithubRepository(value: string): { owner: string; repo: string } {
    try {
        const url = new URL(value);
        const segments = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '').split('/').filter(Boolean);
        if (url.protocol !== 'https:' || url.hostname !== 'github.com' || segments.length !== 2 || url.username || url.password) throw new Error();
        return { owner: segments[0], repo: segments[1] };
    } catch { throw new Error('请输入完整仓库地址，例如 https://github.com/owner/private-vault'); }
}

export interface ClipboardLike {
    writeText(value: string): Promise<void>;
    readText?(): Promise<string>;
}

export function createClipboardManager(
    clipboard: ClipboardLike,
    schedule: (callback: () => void, delay: number) => any = setTimeout,
    cancel: (id: any) => void = clearTimeout,
) {
    let timer: any;
    let generation = 0;
    return {
        async copy(value: string, { clearAfter = 30000 }: { clearAfter?: number } = {}): Promise<void> {
            await clipboard.writeText(value);
            const current = ++generation;
            cancel(timer);
            timer = undefined;
            // A copy made after a password replaces the clipboard contents, so
            // the previous password timer must be cancelled even when the new
            // value is not scheduled for clearing.
            if (!(clearAfter > 0)) return;
            timer = schedule(async () => {
                if (generation !== current || typeof clipboard.readText !== 'function') return;
                try {
                    const contents = await clipboard.readText();
                    if (generation === current && contents === value) await clipboard.writeText('');
                } catch { /* Do not erase unrelated clipboard data when read access is unavailable. */ }
            }, clearAfter);
        },
    };
}

export function trapDialogKey(event: KeyboardEvent, dialog: HTMLElement | null): void {
    if (event.key !== 'Tab' || !dialog) return;
    const controls = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    )].filter((node) => node.getClientRects().length);
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function hostOf(entry: Pick<VaultEntry, 'url'>): string {
    try {
        return new URL(entry.url).hostname.replace(/^www\./, '');
    } catch { return ''; }
}

export function toneIndex(key: string): number {
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
    return hash % 8;
}

export function identityTab(entry: Pick<VaultEntry, 'url' | 'title'>): number {
    return toneIndex(hostOf(entry) || entry.title || '');
}

export function categoryTone(category: string): string {
    return String(toneIndex(category));
}

export function monogramOf(entry?: Pick<VaultEntry, 'title'> | null): string {
    const title = String(entry?.title || '').trim();
    if (!title) return '•';
    const cjk = title.match(/[\u4e00-\u9fff]/);
    if (cjk && title.indexOf(cjk[0]) === 0) return cjk[0];
    const words = title.replace(/[^A-Za-z0-9\u4e00-\u9fff]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return title.slice(0, 1).toUpperCase();
    if (/[\u4e00-\u9fff]/.test(words[0])) return words[0][0];
    if (words.length >= 2 && /^[A-Za-z0-9]/.test(words[1])) return (words[0][0] + words[1][0]).toUpperCase();
    return words[0].slice(0, 2).toUpperCase();
}

export function timeLabel(iso: string): string {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return '时间未知';
    const elapsed = Date.now() - time;
    if (elapsed < 60000) return '刚刚';
    if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前`;
    if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} 小时前`;
    if (elapsed < 172800000) return '昨天';
    return new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function formatShortDate(iso: string): string {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return '时间未知';
    const d = new Date(time);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatBytes(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value) || value < 0) return '';
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
    if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${Math.round(value)} B`;
}

export interface PasswordToken {
    char: string;
    kind: 'digit' | 'symbol' | 'letter';
}

export function tokenizePassword(password = ''): PasswordToken[] {
    return [...String(password)].map((char) => {
        if (/[0-9]/.test(char)) return { char, kind: 'digit' };
        if (!/[A-Za-z]/.test(char)) return { char, kind: 'symbol' };
        return { char, kind: 'letter' };
    });
}

function validTimestamp(value: unknown, fallback: string): string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

export interface LegacyBackupData {
    exportedAt?: string;
    customTypes?: unknown[];
    entries: Array<{
        id?: string;
        siteName?: string;
        title?: string;
        account?: string;
        username?: string;
        password?: unknown;
        type?: string;
        category?: string;
        url?: string;
        notes?: string;
        favorite?: unknown;
        createdAt?: string;
        updatedAt?: string;
    }>;
}

export function convertLegacyBackup(
    data: LegacyBackupData,
    currentVault: VaultData,
): { entries: VaultEntry[]; categories: string[]; added: number; updated: number; skipped: number } {
    if (!data || !Array.isArray(data.entries)) throw new Error('不是有效的旧版备份');
    const now = new Date().toISOString();
    const entriesById = new Map(currentVault.entries.map((entry) => [entry.id, entry]));
    // Deleted entries keep their id in the trash. Re-importing the same legacy
    // file must not recreate that id in entries: the vault format rejects an id
    // that exists in both lists, and unlocking would then fail permanently.
    const trashedIds = new Set(currentVault.trash.map((entry) => entry.id));
    const categories = new Set([...DEFAULT_CATEGORIES, ...currentVault.categories]);
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const category of data.customTypes || []) {
        if (typeof category === 'string' && category.trim()) categories.add(category.trim());
    }

    for (const legacy of data.entries) {
        const title = String(legacy.siteName || legacy.title || '').trim();
        const password = typeof legacy.password === 'string' ? legacy.password : '';
        if (!title || !password) {
            skipped += 1;
            continue;
        }
        const category = String(legacy.type || legacy.category || '个人').trim() || '个人';
        categories.add(category);
        const id = typeof legacy.id === 'string' && legacy.id ? legacy.id : makeId();
        if (!entriesById.has(id) && trashedIds.has(id)) {
            // The person deleted this entry after an earlier migration; a merge should
            // not resurrect it, and the trash copy already owns the id.
            skipped += 1;
            continue;
        }
        const createdAt = validTimestamp(legacy.createdAt, validTimestamp(data.exportedAt, now));
        const updatedAt = validTimestamp(legacy.updatedAt, createdAt);
        const converted: VaultEntry = {
            id,
            title,
            username: String(legacy.account || legacy.username || '').trim(),
            password,
            category,
            url: String(legacy.url || '').trim(),
            notes: String(legacy.notes || '').trim(),
            favorite: Boolean(legacy.favorite),
            createdAt,
            updatedAt,
        };
        const existing = entriesById.get(id);
        if (!existing) {
            entriesById.set(id, converted);
            added += 1;
        } else if (new Date(updatedAt) > new Date(existing.updatedAt)) {
            entriesById.set(id, converted);
            updated += 1;
        }
    }

    return { entries: [...entriesById.values()], categories: [...categories], added, updated, skipped };
}
