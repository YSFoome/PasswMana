import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useVault } from '../contexts/VaultContext';
import { useToast } from '../hooks/useToast';
import { PASSWORD_TYPES } from '../utils/passwordGen';
import { sha256 } from '../utils/crypto';
import * as storage from '../utils/storage';
import { getUser, updateUser } from '../api/client';

export default function SettingsPage() {
  const { user, logout, getRecoveryCode } = useAuth();
  const { customTypes, addCustomType, removeCustomType, updateProfile, doExport, doImport } = useVault();
  const { showToast } = useToast();

  const [profile, setProfile] = useState(null);

  // Fetch profile from server (not localStorage!)
  useEffect(() => {
    if (user) { getUser(user).then(setProfile).catch(() => {}); }
  }, [user]);

  const [idCard, setIdCard] = useState('');
  const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [birthday, setBirthday] = useState('');

  // 修复：profile 异步加载完成后同步写入 input state，解决表单不显示已存储信息的问题
  useEffect(() => {
    if (profile) {
      const info = profile.personalInfo || {};
      setIdCard(info.idCard || '');
      setPhone(info.phone || '');
      setNickname(info.nickname || '');
      setBirthday(info.birthday || '');
    }
  }, [profile]);
  const [newType, setNewType] = useState('');
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [hintModal, setHintModal] = useState(false);

  const handleSaveProfile = () => {
    updateProfile({ idCard, phone, nickname, birthday });
    showToast('个人信息已保存');
  };

  const handleAddType = async () => {
    const name = newType.trim();
    if (!name) return showToast('请输入类型名称');
    if (Object.keys(PASSWORD_TYPES).includes(name) || customTypes.includes(name)) return showToast('类型已存在');
    const ok = await addCustomType(name);
    if (ok) { setNewType(''); showToast('已添加: ' + name); }
  };

  const handleDeleteType = async (name) => {
    await removeCustomType(name);
    showToast('已删除: ' + name);
  };

  const handleChangePwd = async () => {
    if (newPwd !== confirmPwd) return showToast('两次密码不一致');
    if (newPwd.length < 6) return showToast('密码至少6个字符');
    try {
      const pf = await getUser(user);
      if (!pf) return showToast('获取用户信息失败');
      if (await sha256(oldPwd) !== pf.passwordHash) return showToast('旧密码错误');
      await updateUser(user, { passwordHash: await sha256(newPwd) });
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
      showToast('密码已修改');
    } catch (err) { showToast('修改失败: ' + err.message); }
  };

  const handleImport = async () => {
    try {
      const data = await storage.importFile();
      if (!data.entries) return showToast('无效的备份文件');
      const { added, updated } = await doImport(data);
      showToast(`导入完成: ${added} 新增, ${updated} 更新`);
    } catch (err) { showToast('导入失败: ' + err.message); }
  };

  return (
    <div style={{ maxWidth: 660 }}>
      <div className="section-header"><h2 className="section-title">设置</h2></div>

      {/* Profile */}
      <div className="card">
        <h3 style={{ marginBottom: 20 }}>个人信息</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-group"><label className="form-label">身份证号</label><input className="input" value={idCard} onChange={(e) => setIdCard(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">手机号</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">昵称</label><input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">生日</label><input type="date" className="input" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></div>
        </div>
        <button className="btn btn-primary" onClick={handleSaveProfile}>💾 保存个人信息</button>
      </div>

      {/* Type Management */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>密码类型管理</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {Object.keys(PASSWORD_TYPES).map((t) => (
            <span key={t} style={{ padding: '5px 14px', borderRadius: 20, fontSize: '0.81rem', background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)', opacity: 0.6 }}>{t}</span>
          ))}
          {customTypes.map((t) => (
            <span key={t} style={{ padding: '5px 14px', borderRadius: 20, fontSize: '0.81rem', background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid rgba(0,212,255,0.2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {t}
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.4, fontSize: '1rem' }} onClick={() => handleDeleteType(t)}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}><input className="input" style={{ flex: 1 }} value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="新类型名称" /><button className="btn btn-primary btn-sm" onClick={handleAddType}>＋ 新增</button></div>
      </div>

      {/* Security */}
      <div className="card" style={{ borderColor: 'rgba(255,84,112,0.18)' }}>
        <h3 style={{ marginBottom: 20 }}>安全设置</h3>
        <div className="form-group"><label className="form-label">旧密码</label><input type="password" className="input" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">新密码</label><input type="password" className="input" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">确认新密码</label><input type="password" className="input" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} /></div>
        <button className="btn btn-danger" onClick={handleChangePwd}>修改主密码</button>

        <div style={{ borderTop: '1px solid var(--glass-border)', marginTop: 20, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setHintModal(true)}>🔑 查看密码提示与恢复码</button>
          <button className="btn btn-ghost btn-sm" onClick={doExport}>📥 导出全部数据</button>
          <button className="btn btn-ghost btn-sm" onClick={handleImport}>📤 导入数据</button>
          <button className="btn btn-danger btn-sm" onClick={() => { if (confirm('确定退出？')) logout(); }} style={{ marginTop: 8 }}>🚪 退出登录</button>
        </div>
      </div>

      {/* Hint & Recovery Code Modal */}
      {hintModal && <HintModal profile={profile} getRecoveryCode={getRecoveryCode} showToast={showToast} onClose={() => setHintModal(false)} />}
    </div>
  );
}

function HintModal({ profile, getRecoveryCode, showToast, onClose }) {
  const [recoveryCode, setRecoveryCode] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleView = async () => {
    setLoading(true);
    try { setRecoveryCode(await getRecoveryCode()); }
    catch (err) { showToast(err.message); }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header"><div className="modal-title">密码提示与恢复码</div><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div style={{ marginBottom: 16 }}>
            <div className="form-label" style={{ marginBottom: 6 }}>密码提示</div>
            <div style={{ background: 'var(--bg)', padding: '10px 16px', borderRadius: 8, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
              {profile?.passwordHint || '(未设置)'}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: 16 }}>
            <div className="form-label" style={{ marginBottom: 6 }}>恢复码</div>
            {!recoveryCode ? (
              <button className="btn btn-primary btn-sm" onClick={handleView} disabled={loading}>
                {loading ? '加载中...' : '👁 查看恢复码'}
              </button>
            ) : (
              <div>
                <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px dashed var(--warning)', borderRadius: 8, padding: 14, fontFamily: 'var(--font-mono)', fontSize: '1.15rem', color: 'var(--warning)', textAlign: 'center', letterSpacing: '0.1em', marginBottom: 12 }}>
                  {recoveryCode}
                </div>
                <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(recoveryCode); showToast('恢复码已复制'); }}>
                  📋 复制恢复码
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer"><button className="btn btn-ghost" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  );
}
