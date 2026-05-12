// API client — replaces sql.js with REST calls to Express backend
const BASE = '/api';

async function request(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || '请求失败');
  }
  return res.json();
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);
const put = (path, body) => request('PUT', path, body);
const del = (path) => request('DELETE', path);

// ===== Users =====
export async function userExists(username) {
  const data = await get(`/users/${encodeURIComponent(username)}/exists`);
  return data.exists;
}
export async function saveUser(user) {
  await post('/users', {
    username: user.username,
    passwordHash: user.passwordHash,
    passwordHint: user.passwordHint,
    recoveryCodeEncrypted: user.recoveryCodeEncrypted || '',
    recoveryCodeStored: user.recoveryCodeStored || '',
    unlockPINHash: user.unlockPINHash || '',
    idCard: user.idCard || '',
    phone: user.phone || '',
    nickname: user.nickname || '',
    birthday: user.birthday || '',
    createdAt: user.createdAt,
  });
}
export async function getUser(username) {
  return get(`/users/${encodeURIComponent(username)}`);
}
export async function updateUser(username, updates) {
  await put(`/users/${encodeURIComponent(username)}`, updates);
}

// ===== Vault =====
export async function getVaultEntries(username) {
  return get(`/vault/${encodeURIComponent(username)}`);
}
export async function saveVaultEntry(username, entry) {
  await post(`/vault/${encodeURIComponent(username)}`, entry);
}
export async function deleteVaultEntry(id, username) {
  await del(`/vault/${encodeURIComponent(username)}/${encodeURIComponent(id)}`);
}

// ===== Custom Types =====
export async function getCustomTypes(username) {
  return get(`/types/${encodeURIComponent(username)}`);
}
export async function addCustomType(username, typeName) {
  await post(`/types/${encodeURIComponent(username)}`, { typeName });
}
export async function removeCustomType(username, typeName) {
  await del(`/types/${encodeURIComponent(username)}/${encodeURIComponent(typeName)}`);
}

// ===== Sessions =====
export async function saveSession(username, encryptedPassword) {
  await post('/sessions', { username, encryptedPassword });
}
export async function getSession(username) {
  return get(`/sessions/${encodeURIComponent(username)}`);
}
export async function getLatestSession() {
  return get('/sessions');
}
export async function deleteSession(username) {
  await del(`/sessions/${encodeURIComponent(username)}`);
}

// ===== Remembered Accounts =====
export async function getRememberedAccounts() {
  return get('/remembered');
}
export async function saveRememberedAccount(account) {
  await post('/remembered', account);
}
export async function deleteRememberedAccount(username) {
  await del(`/remembered/${encodeURIComponent(username)}`);
}

// ===== Device Token =====
export async function getDeviceToken() {
  const data = await get('/device-token');
  return data.token;
}
export async function setDeviceToken(token) {
  await post('/device-token', { token });
}

// ===== Raw DB Export =====
export async function exportRawDatabase() {
  window.open(BASE + '/db/export', '_blank');
}
