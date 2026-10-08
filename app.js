import {
    DEFAULT_CATEGORIES, makeId, bytesToBase64, base64ToBytes, randomBase64, formatRecoveryCode,
    dbGet, dbPut, deriveKey, encryptText, decryptText, importVaultKey, defaultVault,
    createVault, unlockWithMaster, unlockWithRecovery, validateVault, validateEncryptedRecord,
    prepareBackupRestore, commitBackupRestore, getRollbackRecord, restoreRollbackRecord,
    saveEncryptedDraft, loadEncryptedDraft, clearEncryptedDraft,
} from './vault-core.js';
import { mergeVaults, mergeVaultChanges, collectVaultConflicts, conflictVaultSnapshot, sameValue, keyMetadata, mergeKeyMetadata } from './sync-core.js';

const MAX_SYNC_ATTEMPTS = 3;
const SYNC_DEBOUNCE_MS = 2000;
const SYNC_POLL_MS = 60000;
const SYNC_TIMEOUT_MS = 20000;

import { passwordStrength, generatePassword, safeWebUrl, parseGithubRepository, createClipboardManager, formValues, showFormError, enhanceDialogs, trapDialogKey } from './ui-helpers.js';

const app = document.getElementById('app');
const state = {
  record: null,
  vaultKey: null,
  rawVaultKey: null,
  vault: null,
  view: 'vault',
  settingPanel: 'sync',
  settingsDetail: false,
  search: '',
  category: '',
  favoriteOnly: false,
  modal: null,
  syncing: null,
  syncAutomatic: false,
  syncAttempt: null,
  syncLastError: null,
  pendingRemote: null,
  session: 0,
  vaultRevision: 0,
  syncPromise: null,
  syncController: null,
  syncTimer: null,
  syncPollTimer: null,
  syncRetryCount: 0,
  syncRetryAt: 0,
  syncBlocked: false,
  drawerOpen: false,
  timer: null,
  lastActivityAt: Date.now(),
  localSaveError: null,
  releaseVaultLock: null,
  formDraft: null,
  savedDraft: null,
  draftTimer: null,
  lockWarningTimer: null,
  serviceWorkerRegistration: null,
  updateReady: false,
};

const clipboardManager = createClipboardManager({
    writeText: (value) => navigator.clipboard.writeText(value),
    readText: async () => {
        if (!navigator.permissions?.query) throw new Error('无法安全检查剪贴板');
        const permission = await navigator.permissions.query({ name: 'clipboard-read' });
        if (permission.state !== 'granted') throw new Error('未授予剪贴板读取权限');
        return navigator.clipboard.readText();
    },
});
const initialFormValues = new WeakMap();
let dialogTrigger = null;
let activeDialog = null;
let updateRequested = false;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function icon(name, extra = '') {
  return `<i data-lucide="${name}"${extra ? ` class="${extra}"` : ''}></i>`;
}

let storageQueue = Promise.resolve();

function queueStorage(operation) {
    const result = storageQueue.then(operation);
    storageQueue = result.catch(() => {});
    return result;
}

async function persistVault({ dirty = true } = {}) {
    const record = state.record;
    const vaultKey = state.vaultKey;
    const snapshot = JSON.stringify(state.vault);
    const updatedAt = new Date().toISOString();
    state.vaultRevision += 1;
    if (dirty) record.dirty = true;
    try {
        await queueStorage(async () => {
            record.encryptedVault = await encryptText(snapshot, vaultKey);
            record.updatedAt = updatedAt;
            await dbPut(record);
        });
        state.localSaveError = null;
    } catch (error) {
        state.localSaveError = error;
        throw error;
    }
    if (dirty) scheduleAutoSync();
}

function resetLockTimer({ activity = true } = {}) {
  if (!state.vaultKey) return;
  if (activity) state.lastActivityAt = Date.now();
  clearTimeout(state.timer);
  clearTimeout(state.lockWarningTimer);
  app.querySelector('[data-lock-warning]')?.remove();
  if (state.modal?.type === 'recovery-created') return;
  const minutes = Number(state.vault.preferences?.lockMinutes ?? 5);
  if (minutes > 0) {
    const remaining = Math.max(0, minutes * 60 * 1000 - (Date.now() - state.lastActivityAt));
    state.timer = setTimeout(lockVault, remaining);
    state.lockWarningTimer = setTimeout(() => {
      if (!state.vaultKey || app.querySelector('[data-lock-warning]')) return;
      const warning = document.createElement('div');
      warning.className = 'lock-warning';
      warning.dataset.lockWarning = '';
      warning.setAttribute('role', 'status');
      warning.innerHTML = '即将自动锁定，未完成的密码编辑会加密保存。<button class="secondary-button" data-action="extend-session">继续使用</button>';
      app.append(warning);
    }, Math.max(0, remaining - 30000));
  }
}

async function acquireVaultLock() {
    if (!navigator.locks || state.releaseVaultLock) return;
    let report;
    const acquired = new Promise((resolve) => { report = resolve; });
    navigator.locks.request('passwmana-unlocked', { ifAvailable: true }, async (lock) => {
        if (!lock) { report(false); return; }
        const released = new Promise((resolve) => { state.releaseVaultLock = resolve; });
        report(true);
        await released;
    }).catch(() => report(false));
    if (!await acquired) throw new Error('保险库已在另一个标签页解锁，请先锁定该页面');
}

function releaseVaultLock() {
    const release = state.releaseVaultLock;
    state.releaseVaultLock = null;
    // Finish captured encrypted saves before another tab reads the shared database.
    if (release) storageQueue.finally(release);
}

function lockVault() {
  clearTimeout(state.timer);
  clearTimeout(state.lockWarningTimer);
  clearTimeout(state.draftTimer);
  captureEntryDraft();
  if (state.formDraft && state.vaultKey) void persistEntryDraft().catch(() => {});
  stopSyncSession();
  releaseVaultLock();
  state.vaultKey = null;
  state.rawVaultKey = null;
  state.vault = null;
  state.modal = null;
  state.syncAutomatic = false;
  state.pendingRemote = null;
  state.drawerOpen = false;
  state.formDraft = null;
  state.savedDraft = null;
  dialogTrigger = null;
  render();
}

function currentEntries() {
  const query = state.search.trim().toLocaleLowerCase();
  return state.vault.entries
    .filter((entry) => !state.category || entry.category === state.category)
    .filter((entry) => !state.favoriteOnly || entry.favorite)
    .filter((entry) => !query || [entry.title, entry.username, entry.category, entry.url, entry.notes].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updatedAt) - new Date(a.updatedAt));
}

function timeLabel(iso) {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed < 60000) return '刚刚';
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} 小时前`;
  if (elapsed < 172800000) return '昨天';
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function maskAccount(value) {
  if (!value) return '未设置账户';
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 2)}•••${value.slice(-2)}`;
}

function validTimestamp(value, fallback) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function convertLegacyBackup(data, currentVault) {
  if (!data || !Array.isArray(data.entries)) throw new Error('不是有效的旧版备份');
  const now = new Date().toISOString();
  const entriesById = new Map(currentVault.entries.map((entry) => [entry.id, entry]));
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
    const createdAt = validTimestamp(legacy.createdAt, validTimestamp(data.exportedAt, now));
    const updatedAt = validTimestamp(legacy.updatedAt, createdAt);
    const converted = {
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

function titleInitial(entry) {
  return escapeHtml((entry.title || '?').trim().slice(0, 1).toUpperCase());
}

function renderRecovery(code) {
    return `<main class="lock-screen"><section class="lock-panel"><div class="lock-brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div><h1>保存恢复密钥</h1><p>忘记主密码时，它是重新访问保险库的唯一方式。请先离线保存，再确认。</p><div class="recovery-box"><div class="recovery-code">${escapeHtml(code)}</div><button class="secondary-button" data-action="copy-recovery" data-code="${escapeHtml(code)}">${icon('copy')}复制恢复密钥</button></div><form class="form-stack" data-form="recovery-confirm"><label class="form-field">核验已保存的密钥最后 4 位<input class="field" name="recoverySuffix" maxlength="4" autocomplete="off" autocapitalize="characters" required /></label><p class="form-help">请从你保存的位置读取。确认之前不会自动隐藏此页面；刷新或关闭页面将无法再次显示密钥。</p><button class="primary-button" type="submit" data-action="finish-setup" disabled>已保存并核验，进入密码库</button></form></section></main>`;
}

function renderSetup() {
    return `<main class="lock-screen"><form class="lock-panel" data-form="setup"><div class="lock-brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div><h1>创建本地保险库</h1><p>主密码只在本设备用于解密，请为保险库使用独有的长密码。</p><div class="form-stack"><label class="form-field">主密码<div class="password-field"><input class="field" name="password" type="password" autocomplete="new-password" minlength="12" aria-describedby="password-help" required /><button class="icon-button" type="button" data-action="toggle-password" title="显示密码" aria-label="显示密码">${icon('eye')}</button></div></label><p class="form-help" id="password-help" data-password-strength>至少 12 个字符，建议使用多个无关词组成的密码短语。</p><label class="form-field">确认主密码<input class="field" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></label><button class="primary-button" type="submit">${icon('lock-keyhole')}创建保险库</button></div></form></main>`;
}

function renderUnlock() {
  return `<main class="lock-screen"><form class="lock-panel" data-form="unlock"><div class="lock-brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div><h1>解锁保险库</h1><p>输入主密码以在本设备解密保险库。</p><div class="form-stack"><label class="form-field">主密码<div class="password-field"><input class="field" name="password" type="password" autocomplete="current-password" required autofocus /><button class="icon-button" type="button" data-action="toggle-password" title="显示密码" aria-label="显示密码">${icon('eye')}</button></div></label><button class="primary-button" type="submit">${icon('unlock')}解锁</button><button class="secondary-button" type="button" data-action="open-recovery-reset">使用恢复密钥</button></div></form></main>`;
}

function entryTemplate(entry) {
  return `<button class="entry" data-action="open-detail" data-id="${escapeHtml(entry.id)}"><span class="entry-site"><span class="site-icon">${titleInitial(entry)}</span><span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(maskAccount(entry.username))}</small></span></span><span class="pill">${escapeHtml(entry.category)}</span><span class="pill">${entry.url ? '网站' : '账户'}</span><time>${timeLabel(entry.updatedAt)}</time>${entry.favorite ? icon('star', 'starred') : icon('chevron-right', 'chevron')}</button>`;
}

function vaultListTemplate() {
    const entries = currentEntries();
    if (!state.vault.entries.length) return `<div class="empty-state">${icon('vault')}<h2>还没有密码条目</h2><p>添加第一条密码，或导入已有保险库。</p><div class="empty-actions"><button class="primary-button" data-action="open-add">${icon('plus')}添加第一条密码</button><button class="secondary-button" data-action="import-backup">${icon('upload')}从备份导入</button></div></div>`;
    if (!entries.length) return `<div class="empty-state">${icon('search')}<h2>没有匹配的密码条目</h2><p>尝试其他关键词，或清除分类与收藏筛选。</p><button class="secondary-button" data-action="clear-filters">清除筛选</button></div>`;
    const favorites = entries.filter((entry) => entry.favorite);
    const rest = entries.filter((entry) => !entry.favorite);
    return `${favorites.length ? `<div class="group-heading">收藏 <span>${favorites.length}</span></div>${favorites.map(entryTemplate).join('')}` : ''}${rest.length ? `<div class="group-heading">${favorites.length ? '全部条目' : '密码条目'} <span>${rest.length}</span></div>${rest.map(entryTemplate).join('')}` : ''}`;
}

function updateVaultList() {
  const list = app.querySelector('[data-vault-list]');
  if (!list) return;
  list.innerHTML = vaultListTemplate();
  drawIcons();
}

function syncStatus() {
    if (state.localSaveError) return { label: '本地保存失败', detail: '无法保存到本机，请保留页面并检查浏览器存储空间', status: 'error', icon: 'circle-alert' };
    if (!syncConfigured()) return { label: '仅本地保存', detail: '配置私有仓库后即可启用后台同步', status: 'local', icon: 'hard-drive' };
    if (state.syncing) return { label: '正在同步', detail: '正在后台同步加密保险库，可以继续使用', status: 'syncing', icon: 'refresh-cw' };
    if (!state.record.remoteSha) return { label: '等待首次连接', detail: '请选择从远端导入或初始化远端，完成后自动同步', status: 'pending', icon: 'cloud-off' };
    if (navigator.onLine === false) return { label: '离线保存', detail: '改动已在本地加密保存，联网并解锁后自动同步', status: 'pending', icon: 'cloud-off' };
    if (state.syncLastError) return { label: state.syncBlocked ? '需要处理同步' : '等待重试', detail: state.syncLastError.message, status: 'error', icon: 'circle-alert' };
    if (state.record.dirty) return { label: '等待同步', detail: state.vault.sync.automatic === false ? '改动已在本地保存，请手动同步' : '改动已在本地保存，即将自动同步', status: 'pending', icon: 'cloud-upload' };
    return { label: '已同步', detail: state.record.lastSyncedAt ? `最近同步：${new Date(state.record.lastSyncedAt).toLocaleString('zh-CN')}` : '本地保险库已与私有仓库同步', status: 'synced', icon: 'cloud-check' };
}

function refreshSyncStatus() {
    if (!state.vaultKey) return;
    const status = syncStatus();
    app.querySelectorAll('[data-sync-label]').forEach((node) => { node.textContent = status.label; });
    app.querySelectorAll('[data-sync-detail]').forEach((node) => { node.textContent = status.detail; });
    app.querySelectorAll('[data-sync-status]').forEach((node) => { node.dataset.syncStatus = status.status; node.title = status.detail; });
    app.querySelectorAll('[data-sync-icon]').forEach((node) => { node.innerHTML = icon(status.icon, state.syncing ? 'is-spinning' : ''); });
    app.querySelectorAll('[data-action="pull-remote"], [data-action="push-remote"]').forEach((node) => { node.disabled = Boolean(state.syncing); });
    drawIcons();
}

function refreshVaultViews() {
    updateVaultList();
    if (state.modal?.type === 'detail') {
        const entry = state.vault.entries.find((item) => item.id === state.modal.id);
        if (entry) {
            const secret = app.querySelector('[data-secret-value]');
            if (secret) secret.textContent = state.modal.revealed ? entry.password : '••••••••••••••••';
            const title = app.querySelector('.modal-head h2');
            if (title) title.textContent = entry.title;
        } else { state.modal = null; render(); toast('此条目已在其他设备删除'); }
    }
    const filter = app.querySelector('[data-input="category"]');
    if (filter && filter !== document.activeElement) {
        filter.innerHTML = `<option value="">全部分类</option>${state.vault.categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('')}`;
        filter.value = state.category;
    }
    // Background updates must leave open forms, their values and focus intact.
    for (const [panel, template] of Object.entries({ sync: renderSyncSettings, security: renderSecuritySettings, categories: renderCategoriesSettings, trash: renderTrashSettings })) {
        const node = app.querySelector(`.settings-panel[data-panel="${panel}"]`);
        if (node && !node.contains(document.activeElement)) node.outerHTML = template();
    }
    refreshSyncStatus();
}

function renderVault() {
  const status = syncStatus();
  return `<section class="view ${state.view === 'vault' ? 'active' : ''}" data-view="vault"><div class="notice" data-sync-status="${status.status}"><div class="notice-copy"><span data-sync-icon>${icon(status.icon)}</span><span data-sync-detail>${escapeHtml(status.detail)}</span></div><button class="secondary-button" data-action="open-sync">${icon('refresh-cw')}同步详情</button></div><div class="toolbar"><div class="search">${icon('search')}<input class="field" type="search" data-input="search" placeholder="搜索站点、账户或分类" value="${escapeHtml(state.search)}" aria-label="搜索密码库" /></div><select class="field filter" data-input="category" aria-label="按分类筛选"><option value="">全部分类</option>${state.vault.categories.map((category) => `<option value="${escapeHtml(category)}" ${state.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select><button class="secondary-button filter-favorite ${state.favoriteOnly ? 'active' : ''}" data-action="toggle-favorite-filter" aria-pressed="${state.favoriteOnly}" title="仅看收藏" aria-label="仅看收藏">${icon('star')}</button><button class="secondary-button mobile-filter" data-action="open-category-filter" title="分类筛选" aria-label="分类筛选">${icon('tags')}</button><button class="primary-button" data-action="open-add">${icon('plus')}<span>新增密码</span></button></div><div class="vault-list" data-vault-list>${vaultListTemplate()}</div></section>`;
}

const settingLabels = { sync: '同步与备份', security: '安全', appearance: '外观', categories: '分类', trash: '回收站' };

function settingsNavigation() {
  return `<nav class="settings-nav" aria-label="设置分类">${Object.entries(settingLabels).map(([key, label]) => `<button class="${state.settingPanel === key ? 'active' : ''}" data-action="setting-panel" data-panel="${key}">${icon({ sync: 'refresh-cw', security: 'shield-check', appearance: 'paintbrush', categories: 'tags', trash: 'trash-2' }[key])}${label}</button>`).join('')}</nav>`;
}

function renderSyncSettings() {
  const sync = state.vault.sync;
  const repo = sync.owner && sync.repo ? `${sync.owner} / ${sync.repo}` : '尚未配置私有仓库';
  return `<section class="settings-panel ${state.settingPanel === 'sync' ? 'active' : ''}" data-panel="sync"><h2>同步与备份</h2><p class="panel-intro">首次连接后，解锁、保存改动和恢复联网时自动同步。页面打开且已解锁时，每分钟检查远端更新。</p><div class="setting-list"><div class="setting-row"><div class="setting-copy"><strong>私有仓库</strong><span>${escapeHtml(repo)}</span></div><button class="secondary-button" data-action="open-sync-config">配置</button></div><div class="setting-row"><div class="setting-copy"><strong>后台自动同步</strong><span>保存后约 2 秒同步；锁定或关闭页面时暂停</span></div><button class="secondary-button" data-action="toggle-auto-sync" aria-pressed="${sync.automatic !== false}">${sync.automatic === false ? '已关闭' : '已开启'}</button></div><div class="setting-row"><div class="setting-copy"><strong>同步状态</strong><span data-sync-detail>${escapeHtml(syncStatus().detail)}</span></div><button class="secondary-button" data-action="open-sync">详情</button></div><div class="setting-row"><div class="setting-copy"><strong>加密备份</strong><span>导出当前保险库为 .passwmana 文件</span></div><button class="secondary-button" data-action="export-backup">${icon('download')}导出</button></div><div class="setting-row"><div class="setting-copy"><strong>恢复加密备份</strong><span>使用 .passwmana 文件替换本机保险库</span></div><button class="secondary-button" data-action="import-backup">${icon('upload')}恢复</button></div><div class="setting-row"><div class="setting-copy"><strong>恢复替换前的保险库</strong><span>备份恢复后，可使用旧库主密码回滚</span></div><button class="secondary-button" data-action="restore-previous">回滚</button></div><div class="setting-row"><div class="setting-copy"><strong>应用更新</strong><span>更新前会保存加密草稿并锁定</span></div><button class="secondary-button" data-action="check-update">检查更新</button></div><div class="setting-row"><div class="setting-copy"><strong>迁移旧版备份</strong><span>从旧版明文 JSON 合并条目与分类</span></div><button class="secondary-button" data-action="import-legacy">${icon('file-input')}迁移</button></div></div></section>`;
}

function renderSecuritySettings() {
  return `<section class="settings-panel ${state.settingPanel === 'security' ? 'active' : ''}" data-panel="security"><h2>安全</h2><p class="panel-intro">主密码不会离开本设备。解锁后密钥只保留在当前会话内存中。</p><div class="setting-list"><div class="setting-row"><div class="setting-copy"><strong>自动锁定</strong><span>无操作后自动清除解锁密钥</span></div><select class="field inline-select" data-input="lock-minutes"><option value="0" ${state.vault.preferences.lockMinutes === 0 ? 'selected' : ''}>关闭</option><option value="1" ${state.vault.preferences.lockMinutes === 1 ? 'selected' : ''}>1 分钟</option><option value="5" ${state.vault.preferences.lockMinutes === 5 ? 'selected' : ''}>5 分钟</option><option value="15" ${state.vault.preferences.lockMinutes === 15 ? 'selected' : ''}>15 分钟</option><option value="30" ${state.vault.preferences.lockMinutes === 30 ? 'selected' : ''}>30 分钟</option></select></div><div class="setting-row"><div class="setting-copy"><strong>主密码</strong><span>只更新保险库密钥的主密码包装</span></div><button class="secondary-button" data-action="open-change-password">修改</button></div><div class="setting-row"><div class="setting-copy"><strong>恢复密钥</strong><span>创建时生成，请保存在离线可信位置</span></div><span class="setting-copy"><span>不可再次显示</span></span></div></div></section>`;
}

function renderAppearanceSettings() {
  const accentNames = { emerald: '翡翠绿', blue: '蓝', cyan: '青', rose: '玫红', amber: '琥珀', graphite: '石墨灰' };
  const mode = document.documentElement.dataset.mode || 'system';
  const accent = document.documentElement.dataset.accent || 'emerald';
  return `<section class="settings-panel ${state.settingPanel === 'appearance' ? 'active' : ''}" data-panel="appearance"><h2>外观</h2><p class="panel-intro">选择显示模式和主题色。偏好仅保存于当前设备。</p><div class="appearance-preview"><div class="mini-app"><div class="mini-side"><span class="mini-mark"></span><span class="mini-line"></span><span class="mini-line"></span></div><div class="mini-content"><strong>密码库</strong><span class="mini-cta">新增密码</span></div></div><div class="preview-text">主题色会用于导航、主要操作、焦点和状态提示。</div></div><div class="setting-list"><div class="setting-row"><div class="setting-copy"><strong>显示模式</strong><span>按系统偏好或固定浅色/深色</span></div><div class="segmented" role="group" aria-label="显示模式">${[['system','跟随系统'],['light','浅色'],['dark','深色']].map(([value,label]) => `<button class="${mode === value ? 'active' : ''}" data-action="set-mode" data-mode="${value}">${label}</button>`).join('')}</div></div><div class="setting-row"><div class="setting-copy"><strong>主题色</strong><span>${accentNames[accent]}</span></div><div class="swatches" role="group" aria-label="主题色">${Object.entries(accentNames).map(([value,label]) => `<button class="swatch ${accent === value ? 'active' : ''}" data-accent="${value}" data-action="set-accent" title="${label}" aria-label="${label}">${accent === value ? icon('check') : ''}</button>`).join('')}</div></div></div></section>`;
}

function renderCategoriesSettings() {
  return `<section class="settings-panel ${state.settingPanel === 'categories' ? 'active' : ''}" data-panel="categories"><h2>分类</h2><p class="panel-intro">分类用于整理和筛选密码条目，可以按自己的习惯维护。</p><div class="category-list">${state.vault.categories.map((category) => `<div class="category-row"><span><i class="category-dot"></i>${escapeHtml(category)}</span><button class="icon-button" data-action="delete-category" data-category="${escapeHtml(category)}" title="删除分类" aria-label="删除 ${escapeHtml(category)}">${icon('trash-2')}</button></div>`).join('')}</div><button class="secondary-button" data-action="add-category">${icon('plus')}新增分类</button></section>`;
}

function renderTrashSettings() {
  const entries = state.vault.trash.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  return `<section class="settings-panel ${state.settingPanel === 'trash' ? 'active' : ''}" data-panel="trash"><h2>回收站</h2><p class="panel-intro">删除的条目保留 30 天，之后会自动永久清除。</p><div class="setting-list">${entries.length ? entries.map((entry) => `<div class="setting-row"><div class="setting-copy"><strong>${escapeHtml(entry.title)}</strong><span>删除于 ${timeLabel(entry.deletedAt)}</span></div><div><button class="secondary-button" data-action="restore-entry" data-id="${escapeHtml(entry.id)}">恢复</button><button class="icon-button" data-action="purge-entry" data-id="${escapeHtml(entry.id)}" title="永久删除" aria-label="永久删除 ${escapeHtml(entry.title)}">${icon('trash-2')}</button></div></div>`).join('') : `<div class="empty-state">${icon('trash-2')}<div>回收站为空</div></div>`}</div></section>`;
}

function renderSettings() {
  return `<section class="view ${state.view === 'settings' ? 'active' : ''} ${state.settingsDetail ? 'settings-detail' : ''}" data-view="settings"><div class="settings-layout">${settingsNavigation()}<div>${renderSyncSettings()}${renderSecuritySettings()}${renderAppearanceSettings()}${renderCategoriesSettings()}${renderTrashSettings()}</div></div></section>`;
}

function modalTemplate() {
    const modal = state.modal;
    if (!modal) return '';
    const close = `<button class="icon-button" type="button" data-action="close-modal" title="关闭" aria-label="关闭">${icon('x')}</button>`;
    const shell = (title, body, foot = '', form = '') => `<div class="modal-layer open ${form ? 'form-open' : ''}" data-modal-layer><${form ? 'form' : 'section'} class="modal" ${form ? `data-form="${form}"` : ''}><header class="modal-head"><h2>${escapeHtml(title)}</h2>${close}</header><div class="modal-body">${body}</div>${foot ? `<footer class="modal-foot">${foot}</footer>` : ''}</${form ? 'form' : 'section'}></div>`;
    const cancel = `<button class="secondary-button" type="button" data-action="close-modal">取消</button>`;
    if (modal.type === 'category-filter') {
        const options = [['', '全部分类'], ...state.vault.categories.map((category) => [category, category])];
        return shell('筛选密码', `<button class="secondary-button" data-action="toggle-favorite-filter" aria-pressed="${state.favoriteOnly}">${icon('star')}${state.favoriteOnly ? '显示全部条目' : '仅看收藏'}</button><div class="category-list">${options.map(([value, label]) => `<button class="category-row" data-action="select-category" data-category="${escapeHtml(value)}"><span><i class="category-dot"></i>${escapeHtml(label)}</span>${state.category === value ? icon('check') : ''}</button>`).join('')}</div>`);
    }
    if (modal.type === 'add' || modal.type === 'edit') {
        const entry = { title: '', username: '', password: '', category: state.vault.categories[0] || '', url: '', notes: '', favorite: false, ...(modal.entry || {}), ...(modal.draft?.values || {}) };
        const categories = [...new Set([...state.vault.categories, entry.category].filter(Boolean))];
        return shell(modal.type === 'edit' ? '编辑密码' : '新增密码', `<div class="form-grid"><label class="form-field">站点 / 应用<input class="field" name="title" value="${escapeHtml(entry.title)}" required /></label><label class="form-field">分类<select class="field" name="category">${categories.map((category) => `<option ${entry.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></label><label class="form-field">账户名<input class="field" name="username" value="${escapeHtml(entry.username)}" required /></label><label class="form-field">密码<div class="password-field"><input class="field" name="password" type="password" value="${escapeHtml(entry.password)}" autocomplete="off" required /><button class="icon-button" type="button" data-action="toggle-password" title="显示密码" aria-label="显示密码">${icon('eye')}</button></div></label><div class="generator full"><label class="form-field">生成长度<select class="field" data-generator-length>${[16,20,24,32,48,64].map((length) => `<option value="${length}" ${length === 20 ? 'selected' : ''}>${length} 个字符</option>`).join('')}</select></label><button class="secondary-button" type="button" data-action="generate-password">${icon('wand-sparkles')}生成随机密码</button><button class="secondary-button" type="button" data-action="copy-generated">${icon('copy')}复制</button></div><label class="form-field full">网址<input class="field" name="url" type="url" value="${escapeHtml(entry.url || '')}" placeholder="https://example.com" /></label><label class="form-field full">备注<textarea class="field" name="notes" placeholder="可选备注">${escapeHtml(entry.notes || '')}</textarea></label><label class="form-field full"><span><input name="favorite" type="checkbox" ${entry.favorite ? 'checked' : ''} /> 收藏此条目</span></label></div>`, `${cancel}<button class="primary-button" type="submit">${icon('save')}保存</button>`, modal.type === 'edit' ? 'edit-entry' : 'add-entry');
    }
    if (modal.type === 'detail') {
        const entry = state.vault.entries.find((item) => item.id === modal.id);
        if (!entry) return '';
        const id = escapeHtml(entry.id);
        const url = safeWebUrl(entry.url);
        return shell(entry.title, `<dl><div class="detail-row"><dt>账户</dt><dd>${escapeHtml(entry.username)} <button class="icon-button" data-action="copy-account" data-id="${id}" aria-label="复制账户">${icon('copy')}</button></dd></div><div class="detail-row"><dt>网址</dt><dd>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开网站 ${icon('external-link')}</a>` : escapeHtml(entry.url || '未设置')}</dd></div><div class="detail-row"><dt>分类</dt><dd>${escapeHtml(entry.category)}</dd></div><div class="detail-row"><dt>更新时间</dt><dd>${new Date(entry.updatedAt).toLocaleString('zh-CN')}</dd></div>${entry.notes ? `<div class="detail-row"><dt>备注</dt><dd>${escapeHtml(entry.notes)}</dd></div>` : ''}</dl><div class="secret"><span class="secret-value" data-secret-value>${modal.revealed ? escapeHtml(entry.password) : '••••••••••••••••'}</span><button class="icon-button" data-action="reveal-password" aria-label="${modal.revealed ? '隐藏密码' : '显示密码'}" aria-pressed="${Boolean(modal.revealed)}">${icon(modal.revealed ? 'eye-off' : 'eye')}</button></div>`, `<button class="secondary-button" data-action="delete-entry" data-id="${id}">${icon('trash-2')}删除</button><button class="secondary-button" data-action="open-edit" data-id="${id}">${icon('pencil')}编辑</button><button class="primary-button" data-action="copy-password" data-id="${id}">${icon('copy')}复制密码</button>`);
    }
    if (modal.type === 'sync') {
        const first = !state.record.remoteSha;
        const disabled = state.syncing ? 'disabled' : '';
        const status = syncStatus();
        return shell(first ? '完成首次连接' : '同步详情', `<div class="sync-state" data-sync-status="${status.status}"><span data-sync-icon>${icon(status.icon)}</span><span data-sync-label>${escapeHtml(status.label)}</span></div><p data-sync-detail>${escapeHtml(status.detail)}</p>${syncConfigured() ? `<p>${first ? '已有远端保险库请选择导入；远端没有文件请选择初始化。' : '不同字段自动合并；冲突可逐项选择。采用远端版本会替换本地条目。'}</p><div class="sync-actions"><button class="secondary-button" data-action="pull-remote" ${disabled}>${icon('download')}${first ? '从远端导入' : '采用远端版本'}</button><button class="primary-button" data-action="push-remote" ${disabled}>${icon('refresh-cw')}${first ? '初始化远端' : '立即同步'}</button></div>${state.syncConflict ? '<button class="primary-button sync-backup" data-action="open-conflicts">查看并处理冲突</button>' : ''}<button class="secondary-button sync-backup" data-action="export-backup">${icon('download')}先导出加密备份</button>` : '<button class="primary-button" data-action="open-sync-config">配置私有仓库</button>'}`);
    }
    if (modal.type === 'sync-result') return shell(modal.title, `<div class="sync-result" role="alert">${icon('circle-alert')}<span>${escapeHtml(modal.message)}</span></div>${state.syncConflict ? '<button class="primary-button sync-backup" data-action="open-conflicts">查看冲突差异</button>' : ''}`, '<button class="primary-button" data-action="close-modal">知道了</button>');
    if (modal.type === 'conflicts') {
        const conflicts = state.syncConflict?.conflicts || [];
        const preview = (conflict, value) => {
            if (conflict.kind === 'master-password') return String(value ?? '没有记录');
            if (conflict.field === 'password') return value === undefined ? '已删除' : '••••••••（密码不同）';
            if (value === undefined) return '已删除 / 未设置';
            if (typeof value === 'object') return value.entry ? `${value.location === 'trash' ? '回收站' : '密码库'}：${value.entry.title}\n账户：${value.entry.username || '未设置'}\n分类：${value.entry.category || '未设置'}\n备注：${value.entry.notes || '无'}\n密码已隐藏` : '条目变更';
            return String(value);
        };
        return shell('选择冲突版本', `<p>先保存一份本地备份，再逐项选择。密码默认隐藏；新远端修改会重新检查。</p><button class="secondary-button" type="button" data-action="export-backup">${icon('download')}导出本地加密备份</button><div class="conflict-list">${conflicts.map((conflict, index) => `<fieldset class="conflict-item"><legend>${escapeHtml(conflict.title || '条目')} · ${escapeHtml(({password:'密码',username:'账户',title:'名称',notes:'备注',url:'网址',category:'分类',favorite:'收藏',lockMinutes:'自动锁定',record:'条目状态'})[conflict.field] || conflict.field || '版本')}</legend><label><input type="radio" name="choice-${index}" value="local" required /> 本地：${escapeHtml(preview(conflict, conflict.local))}</label><label><input type="radio" name="choice-${index}" value="remote" required /> 远端：${escapeHtml(preview(conflict, conflict.remote))}</label>${(conflict.field === 'password' || conflict.field === 'record') ? `<button class="secondary-button" type="button" data-action="reveal-conflict" data-index="${index}">查看密码差异</button><div data-conflict-secret="${index}" hidden></div>` : ''}</fieldset>`).join('')}</div>`, `${cancel}<button class="primary-button" type="submit">应用选择并同步</button>`, 'resolve-conflicts');
    }
    if (modal.type === 'remote-unlock') return shell('首次导入保险库', '<p>输入远端主密码以验证并导入。导入成功后保持解锁。</p><label class="form-field">远端主密码<input class="field" name="password" type="password" autocomplete="current-password" required /></label>', `${cancel}<button class="primary-button" type="submit">验证并导入</button>`, 'remote-unlock');
    if (modal.type === 'backup-unlock') return shell(modal.rollback ? '恢复替换前的保险库' : '验证加密备份', '<p>先验证密码和全部数据，验证失败不会覆盖当前保险库。恢复成功后会保留替换前的加密副本。</p><label class="form-field">备份主密码<input class="field" name="password" type="password" autocomplete="off" required /></label>', `${cancel}<button class="primary-button" type="submit">验证并恢复</button>`, 'backup-unlock');
    if (modal.type === 'sync-config') {
        const sync = { ...state.vault.sync, ...(modal.configDraft || {}) };
        const step = modal.step || 1;
        return shell('连接 GitHub 私有仓库', `<ol class="wizard-steps"><li ${step === 1 ? 'aria-current="step"' : ''}>仓库</li><li ${step === 2 ? 'aria-current="step"' : ''}>访问令牌</li><li>首次连接</li></ol><div ${step !== 1 ? 'hidden' : ''}><label class="form-field">仓库地址<input class="field" name="repositoryUrl" type="url" value="${escapeHtml(sync.owner && sync.repo ? `https://github.com/${sync.owner}/${sync.repo}` : '')}" placeholder="https://github.com/owner/private-vault" /></label><p class="form-help">使用你创建的私有仓库，密码库只上传密文。</p><details><summary>高级设置</summary><div class="form-stack"><label class="form-field">所有者<input class="field" name="owner" value="${escapeHtml(sync.owner)}" /></label><label class="form-field">仓库名<input class="field" name="repo" value="${escapeHtml(sync.repo)}" /></label><label class="form-field">分支<input class="field" name="branch" value="${escapeHtml(sync.branch || 'main')}" /></label><label class="form-field">密文文件路径<input class="field" name="path" value="${escapeHtml(sync.path || 'passwmana.vault')}" /></label></div></details></div><div ${step !== 2 ? 'hidden' : ''}><p><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">创建 Fine-grained PAT</a>：仅选此私有仓库，授予 Contents 读写权限，并设置有效期。</p><label class="form-field">Fine-grained PAT<div class="password-field"><input class="field" name="token" type="password" value="${escapeHtml(sync.token)}" autocomplete="off" /><button class="icon-button" type="button" data-action="toggle-password" aria-label="显示令牌">${icon('eye')}</button></div></label><button class="secondary-button sync-backup" type="button" data-action="test-sync-connection">${icon('plug')}测试连接</button><p role="status" data-connection-result>${escapeHtml(modal.connectionResult || '验证仓库、分支和当前令牌的读写权限。')}</p></div>`, `${cancel}${step === 1 ? '<button class="primary-button" type="button" data-action="wizard-next">下一步</button>' : '<button class="secondary-button" type="button" data-action="wizard-back">上一步</button><button class="primary-button" type="submit">保存并完成连接</button>'}`, 'sync-config');
    }
    if (modal.type === 'change-password') return shell('修改主密码', '<p>新主密码会同步到其他设备；并发修改时会要求选择版本。</p><div class="form-stack"><label class="form-field">当前主密码<input class="field" name="currentPassword" type="password" autocomplete="current-password" required /></label><label class="form-field">新主密码<input class="field" name="newPassword" type="password" autocomplete="new-password" minlength="12" required aria-describedby="new-password-help" /></label><p class="form-help" id="new-password-help" data-password-strength>建议使用独有的长密码短语。</p><label class="form-field">确认新主密码<input class="field" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></label></div>', `${cancel}<button class="primary-button" type="submit">保存新密码</button>`, 'change-password');
    if (modal.type === 'recovery-reset') return shell('使用恢复密钥', '<p>恢复密钥在本机验证；重设的主密码会随保险库同步到其他设备。请先锁定其他打开的标签页。</p><div class="form-stack"><label class="form-field">恢复密钥<input class="field" name="recoveryCode" autocomplete="off" required /></label><label class="form-field">新主密码<input class="field" name="newPassword" type="password" minlength="12" autocomplete="new-password" required /></label><label class="form-field">确认新主密码<input class="field" name="confirmPassword" type="password" minlength="12" autocomplete="new-password" required /></label></div>', `${cancel}<button class="primary-button" type="submit">验证并重设主密码</button>`, 'recovery-reset');
    return '';
}

function renderApp() {
  const title = state.view === 'vault' ? '密码库' : state.settingsDetail ? settingLabels[state.settingPanel] : '设置';
  const nav = `<nav class="main-nav"><button class="nav-link ${state.view === 'vault' ? 'active' : ''}" data-action="view" data-view-name="vault">${icon('vault')}密码库</button><button class="nav-link ${state.view === 'settings' ? 'active' : ''}" data-action="view" data-view-name="settings">${icon('settings-2')}设置</button></nav>`;
  app.innerHTML = `<div class="app-shell"><aside class="side-nav"><div class="brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div>${nav}<div class="nav-footer"><span class="avatar">PM</span><div><strong>本地保险库</strong><span>已解锁</span></div></div></aside><main class="content"><header class="mobile-header"><button class="icon-button" id="mobile-left" data-action="mobile-left" title="${state.settingsDetail ? '返回设置' : '打开导航'}" aria-label="${state.settingsDetail ? '返回设置' : '打开导航'}">${icon(state.settingsDetail ? 'arrow-left' : 'menu')}</button><div class="mobile-title">${title}</div><div class="mobile-header-actions"><button class="icon-button" data-action="lock" title="立即锁定" aria-label="立即锁定">${icon('lock-keyhole')}</button><button class="icon-button" data-action="open-sync" title="打开同步" aria-label="打开同步">${icon('refresh-cw')}</button></div></header><header class="topbar"><h1>${title}</h1><div class="topbar-actions"><button class="icon-button" data-action="lock" title="立即锁定" aria-label="立即锁定">${icon('lock-keyhole')}</button><button class="sync-button" data-action="open-sync" data-sync-status="${syncStatus().status}"><span class="sync-dot"></span><span data-sync-label>${escapeHtml(syncStatus().label)}</span>${icon('refresh-cw')}</button></div></header><div class="page">${state.savedDraft ? '<div class="notice draft-notice"><span>有一份未完成的密码编辑</span><div class="empty-actions"><button class="secondary-button" data-action="resume-draft">继续编辑</button><button class="secondary-button" data-action="discard-draft">放弃草稿</button></div></div>' : ''}${state.updateReady ? '<div class="notice"><span>新版本已准备好</span><button class="secondary-button" data-action="apply-update">保存草稿并更新</button></div>' : ''}${renderVault()}${renderSettings()}</div><button class="mobile-fab" data-action="open-add" title="新增密码" aria-label="新增密码">${icon('plus')}</button></main></div><div class="scrim ${state.drawerOpen ? 'open' : ''}" data-action="close-drawer"></div><aside class="drawer ${state.drawerOpen ? 'open' : ''}"><div class="brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div>${nav}<div class="nav-footer"><span class="avatar">PM</span><div><strong>本地保险库</strong><span>已解锁</span></div></div></aside>${modalTemplate()}<div class="toast-wrap" id="toast-wrap" role="status" aria-live="polite" aria-atomic="true"></div>`;
  queueMicrotask(drawIcons);
}

function drawIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
}

function render() {
    const hadDialog = Boolean(activeDialog);
    if (state.modal?.type === 'recovery-created') app.innerHTML = renderRecovery(state.modal.code);
    else if (!state.record) app.innerHTML = renderSetup();
    else if (!state.vaultKey) app.innerHTML = renderUnlock() + modalTemplate();
    else renderApp();
    activeDialog = enhanceDialogs(app, { drawerOpen: state.drawerOpen, trigger: hadDialog && !state.modal ? dialogTrigger : null });
    for (const form of app.querySelectorAll('form[data-form]')) initialFormValues.set(form, JSON.stringify(formValues(form)));
    if (!activeDialog && hadDialog) dialogTrigger = null;
    queueMicrotask(drawIcons);
}

function toast(message) {
  let container = document.getElementById('toast-wrap');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-wrap';
    container.id = 'toast-wrap';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    app.append(container);
  }
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  container.append(node);
  setTimeout(() => node.remove(), 2600);
}

async function copyText(value, message = '已复制；30 秒后尝试清除，后续复制的内容会保留') {
    if (!navigator.clipboard?.writeText) throw new Error('此浏览器无法访问剪贴板，请手动选择并复制');
    await clipboardManager.copy(value);
    toast(message);
}

async function downloadBackup() {
    await storageQueue;
    const record = state.record;
    const key = state.vaultKey;
    const session = state.session;
    if (!key) throw new Error('请先解锁再导出备份');
    const encryptedVault = await encryptText(JSON.stringify(state.vault), key);
    assertSyncSession(session);
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), record: remoteRecord({ ...record, encryptedVault }) }, null, 2);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    link.download = `passwmana-${new Date().toISOString().slice(0, 10)}.passwmana`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    toast('已导出包含当前改动的加密备份');
}

async function importBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.passwmana,.json,application/json';
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            if (file.size > 20 * 1024 * 1024) throw new Error('备份文件过大，请选择小于 20 MB 的文件');
            const data = JSON.parse(await file.text());
            validateEncryptedRecord(data.record || data);
            state.modal = { type: 'backup-unlock', data };
            render();
        } catch (error) { toast(`恢复失败，原保险库已保留：${error.message}`); }
    };
    input.click();
}

async function importLegacyBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format === 'passwmana-v1' || data.record?.format === 'passwmana-v1') {
        throw new Error('这是新版加密备份，请使用“恢复加密备份”');
      }
      if (!Array.isArray(data.entries)) throw new Error('不是有效的旧版备份');
      const confirmed = confirm('旧版 JSON 包含明文密码。文件会在当前浏览器内读取并立即加密；启用同步后只上传密文。确认迁移并合并到当前保险库？');
      if (!confirmed) return;
      const converted = convertLegacyBackup(data, state.vault);
      state.vault.entries = converted.entries;
      state.vault.categories = converted.categories;
      await persistVault();
      render();
      alert(`迁移完成：新增 ${converted.added} 项，更新 ${converted.updated} 项，跳过 ${converted.skipped} 项。\n\n旧版 JSON 仍含明文密码，请在确认数据无误后安全删除该文件。`);
    } catch (error) {
      toast(`迁移失败: ${error.message}`);
    }
  };
  input.click();
}

function githubHeaders(token) {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
}

function syncError(message, code) {
    const error = new Error(message);
    error.code = code;
    error.retryable = false;
    return error;
}

function syncConfigured(sync = state.vault?.sync) {
    return Boolean(sync?.owner && sync.repo && sync.branch && sync.path && sync.token);
}

function stopSyncSession() {
    state.session += 1;
    state.syncController?.abort();
    clearTimeout(state.syncTimer);
    clearInterval(state.syncPollTimer);
    state.syncController = null;
    state.syncPromise = null;
    state.syncing = null;
    state.syncAttempt = null;
    state.syncBlocked = false;
    state.syncRetryCount = 0;
    state.syncRetryAt = 0;
    state.verifiedSyncTarget = null;
    state.pendingRemote = null;
    state.syncConflict = null;
}

function startSyncSession() {
    stopSyncSession();
    state.syncLastError = null;
    if (!state.vaultKey) return;
    state.syncPollTimer = setInterval(() => scheduleAutoSync(0), SYNC_POLL_MS);
    scheduleAutoSync(0);
}

function scheduleAutoSync(delay = SYNC_DEBOUNCE_MS) {
    if (!state.vaultKey || !syncConfigured() || state.vault.sync.automatic === false
        || !state.record.remoteSha || state.syncBlocked) return;
    clearTimeout(state.syncTimer);
    if (navigator.onLine === false || document.visibilityState === 'hidden') return;
    const wait = Math.max(delay, state.syncRetryAt - Date.now(), 0);
    state.syncTimer = setTimeout(() => { void synchronize({ automatic: true }); }, wait);
}

function assertSyncSession(session) {
    if (session !== state.session || !state.vaultKey) throw new DOMException('同步已取消', 'AbortError');
}

async function remoteRequest(method, sync, body, { repository = false } = {}) {
    const encodedPath = sync.path.split('/').map(encodeURIComponent).join('/');
    const root = `https://api.github.com/repos/${encodeURIComponent(sync.owner)}/${encodeURIComponent(sync.repo)}`;
    const url = repository ? root : `${root}/contents/${encodedPath}${method === 'GET' ? `?ref=${encodeURIComponent(sync.branch)}` : ''}`;
    const controller = new AbortController();
    const sessionSignal = state.syncController?.signal;
    const abort = () => controller.abort();
    sessionSignal?.addEventListener('abort', abort, { once: true });
    if (sessionSignal?.aborted) controller.abort();
    const timer = setTimeout(abort, SYNC_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method, cache: 'no-store', signal: controller.signal,
            headers: { ...githubHeaders(sync.token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (response.status === 404 && method === 'GET' && !repository) return null;
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(`GitHub 返回 ${response.status}${result.message ? `：${result.message}` : ''}`);
            error.status = response.status;
            const retryAfter = Number(response.headers.get('retry-after'));
            const rateReset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
            if (response.status === 429 || (response.status === 403 && (retryAfter > 0
                || response.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(result.message || '')))) {
                error.retryAfterMs = Math.max(retryAfter * 1000, rateReset - Date.now(), 60000);
            }
            throw error;
        }
        return result;
    } catch (error) {
        if (controller.signal.aborted && !sessionSignal?.aborted) {
            const timeout = new Error('连接 GitHub 超时，将稍后重试');
            timeout.status = 408;
            throw timeout;
        }
        throw error;
    } finally {
        clearTimeout(timer);
        sessionSignal?.removeEventListener('abort', abort);
    }
}

function isRetryableSyncError(error) {
    if (error.retryable === false || error.name === 'AbortError') return false;
    return Boolean(error.retryAfterMs) || !error.status || [408, 409, 425, 429].includes(error.status) || error.status >= 500;
}

async function withSyncRetry(operation, session = state.session) {
    for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
        assertSyncSession(session);
        state.syncAttempt = attempt;
        refreshSyncStatus();
        try {
            return await operation();
        } catch (error) {
            assertSyncSession(session);
            if (!isRetryableSyncError(error) || error.retryAfterMs || attempt === MAX_SYNC_ATTEMPTS) throw error;
            state.syncLastError = error;
            refreshSyncStatus();
            await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
        }
    }
}

function decodeRemote(remote) {
    try {
        if (!remote.sha || typeof remote.content !== 'string') throw new Error();
        const payload = JSON.parse(new TextDecoder().decode(base64ToBytes(remote.content.replace(/\s/g, ''))));
        return validateEncryptedRecord(payload);
    } catch {
        throw syncError('远端文件格式不正确，已保留本地数据', 'format');
    }
}

function remoteRecord(record) {
    // Device sync bookkeeping and the encrypted merge base never travel to GitHub.
    const { remoteSha, syncBase, syncKeyBase, dirty, lastSyncedAt, ...payload } = record;
    return payload;
}

function localRevisionChanged(revision) {
    if (revision !== state.vaultRevision) {
        const error = new Error('本地保存了新改动，正在重新同步');
        error.status = 409;
        throw error;
    }
}

function assertLocalSaved() {
    if (state.localSaveError) throw syncError('本地改动尚未成功保存，已暂停同步。请检查浏览器存储空间并重新保存。', 'storage');
}

async function persistSyncRecord() {
    try { await dbPut(state.record); }
    catch (error) {
        state.record.dirty = true;
        state.localSaveError = error;
        throw syncError('同步结果尚未成功保存到此设备，已暂停后续上传。请检查浏览器存储空间并重新保存。', 'storage');
    }
}

async function applyRemoteVault(vault, payload, sha, dirty, revision, session, metadata = keyMetadata(payload)) {
    await queueStorage(async () => {
        assertSyncSession(session);
        localRevisionChanged(revision);
        assertLocalSaved();
        const encryptedVault = await encryptText(JSON.stringify(vault), state.vaultKey);
        assertSyncSession(session);
        localRevisionChanged(revision);
        const nextRecord = { ...state.record, ...metadata, encryptedVault, remoteSha: sha,
            syncBase: payload.encryptedVault, syncKeyBase: keyMetadata(payload), dirty, updatedAt: new Date().toISOString() };
        // Preserve the record identity used by queued local saves. Publish the merge
        // before IndexedDB yields so an edit during that write extends this version.
        Object.assign(state.record, nextRecord);
        state.vault = vault;
        state.vaultRevision += 1;
        await persistSyncRecord();
    });
    assertSyncSession(session);
    resetLockTimer({ activity: false });
    refreshVaultViews();
}

async function synchronizeOnce(sync, mode, session, resolution) {
    await storageQueue;
    assertSyncSession(session);
    assertLocalSaved();
    const target = JSON.stringify(sync);
    if (state.verifiedSyncTarget !== target) {
        const repository = await remoteRequest('GET', sync, undefined, { repository: true });
        assertSyncSession(session);
        if (repository.private !== true) throw syncError('请选择私有仓库保存加密保险库', 'repository');
        state.verifiedSyncTarget = target;
    }
    const remote = await remoteRequest('GET', sync);
    assertSyncSession(session);
    await storageQueue;
    assertSyncSession(session);
    assertLocalSaved();
    const revision = state.vaultRevision;
    if (!remote && (state.record.remoteSha || mode === 'pull')) {
        throw syncError('远端保险库文件不存在或无权读取，请检查仓库、分支、路径和令牌权限', 'missing');
    }
    if (remote && !state.record.remoteSha && mode !== 'pull') {
        throw syncError('远端已有保险库，请选择“从远端导入”。初始化不会覆盖现有文件。', 'unbound');
    }
    if (remote) {
        const payload = decodeRemote(remote);
        const localMetadata = keyMetadata(state.record);
        const remoteMetadata = keyMetadata(payload);
        // A password change applies to every device sharing this vault key. Keep its
        // wrapping version independent of entry ciphertext so entry uploads cannot revert it.
        const choices = resolution?.sha === remote.sha && resolution.revision === revision ? resolution.choices : {};
        const keyMerge = mode === 'pull' ? { metadata: remoteMetadata, conflicts: [] }
            : mergeKeyMetadata(state.record.syncKeyBase, localMetadata, remoteMetadata, choices['key:master-password']);
        if (mode === 'pull' || remote.sha !== state.record.remoteSha || keyMerge.conflicts.length
            || !sameValue(localMetadata, keyMerge.metadata)) {
            let remoteVault;
            try {
                remoteVault = JSON.parse(await decryptText(payload.encryptedVault, state.vaultKey));
            } catch {
                assertSyncSession(session);
                localRevisionChanged(revision);
                if (mode === 'pull' && !state.record.remoteSha) {
                    state.pendingRemote = { payload: { ...remoteRecord(payload), remoteSha: remote.sha,
                        syncBase: payload.encryptedVault, syncKeyBase: remoteMetadata, dirty: false }, sync, revision };
                    state.modal = { type: 'remote-unlock' };
                    return;
                }
                throw syncError('远端属于不同保险库或密文已损坏，已保留本地数据。请检查同步配置。', 'key');
            }
            assertSyncSession(session);
            localRevisionChanged(revision);
            validateVault(remoteVault);
            remoteVault.sync = { ...state.vault.sync };
            let merged = remoteVault;
            const dirty = mode !== 'pull' && state.record.dirty;
            let base = state.vault;
            let conflicts = [];
            if (dirty) {
                if (!state.record.syncBase) throw syncError('旧版同步尚无合并基线，两端都有改动。请先导出备份，再处理冲突。', 'conflict');
                try { base = validateVault(JSON.parse(await decryptText(state.record.syncBase, state.vaultKey))); }
                catch { throw syncError('无法读取同步基线，已保留本地改动，请先导出备份', 'conflict'); }
                assertSyncSession(session);
                localRevisionChanged(revision);
                const result = mergeVaultChanges(base, state.vault, remoteVault, { choices });
                merged = result.vault;
                conflicts = result.conflicts;
            }
            conflicts.push(...keyMerge.conflicts);
            if (conflicts.length) {
                state.syncConflict = { sha: remote.sha, revision, base: conflictVaultSnapshot(base),
                    local: conflictVaultSnapshot(state.vault), remote: conflictVaultSnapshot(remoteVault), conflicts };
                throw syncError(keyMerge.conflicts.length
                    ? '两端的主密码设置不同，已暂停同步。请查看冲突并确认所有设备应使用哪一版主密码。'
                    : '两台设备修改了相同字段。请查看冲突并逐项选择保留的版本。', 'conflict');
            }
            await applyRemoteVault(merged, payload, remote.sha, dirty, revision, session, keyMerge.metadata);
        } else if (!state.record.syncBase || !state.record.syncKeyBase) {
            await queueStorage(async () => {
                assertSyncSession(session);
                localRevisionChanged(revision);
                const nextRecord = { ...state.record, syncBase: payload.encryptedVault, syncKeyBase: remoteMetadata };
                Object.assign(state.record, nextRecord);
                await persistSyncRecord();
            });
        }
    }
    if (mode === 'pull' || (!state.record.dirty && remote)) return;
    await storageQueue;
    assertSyncSession(session);
    assertLocalSaved();
    const uploadedRevision = state.vaultRevision;
    const payload = structuredClone(remoteRecord(state.record));
    state.syncing = 'push';
    refreshSyncStatus();
    // The SHA is the version read and merged above. A 409 restarts GET + merge, never a blind overwrite.
    const result = await remoteRequest('PUT', sync, {
        message: 'Update encrypted PasswMana vault', branch: sync.branch,
        content: bytesToBase64(new TextEncoder().encode(JSON.stringify(payload))),
        ...(remote ? { sha: remote.sha } : {}),
    });
    assertSyncSession(session);
    if (!result.content?.sha) throw syncError('GitHub 未返回文件版本，请重新检查同步状态', 'format');
    await queueStorage(async () => {
        assertSyncSession(session);
        state.record.remoteSha = result.content.sha;
        state.record.syncBase = payload.encryptedVault;
        state.record.syncKeyBase = keyMetadata(payload);
        state.record.dirty = state.vaultRevision !== uploadedRevision;
        await persistSyncRecord();
    });
}

async function synchronize({ automatic = false, mode = 'sync', resolution } = {}) {
    if (!state.vaultKey || !syncConfigured()) return;
    if (state.syncPromise) return state.syncPromise;
    if (automatic && (state.vault.sync.automatic === false || !state.record.remoteSha || state.syncBlocked
        || navigator.onLine === false || document.visibilityState === 'hidden')) return;
    if (automatic && Date.now() < state.syncRetryAt) { scheduleAutoSync(0); return; }
    if (!automatic && mode === 'pull' && (!state.record.remoteSha || state.record.dirty)
        && !confirm('从远端导入会替换本地条目。请先导出加密备份保存本地改动。是否继续？')) return;
    if (!automatic && mode !== 'pull' && !state.record.remoteSha
        && !confirm('将以本机保险库初始化远端。只有远端不存在密文文件时才会创建。是否继续？')) return;
    const session = state.session;
    const sync = { ...state.vault.sync };
    state.syncController = new AbortController();
    state.syncing = mode === 'pull' ? 'pull' : 'sync';
    state.syncAutomatic = automatic;
    state.syncLastError = null;
    state.syncBlocked = false;
    clearTimeout(state.syncTimer);
    refreshSyncStatus();
    const operation = (async () => {
        try {
            await withSyncRetry(() => synchronizeOnce(sync, mode, session, resolution), session);
            assertSyncSession(session);
            if (state.pendingRemote) return;
            await queueStorage(async () => {
                assertSyncSession(session);
                state.record.lastSyncedAt = new Date().toISOString();
                await persistSyncRecord();
            });
            state.syncLastError = null;
            state.syncConflict = null;
            state.syncRetryCount = 0;
            state.syncRetryAt = 0;
            if (!automatic) {
                if (state.modal?.type === 'sync') state.modal = null;
                if (!state.modal || state.modal.type === 'sync') render();
                toast(mode === 'pull' ? '已采用远端版本，保险库保持解锁' : '已同步加密保险库');
            }
        } catch (error) {
            if (session !== state.session || error.name === 'AbortError') return;
            state.syncLastError = error;
            state.syncBlocked = !isRetryableSyncError(error);
            state.syncRetryCount += 1;
            state.syncRetryAt = Date.now() + Math.max(error.retryAfterMs || 0, Math.min(300000, 5000 * 2 ** Math.min(state.syncRetryCount, 6)));
            if (!automatic && (!state.modal || state.modal.type === 'sync')) {
                state.modal = { type: 'sync-result', title: '同步未完成', message: `${error.message} 本地数据仍保存在此设备。` };
                render();
            }
        } finally {
            if (session === state.session) {
                state.syncing = null;
                state.syncAttempt = null;
                state.syncAutomatic = false;
                state.syncPromise = null;
                state.syncController = null;
                if (state.pendingRemote) render();
                refreshSyncStatus();
                if (!state.syncBlocked && !state.pendingRemote && (state.record.dirty || state.syncLastError)) scheduleAutoSync();
            }
        }
    })();
    state.syncPromise = operation;
    return operation;
}

async function pullRemote() {
    return synchronize({ mode: 'pull' });
}

async function pushRemote() {
    return synchronize();
}

async function resolveSyncConflicts(choices) {
    const conflict = state.syncConflict;
    if (!conflict || !state.vaultKey) throw syncError('没有待处理的同步冲突', 'conflict');
    if (!choices || typeof choices !== 'object' || Array.isArray(choices)
        || conflict.conflicts.some((item) => !Object.hasOwn(choices, item.id) || !['local', 'remote'].includes(choices[item.id]))) {
        throw syncError('请为每个冲突选择此设备或远端版本', 'conflict');
    }
    if (state.syncPromise) throw syncError('请等待当前同步完成后再处理冲突', 'conflict');
    // synchronize always GETs again. Selections apply only to the exact local and
    // remote versions shown; a newer revision is merged again and may need new choices.
    return synchronize({ resolution: { sha: conflict.sha, revision: conflict.revision, choices: { ...choices } } });
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.submitting) return;
  form.dataset.submitting = 'true';
  const submitButton = form.querySelector('[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  const values = new FormData(form);
  try {
    form.querySelector('[data-form-error]')?.remove();
    for (const field of form.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
    if (['setup', 'change-password', 'recovery-reset'].includes(form.dataset.form)) {
      const password = values.get(form.dataset.form === 'setup' ? 'password' : 'newPassword');
      if (typeof password !== 'string' || password.length < 12) throw new Error('主密码至少需要 12 个字符');
    }
    if (form.dataset.form === 'recovery-confirm') {
      if (values.get('recoverySuffix').trim().toUpperCase() !== state.modal?.code.split('-').at(-1)) throw new Error('最后 4 位不匹配，请从保存的位置重新核验');
      state.modal = null;
      render();
      resetLockTimer();
      startSyncSession();
      return;
    }
    if (form.dataset.form === 'backup-unlock') {
      const session = state.session;
      const modal = state.modal;
      const data = modal.rollback ? await getRollbackRecord() : modal.data;
      if (!data) throw new Error('此设备没有可回滚的保险库');
      const prepared = await prepareBackupRestore(data, { masterPassword: values.get('password') });
      assertSyncSession(session);
      if (!confirm('备份已验证。恢复会替换本机保险库，并保留替换前的加密副本。继续？')) return;
      await queueStorage(async () => { assertSyncSession(session); await commitBackupRestore(prepared); });
      state.record = prepared.record;
      state.localSaveError = null;
      lockVault();
      toast('备份已安全恢复，请用备份主密码解锁');
      return;
    }
    if (form.dataset.form === 'resolve-conflicts') {
      const choices = Object.fromEntries((state.syncConflict?.conflicts || []).map((conflict, index) => [conflict.id, values.get(`choice-${index}`)]));
      await resolveSyncConflicts(choices);
      if (state.syncConflict) { render(); toast('版本已变化，请检查最新差异后重新选择'); }
      else if (!state.syncLastError) { state.modal = null; render(); }
      else showFormError(form, state.syncLastError.message);
      return;
    }
    if (form.dataset.form === 'setup') {
      const password = values.get('password');
      if (password !== values.get('confirmPassword')) throw new Error('两次主密码不一致');
      await acquireVaultLock();
      const existing = await dbGet();
      if (existing) { state.record = existing; releaseVaultLock(); render(); return; }
      const recoveryCode = formatRecoveryCode();
      const created = await createVault(password, recoveryCode);
      state.record = created.record;
      state.vaultKey = created.vaultKey;
      state.rawVaultKey = created.rawVaultKey;
      state.vault = created.vault;
      await dbPut(state.record);
      state.modal = { type: 'recovery-created', code: recoveryCode };
      render();
      resetLockTimer();
      return;
    }
    if (form.dataset.form === 'unlock') {
      await acquireVaultLock();
      await storageQueue;
      state.record = await dbGet();
      const session = state.session;
      const record = state.record;
      const unlocked = await unlockWithMaster(record, values.get('password'));
      if (session !== state.session || record !== state.record) return;
      state.vaultKey = unlocked.vaultKey;
      state.rawVaultKey = unlocked.rawVaultKey;
      state.vault = unlocked.vault;
      const savedDraft = await loadEncryptedDraft(record, unlocked.vaultKey, unlocked.rawVaultKey);
      if (session !== state.session || record !== state.record) return;
      state.savedDraft = savedDraft;
      pruneTrash();
      render();
      resetLockTimer();
      startSyncSession();
      return;
    }
    if (form.dataset.form === 'remote-unlock') {
      const pending = state.pendingRemote;
      if (!pending) throw new Error('远端拉取会话已失效，请重新拉取');
      const session = state.session;
      const unlocked = await unlockWithMaster(pending.payload, values.get('password'));
      assertSyncSession(session);
      localRevisionChanged(pending.revision);
      validateVault(unlocked.vault);
      unlocked.vault.sync = pending.sync;
      stopSyncSession();
      state.record = pending.payload;
      state.vaultKey = unlocked.vaultKey;
      state.rawVaultKey = unlocked.rawVaultKey;
      state.vault = unlocked.vault;
      state.record.lastSyncedAt = new Date().toISOString();
      await persistVault({ dirty: false });
      state.pendingRemote = null;
      state.modal = null;
      render();
      resetLockTimer();
      startSyncSession();
      toast('已从远端拉取，保险库保持解锁');
      return;
    }
    if (form.dataset.form === 'add-entry' || form.dataset.form === 'edit-entry') {
      const now = new Date().toISOString();
      const entry = { title: values.get('title').trim(), username: values.get('username').trim(), password: values.get('password'), category: values.get('category'), url: values.get('url').trim(), notes: values.get('notes').trim(), favorite: values.get('favorite') === 'on', updatedAt: now };
      if (!entry.title || !entry.username || !entry.password) throw new Error('请填写站点、账户和密码');
      if (form.dataset.form === 'edit-entry') {
        const index = state.vault.entries.findIndex((item) => item.id === state.modal.entry.id);
        if (index < 0 || !sameValue(state.vault.entries[index], state.modal.entry)) throw new Error('此条目已在后台更新或删除，请关闭编辑窗口后重新打开');
        state.vault.entries[index] = { ...state.vault.entries[index], ...entry };
      } else {
        state.vault.entries.unshift({ ...entry, id: makeId(), createdAt: now });
      }
      await persistVault();
      clearTimeout(state.draftTimer);
      state.formDraft = null;
      state.savedDraft = null;
      await queueStorage(() => clearEncryptedDraft());
      state.modal = null;
      render();
      toast('已保存到密码库');
      return;
    }
    if (form.dataset.form === 'sync-config') {
      const previous = state.vault.sync;
      const next = { owner: values.get('owner').trim(), repo: values.get('repo').trim(), branch: values.get('branch').trim(), path: values.get('path').trim().replace(/^\/+|\/+$/g, ''), token: values.get('token').trim(), automatic: previous.automatic !== false };
      if (!syncConfigured(next)) throw new Error('请完整填写仓库、分支、路径与令牌');
      const targetChanged = ['owner', 'repo', 'branch', 'path'].some((key) => previous[key] !== next[key]);
      stopSyncSession();
      state.vault.sync = next;
      if (targetChanged) {
        state.record.remoteSha = null;
        delete state.record.syncBase;
        delete state.record.syncKeyBase;
        delete state.record.lastSyncedAt;
      }
      await persistVault();
      state.modal = { type: 'sync' };
      render();
      startSyncSession();
      toast('配置已加密保存，请完成首次连接');
      return;
    }
    if (form.dataset.form === 'change-password') {
      const session = state.session;
      const record = state.record;
      const rawVaultKey = state.rawVaultKey;
      const originalWrapping = { masterSalt: record.masterSalt, wrappedVaultKey: structuredClone(record.wrappedVaultKey) };
      if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('两次新密码不一致');
      const currentKey = await deriveKey(values.get('currentPassword'), state.record.masterSalt);
      await decryptText(state.record.wrappedVaultKey, currentKey);
      const newSalt = randomBase64(16);
      const newKey = await deriveKey(values.get('newPassword'), newSalt);
      const wrappedVaultKey = await encryptText(rawVaultKey, newKey);
      assertSyncSession(session);
      if (record !== state.record) return;
      if (!sameValue(originalWrapping, { masterSalt: record.masterSalt, wrappedVaultKey: record.wrappedVaultKey })) throw new Error('主密码已在后台更新，请关闭窗口后重新验证');
      state.record.masterSalt = newSalt;
      state.record.wrappedVaultKey = wrappedVaultKey;
      await persistVault();
      state.modal = null;
      render();
      toast('主密码已更新');
      return;
    }
    if (form.dataset.form === 'recovery-reset') {
      await acquireVaultLock();
      await storageQueue;
      state.record = await dbGet();
      const session = state.session;
      const record = state.record;
      if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('两次新密码不一致');
      const { rawVaultKey } = await unlockWithRecovery(record, values.get('recoveryCode'));
      const masterSalt = randomBase64(16);
      const masterKey = await deriveKey(values.get('newPassword'), masterSalt);
      const wrappedVaultKey = await encryptText(rawVaultKey, masterKey);
      if (session !== state.session || record !== state.record) return;
      const next = { ...record, masterSalt, wrappedVaultKey, updatedAt: new Date().toISOString(), dirty: true };
      await queueStorage(() => dbPut(next));
      state.record = next;
      releaseVaultLock();
      state.modal = null;
      render();
      toast('主密码已重设');
    }
  } catch (error) {
    if (!state.vaultKey) releaseVaultLock();
    const friendlyError = form.dataset.form === 'unlock' && error.name === 'OperationError'
      ? '主密码错误，无法解锁保险库'
      : form.dataset.form === 'recovery-reset' && error.name === 'OperationError'
        ? '恢复密钥无效，无法重设主密码'
        : form.dataset.form === 'remote-unlock' && error.name === 'OperationError'
          ? '远端主密码错误，无法完成拉取'
        : form.dataset.form === 'backup-unlock' && error.name === 'OperationError'
          ? '备份主密码错误或密文已损坏，原保险库已保留'
          : form.dataset.form === 'change-password' && error.name === 'OperationError'
            ? '当前主密码错误，请重新输入'
            : (error.message || '操作失败');
    const mismatch = /两次/.test(friendlyError);
    showFormError(form, friendlyError, mismatch ? 'confirmPassword' : form.dataset.form === 'change-password' ? 'currentPassword' : form.dataset.form === 'recovery-reset' ? 'recoveryCode' : undefined);
  } finally {
    delete form.dataset.submitting;
    if (submitButton) submitButton.disabled = false;
  }
}

function captureEntryDraft() {
    if (!state.vaultKey) return;
    const form = app.querySelector('form[data-form="add-entry"], form[data-form="edit-entry"]');
    if (!form) return;
    const values = formValues(form);
    if (JSON.stringify(values) === initialFormValues.get(form) && !state.formDraft) return;
    state.formDraft = {
        type: form.dataset.form,
        values: { title: values.title || '', username: values.username || '', password: values.password || '', category: values.category || '', url: values.url || '', notes: values.notes || '', favorite: values.favorite === 'on' },
        ...(state.modal?.type === 'edit' ? { entryId: state.modal.entry.id, entry: structuredClone(state.modal.entry) } : {}),
    };
}

function persistEntryDraft() {
    const draft = state.formDraft && structuredClone(state.formDraft);
    const record = state.record;
    const key = state.vaultKey;
    const rawKey = state.rawVaultKey;
    if (!draft || !key) return Promise.resolve();
    return queueStorage(() => saveEncryptedDraft(record, key, rawKey, draft));
}

async function closeModal() {
    const form = app.querySelector('form[data-form="add-entry"], form[data-form="edit-entry"]');
    if (form) {
        if ((state.formDraft || JSON.stringify(formValues(form)) !== initialFormValues.get(form)) && !confirm('放弃这次未保存的编辑？')) return;
        clearTimeout(state.draftTimer);
        state.formDraft = null;
        state.savedDraft = null;
        await queueStorage(() => clearEncryptedDraft());
    }
    if (state.modal?.type === 'remote-unlock') state.pendingRemote = null;
    state.modal = null;
    render();
}

function syncConfigFromForm(form) {
    const values = formValues(form);
    const repository = parseGithubRepository(values.repositoryUrl);
    return { ...repository, repositoryUrl: values.repositoryUrl, branch: values.branch.trim() || 'main', path: values.path.trim().replace(/^\/+|\/+$/g, '') || 'passwmana.vault', token: values.token.trim() };
}

async function testSyncConnection(form) {
    const result = form.querySelector('[data-connection-result]');
    const button = form.querySelector('[data-action="test-sync-connection"]');
    button.disabled = true;
    result.textContent = '正在检查仓库、令牌权限和分支…';
    try {
        const sync = syncConfigFromForm(form);
        if (!sync.token) throw new Error('请填写访问令牌');
        const repository = await remoteRequest('GET', sync, undefined, { repository: true });
        if (!repository.private) throw new Error('该仓库不是私有仓库，请换用私有仓库');
        if (repository.permissions && repository.permissions.push !== true) throw new Error('令牌缺少 Contents 写入权限');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
        try {
            const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(sync.owner)}/${encodeURIComponent(sync.repo)}/branches/${encodeURIComponent(sync.branch)}`, { headers: githubHeaders(sync.token), cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error('分支不存在或无权读取，请检查高级设置');
        } finally { clearTimeout(timer); }
        result.textContent = repository.permissions ? '连接正常，仓库为私有且具有写入权限。保存后选择导入或初始化。' : '已验证私有仓库和分支可读取；GitHub 未报告写入权限，请确认 Contents 读写授权。';
    } catch (error) {
        result.textContent = `连接未通过：${error.message}`;
        showFormError(form, error.message, 'token');
    } finally { button.disabled = false; }
}

async function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        state.serviceWorkerRegistration = registration;
        const announce = () => {
            if (!registration.waiting || !navigator.serviceWorker.controller) return;
            state.updateReady = true;
            let notice = app.querySelector('[data-update-notice]');
            if (!notice) {
                notice = document.createElement('div');
                notice.className = 'update-notice';
                notice.dataset.updateNotice = '';
                notice.setAttribute('role', 'status');
                notice.innerHTML = '新版本已准备好。<button class="secondary-button" data-action="apply-update">保存草稿并更新</button>';
                app.append(notice);
            }
        };
        registration.addEventListener('updatefound', () => {
            registration.installing?.addEventListener('statechange', announce);
        });
        announce();
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateRequested) window.location.reload(); });
    } catch { /* Normal vault access remains available if offline installation fails. */ }
}

function pruneTrash() {
  const cutoff = Date.now() - 30 * 86400000;
  const originalLength = state.vault.trash.length;
  state.vault.trash = state.vault.trash.filter((entry) => new Date(entry.deletedAt).getTime() > cutoff);
  if (state.vault.trash.length !== originalLength) persistVault().catch(() => {});
}

async function handleAction(event) {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const action = control.dataset.action;
  if (action.startsWith('open-') || action === 'import-backup') dialogTrigger = { action: action === 'open-edit' ? 'open-detail' : action, id: control.dataset.id, panel: control.dataset.panel };
  if (action === 'finish-setup') return; // The recovery-confirm form owns verification.
  if (action === 'extend-session') { resetLockTimer(); return; }
  if (action === 'clear-filters') { state.search = ''; state.category = ''; state.favoriteOnly = false; render(); return; }
  if (action === 'wizard-next' || action === 'wizard-back') {
    const form = control.closest('form');
    try { state.modal.configDraft = syncConfigFromForm(form); state.modal.step = action === 'wizard-next' ? 2 : 1; render(); }
    catch (error) { showFormError(form, error.message, 'repositoryUrl'); }
    return;
  }
  if (action === 'test-sync-connection') { await testSyncConnection(control.closest('form')); return; }
  if (action === 'generate-password') {
    const form = control.closest('form');
    form.elements.password.value = generatePassword(form.querySelector('[data-generator-length]').value);
    captureEntryDraft();
    await persistEntryDraft();
    toast('已生成随机密码，可保存或复制');
    return;
  }
  if (action === 'copy-generated') { await copyText(control.closest('form').elements.password.value); return; }
  if (action === 'copy-account') { const entry = state.vault.entries.find((item) => item.id === control.dataset.id); if (entry) await copyText(entry.username); return; }
  if (action === 'open-conflicts') { if (!state.syncConflict) return toast('当前没有待处理的冲突'); state.modal = { type: 'conflicts' }; render(); return; }
  if (action === 'reveal-conflict') {
    const conflict = state.syncConflict?.conflicts[Number(control.dataset.index)];
    if (!conflict) return;
    const node = app.querySelector(`[data-conflict-secret="${Number(control.dataset.index)}"]`);
    node.hidden = !node.hidden;
    const password = (value) => typeof value === 'object' && value ? value.entry?.password : value;
    node.textContent = node.hidden ? '' : `本地：${String(password(conflict.local) ?? '已删除')}\n远端：${String(password(conflict.remote) ?? '已删除')}`;
    control.textContent = node.hidden ? '查看密码差异' : '隐藏密码差异';
    return;
  }
  if (action === 'resume-draft') {
    const draft = state.savedDraft;
    if (!draft) return;
    state.formDraft = draft;
    state.modal = draft.type === 'edit-entry' ? { type: 'edit', entry: draft.entry || state.vault.entries.find((entry) => entry.id === draft.entryId), draft } : { type: 'add', draft };
    if (state.modal.type === 'edit' && !state.modal.entry) { state.modal = null; return toast('此条目已删除，请先导出草稿内容或重新添加'); }
    render();
    return;
  }
  if (action === 'discard-draft') {
    if (!confirm('放弃这份未完成的编辑？')) return;
    state.formDraft = null; state.savedDraft = null;
    await queueStorage(() => clearEncryptedDraft());
    render(); return;
  }
  if (action === 'restore-previous') { if (!await getRollbackRecord()) return toast('此设备没有可回滚的保险库'); state.modal = { type: 'backup-unlock', rollback: true }; render(); return; }
  if (action === 'check-update') { await state.serviceWorkerRegistration?.update(); toast(state.updateReady ? '新版本已准备好' : '已检查应用更新'); return; }
  if (action === 'apply-update') {
    const worker = state.serviceWorkerRegistration?.waiting;
    if (!worker) return toast('当前没有等待安装的更新');
    captureEntryDraft();
    await persistEntryDraft();
    await storageQueue;
    updateRequested = true;
    lockVault();
    worker.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  if (action === 'toggle-password') {
    const input = control.closest('.password-field').querySelector('input');
    input.type = input.type === 'password' ? 'text' : 'password';
    control.setAttribute('aria-label', input.type === 'password' ? '显示密码' : '隐藏密码');
    control.innerHTML = icon(input.type === 'password' ? 'eye' : 'eye-off');
    drawIcons();
    return;
  }
  if (action === 'copy-recovery') { await copyText(control.dataset.code, '恢复密钥已复制'); return; }
  if (action === 'open-recovery-reset') { state.modal = { type: 'recovery-reset' }; render(); return; }
  if (action === 'view') { state.view = control.dataset.viewName; state.settingsDetail = false; state.drawerOpen = false; render(); return; }
  if (action === 'mobile-left') { dialogTrigger = { action: 'mobile-left' }; if (state.settingsDetail) { state.settingsDetail = false; render(); } else { state.drawerOpen = true; render(); } return; }
  if (action === 'close-drawer') { state.drawerOpen = false; render(); return; }
  if (action === 'setting-panel') { state.settingPanel = control.dataset.panel; if (window.matchMedia('(max-width: 899px)').matches) state.settingsDetail = true; render(); return; }
  if (action === 'set-mode') { document.documentElement.dataset.mode = control.dataset.mode; localStorage.setItem('passwmana-mode', control.dataset.mode); render(); return; }
  if (action === 'set-accent') { document.documentElement.dataset.accent = control.dataset.accent; localStorage.setItem('passwmana-accent', control.dataset.accent); document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(); render(); return; }
  if (action === 'toggle-favorite-filter') { state.favoriteOnly = !state.favoriteOnly; control.classList.toggle('active', state.favoriteOnly); control.setAttribute('aria-pressed', String(state.favoriteOnly)); if (state.modal?.type === 'category-filter') control.textContent = state.favoriteOnly ? '显示全部条目' : '仅看收藏'; updateVaultList(); return; }
  if (action === 'open-category-filter') { state.modal = { type: 'category-filter' }; render(); return; }
  if (action === 'select-category') { state.category = control.dataset.category; state.modal = null; render(); return; }
  if (action === 'open-add') { state.modal = { type: 'add' }; render(); return; }
  if (action === 'open-detail') { state.modal = { type: 'detail', id: control.dataset.id, revealed: false }; render(); return; }
  if (action === 'close-modal') { await closeModal(); return; }
  if (action === 'reveal-password') {
    const entry = state.vault.entries.find((item) => item.id === state.modal.id);
    if (!entry) return;
    state.modal.revealed = !state.modal.revealed;
    app.querySelector('[data-secret-value]').textContent = state.modal.revealed ? entry.password : '••••••••••••••••';
    control.setAttribute('aria-label', state.modal.revealed ? '隐藏密码' : '显示密码');
    control.setAttribute('aria-pressed', String(state.modal.revealed));
    control.innerHTML = icon(state.modal.revealed ? 'eye-off' : 'eye');
    drawIcons();
    return;
  }
  if (action === 'copy-password') { const entry = state.vault.entries.find((item) => item.id === control.dataset.id); if (entry) await copyText(entry.password); return; }
  if (action === 'open-edit') { const entry = state.vault.entries.find((item) => item.id === control.dataset.id); if (!entry) return; state.modal = { type: 'edit', entry: structuredClone(entry) }; render(); return; }
  if (action === 'delete-entry') { const entry = state.vault.entries.find((item) => item.id === control.dataset.id); if (!confirm(`将“${entry.title}”移至回收站？`)) return; state.vault.entries = state.vault.entries.filter((item) => item.id !== entry.id); state.vault.trash.unshift({ ...entry, deletedAt: new Date().toISOString() }); await persistVault(); state.modal = null; render(); toast('已移至回收站'); return; }
  if (action === 'restore-entry') { const entry = state.vault.trash.find((item) => item.id === control.dataset.id); state.vault.trash = state.vault.trash.filter((item) => item.id !== entry.id); delete entry.deletedAt; entry.updatedAt = new Date().toISOString(); state.vault.entries.unshift(entry); await persistVault(); render(); toast('已恢复条目'); return; }
  if (action === 'purge-entry') { if (!confirm('永久删除后无法恢复。是否继续？')) return; state.vault.trash = state.vault.trash.filter((item) => item.id !== control.dataset.id); await persistVault(); render(); toast('已永久删除'); return; }
  if (action === 'add-category') { const category = prompt('分类名称'); if (!category?.trim()) return; if (state.vault.categories.includes(category.trim())) return toast('分类已存在'); state.vault.categories.push(category.trim()); await persistVault(); render(); return; }
  if (action === 'delete-category') { const category = control.dataset.category; if (DEFAULT_CATEGORIES.includes(category)) return toast('默认分类不可删除'); if (state.vault.entries.some((entry) => entry.category === category)) return toast('该分类仍有条目，无法删除'); state.vault.categories = state.vault.categories.filter((item) => item !== category); await persistVault(); render(); return; }
  if (action === 'open-sync') { state.modal = { type: 'sync' }; render(); return; }
  if (action === 'open-sync-config') { state.modal = { type: 'sync-config' }; render(); return; }
  if (action === 'toggle-auto-sync') { state.vault.sync.automatic = state.vault.sync.automatic === false; stopSyncSession(); await persistVault(); startSyncSession(); render(); return; }
  if (action === 'pull-remote') { await pullRemote(); return; }
  if (action === 'push-remote') { await pushRemote(); return; }
  if (action === 'export-backup') { await downloadBackup(); return; }
  if (action === 'import-backup') { await importBackup(); return; }
  if (action === 'import-legacy') { await importLegacyBackup(); return; }
  if (action === 'open-change-password') { state.modal = { type: 'change-password' }; render(); return; }
  if (action === 'lock') { lockVault(); return; }
}

app.addEventListener('click', (event) => { handleAction(event).catch((error) => toast(error.message || '操作失败')); });
app.addEventListener('submit', handleSubmit);
app.addEventListener('input', (event) => {
    if (event.target.dataset.input === 'search') { state.search = event.target.value; updateVaultList(); }
    const form = event.target.closest('form');
    if (event.target.name === 'password' || event.target.name === 'newPassword') {
        const help = form?.querySelector('[data-password-strength]');
        if (help) help.textContent = passwordStrength(event.target.value);
    }
    if (event.target.name === 'recoverySuffix' && state.modal?.type === 'recovery-created') {
        form.querySelector('[data-action="finish-setup"]').disabled = event.target.value.trim().toUpperCase() !== state.modal.code.split('-').at(-1);
    }
    if (form && ['add-entry', 'edit-entry'].includes(form.dataset.form)) {
        captureEntryDraft();
        clearTimeout(state.draftTimer);
        state.draftTimer = setTimeout(() => { void persistEntryDraft().catch(() => showFormError(form, '草稿暂未保存，请保留页面并检查存储空间')); }, 250);
    }
    event.target.removeAttribute('aria-invalid');
    resetLockTimer();
});
app.addEventListener('invalid', (event) => {
    const form = event.target.closest('form');
    if (!form) return;
    event.preventDefault();
    showFormError(form, event.target.validity.valueMissing ? '请填写此项' : event.target.validity.tooShort ? '主密码至少需要 12 个字符' : '请检查输入格式', event.target.name);
}, true);
app.addEventListener('change', async (event) => {
  if (event.target.dataset.input === 'category') { state.category = event.target.value; updateVaultList(); }
  if (event.target.dataset.input === 'lock-minutes') {
    try { state.vault.preferences.lockMinutes = Number(event.target.value); await persistVault(); resetLockTimer(); toast('自动锁定设置已保存'); }
    catch (error) { toast(`设置保存失败：${error.message}`); }
  }
  if (event.target.closest('form[data-form="add-entry"], form[data-form="edit-entry"]')) { captureEntryDraft(); void persistEntryDraft().catch(() => {}); }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeDialog) {
        event.preventDefault();
        if (state.drawerOpen) { state.drawerOpen = false; render(); }
        else void closeModal().catch((error) => toast(error.message));
        return;
    }
    trapDialogKey(event, activeDialog);
});
window.addEventListener('pagehide', () => { captureEntryDraft(); void persistEntryDraft().catch(() => {}); });
window.addEventListener('beforeunload', (event) => {
    const form = app.querySelector('form[data-form="add-entry"], form[data-form="edit-entry"]');
    if (form && JSON.stringify(formValues(form)) !== initialFormValues.get(form) && !updateRequested) { event.preventDefault(); event.returnValue = ''; }
});

for (const eventName of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(eventName, resetLockTimer, { passive: true });
window.addEventListener('online', () => { refreshSyncStatus(); scheduleAutoSync(0); });
window.addEventListener('offline', refreshSyncStatus);
window.addEventListener('focus', () => scheduleAutoSync(0));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleAutoSync(0); });
window.addEventListener('resize', () => { if (!window.matchMedia('(max-width: 899px)').matches && state.settingsDetail) { state.settingsDetail = false; render(); } });

async function bootstrap() {
  document.documentElement.dataset.mode = localStorage.getItem('passwmana-mode') || 'system';
  document.documentElement.dataset.accent = localStorage.getItem('passwmana-accent') || 'emerald';
  state.record = await dbGet();
  render();
  void setupServiceWorker();
}

bootstrap().catch((error) => { app.textContent = `无法初始化保险库: ${error.message}`; });
