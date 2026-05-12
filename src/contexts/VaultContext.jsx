import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { uuid } from '../utils/crypto';
import * as db from '../api/client';
import { useAuth } from './AuthContext';

const VaultContext = createContext(null);

export function VaultProvider({ children }) {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [customTypes, setCustomTypes] = useState([]);
  const [lastBackup, setLastBackup] = useState(0);

  const refreshVault = useCallback(async () => {
    if (!user) return;
    try {
      const [serverEntries, serverTypes] = await Promise.all([
        db.getVaultEntries(user),
        db.getCustomTypes(user),
      ]);
      setEntries(serverEntries);
      setCustomTypes(serverTypes);
      const ts = parseInt(localStorage.getItem('pmr_last_backup_' + user) || '0');
      setLastBackup(ts);
    } catch (err) {
      console.error('Vault sync failed:', err);
    }
  }, [user]);

  useEffect(() => {
    const data = window.__restoredVault;
    if (data) {
      window.__restoredVault = null;
      setEntries(data.entries || []);
      setCustomTypes(data.customTypes || []);
    }
    if (user) refreshVault();
  }, [user, refreshVault]);

  const addEntry = useCallback(async (password, params) => {
    const entry = {
      id: uuid(), type: params.type, siteName: params.siteName,
      account: params.account, password: password, // plaintext
      notes: params.notes || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await db.saveVaultEntry(user, entry);
    await refreshVault();
  }, [user, refreshVault]);

  const deleteEntry = useCallback(async (entryId) => {
    await db.deleteVaultEntry(entryId, user);
    await refreshVault();
  }, [user, refreshVault]);

  const getPlaintext = useCallback(async (entryId) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) throw new Error('条目不存在');
    return entry.password; // plaintext
  }, [entries]);

  const addCustomType = useCallback(async (typeName) => {
    if (customTypes.includes(typeName)) return false;
    await db.addCustomType(user, typeName);
    await refreshVault();
    return true;
  }, [customTypes, user, refreshVault]);

  const removeCustomType = useCallback(async (typeName) => {
    await db.removeCustomType(user, typeName);
    await refreshVault();
  }, [user, refreshVault]);

  const updateProfile = useCallback(async (personalInfo) => {
    await db.updateUser(user, {
      idCard: personalInfo.idCard || '',
      phone: personalInfo.phone || '',
      nickname: personalInfo.nickname || '',
      birthday: personalInfo.birthday || '',
    });
  }, [user]);

  const initVault = useCallback((vaultData) => {
    setEntries(vaultData.entries || []);
    setCustomTypes(vaultData.customTypes || []);
  }, []);

  const doExport = useCallback(() => {
    const data = { entries, customTypes, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vault-${user}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem('pmr_last_backup_' + user, String(Date.now()));
    setLastBackup(Date.now());
  }, [entries, customTypes, user]);

  const doImport = useCallback(async (data) => {
    if (!data.entries) throw new Error('无效的备份文件');
    const existingIds = new Set(entries.map((e) => e.id));
    let added = 0, updated = 0;
    for (const e of data.entries) {
      if (existingIds.has(e.id)) {
        const idx = entries.findIndex((m) => m.id === e.id);
        if (idx >= 0 && new Date(e.updatedAt) > new Date(entries[idx].updatedAt)) {
          await db.saveVaultEntry(user, e);
          updated++;
        }
      } else {
        await db.saveVaultEntry(user, e);
        added++;
      }
    }
    if (data.customTypes) {
      for (const ct of data.customTypes) {
        await db.addCustomType(user, ct);
      }
    }
    await refreshVault();
    localStorage.setItem('pmr_last_backup_' + user, String(Date.now()));
    return { added, updated };
  }, [entries, user, refreshVault]);

  return (
    <VaultContext.Provider value={{ entries, customTypes, lastBackup, initVault, addEntry, deleteEntry, getPlaintext, addCustomType, removeCustomType, updateProfile, doExport, doImport }}>
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() { return useContext(VaultContext); }
