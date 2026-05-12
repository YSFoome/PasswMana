import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { VaultProvider } from './contexts/VaultContext';
import { ToastProvider } from './hooks/useToast';
import AuthPage from './pages/AuthPage';
import MainLayout from './pages/MainLayout';

function ProtectedRoute({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return user ? children : <Navigate to="/auth" replace />;
}

function PublicRoute({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return !user ? children : <Navigate to="/generator" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <VaultProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </VaultProvider>
    </AuthProvider>
  );
}

function AppRoutes() {
  const { ready } = useAuth();
  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, margin: '0 auto 16px', background: 'linear-gradient(135deg, rgba(0,212,255,0.15), rgba(139,92,246,0.15))', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>🔐</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/auth" element={<PublicRoute><AuthPage /></PublicRoute>} />
      <Route path="/*" element={
        <ProtectedRoute>
          <MainLayout />
        </ProtectedRoute>
      } />
    </Routes>
  );
}
