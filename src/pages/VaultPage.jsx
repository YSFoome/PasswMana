import { useState, useMemo } from 'react';
import { useVault } from '../contexts/VaultContext';
import { useToast } from '../hooks/useToast';
import { PASSWORD_TYPES } from '../utils/passwordGen';
import * as storage from '../utils/storage';

const TYPE_ICONS = { '银行密码': '🏦', '游戏账户': '🎮', '股票账户': '📈', '网站密码': '🌐' };

export default function VaultPage() {
  const { entries, customTypes, lastBackup, addEntry, deleteEntry, getPlaintext, doExport, doImport } = useVault();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modalEntry, setModalEntry] = useState(null);
  const [plainPwd, setPlainPwd] = useState('');
  const [blurred, setBlurred] = useState(true);

  // Manual entry form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addType, setAddType] = useState('网站密码');
  const [addSiteName, setAddSiteName] = useState('');
  const [addAccount, setAddAccount] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  const allTypes = [...Object.keys(PASSWORD_TYPES), ...(customTypes || [])];
  const needsBackup = (Date.now() - lastBackup) > 7 * 86400000;

  const filtered = useMemo(() => {
    let result = entries;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((e) => e.siteName.toLowerCase().includes(s) || e.account.toLowerCase().includes(s) || e.type.toLowerCase().includes(s));
    }
    if (typeFilter) result = result.filter((e) => e.type === typeFilter);
    return [...result].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [entries, search, typeFilter]);

  // Group entries by type, maintaining sort order within each group
  const grouped = useMemo(() => {
    const groups = {};
    for (const entry of filtered) {
      if (!groups[entry.type]) groups[entry.type] = [];
      groups[entry.type].push(entry);
    }
    // Sort groups: presets first in PASSWORD_TYPES order, then custom alphabetically
    const presetOrder = Object.keys(PASSWORD_TYPES);
    const sorted = Object.entries(groups).sort((a, b) => {
      const ai = presetOrder.indexOf(a[0]); const bi = presetOrder.indexOf(b[0]);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a[0].localeCompare(b[0]);
    });
    return sorted;
  }, [filtered]);

  const [collapsed, setCollapsed] = useState({});

  const openModal = async (entry) => {
    setModalEntry(entry);
    try {
      const pwd = await getPlaintext(entry.id);
      setPlainPwd(pwd);
      setBlurred(true);
    } catch { showToast('解密失败'); setModalEntry(null); }
  };

  const handleDelete = async (id) => {
    if (!confirm('确定删除此密码条目？')) return;
    try { await deleteEntry(id); showToast('已删除'); }
    catch (err) { showToast('删除失败: ' + err.message); }
  };

  const handleCopy = async (entry) => {
    try {
      const pwd = await getPlaintext(entry.id);
      navigator.clipboard.writeText(pwd);
      showToast('已复制');
    } catch { showToast('复制失败'); }
  };

  const handleManualAdd = async (e) => {
    e.preventDefault();
    if (!addSiteName.trim()) return showToast('请输入站点/应用名称');
    if (!addAccount.trim()) return showToast('请输入账户名');
    if (!addPassword) return showToast('请输入密码');
    setSaving(true);
    try {
      await addEntry(addPassword, { type: addType, siteName: addSiteName.trim(), account: addAccount.trim(), notes: addNotes.trim() });
      showToast('已存入密码库');
      resetAddForm();
    } catch (err) { showToast('保存失败: ' + err.message); }
    setSaving(false);
  };

  const handleImport = async () => {
    try {
      const data = await storage.importFile();
      if (!data.entries) return showToast('无效的备份文件');
      const { added, updated } = await doImport(data);
      showToast(`导入完成: ${added} 新增, ${updated} 更新`);
    } catch (err) { showToast('导入失败: ' + err.message); }
  };

  const resetAddForm = () => {
    setShowAddForm(false);
    setAddType('网站密码');
    setAddSiteName(''); setAddAccount(''); setAddPassword(''); setAddNotes('');
    setShowPwd(false); setSaving(false);
  };

  const maskAccount = (acc) => acc && acc.length > 4 ? acc.substring(0, 2) + '****' + acc.substring(acc.length - 2) : '****';
  const timeAgo = (d) => {
    const sec = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (sec < 60) return '刚刚';
    if (sec < 3600) return Math.floor(sec / 60) + '分钟前';
    if (sec < 86400) return Math.floor(sec / 3600) + '小时前';
    if (sec < 2592000) return Math.floor(sec / 86400) + '天前';
    return new Date(d).toLocaleDateString('zh-CN');
  };

  return (
    <div>
      <div className="section-header"><h2 className="section-title">密码库</h2></div>

      {needsBackup && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'var(--warning-muted)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 12, marginBottom: 22, fontSize: '0.85rem' }}>
          <span style={{ color: 'var(--warning)' }}>⚠ 距离上次备份已超过7天</span>
          <button className="btn btn-sm" onClick={doExport}>📥 立即备份</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 22 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>🔍</span>
          <input className="input" style={{ paddingLeft: 42 }} placeholder="搜索名称/账户..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input" style={{ width: 160 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">全部类型</option>
          {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>＋ 手动录入</button>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '72px 24px' }}>
          <div style={{ fontSize: '3rem', opacity: 0.5, marginBottom: 18 }}>🔒</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 8 }}>暂无密码记录</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 22 }}>生成密码或手动录入已有账户密码</div>
          <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>＋ 手动录入已有密码</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {grouped.map(([type, items]) => {
            const isCollapsed = collapsed[type];
            const icon = TYPE_ICONS[type] || '🔧';
            return (
              <div key={type}>
                {/* Group Header */}
                <div
                  onClick={() => setCollapsed({ ...collapsed, [type]: !isCollapsed })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 4px', cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <span style={{
                    fontSize: '0.7rem', transition: 'transform 0.2s',
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0)',
                    color: 'var(--text-muted)',
                  }}>▼</span>
                  <span style={{ fontSize: '1.2rem' }}>{icon}</span>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', letterSpacing: '-0.01em' }}>{type}</span>
                  <span style={{
                    fontSize: '0.72rem', color: 'var(--text-muted)',
                    background: 'var(--glass-medium)', padding: '1px 8px', borderRadius: 10,
                  }}>{items.length}</span>
                </div>

                {/* Group Items */}
                {!isCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {items.map((entry, idx, arr) => (
                      <div key={entry.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 20px', gap: 16,
                        background: 'var(--glass-light)', backdropFilter: 'blur(8px)',
                        border: '1px solid transparent',
                        borderRadius: idx === 0 ? '12px 12px 0 0' : idx === arr.length - 1 ? '0 0 12px 12px' : '0',
                        borderTopColor: idx === 0 ? 'var(--glass-border)' : 'transparent',
                        borderBottomColor: idx === arr.length - 1 ? 'var(--glass-border)' : 'var(--glass-border)',
                        borderLeftColor: idx === 0 && idx === arr.length - 1 ? 'var(--glass-border)' : undefined,
                        borderRightColor: idx === 0 && idx === arr.length - 1 ? 'var(--glass-border)' : undefined,
                        transition: 'all 0.25s',
                      }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-hover)'; e.currentTarget.style.borderColor = 'var(--glass-border-light)'; e.currentTarget.style.zIndex = '2'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--glass-light)'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.zIndex = '1'; e.currentTarget.style.borderTopColor = idx === 0 ? 'var(--glass-border)' : 'transparent'; e.currentTarget.style.borderBottomColor = 'var(--glass-border)'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.91rem' }}>{entry.siteName}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{maskAccount(entry.account)}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginRight: 8 }}>{timeAgo(entry.updatedAt)}</span>
                          <button className="btn btn-sm btn-ghost" onClick={() => openModal(entry)} title="查看">👁</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => handleCopy(entry)} title="复制">📋</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => handleDelete(entry.id)} title="删除">🗑</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 26, paddingTop: 22, borderTop: '1px solid var(--glass-border)' }}>
        <button className="btn" onClick={doExport}>📥 导出备份</button>
        <button className="btn" onClick={handleImport}>📤 导入恢复</button>
      </div>

      {/* Manual Add Modal */}
      {showAddForm && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) resetAddForm(); }}>
          <form className="modal" style={{ maxWidth: 460 }} onSubmit={handleManualAdd}>
            <div className="modal-header">
              <div className="modal-title">手动录入已有密码</div>
              <button type="button" className="modal-close" onClick={resetAddForm}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">密码类型</label>
                <select className="input" value={addType} onChange={(e) => setAddType(e.target.value)}>
                  {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">站点 / 应用名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input className="input" value={addSiteName} onChange={(e) => setAddSiteName(e.target.value)} placeholder="例如: 招商银行" required />
              </div>
              <div className="form-group">
                <label className="form-label">账户 / 卡号 / 用户名 <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input className="input" value={addAccount} onChange={(e) => setAddAccount(e.target.value)} placeholder="例如: 6222****1234 或 zhangsan@mail.com" required />
              </div>
              <div className="form-group">
                <label className="form-label">密码 <span style={{ color: 'var(--danger)' }}>*</span></label>
                <div className="password-wrapper">
                  <input type={showPwd ? 'text' : 'password'} className="input input-mono" value={addPassword} onChange={(e) => setAddPassword(e.target.value)} placeholder="输入已有密码" required />
                  <button type="button" className="toggle-pw" onClick={() => setShowPwd(!showPwd)}>{showPwd ? '🙈' : '👁'}</button>
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">备注</label>
                <input className="input" value={addNotes} onChange={(e) => setAddNotes(e.target.value)} placeholder="可选备注" />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={resetAddForm}>取消</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '保存中...' : '💾 存入密码库'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Password View Modal */}
      {modalEntry && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setModalEntry(null); }}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div className="modal-title">密码详情</div>
              <button className="modal-close" onClick={() => setModalEntry(null)}>×</button>
            </div>
            <div className="modal-body">
              {[
                ['类型', modalEntry.type],
                ['站点', modalEntry.siteName],
                ['账户', modalEntry.account],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--glass-border)' }}>
                  <span style={{ fontSize: '0.81rem', color: 'var(--text-muted)' }}>{label}</span>
                  <span style={{ fontSize: '0.89rem', fontWeight: label === '站点' ? 600 : 400 }}>{value}</span>
                </div>
              ))}
              {modalEntry.notes && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--glass-border)' }}>
                  <span style={{ fontSize: '0.81rem', color: 'var(--text-muted)' }}>备注</span>
                  <span style={{ fontSize: '0.89rem', maxWidth: '60%', textAlign: 'right' }}>{modalEntry.notes}</span>
                </div>
              )}
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: '0.81rem', color: 'var(--text-muted)' }}>密码</span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBlurred(!blurred)}>{blurred ? '👁 显示' : '🙈 隐藏'}</button>
                </div>
                <div className={'modal-password' + (blurred ? ' blurred' : '')}>{plainPwd}</div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => { navigator.clipboard.writeText(plainPwd); showToast('已复制'); }}>📋 复制密码</button>
              <button className="btn btn-ghost" onClick={() => setModalEntry(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
