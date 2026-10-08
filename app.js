const DB_NAME = 'passwmana';
const STORE_NAME = 'vault';
const RECORD_KEY = 'primary';
const PBKDF2_ITERATIONS = 600000;
const MAX_SYNC_ATTEMPTS = 3;
const SYNC_DEBOUNCE_MS = 2000;
const SYNC_POLL_MS = 60000;
const SYNC_TIMEOUT_MS = 20000;
const DEFAULT_CATEGORIES = ['工作', '个人', '金融'];

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
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function icon(name, extra = '') {
  return `<i data-lucide="${name}"${extra ? ` class="${extra}"` : ''}></i>`;
}

function makeId() {
  return crypto.randomUUID();
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBase64(byteLength = 24) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function formatRecoveryCode() {
  return randomBase64(24).replace(/[+/=]/g, '').toUpperCase().slice(0, 20).match(/.{1,4}/g).join('-');
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_KEY);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record, RECORD_KEY);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

let storageQueue = Promise.resolve();

function queueStorage(operation) {
    const result = storageQueue.then(operation);
    storageQueue = result.catch(() => {});
    return result;
}

async function deriveKey(secret, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBytes(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptText(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) };
}

async function decryptText(value, key) {
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(value.iv) }, key, base64ToBytes(value.data));
  return new TextDecoder().decode(data);
}

async function importVaultKey(raw) {
  return crypto.subtle.importKey('raw', base64ToBytes(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function defaultVault() {
  return {
    entries: [],
    trash: [],
    categories: DEFAULT_CATEGORIES,
    preferences: { lockMinutes: 5 },
    sync: { owner: '', repo: '', branch: 'main', path: 'passwmana.vault', token: '', automatic: true },
  };
}

async function createVault(masterPassword, recoveryCode) {
  const vaultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const rawKey = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey)));
  const masterSalt = randomBase64(16);
  const recoverySalt = randomBase64(16);
  const masterKey = await deriveKey(masterPassword, masterSalt);
  const recoveryKey = await deriveKey(recoveryCode, recoverySalt);
  const vault = defaultVault();
  const record = {
    format: 'passwmana-v1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    masterSalt,
    recoverySalt,
    wrappedVaultKey: await encryptText(rawKey, masterKey),
    recoveryWrappedVaultKey: await encryptText(rawKey, recoveryKey),
    encryptedVault: await encryptText(JSON.stringify(vault), vaultKey),
    remoteSha: null,
    dirty: true,
  };
  return { record, vaultKey, rawVaultKey: rawKey, vault };
}

async function unlockWithMaster(record, masterPassword) {
  const masterKey = await deriveKey(masterPassword, record.masterSalt);
  const rawVaultKey = await decryptText(record.wrappedVaultKey, masterKey);
  const vaultKey = await importVaultKey(rawVaultKey);
  const vault = JSON.parse(await decryptText(record.encryptedVault, vaultKey));
  return { vaultKey, rawVaultKey, vault };
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
  const minutes = Number(state.vault.preferences?.lockMinutes ?? 5);
  if (minutes > 0) state.timer = setTimeout(lockVault, Math.max(0, minutes * 60 * 1000 - (Date.now() - state.lastActivityAt)));
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
  stopSyncSession();
  releaseVaultLock();
  state.vaultKey = null;
  state.rawVaultKey = null;
  state.vault = null;
  state.modal = null;
  state.syncAutomatic = false;
  state.pendingRemote = null;
  state.drawerOpen = false;
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
  return `<main class="lock-screen"><section class="lock-panel"><div class="lock-brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div><h1>保存恢复密钥</h1><p>它可以在忘记主密码时重新取得保险库访问权。密钥不会保存到此设备。</p><div class="recovery-box"><div class="recovery-code">${escapeHtml(code)}</div><button class="secondary-button" data-action="copy-recovery" data-code="${escapeHtml(code)}">${icon('copy')}复制恢复密钥</button></div><div class="notice-line">${icon('triangle-alert')}<span>确认已存到可信且离线的位置后，再进入密码库。</span></div><div class="button-row"><button class="primary-button" data-action="finish-setup">我已保存</button></div></section></main>`;
}

function renderSetup() {
  return `<main class="lock-screen"><form class="lock-panel" data-form="setup"><div class="lock-brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div><h1>创建本地保险库</h1><p>密码只在此设备以加密形式保存。主密码无法由服务端重置。</p><div class="form-stack"><label class="form-field">主密码<div class="password-field"><input class="field" name="password" type="password" autocomplete="new-password" minlength="12" required /><button class="icon-button" type="button" data-action="toggle-password" title="显示密码" aria-label="显示密码">${icon('eye')}</button></div></label><label class="form-field">确认主密码<input class="field" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></label><p class="form-help">建议至少 12 个字符。首次创建后会显示一次恢复密钥。</p><button class="primary-button" type="submit">${icon('lock-keyhole')}创建保险库</button></div></form></main>`;
}

function renderUnlock() {
  return `<main class="lock-screen"><form class="lock-panel" data-form="unlock"><div class="lock-brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div><h1>解锁保险库</h1><p>输入主密码以在本设备解密保险库。</p><div class="form-stack"><label class="form-field">主密码<div class="password-field"><input class="field" name="password" type="password" autocomplete="current-password" required autofocus /><button class="icon-button" type="button" data-action="toggle-password" title="显示密码" aria-label="显示密码">${icon('eye')}</button></div></label><button class="primary-button" type="submit">${icon('unlock')}解锁</button><button class="secondary-button" type="button" data-action="open-recovery-reset">使用恢复密钥</button></div></form></main>`;
}

function entryTemplate(entry) {
  return `<button class="entry" data-action="open-detail" data-id="${entry.id}"><span class="entry-site"><span class="site-icon">${titleInitial(entry)}</span><span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(maskAccount(entry.username))}</small></span></span><span class="pill">${escapeHtml(entry.category)}</span><span class="pill">${entry.url ? '网站' : '账户'}</span><time>${timeLabel(entry.updatedAt)}</time>${entry.favorite ? icon('star', 'starred') : icon('chevron-right', 'chevron')}</button>`;
}

function vaultListTemplate() {
  const entries = currentEntries();
  const favorites = entries.filter((entry) => entry.favorite);
  const rest = entries.filter((entry) => !entry.favorite);
  return entries.length ? `${favorites.length ? `<div class="group-heading">收藏 <span>${favorites.length}</span></div>${favorites.map(entryTemplate).join('')}` : ''}${rest.length ? `<div class="group-heading">${favorites.length ? '全部条目' : '密码条目'} <span>${rest.length}</span></div>${rest.map(entryTemplate).join('')}` : ''}` : `<div class="empty-state">${icon('vault')}<div>没有匹配的密码条目</div></div>`;
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
  return `<section class="view ${state.view === 'vault' ? 'active' : ''}" data-view="vault"><div class="notice" data-sync-status="${status.status}"><div class="notice-copy"><span data-sync-icon>${icon(status.icon)}</span><span data-sync-detail>${escapeHtml(status.detail)}</span></div><button class="secondary-button" data-action="open-sync">${icon('refresh-cw')}同步详情</button></div><div class="toolbar"><div class="search">${icon('search')}<input class="field" type="search" data-input="search" placeholder="搜索站点、账户或分类" value="${escapeHtml(state.search)}" aria-label="搜索密码库" /></div><select class="field filter" data-input="category" aria-label="按分类筛选"><option value="">全部分类</option>${state.vault.categories.map((category) => `<option value="${escapeHtml(category)}" ${state.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select><button class="secondary-button filter-favorite ${state.favoriteOnly ? 'active' : ''}" data-action="toggle-favorite-filter" title="仅看收藏" aria-label="仅看收藏">${icon('star')}</button><button class="secondary-button mobile-filter" data-action="open-category-filter" title="分类筛选" aria-label="分类筛选">${icon('tags')}</button><button class="primary-button" data-action="open-add">${icon('plus')}<span>新增密码</span></button></div><div class="vault-list" data-vault-list>${vaultListTemplate()}</div></section>`;
}

const settingLabels = { sync: '同步与备份', security: '安全', appearance: 'Appearance', categories: '分类', trash: '回收站' };

function settingsNavigation() {
  return `<nav class="settings-nav" aria-label="设置分类">${Object.entries(settingLabels).map(([key, label]) => `<button class="${state.settingPanel === key ? 'active' : ''}" data-action="setting-panel" data-panel="${key}">${icon({ sync: 'refresh-cw', security: 'shield-check', appearance: 'paintbrush', categories: 'tags', trash: 'trash-2' }[key])}${label}</button>`).join('')}</nav>`;
}

function renderSyncSettings() {
  const sync = state.vault.sync;
  const repo = sync.owner && sync.repo ? `${sync.owner} / ${sync.repo}` : '尚未配置私有仓库';
  return `<section class="settings-panel ${state.settingPanel === 'sync' ? 'active' : ''}" data-panel="sync"><h2>同步与备份</h2><p class="panel-intro">首次连接后，解锁、保存改动和恢复联网时自动同步。页面打开且已解锁时，每分钟检查远端更新。</p><div class="setting-list"><div class="setting-row"><div class="setting-copy"><strong>私有仓库</strong><span>${escapeHtml(repo)}</span></div><button class="secondary-button" data-action="open-sync-config">配置</button></div><div class="setting-row"><div class="setting-copy"><strong>后台自动同步</strong><span>保存后约 2 秒同步；锁定或关闭页面时暂停</span></div><button class="secondary-button" data-action="toggle-auto-sync" aria-pressed="${sync.automatic !== false}">${sync.automatic === false ? '已关闭' : '已开启'}</button></div><div class="setting-row"><div class="setting-copy"><strong>同步状态</strong><span data-sync-detail>${escapeHtml(syncStatus().detail)}</span></div><button class="secondary-button" data-action="open-sync">详情</button></div><div class="setting-row"><div class="setting-copy"><strong>加密备份</strong><span>导出当前保险库为 .passwmana 文件</span></div><button class="secondary-button" data-action="export-backup">${icon('download')}导出</button></div><div class="setting-row"><div class="setting-copy"><strong>恢复加密备份</strong><span>使用 .passwmana 文件替换本机保险库</span></div><button class="secondary-button" data-action="import-backup">${icon('upload')}恢复</button></div><div class="setting-row"><div class="setting-copy"><strong>迁移旧版备份</strong><span>从旧版明文 JSON 合并条目与分类</span></div><button class="secondary-button" data-action="import-legacy">${icon('file-input')}迁移</button></div></div></section>`;
}

function renderSecuritySettings() {
  return `<section class="settings-panel ${state.settingPanel === 'security' ? 'active' : ''}" data-panel="security"><h2>安全</h2><p class="panel-intro">主密码不会离开本设备。解锁后密钥只保留在当前会话内存中。</p><div class="setting-list"><div class="setting-row"><div class="setting-copy"><strong>自动锁定</strong><span>无操作后自动清除解锁密钥</span></div><select class="field inline-select" data-input="lock-minutes"><option value="0" ${state.vault.preferences.lockMinutes === 0 ? 'selected' : ''}>关闭</option><option value="1" ${state.vault.preferences.lockMinutes === 1 ? 'selected' : ''}>1 分钟</option><option value="5" ${state.vault.preferences.lockMinutes === 5 ? 'selected' : ''}>5 分钟</option><option value="15" ${state.vault.preferences.lockMinutes === 15 ? 'selected' : ''}>15 分钟</option><option value="30" ${state.vault.preferences.lockMinutes === 30 ? 'selected' : ''}>30 分钟</option></select></div><div class="setting-row"><div class="setting-copy"><strong>主密码</strong><span>只更新保险库密钥的主密码包装</span></div><button class="secondary-button" data-action="open-change-password">修改</button></div><div class="setting-row"><div class="setting-copy"><strong>恢复密钥</strong><span>创建时生成，请保存在离线可信位置</span></div><span class="setting-copy"><span>不可再次显示</span></span></div></div></section>`;
}

function renderAppearanceSettings() {
  const accentNames = { emerald: '翡翠绿', blue: '蓝', cyan: '青', rose: '玫红', amber: '琥珀', graphite: '石墨灰' };
  const mode = document.documentElement.dataset.mode || 'system';
  const accent = document.documentElement.dataset.accent || 'emerald';
  return `<section class="settings-panel ${state.settingPanel === 'appearance' ? 'active' : ''}" data-panel="appearance"><h2>Appearance</h2><p class="panel-intro">选择显示模式和主题色。偏好仅保存于当前设备。</p><div class="appearance-preview"><div class="mini-app"><div class="mini-side"><span class="mini-mark"></span><span class="mini-line"></span><span class="mini-line"></span></div><div class="mini-content"><strong>密码库</strong><span class="mini-cta">新增密码</span></div></div><div class="preview-text">主题色会用于导航、主要操作、焦点和状态提示。</div></div><div class="setting-list"><div class="setting-row"><div class="setting-copy"><strong>显示模式</strong><span>按系统偏好或固定浅色/深色</span></div><div class="segmented" role="group" aria-label="显示模式">${[['system','跟随系统'],['light','浅色'],['dark','深色']].map(([value,label]) => `<button class="${mode === value ? 'active' : ''}" data-action="set-mode" data-mode="${value}">${label}</button>`).join('')}</div></div><div class="setting-row"><div class="setting-copy"><strong>主题色</strong><span>${accentNames[accent]}</span></div><div class="swatches" role="group" aria-label="主题色">${Object.entries(accentNames).map(([value,label]) => `<button class="swatch ${accent === value ? 'active' : ''}" data-accent="${value}" data-action="set-accent" title="${label}" aria-label="${label}">${accent === value ? icon('check') : ''}</button>`).join('')}</div></div></div></section>`;
}

function renderCategoriesSettings() {
  return `<section class="settings-panel ${state.settingPanel === 'categories' ? 'active' : ''}" data-panel="categories"><h2>分类</h2><p class="panel-intro">分类用于整理和筛选密码条目，可以按自己的习惯维护。</p><div class="category-list">${state.vault.categories.map((category) => `<div class="category-row"><span><i class="category-dot"></i>${escapeHtml(category)}</span><button class="icon-button" data-action="delete-category" data-category="${escapeHtml(category)}" title="删除分类" aria-label="删除 ${escapeHtml(category)}">${icon('trash-2')}</button></div>`).join('')}</div><button class="secondary-button" data-action="add-category">${icon('plus')}新增分类</button></section>`;
}

function renderTrashSettings() {
  const entries = state.vault.trash.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  return `<section class="settings-panel ${state.settingPanel === 'trash' ? 'active' : ''}" data-panel="trash"><h2>回收站</h2><p class="panel-intro">删除的条目保留 30 天，之后会自动永久清除。</p><div class="setting-list">${entries.length ? entries.map((entry) => `<div class="setting-row"><div class="setting-copy"><strong>${escapeHtml(entry.title)}</strong><span>删除于 ${timeLabel(entry.deletedAt)}</span></div><div><button class="secondary-button" data-action="restore-entry" data-id="${entry.id}">恢复</button><button class="icon-button" data-action="purge-entry" data-id="${entry.id}" title="永久删除" aria-label="永久删除 ${escapeHtml(entry.title)}">${icon('trash-2')}</button></div></div>`).join('') : `<div class="empty-state">${icon('trash-2')}<div>回收站为空</div></div>`}</div></section>`;
}

function renderSettings() {
  return `<section class="view ${state.view === 'settings' ? 'active' : ''} ${state.settingsDetail ? 'settings-detail' : ''}" data-view="settings"><div class="settings-layout">${settingsNavigation()}<div>${renderSyncSettings()}${renderSecuritySettings()}${renderAppearanceSettings()}${renderCategoriesSettings()}${renderTrashSettings()}</div></div></section>`;
}

function modalTemplate() {
  if (!state.modal) return '';
  if (state.modal.type === 'category-filter') {
    const options = [['', '全部分类'], ...state.vault.categories.map((category) => [category, category])];
    return `<div class="modal-layer open" data-modal-layer><section class="modal"><header class="modal-head"><h2>分类筛选</h2><button class="icon-button" data-action="close-modal" title="关闭" aria-label="关闭">${icon('x')}</button></header><div class="modal-body"><div class="category-list">${options.map(([value, label]) => `<button class="category-row" data-action="select-category" data-category="${escapeHtml(value)}"><span><i class="category-dot"></i>${escapeHtml(label)}</span>${state.category === value ? icon('check') : ''}</button>`).join('')}</div></div></section></div>`;
  }
  if (state.modal.type === 'add' || state.modal.type === 'edit') {
    const entry = state.modal.entry || { title: '', username: '', password: '', category: state.vault.categories[0] || '', url: '', notes: '', favorite: false };
    const editing = state.modal.type === 'edit';
    return `<div class="modal-layer open form-open" data-modal-layer><form class="modal" data-form="${editing ? 'edit-entry' : 'add-entry'}"><header class="modal-head"><h2>${editing ? '编辑密码' : '新增密码'}</h2><button class="icon-button" type="button" data-action="close-modal" title="关闭" aria-label="关闭">${icon('x')}</button></header><div class="modal-body"><div class="form-grid"><label class="form-field">站点 / 应用<input class="field" name="title" value="${escapeHtml(entry.title)}" required /></label><label class="form-field">分类<select class="field" name="category">${state.vault.categories.map((category) => `<option ${entry.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></label><label class="form-field">账户名<input class="field" name="username" value="${escapeHtml(entry.username)}" required /></label><label class="form-field">密码<div class="password-field"><input class="field" name="password" type="password" value="${escapeHtml(entry.password)}" required /><button class="icon-button" type="button" data-action="toggle-password" title="显示密码" aria-label="显示密码">${icon('eye')}</button></div></label><label class="form-field full">网址<input class="field" name="url" type="url" value="${escapeHtml(entry.url || '')}" placeholder="https://example.com" /></label><label class="form-field full">备注<textarea class="field" name="notes" placeholder="可选备注">${escapeHtml(entry.notes || '')}</textarea></label><label class="form-field full"><span><input name="favorite" type="checkbox" ${entry.favorite ? 'checked' : ''} /> 收藏此条目</span></label></div></div><footer class="modal-foot"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">${icon('save')}保存</button></footer></form></div>`;
  }
  if (state.modal.type === 'detail') {
    const entry = state.vault.entries.find((item) => item.id === state.modal.id);
    if (!entry) return '';
    const password = state.modal.revealed ? escapeHtml(entry.password) : '••••••••••••••••';
    return `<div class="modal-layer open" data-modal-layer><section class="modal"><header class="modal-head"><h2>${escapeHtml(entry.title)}</h2><button class="icon-button" data-action="close-modal" title="关闭" aria-label="关闭">${icon('x')}</button></header><div class="modal-body"><dl><div class="detail-row"><dt>账户</dt><dd>${escapeHtml(entry.username)}</dd></div><div class="detail-row"><dt>网址</dt><dd>${escapeHtml(entry.url || '未设置')}</dd></div><div class="detail-row"><dt>分类</dt><dd>${escapeHtml(entry.category)}</dd></div><div class="detail-row"><dt>更新时间</dt><dd>${new Date(entry.updatedAt).toLocaleString('zh-CN')}</dd></div></dl><div class="secret"><span class="secret-value">${password}</span><button class="icon-button" data-action="reveal-password" title="${state.modal.revealed ? '隐藏密码' : '显示密码'}" aria-label="显示或隐藏密码">${icon(state.modal.revealed ? 'eye-off' : 'eye')}</button></div></div><footer class="modal-foot"><button class="secondary-button" data-action="delete-entry" data-id="${entry.id}">${icon('trash-2')}删除</button><button class="secondary-button" data-action="open-edit" data-id="${entry.id}">${icon('pencil')}编辑</button><button class="primary-button" data-action="copy-password" data-id="${entry.id}">${icon('copy')}复制密码</button></footer></section></div>`;
  }
  if (state.modal.type === 'sync') {
    const configured = syncConfigured();
    const firstConnection = !state.record.remoteSha;
    const disabled = state.syncing ? 'disabled' : '';
    const status = syncStatus();
    const note = firstConnection ? '已有保险库请选择“从远端导入”；空仓库请选择“初始化远端”。导入会替换本地条目，请先备份。' : '立即同步会合并不同条目的改动，同一条目冲突时保留本地数据并停止上传。“采用远端版本”会替换本地条目，请先导出备份。';
    return `<div class="modal-layer open" data-modal-layer><section class="modal"><header class="modal-head"><h2>同步详情</h2><button class="icon-button" data-action="close-modal" title="关闭" aria-label="关闭">${icon('x')}</button></header><div class="modal-body"><div class="sync-state" data-sync-status="${status.status}"><span data-sync-icon>${icon(status.icon)}</span><span data-sync-label>${escapeHtml(status.label)}</span></div><p class="panel-intro" data-sync-detail>${escapeHtml(status.detail)}</p>${configured ? `<div class="sync-actions"><button class="secondary-button" data-action="pull-remote" ${disabled}>${icon('download')}${firstConnection ? '从远端导入' : '采用远端版本'}</button><button class="primary-button" data-action="push-remote" ${disabled}>${icon('refresh-cw')}${firstConnection ? '初始化远端' : '立即同步'}</button></div><button class="secondary-button sync-backup" data-action="export-backup">${icon('download')}导出加密备份</button><p class="dialog-note">${note}</p>` : `<button class="primary-button" data-action="open-sync-config">配置私有仓库</button>`}</div></section></div>`;
  }
  if (state.modal.type === 'sync-result') {
    return `<div class="modal-layer open" data-modal-layer><section class="modal" role="alertdialog" aria-labelledby="sync-result-title"><header class="modal-head"><h2 id="sync-result-title">${escapeHtml(state.modal.title)}</h2><button class="icon-button" data-action="close-modal" title="关闭" aria-label="关闭">${icon('x')}</button></header><div class="modal-body"><div class="sync-result">${icon('circle-alert')}<span>${escapeHtml(state.modal.message)}</span></div></div><footer class="modal-foot"><button class="primary-button" data-action="close-modal">知道了</button></footer></section></div>`;
  }
  if (state.modal.type === 'remote-unlock') {
    return `<div class="modal-layer open form-open" data-modal-layer><form class="modal" data-form="remote-unlock"><header class="modal-head"><h2>首次导入保险库</h2><button class="icon-button" type="button" data-action="close-modal" title="取消" aria-label="取消">${icon('x')}</button></header><div class="modal-body"><div class="form-stack"><p class="panel-intro">此设备尚未绑定远端保险库。输入远端主密码一次即可完成导入；以后拉取和推送将保持解锁，无需再次验证。</p><label class="form-field">远端主密码<div class="password-field"><input class="field" name="password" type="password" autocomplete="current-password" required autofocus /><button class="icon-button" type="button" data-action="toggle-password" title="显示密码" aria-label="显示密码">${icon('eye')}</button></div></label></div></div><footer class="modal-foot"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">导入并保持解锁</button></footer></form></div>`;
  }
  if (state.modal.type === 'sync-config') {
    const sync = state.vault.sync;
    return `<div class="modal-layer open form-open" data-modal-layer><form class="modal" data-form="sync-config"><header class="modal-head"><h2>私有仓库</h2><button class="icon-button" type="button" data-action="close-modal" title="关闭" aria-label="关闭">${icon('x')}</button></header><div class="modal-body"><div class="form-grid"><label class="form-field">所有者<input class="field" name="owner" value="${escapeHtml(sync.owner)}" placeholder="GitHub 用户或组织" required /></label><label class="form-field">仓库名<input class="field" name="repo" value="${escapeHtml(sync.repo)}" placeholder="passwmana-vault" required /></label><label class="form-field">分支<input class="field" name="branch" value="${escapeHtml(sync.branch || 'main')}" required /></label><label class="form-field">密文文件路径<input class="field" name="path" value="${escapeHtml(sync.path || 'passwmana.vault')}" required /></label><label class="form-field full">Fine-grained PAT<div class="password-field"><input class="field" name="token" type="password" value="${escapeHtml(sync.token)}" autocomplete="off" required /><button class="icon-button" type="button" data-action="toggle-password" title="显示令牌" aria-label="显示令牌">${icon('eye')}</button></div><span class="form-help">只授予该私有仓库 Contents 读写权限。令牌与保险库一起加密保存。</span></label></div></div><footer class="modal-foot"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">${icon('save')}保存配置</button></footer></form></div>`;
  }
  if (state.modal.type === 'change-password') {
    return `<div class="modal-layer open form-open" data-modal-layer><form class="modal" data-form="change-password"><header class="modal-head"><h2>修改主密码</h2><button class="icon-button" type="button" data-action="close-modal" title="关闭" aria-label="关闭">${icon('x')}</button></header><div class="modal-body"><div class="form-stack"><label class="form-field">当前主密码<input class="field" name="currentPassword" type="password" required /></label><label class="form-field">新主密码<input class="field" name="newPassword" type="password" minlength="12" required /></label><label class="form-field">确认新主密码<input class="field" name="confirmPassword" type="password" minlength="12" required /></label></div></div><footer class="modal-foot"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存新密码</button></footer></form></div>`;
  }
  if (state.modal.type === 'recovery-reset') {
    return `<div class="modal-layer open form-open" data-modal-layer><form class="modal" data-form="recovery-reset"><header class="modal-head"><h2>使用恢复密钥</h2><button class="icon-button" type="button" data-action="close-modal" title="关闭" aria-label="关闭">${icon('x')}</button></header><div class="modal-body"><div class="form-stack"><label class="form-field">恢复密钥<input class="field" name="recoveryCode" autocomplete="off" required /></label><label class="form-field">新主密码<input class="field" name="newPassword" type="password" minlength="12" required /></label><label class="form-field">确认新主密码<input class="field" name="confirmPassword" type="password" minlength="12" required /></label></div></div><footer class="modal-foot"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">重设主密码</button></footer></form></div>`;
  }
  return '';
}

function renderApp() {
  const title = state.view === 'vault' ? '密码库' : state.settingsDetail ? settingLabels[state.settingPanel] : '设置';
  const nav = `<nav class="main-nav"><button class="nav-link ${state.view === 'vault' ? 'active' : ''}" data-action="view" data-view-name="vault">${icon('vault')}密码库</button><button class="nav-link ${state.view === 'settings' ? 'active' : ''}" data-action="view" data-view-name="settings">${icon('settings-2')}设置</button></nav>`;
  app.innerHTML = `<div class="app-shell"><aside class="side-nav"><div class="brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div>${nav}<div class="nav-footer"><span class="avatar">PM</span><div><strong>本地保险库</strong><span>已解锁</span></div></div></aside><main class="content"><header class="mobile-header"><button class="icon-button" id="mobile-left" data-action="mobile-left" title="打开导航" aria-label="打开导航">${icon(state.settingsDetail ? 'arrow-left' : 'menu')}</button><div class="mobile-title">${title}</div><button class="icon-button" data-action="open-sync" title="打开同步" aria-label="打开同步">${icon('refresh-cw')}</button></header><header class="topbar"><h1>${title}</h1><div class="topbar-actions"><button class="icon-button" data-action="lock" title="立即锁定" aria-label="立即锁定">${icon('lock-keyhole')}</button><button class="sync-button" data-action="open-sync" data-sync-status="${syncStatus().status}"><span class="sync-dot"></span><span data-sync-label>${escapeHtml(syncStatus().label)}</span>${icon('refresh-cw')}</button></div></header><div class="page">${renderVault()}${renderSettings()}</div><button class="mobile-fab" data-action="open-add" title="新增密码" aria-label="新增密码">${icon('plus')}</button></main></div><div class="scrim ${state.drawerOpen ? 'open' : ''}" data-action="close-drawer"></div><aside class="drawer ${state.drawerOpen ? 'open' : ''}"><div class="brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div>${nav}<div class="nav-footer"><span class="avatar">PM</span><div><strong>本地保险库</strong><span>已解锁</span></div></div></aside>${modalTemplate()}<div class="toast-wrap" id="toast-wrap"></div>`;
  queueMicrotask(drawIcons);
}

function drawIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
}

function render() {
  if (state.modal?.type === 'recovery-created') {
    app.innerHTML = renderRecovery(state.modal.code);
  } else if (!state.record) {
    app.innerHTML = renderSetup();
  } else if (!state.vaultKey) {
    app.innerHTML = renderUnlock();
  } else {
    renderApp();
  }
  queueMicrotask(drawIcons);
}

function toast(message) {
  let container = document.getElementById('toast-wrap');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-wrap';
    container.id = 'toast-wrap';
    app.append(container);
  }
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  container.append(node);
  setTimeout(() => node.remove(), 2600);
}

async function copyText(value, message = '已复制') {
  await navigator.clipboard.writeText(value);
  toast(message);
  setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000);
}

async function downloadBackup() {
  await storageQueue;
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), record: state.record }, null, 2);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  link.download = `passwmana-${new Date().toISOString().slice(0, 10)}.passwmana`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
  toast('已导出加密备份');
}

async function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.passwmana,.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const record = data.record || data;
      if (record.format !== 'passwmana-v1' || !record.encryptedVault || !record.wrappedVaultKey) throw new Error('格式不正确');
      if (!confirm('恢复会覆盖此设备的本地保险库。是否继续？')) return;
      stopSyncSession();
      delete record.syncBase;
      delete record.lastSyncedAt;
      record.remoteSha = null;
      record.dirty = true;
      await queueStorage(() => dbPut(record));
      state.record = record;
      state.vault = null;
      state.vaultKey = null;
      state.rawVaultKey = null;
      state.pendingRemote = null;
      state.localSaveError = null;
      releaseVaultLock();
      state.modal = null;
      render();
      toast('备份已恢复，请解锁');
    } catch (error) { toast(`恢复失败: ${error.message}`); }
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

function comparable(value) {
    if (Array.isArray(value)) return value.map(comparable);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().filter((key) => key !== 'updatedAt')
            .map((key) => [key, comparable(value[key])]));
    }
    return value;
}

function sameValue(left, right) {
    return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function mergeValue(base, local, remote) {
    if (sameValue(local, remote) || sameValue(remote, base)) return local;
    if (sameValue(local, base)) return remote;
    throw syncError('两台设备修改了同一条目或设置。已保留本地改动，请导出备份后处理冲突。', 'conflict');
}

function vaultItems(vault) {
    return new Map([
        ...vault.entries.map((entry) => [entry.id, { location: 'entries', entry }]),
        ...vault.trash.map((entry) => [entry.id, { location: 'trash', entry }]),
    ]);
}

function mergeVaults(base, local, remote) {
    const baseItems = vaultItems(base);
    const localItems = vaultItems(local);
    const remoteItems = vaultItems(remote);
    const merged = { ...local, entries: [], trash: [], categories: [], preferences: {} };
    for (const id of new Set([...localItems.keys(), ...remoteItems.keys(), ...baseItems.keys()])) {
        const item = mergeValue(baseItems.get(id), localItems.get(id), remoteItems.get(id));
        if (item) merged[item.location].push(structuredClone(item.entry));
    }
    for (const category of new Set([...local.categories, ...remote.categories, ...base.categories])) {
        if (mergeValue(base.categories.includes(category), local.categories.includes(category), remote.categories.includes(category))) {
            merged.categories.push(category);
        }
    }
    for (const entry of [...merged.entries, ...merged.trash]) {
        if (entry.category && !merged.categories.includes(entry.category)) merged.categories.push(entry.category);
    }
    for (const key of new Set([...Object.keys(base.preferences || {}), ...Object.keys(local.preferences || {}), ...Object.keys(remote.preferences || {})])) {
        const value = mergeValue(base.preferences?.[key], local.preferences?.[key], remote.preferences?.[key]);
        if (value !== undefined) merged.preferences[key] = value;
    }
    return merged;
}

function validateVault(vault) {
    if (!vault || !Array.isArray(vault.entries) || !Array.isArray(vault.trash)
        || !Array.isArray(vault.categories) || !vault.categories.every((category) => typeof category === 'string')
        || !vault.preferences || typeof vault.preferences !== 'object' || Array.isArray(vault.preferences)
        || (vault.preferences.lockMinutes !== undefined && (!Number.isFinite(Number(vault.preferences.lockMinutes)) || Number(vault.preferences.lockMinutes) < 0))) {
        throw syncError('远端保险库结构不正确，已保留本地数据', 'format');
    }
    const ids = new Set();
    for (const entry of [...vault.entries, ...vault.trash]) {
        if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)
            || typeof entry.title !== 'string' || typeof entry.password !== 'string') {
            throw syncError('远端条目格式不正确，已保留本地数据', 'format');
        }
        ids.add(entry.id);
    }
    return vault;
}

function decodeRemote(remote) {
    try {
        if (!remote.sha || typeof remote.content !== 'string') throw new Error();
        const payload = JSON.parse(new TextDecoder().decode(base64ToBytes(remote.content.replace(/\s/g, ''))));
        if (payload.format !== 'passwmana-v1' || !payload.encryptedVault?.iv || !payload.encryptedVault?.data
            || !payload.wrappedVaultKey || !payload.masterSalt || !payload.recoveryWrappedVaultKey || !payload.recoverySalt) throw new Error();
        return payload;
    } catch {
        throw syncError('远端文件格式不正确，已保留本地数据', 'format');
    }
}

function remoteRecord(record) {
    // Device sync bookkeeping and the encrypted merge base never travel to GitHub.
    const { remoteSha, syncBase, dirty, lastSyncedAt, ...payload } = record;
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

async function applyRemoteVault(vault, payload, sha, dirty, revision, session) {
    await queueStorage(async () => {
        assertSyncSession(session);
        localRevisionChanged(revision);
        assertLocalSaved();
        const encryptedVault = await encryptText(JSON.stringify(vault), state.vaultKey);
        assertSyncSession(session);
        localRevisionChanged(revision);
        state.vault = vault;
        state.vaultRevision += 1;
        Object.assign(state.record, { encryptedVault, remoteSha: sha, syncBase: payload.encryptedVault, dirty, updatedAt: new Date().toISOString() });
        await dbPut(state.record);
    });
    assertSyncSession(session);
    resetLockTimer({ activity: false });
    refreshVaultViews();
}

async function synchronizeOnce(sync, mode, session) {
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
        if (mode === 'pull' || remote.sha !== state.record.remoteSha) {
            let remoteVault;
            try {
                remoteVault = JSON.parse(await decryptText(payload.encryptedVault, state.vaultKey));
            } catch {
                assertSyncSession(session);
                localRevisionChanged(revision);
                if (mode === 'pull' && !state.record.remoteSha) {
                    state.pendingRemote = { payload: { ...remoteRecord(payload), remoteSha: remote.sha, syncBase: payload.encryptedVault, dirty: false }, sync, revision };
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
            if (dirty) {
                if (!state.record.syncBase) throw syncError('旧版同步尚无合并基线，两端都有改动。请先导出备份，再处理冲突。', 'conflict');
                let base;
                try { base = validateVault(JSON.parse(await decryptText(state.record.syncBase, state.vaultKey))); }
                catch { throw syncError('无法读取同步基线，已保留本地改动，请先导出备份', 'conflict'); }
                assertSyncSession(session);
                localRevisionChanged(revision);
                merged = mergeVaults(base, state.vault, remoteVault);
            }
            await applyRemoteVault(merged, payload, remote.sha, dirty, revision, session);
        } else if (!state.record.syncBase) {
            await queueStorage(async () => {
                assertSyncSession(session);
                state.record.syncBase = payload.encryptedVault;
                await dbPut(state.record);
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
        state.record.dirty = state.vaultRevision !== uploadedRevision;
        await dbPut(state.record);
    });
}

async function synchronize({ automatic = false, mode = 'sync' } = {}) {
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
            await withSyncRetry(() => synchronizeOnce(sync, mode, session), session);
            assertSyncSession(session);
            if (state.pendingRemote) return;
            await queueStorage(async () => {
                assertSyncSession(session);
                state.record.lastSyncedAt = new Date().toISOString();
                await dbPut(state.record);
            });
            state.syncLastError = null;
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
        delete state.record.lastSyncedAt;
      }
      await persistVault();
      state.modal = null;
      render();
      startSyncSession();
      toast('私有仓库配置已加密保存');
      return;
    }
    if (form.dataset.form === 'change-password') {
      const session = state.session;
      const record = state.record;
      const rawVaultKey = state.rawVaultKey;
      if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('两次新密码不一致');
      const currentKey = await deriveKey(values.get('currentPassword'), state.record.masterSalt);
      await decryptText(state.record.wrappedVaultKey, currentKey);
      const newSalt = randomBase64(16);
      const newKey = await deriveKey(values.get('newPassword'), newSalt);
      const wrappedVaultKey = await encryptText(rawVaultKey, newKey);
      assertSyncSession(session);
      if (record !== state.record) return;
      state.record.masterSalt = newSalt;
      state.record.wrappedVaultKey = wrappedVaultKey;
      await persistVault();
      state.modal = null;
      render();
      toast('主密码已更新');
      return;
    }
    if (form.dataset.form === 'recovery-reset') {
      await storageQueue;
      const session = state.session;
      const record = state.record;
      if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('两次新密码不一致');
      const recoveryKey = await deriveKey(values.get('recoveryCode').trim(), state.record.recoverySalt);
      const rawVaultKey = await decryptText(state.record.recoveryWrappedVaultKey, recoveryKey);
      const masterSalt = randomBase64(16);
      const masterKey = await deriveKey(values.get('newPassword'), masterSalt);
      const wrappedVaultKey = await encryptText(rawVaultKey, masterKey);
      if (session !== state.session || record !== state.record) return;
      state.record.masterSalt = masterSalt;
      state.record.wrappedVaultKey = wrappedVaultKey;
      state.record.updatedAt = new Date().toISOString();
      state.record.dirty = true;
      await queueStorage(() => dbPut(state.record));
      state.modal = null;
      render();
      toast('主密码已重设');
    }
  } catch (error) {
    if (!state.vaultKey) releaseVaultLock();
    const friendlyError = form.dataset.form === 'unlock' && error.name === 'OperationError'
      ? '主密码错误，无法解锁保险库'
      : form.dataset.form === 'recovery-reset'
        ? '恢复密钥无效，无法重设主密码'
        : form.dataset.form === 'remote-unlock'
          ? '远端主密码错误，无法完成拉取'
        : (error.message || '操作失败');
    toast(friendlyError);
  } finally {
    delete form.dataset.submitting;
    if (submitButton) submitButton.disabled = false;
  }
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
  if (action === 'toggle-password') {
    const input = control.closest('.password-field').querySelector('input');
    input.type = input.type === 'password' ? 'text' : 'password';
    return;
  }
  if (action === 'copy-recovery') { await copyText(control.dataset.code, '恢复密钥已复制'); return; }
  if (action === 'finish-setup') { state.modal = null; render(); resetLockTimer(); startSyncSession(); return; }
  if (action === 'open-recovery-reset') { state.modal = { type: 'recovery-reset' }; render(); return; }
  if (action === 'view') { state.view = control.dataset.viewName; state.settingsDetail = false; state.drawerOpen = false; render(); return; }
  if (action === 'mobile-left') { if (state.settingsDetail) { state.settingsDetail = false; render(); } else { state.drawerOpen = true; render(); } return; }
  if (action === 'close-drawer') { state.drawerOpen = false; render(); return; }
  if (action === 'setting-panel') { state.settingPanel = control.dataset.panel; if (window.matchMedia('(max-width: 899px)').matches) state.settingsDetail = true; render(); return; }
  if (action === 'set-mode') { document.documentElement.dataset.mode = control.dataset.mode; localStorage.setItem('passwmana-mode', control.dataset.mode); render(); return; }
  if (action === 'set-accent') { document.documentElement.dataset.accent = control.dataset.accent; localStorage.setItem('passwmana-accent', control.dataset.accent); document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(); render(); return; }
  if (action === 'toggle-favorite-filter') { state.favoriteOnly = !state.favoriteOnly; control.classList.toggle('active', state.favoriteOnly); updateVaultList(); return; }
  if (action === 'open-category-filter') { state.modal = { type: 'category-filter' }; render(); return; }
  if (action === 'select-category') { state.category = control.dataset.category; state.modal = null; render(); return; }
  if (action === 'open-add') { state.modal = { type: 'add' }; render(); return; }
  if (action === 'open-detail') { state.modal = { type: 'detail', id: control.dataset.id, revealed: false }; render(); return; }
  if (action === 'close-modal') { if (state.modal?.type === 'remote-unlock') state.pendingRemote = null; state.modal = null; render(); return; }
  if (action === 'reveal-password') { state.modal.revealed = !state.modal.revealed; render(); return; }
  if (action === 'copy-password') { const entry = state.vault.entries.find((item) => item.id === control.dataset.id); await copyText(entry.password, '密码已复制，30 秒后清空剪贴板'); return; }
  if (action === 'open-edit') { const entry = state.vault.entries.find((item) => item.id === control.dataset.id); state.modal = { type: 'edit', entry }; render(); return; }
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
app.addEventListener('input', (event) => { if (event.target.dataset.input === 'search') { state.search = event.target.value; updateVaultList(); } resetLockTimer(); });
app.addEventListener('change', async (event) => {
  if (event.target.dataset.input === 'category') { state.category = event.target.value; updateVaultList(); }
  if (event.target.dataset.input === 'lock-minutes') { state.vault.preferences.lockMinutes = Number(event.target.value); await persistVault(); resetLockTimer(); toast('自动锁定设置已保存'); }
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

bootstrap().catch((error) => { app.textContent = `无法初始化保险库: ${error.message}`; });
