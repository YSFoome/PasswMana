const DB_NAME = 'passwmana';
const STORE_NAME = 'vault';
const RECORD_KEY = 'primary';
const PBKDF2_ITERATIONS = 600000;
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
  drawerOpen: false,
  timer: null,
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
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record, RECORD_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
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
    sync: { owner: '', repo: '', branch: 'main', path: 'passwmana.vault', token: '' },
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
  state.record.encryptedVault = await encryptText(JSON.stringify(state.vault), state.vaultKey);
  state.record.updatedAt = new Date().toISOString();
  state.record.dirty = dirty;
  await dbPut(state.record);
}

function resetLockTimer() {
  if (!state.vaultKey) return;
  clearTimeout(state.timer);
  const minutes = Number(state.vault.preferences?.lockMinutes ?? 5);
  if (minutes > 0) state.timer = setTimeout(lockVault, minutes * 60 * 1000);
}

function lockVault() {
  clearTimeout(state.timer);
  state.vaultKey = null;
  state.rawVaultKey = null;
  state.vault = null;
  state.modal = null;
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

function renderVault() {
  return `<section class="view ${state.view === 'vault' ? 'active' : ''}" data-view="vault"><div class="notice"><div class="notice-copy">${icon(state.record.dirty ? 'cloud-off' : 'cloud-check')}<span>${state.record.dirty ? '本地改动尚未同步到私有仓库' : '本地保险库已与私有仓库同步'}</span></div><button class="secondary-button" data-action="open-sync">${icon('refresh-cw')}手动同步</button></div><div class="toolbar"><div class="search">${icon('search')}<input class="field" type="search" data-input="search" placeholder="搜索站点、账户或分类" value="${escapeHtml(state.search)}" aria-label="搜索密码库" /></div><select class="field filter" data-input="category" aria-label="按分类筛选"><option value="">全部分类</option>${state.vault.categories.map((category) => `<option value="${escapeHtml(category)}" ${state.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select><button class="secondary-button filter-favorite ${state.favoriteOnly ? 'active' : ''}" data-action="toggle-favorite-filter" title="仅看收藏" aria-label="仅看收藏">${icon('star')}</button><button class="secondary-button mobile-filter" data-action="open-category-filter" title="分类筛选" aria-label="分类筛选">${icon('tags')}</button><button class="primary-button" data-action="open-add">${icon('plus')}<span>新增密码</span></button></div><div class="vault-list" data-vault-list>${vaultListTemplate()}</div></section>`;
}

const settingLabels = { sync: '同步与备份', security: '安全', appearance: 'Appearance', categories: '分类', trash: '回收站' };

function settingsNavigation() {
  return `<nav class="settings-nav" aria-label="设置分类">${Object.entries(settingLabels).map(([key, label]) => `<button class="${state.settingPanel === key ? 'active' : ''}" data-action="setting-panel" data-panel="${key}">${icon({ sync: 'refresh-cw', security: 'shield-check', appearance: 'paintbrush', categories: 'tags', trash: 'trash-2' }[key])}${label}</button>`).join('')}</nav>`;
}

function renderSyncSettings() {
  const sync = state.vault.sync;
  const repo = sync.owner && sync.repo ? `${sync.owner} / ${sync.repo}` : '尚未配置私有仓库';
  return `<section class="settings-panel ${state.settingPanel === 'sync' ? 'active' : ''}" data-panel="sync"><h2>同步与备份</h2><p class="panel-intro">保险库始终以加密形式保存。同步仅在你主动操作时进行。</p><div class="setting-list"><div class="setting-row"><div class="setting-copy"><strong>私有仓库</strong><span>${escapeHtml(repo)}</span></div><button class="secondary-button" data-action="open-sync-config">配置</button></div><div class="setting-row"><div class="setting-copy"><strong>最近同步</strong><span>${state.record.remoteSha ? `已连接，${state.record.dirty ? '有本地改动' : '没有待同步改动'}` : '尚未连接远端'}</span></div><button class="secondary-button" data-action="open-sync">同步</button></div><div class="setting-row"><div class="setting-copy"><strong>加密备份</strong><span>导出当前保险库为 .passwmana 文件</span></div><button class="secondary-button" data-action="export-backup">${icon('download')}导出</button></div><div class="setting-row"><div class="setting-copy"><strong>恢复加密备份</strong><span>使用 .passwmana 文件替换本机保险库</span></div><button class="secondary-button" data-action="import-backup">${icon('upload')}恢复</button></div><div class="setting-row"><div class="setting-copy"><strong>迁移旧版备份</strong><span>从旧版明文 JSON 合并条目与分类</span></div><button class="secondary-button" data-action="import-legacy">${icon('file-input')}迁移</button></div></div></section>`;
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
    const configured = state.vault.sync.owner && state.vault.sync.repo && state.vault.sync.token;
    return `<div class="modal-layer open" data-modal-layer><section class="modal"><header class="modal-head"><h2>手动同步</h2><button class="icon-button" data-action="close-modal" title="关闭" aria-label="关闭">${icon('x')}</button></header><div class="modal-body"><div class="sync-state">${icon(state.record.dirty ? 'cloud-off' : 'cloud-check')}<span>${state.record.dirty ? '本地有待同步改动' : '没有待同步改动'}</span></div><p class="panel-intro">同步内容始终以加密形式保存到私有仓库。</p>${configured ? `<div class="sync-actions"><button class="secondary-button" data-action="pull-remote">${icon('download')}从远端拉取</button><button class="primary-button" data-action="push-remote">${icon('upload')}推送本地改动</button></div><p class="dialog-note">发现两端版本不同，拉取将以远端版本覆盖此设备。推送会先检查远端版本以避免覆盖。</p>` : `<button class="primary-button" data-action="open-sync-config">配置私有仓库</button>`}</div></section></div>`;
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
  app.innerHTML = `<div class="app-shell"><aside class="side-nav"><div class="brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div>${nav}<div class="nav-footer"><span class="avatar">PM</span><div><strong>本地保险库</strong><span>已解锁</span></div></div></aside><main class="content"><header class="mobile-header"><button class="icon-button" id="mobile-left" data-action="mobile-left" title="打开导航" aria-label="打开导航">${icon(state.settingsDetail ? 'arrow-left' : 'menu')}</button><div class="mobile-title">${title}</div><button class="icon-button" data-action="open-sync" title="打开同步" aria-label="打开同步">${icon('refresh-cw')}</button></header><header class="topbar"><h1>${title}</h1><div class="topbar-actions"><button class="icon-button" data-action="lock" title="立即锁定" aria-label="立即锁定">${icon('lock-keyhole')}</button><button class="sync-button" data-action="open-sync"><span class="sync-dot"></span><span>${state.record.dirty ? '有本地改动' : '已同步'}</span>${icon('refresh-cw')}</button></div></header><div class="page">${renderVault()}${renderSettings()}</div><button class="mobile-fab" data-action="open-add" title="新增密码" aria-label="新增密码">${icon('plus')}</button></main></div><div class="scrim ${state.drawerOpen ? 'open' : ''}" data-action="close-drawer"></div><aside class="drawer ${state.drawerOpen ? 'open' : ''}"><div class="brand"><span class="brand-mark">${icon('shield-check')}</span>PasswMana</div>${nav}<div class="nav-footer"><span class="avatar">PM</span><div><strong>本地保险库</strong><span>已解锁</span></div></div></aside>${modalTemplate()}<div class="toast-wrap" id="toast-wrap"></div>`;
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
    resetLockTimer();
  }
  queueMicrotask(drawIcons);
}

function toast(message) {
  const container = document.getElementById('toast-wrap');
  if (!container) return;
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
      await dbPut(record);
      state.record = record;
      state.vault = null;
      state.vaultKey = null;
      state.rawVaultKey = null;
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
      const confirmed = confirm('旧版 JSON 包含明文密码。文件只会在当前浏览器内读取并立即加密，不会上传。确认迁移并合并到当前保险库？');
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

async function remoteRequest(method, sync, body) {
  const encodedPath = sync.path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${encodeURIComponent(sync.owner)}/${encodeURIComponent(sync.repo)}/contents/${encodedPath}${method === 'GET' ? `?ref=${encodeURIComponent(sync.branch)}` : ''}`;
  const response = await fetch(url, { method, headers: { ...githubHeaders(sync.token), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
  return response.json();
}

async function pullRemote() {
  const sync = state.vault.sync;
  if (!confirm('将以远端版本更新此设备的密码条目。此设备的解锁密钥和同步配置会保留。是否继续？')) return;
  try {
    const remote = await remoteRequest('GET', sync);
    if (!remote) throw new Error('远端尚未找到保险库文件');
    const payload = JSON.parse(new TextDecoder().decode(base64ToBytes(remote.content.replace(/\n/g, ''))));
    if (payload.format !== 'passwmana-v1') throw new Error('远端文件格式不正确');

    // A usual pull is another revision of this vault, so keep device-local key wrappers and sync credentials.
    let remoteVault;
    try {
      remoteVault = JSON.parse(await decryptText(payload.encryptedVault, state.vaultKey));
    } catch {
      payload.remoteSha = remote.sha;
      payload.dirty = false;
      await dbPut(payload);
      state.record = payload;
      state.vaultKey = null;
      state.rawVaultKey = null;
      state.vault = null;
      state.modal = null;
      render();
      toast('远端保险库使用不同密钥，已拉取，请使用远端主密码解锁');
      return;
    }

    remoteVault.sync = sync;
    state.vault = remoteVault;
    state.record.remoteSha = remote.sha;
    await persistVault({ dirty: false });
    state.modal = null;
    render();
    toast('已拉取远端保险库，保持解锁');
  } catch (error) { toast(`拉取失败: ${error.message}`); }
}

async function pushRemote() {
  const sync = state.vault.sync;
  try {
    const remote = await remoteRequest('GET', sync);
    if (remote && state.record.remoteSha && remote.sha !== state.record.remoteSha) throw new Error('远端版本已变化，请先拉取');
    const record = { ...state.record, remoteSha: undefined, dirty: false };
    const content = bytesToBase64(new TextEncoder().encode(JSON.stringify(record)));
    const result = await remoteRequest('PUT', sync, { message: 'Update encrypted PasswMana vault', content, branch: sync.branch, ...(remote ? { sha: remote.sha } : {}) });
    state.record.remoteSha = result.content.sha;
    state.record.dirty = false;
    await dbPut(state.record);
    state.modal = null;
    render();
    toast('已推送加密保险库');
  } catch (error) { toast(`推送失败: ${error.message}`); }
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const values = new FormData(form);
  try {
    if (form.dataset.form === 'setup') {
      const password = values.get('password');
      if (password !== values.get('confirmPassword')) throw new Error('两次主密码不一致');
      const recoveryCode = formatRecoveryCode();
      const created = await createVault(password, recoveryCode);
      state.record = created.record;
      state.vaultKey = created.vaultKey;
      state.rawVaultKey = created.rawVaultKey;
      state.vault = created.vault;
      await dbPut(state.record);
      state.modal = { type: 'recovery-created', code: recoveryCode };
      render();
      return;
    }
    if (form.dataset.form === 'unlock') {
      const unlocked = await unlockWithMaster(state.record, values.get('password'));
      state.vaultKey = unlocked.vaultKey;
      state.rawVaultKey = unlocked.rawVaultKey;
      state.vault = unlocked.vault;
      pruneTrash();
      render();
      return;
    }
    if (form.dataset.form === 'add-entry' || form.dataset.form === 'edit-entry') {
      const now = new Date().toISOString();
      const entry = { title: values.get('title').trim(), username: values.get('username').trim(), password: values.get('password'), category: values.get('category'), url: values.get('url').trim(), notes: values.get('notes').trim(), favorite: values.get('favorite') === 'on', updatedAt: now };
      if (!entry.title || !entry.username || !entry.password) throw new Error('请填写站点、账户和密码');
      if (form.dataset.form === 'edit-entry') {
        const index = state.vault.entries.findIndex((item) => item.id === state.modal.entry.id);
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
      state.vault.sync = { owner: values.get('owner').trim(), repo: values.get('repo').trim(), branch: values.get('branch').trim(), path: values.get('path').trim(), token: values.get('token').trim() };
      await persistVault();
      state.modal = null;
      render();
      toast('私有仓库配置已加密保存');
      return;
    }
    if (form.dataset.form === 'change-password') {
      if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('两次新密码不一致');
      const currentKey = await deriveKey(values.get('currentPassword'), state.record.masterSalt);
      await decryptText(state.record.wrappedVaultKey, currentKey);
      const newSalt = randomBase64(16);
      const newKey = await deriveKey(values.get('newPassword'), newSalt);
      state.record.masterSalt = newSalt;
      state.record.wrappedVaultKey = await encryptText(state.rawVaultKey, newKey);
      await persistVault();
      state.modal = null;
      render();
      toast('主密码已更新');
      return;
    }
    if (form.dataset.form === 'recovery-reset') {
      if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('两次新密码不一致');
      const recoveryKey = await deriveKey(values.get('recoveryCode').trim(), state.record.recoverySalt);
      const rawVaultKey = await decryptText(state.record.recoveryWrappedVaultKey, recoveryKey);
      const masterSalt = randomBase64(16);
      const masterKey = await deriveKey(values.get('newPassword'), masterSalt);
      state.record.masterSalt = masterSalt;
      state.record.wrappedVaultKey = await encryptText(rawVaultKey, masterKey);
      state.record.updatedAt = new Date().toISOString();
      await dbPut(state.record);
      state.modal = null;
      render();
      toast('主密码已重设');
    }
  } catch (error) {
    const friendlyError = form.dataset.form === 'unlock'
      ? '主密码错误，无法解锁保险库'
      : form.dataset.form === 'recovery-reset'
        ? '恢复密钥无效，无法重设主密码'
        : (error.message || '操作失败');
    toast(friendlyError);
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
  if (action === 'finish-setup') { state.modal = null; render(); return; }
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
  if (action === 'close-modal') { state.modal = null; render(); return; }
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
window.addEventListener('resize', () => { if (!window.matchMedia('(max-width: 899px)').matches && state.settingsDetail) { state.settingsDetail = false; render(); } });

async function bootstrap() {
  document.documentElement.dataset.mode = localStorage.getItem('passwmana-mode') || 'system';
  document.documentElement.dataset.accent = localStorage.getItem('passwmana-accent') || 'emerald';
  state.record = await dbGet();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

bootstrap().catch((error) => { app.textContent = `无法初始化保险库: ${error.message}`; });
