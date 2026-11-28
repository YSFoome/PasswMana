import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { vaultStore } from './core/vault-store';
import { App } from './App';
import './index.css';

// Only expose internal test hooks when explicitly requested by the Playwright E2E harness.
if ((window as unknown as { __PASSWMANA_ENABLE_TEST_API__?: boolean }).__PASSWMANA_ENABLE_TEST_API__ === true) {
    (window as unknown as { __testApi?: unknown }).__testApi = {
        state: vaultStore.state,
        encryptText: vaultStore.encryptText,
        decryptText: vaultStore.decryptText,
        remoteRecord: vaultStore.remoteRecord,
        persistVault: vaultStore.persistVault,
        synchronize: vaultStore.synchronize,
        lockVault: vaultStore.lockVault,
        createVault: vaultStore.createVault,
        resetLockTimer: vaultStore.resetLockTimer,
        scheduleAutoSync: vaultStore.scheduleAutoSync,
        dbGet: vaultStore.dbGet,
    };
}

createRoot(document.getElementById('app')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
