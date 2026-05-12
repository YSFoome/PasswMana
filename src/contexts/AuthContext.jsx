import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { sha256, deriveKey, encrypt, decrypt, generateRecoveryCode, hex } from '../utils/crypto';
import * as db from '../api/client';

const AuthContext = createContext(null);

// Get or create device token for session persistence
async function getOrCreateDeviceToken() {
  let token = await db.getDeviceToken();
  if (!token) { token = hex(crypto.getRandomValues(new Uint8Array(16))); await db.setDeviceToken(token); }
  return token;
}

async function persistSession(username, password) {
  await db.saveSession(username, password); // plaintext
}

async function tryRestoreSession() {
  const session = await db.getLatestSession();
  if (!session) return null;
  try {
    const profile = await db.getUser(session.username);
    if (!profile) return null;
    const derivedKey = await deriveKey(session.encryptedPassword, session.username);
    const entries = await db.getVaultEntries(session.username);
    const customTypes = await db.getCustomTypes(session.username);
    return { username: session.username, cryptoKey: derivedKey, vaultData: { entries, customTypes } };
  } catch { await db.deleteSession(session.username); return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [cryptoKey, setCryptoKey] = useState(null);
  const [ready, setReady] = useState(false);
  const [remembered, setRemembered] = useState([]);

  useEffect(() => {
    (async () => {
      const accounts = await db.getRememberedAccounts();
      setRemembered(accounts);
      const result = await tryRestoreSession();
      if (result) { window.__restoredVault = result.vaultData; setUser(result.username); }
      setReady(true);
    })();
  }, []);

  const register = useCallback(async (formData) => {
    const { username, password, passwordHint, unlockPIN, idCard, phone, nickname, birthday } = formData;
    if (await db.userExists(username)) throw new Error('用户名已存在');

    const passwordHash = await sha256(password);
    const pinHash = await sha256(unlockPIN);
    const recoveryCode = generateRecoveryCode();

    await db.saveUser({
      username, passwordHash, passwordHint,
      recoveryCodeEncrypted: '', // unused, kept for schema compat
      recoveryCodeStored: recoveryCode, // plaintext recovery code
      unlockPINHash: pinHash,
      idCard, phone, nickname, birthday,
      createdAt: new Date().toISOString(),
    });

    return { recoveryCode };
  }, []);

  const fullLogin = useCallback(async (username, password, remember, unlockPIN) => {
    const profile = await db.getUser(username);
    if (!profile) throw new Error('用户不存在');
    if (await sha256(password) !== profile.passwordHash) throw new Error('密码错误');

    const entries = await db.getVaultEntries(username);
    const customTypes = await db.getCustomTypes(username);

    if (remember && unlockPIN) {
      await db.saveRememberedAccount({
        username, encryptedPassword: password, // plaintext password for session restore
        expiresAt: Date.now() + 7 * 86400000, failCount: 0,
      });
      setRemembered(await db.getRememberedAccounts());
    }

    await persistSession(username, password);
    setUser(username);
    return { entries, customTypes };
  }, []);

  const pinUnlock = useCallback(async (username, pin) => {
    const accounts = await db.getRememberedAccounts();
    const account = accounts.find((a) => a.username === username);
    if (!account) throw new Error('账户未记住');
    if (Date.now() > account.expiresAt) { await db.deleteRememberedAccount(username); throw new Error('登录已过期'); }

    const profile = await db.getUser(username);
    if (!profile) throw new Error('用户数据丢失');

    if (await sha256(pin) !== profile.unlockPINHash) {
      account.failCount = (account.failCount || 0) + 1;
      await db.saveRememberedAccount(account);
      if (account.failCount >= 5) { await db.deleteRememberedAccount(username); throw new Error('PIN 错误次数过多'); }
      throw new Error(`PIN 错误，剩余 ${5 - account.failCount} 次`);
    }

    const entries = await db.getVaultEntries(username);
    const customTypes = await db.getCustomTypes(username);
    account.failCount = 0;
    await db.saveRememberedAccount(account);
    await persistSession(username, account.encryptedPassword);
    setUser(username);
    return { entries, customTypes };
  }, []);

  const clearRemembered = useCallback(async (username) => {
    await db.deleteRememberedAccount(username);
    setRemembered(await db.getRememberedAccounts());
  }, []);

  const logout = useCallback(async () => {
    if (user) { await clearRemembered(user); await db.deleteSession(user); }
    setUser(null);
  }, [user, clearRemembered]);

  const recover = useCallback(async (username, recoveryCode, newPassword) => {
    const profile = await db.getUser(username);
    if (!profile) throw new Error('用户不存在');
    if (profile.recoveryCodeStored !== recoveryCode) throw new Error('恢复码无效');

    const entries = await db.getVaultEntries(username);
    await db.updateUser(username, { passwordHash: await sha256(newPassword) });
    await db.deleteRememberedAccount(username);
    await db.deleteSession(username);
    return true;
  }, []);

  const getRecoveryCode = useCallback(async () => {
    if (!user) throw new Error('未登录');
    const profile = await db.getUser(user);
    if (!profile || !profile.recoveryCodeStored) throw new Error('未找到恢复码');
    return profile.recoveryCodeStored;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, cryptoKey, remembered, ready, register, fullLogin, pinUnlock, logout, recover, clearRemembered, getRecoveryCode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
