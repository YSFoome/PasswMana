import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import GeneratorPage from './GeneratorPage';
import VaultPage from './VaultPage';
import SettingsPage from './SettingsPage';

const NAV_ITEMS = [
  { path: '/generator', label: '🔑 密码生成', view: 'generator' },
  { path: '/vault', label: '📋 密码库', view: 'vault' },
  { path: '/settings', label: '⚙️ 设置', view: 'settings' },
];

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/') navigate('/generator', { replace: true });
  }, [location.pathname, navigate]);

  const handleLogout = () => {
    if (confirm('确定退出登录？所有记住的登录状态将被清除。')) {
      logout();
      navigate('/auth', { replace: true });
    }
  };

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-brand">密码管家</div>
        <div className="sidebar-user">{user}</div>
        <div className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              className={'nav-btn' + (location.pathname.startsWith(item.path) ? ' active' : '')}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button className="nav-btn" style={{ marginTop: 'auto', color: 'var(--danger)' }} onClick={handleLogout}>
          🚪 退出登录
        </button>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/generator" element={<GeneratorPage />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
