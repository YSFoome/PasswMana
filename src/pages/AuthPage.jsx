import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useVault } from '../contexts/VaultContext';
import { useToast } from '../hooks/useToast';

export default function AuthPage() {
  const { remembered, register, fullLogin, pinUnlock, recover } = useAuth();
  const { initVault } = useVault();
  const { showToast } = useToast();

  const [view, setView] = useState(remembered.length > 0 ? 'picker' : 'login');
  const [pinUser, setPinUser] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Form fields
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [pin, setPin] = useState(''); const [remember, setRemember] = useState(true);
  const [passwordHint, setPasswordHint] = useState('');
  const [idCard, setIdCard] = useState(''); const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState(''); const [birthday, setBirthday] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState(''); const [newPassword, setNewPassword] = useState('');
  const [recoveryResult, setRecoveryResult] = useState(null);

  // PIN input state
  const [pinInput, setPinInput] = useState('');

  const handleError = (err) => { setError(err.message); setLoading(false); };

  const doRegister = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    if (password !== confirmPassword) return handleError(new Error('两次密码不一致'));
    if (pin.length < 4 || pin.length > 6) return handleError(new Error('PIN 为4-6位数字'));
    try {
      const result = await register({ username, password, passwordHint, unlockPIN: pin, idCard, phone, nickname, birthday });
      setRecoveryResult(result.recoveryCode);
      showToast('注册成功');
    } catch (err) { handleError(err); }
  };

  const doLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const vaultData = await fullLogin(username, password, remember, remember ? pin : null);
      initVault(vaultData);
    } catch (err) { handleError(err); }
  };

  const doPINUnlock = async () => {
    setError(''); setLoading(true);
    try {
      const vaultData = await pinUnlock(pinUser, pinInput);
      initVault(vaultData);
    } catch (err) { handleError(err); }
  };

  const doRecover = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      await recover(username, recoveryCode, newPassword);
      showToast('密码已重置，请重新登录');
      setView('login');
      setRecoveryCode(''); setNewPassword('');
    } catch (err) { handleError(err); }
    setLoading(false);
  };

  const showPINField = view === 'login' && remember;

  if (recoveryResult) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>🔑</div>
          <h2 style={{ marginBottom: 8 }}>保存恢复码</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 20 }}>此代码仅显示一次</p>
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px dashed var(--warning)', borderRadius: 12, padding: 16, fontFamily: 'var(--font-mono)', fontSize: '1.2rem', color: 'var(--warning)', marginBottom: 16, letterSpacing: '0.12em' }}>{recoveryResult}</div>
          <button className="btn btn-primary w-full" onClick={() => { navigator.clipboard.writeText(recoveryResult); showToast('已复制'); }}>📋 复制恢复码</button>
          <button className="btn btn-ghost w-full" style={{ marginTop: 12 }} onClick={() => { setRecoveryResult(null); setView('login'); setPassword(''); setPin(''); setConfirmPassword(''); }}>我已保存，使用此账户登录</button>
        </div>
      </div>
    );
  }

  if (view === 'picker') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">🔐</div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: 4 }}>密码管家</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>选择一个账户以快速登录</p>
          {error && <div className="form-error">{error}</div>}
          {remembered.map((acc) => (
            <div key={acc.username} className="account-card" onClick={() => { setPinUser(acc.username); setView('pin'); }}>
              <div className="account-avatar">{acc.username.charAt(0).toUpperCase()}</div>
              <div className="account-info">
                <div className="account-name">{acc.username}</div>
                <div className="account-date">快速登录 · {Math.max(0, Math.floor((acc.expiresAt - Date.now()) / 86400000))} 天后过期</div>
              </div>
              <span className="account-arrow">→</span>
            </div>
          ))}
          <div className="account-card-add" onClick={() => setView('login')}>＋ 登录其他账户</div>
          <span className="account-register-link" onClick={() => setView('register')}>注册新账户</span>
        </div>
      </div>
    );
  }

  if (view === 'pin') {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div className="account-avatar" style={{ width: 52, height: 52, fontSize: '1.3rem', margin: '0 auto 16px', background: 'var(--accent)', color: '#fff' }}>{pinUser.charAt(0).toUpperCase()}</div>
          <h3 style={{ marginBottom: 4 }}>{pinUser}</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>输入解锁 PIN 码</p>
          {error && <div className="form-error">{error}</div>}
          <input type="password" className="input input-mono" style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: '0.4em' }} maxLength={6} value={pinInput} onChange={(e) => { setPinInput(e.target.value); setError(''); }} autoFocus />
          <div className="pin-dots">
            {[...Array(6)].map((_, i) => <div key={i} className={'pin-dot' + (i < pinInput.length ? ' filled' : '')} />)}
          </div>
          <button className="btn btn-primary w-full" onClick={doPINUnlock} disabled={loading || pinInput.length < 4}>解锁</button>
          <div className="auth-links" style={{ justifyContent: 'center', marginTop: 20 }}>
            <span onClick={() => { setView('picker'); setError(''); setPinInput(''); }}>← 返回</span>
            <span onClick={() => { setView('login'); setUsername(pinUser); setError(''); setPinInput(''); }}>使用密码登录</span>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'recovery') {
    return (
      <div className="auth-page">
        <form className="auth-card" onSubmit={doRecover}>
          <div className="auth-logo">🔑</div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: 4 }}>恢复密码</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>使用注册时保存的恢复码重置密码</p>
          {error && <div className="form-error">{error}</div>}
          <div className="form-group"><label className="form-label">用户名</label><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
          <div className="form-group"><label className="form-label">恢复码</label><input className="input input-mono" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" style={{ textTransform: 'uppercase' }} required /></div>
          <div className="form-group"><label className="form-label">新密码</label><input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></div>
          <button className="btn btn-primary w-full btn-lg" disabled={loading}>重置密码</button>
          <div className="auth-links"><span onClick={() => { setView('login'); setError(''); }}>← 返回登录</span></div>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" style={view === 'register' ? { maxWidth: 480 } : {}} onSubmit={view === 'register' ? doRegister : doLogin}>
        <div className="auth-logo">{view === 'register' ? '📝' : '🔐'}</div>
        <h2 style={{ fontSize: '1.4rem', marginBottom: 4 }}>{view === 'register' ? '创建账户' : '密码管家'}</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>{view === 'register' ? '填写信息以创建新账户' : '登录以访问您的密码库'}</p>

        {error && <div className="form-error">{error}</div>}

        <div className="form-group"><label className="form-label">用户名</label><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></div>
        <div className="form-group">
          <label className="form-label">密码</label>
          <div className="password-wrapper">
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={view === 'register' ? 'new-password' : 'current-password'} required />
          </div>
        </div>

        {view === 'register' && (
          <>
            <div className="form-group"><label className="form-label">确认密码</label><input type="password" className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required /></div>
            <div className="form-group"><label className="form-label">密码提示</label><input className="input" value={passwordHint} onChange={(e) => setPasswordHint(e.target.value)} placeholder="帮助记起密码的提示" /></div>
            <div className="form-group"><label className="form-label">解锁 PIN (4-6位数字)</label><input type="password" className="input input-mono" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} required /><span className="form-hint">用于快速登录</span></div>
            <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: 16, marginTop: 8 }}>
              <p style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>个人信息（可选，用于密码生成）</p>
              <div className="form-group"><label className="form-label">昵称</label><input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">身份证号</label><input className="input" value={idCard} onChange={(e) => setIdCard(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">手机号</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">生日</label><input type="date" className="input" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></div>
            </div>
          </>
        )}

        {view === 'login' && (
          <>
            <div className="form-group">
              <label className="checkbox-item">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                记住此账户 (7天)
              </label>
            </div>
            {showPINField && (
              <div className="form-group"><label className="form-label">解锁 PIN</label><input type="password" className="input input-mono" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="设置6位数字PIN" /><span className="form-hint">用于快速登录</span></div>
            )}
          </>
        )}

        <button className="btn btn-primary w-full btn-lg" style={{ marginTop: 8 }} disabled={loading}>
          {view === 'register' ? '注册' : '登录'}
        </button>

        <div className="auth-links">
          {view === 'login' ? (
            <>
              <span onClick={() => { setView('recovery'); setError(''); }}>忘记密码？</span>
              <span onClick={() => { setView('register'); setError(''); }}>注册新账户</span>
            </>
          ) : (
            <span onClick={() => { setView('login'); setError(''); }}>← 已有账户？登录</span>
          )}
        </div>
      </form>
    </div>
  );
}
