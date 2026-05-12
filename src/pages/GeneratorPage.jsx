import { useState, useCallback, useEffect } from 'react';
import { useVault } from '../contexts/VaultContext';
import { useToast } from '../hooks/useToast';
import { generatePassword, computeStrength, PASSWORD_TYPES } from '../utils/passwordGen';
import { useAuth } from '../contexts/AuthContext';
import { getUser } from '../api/client';

export default function GeneratorPage() {
  const { user } = useAuth();
  const { customTypes, addEntry } = useVault();
  const [personalInfo, setPersonalInfo] = useState({});

  useEffect(() => {
    if (user) { getUser(user).then(p => setPersonalInfo(p?.personalInfo || {})).catch(() => {}); }
  }, [user]);
  const { showToast } = useToast();

  const [type, setType] = useState('银行密码');
  const [siteName, setSiteName] = useState('');
  const [account, setAccount] = useState('');
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState('deterministic');
  const [length, setLength] = useState(6);
  const [offset, setOffset] = useState(0);
  const [charset, setCharset] = useState('numeric');
  const [generatedPwd, setGeneratedPwd] = useState('');
  const [blurred, setBlurred] = useState(true);
  const [strength, setStrength] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Source offsets
  const [srcIdCard, setSrcIdCard] = useState([3, 6]);
  const [srcPhone, setSrcPhone] = useState([4, 4]);
  const [srcNickname, setSrcNickname] = useState([1, 3]);
  const [srcAccount, setSrcAccount] = useState([1, 4]);
  const [srcSiteName, setSrcSiteName] = useState([1, 4]);

  // Constraints
  const [cons, setCons] = useState({ requireDigit: true });

  const loadPreset = useCallback((typeName) => {
    const preset = PASSWORD_TYPES[typeName];
    if (!preset) return;
    setLength(preset.defaultLength);
    setCharset(preset.charset);
    setCons({ ...preset.constraints });
  }, []);

  const handleGenerate = async () => {
    const params = {
      mode, type, siteName, account, length, offset, charset,
      sourceOffsets: {
        idCard: srcIdCard, phone: srcPhone, nickname: srcNickname,
        account: srcAccount, siteName: srcSiteName,
      },
      constraints: cons,
    };
    const pwd = await generatePassword(params, personalInfo);
    setGeneratedPwd(pwd);
    setBlurred(true);
    setStrength(computeStrength(pwd, cons));
  };

  const handleSave = async () => {
    if (!generatedPwd) return;
    try {
      await addEntry(generatedPwd, { type, siteName, account, notes, mode, charset, length });
      showToast('已保存到密码库');
    } catch (err) { showToast('保存失败: ' + err.message); }
  };

  const handleCopy = () => {
    if (!generatedPwd) return;
    navigator.clipboard.writeText(generatedPwd);
    showToast('已复制');
  };

  const allTypes = [...Object.keys(PASSWORD_TYPES), ...(customTypes || [])];

  return (
    <div>
      <div className="section-header"><h2 className="section-title">密码生成</h2></div>
      <div className="gen-layout">
        {/* Left — Form */}
        <div className="gen-left">
          <div className="card">
            <div className="form-group"><label className="form-label">密码类型</label>
              <select className="input" value={type} onChange={(e) => { setType(e.target.value); loadPreset(e.target.value); }}>
                {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">站点/应用名称</label><input className="input" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="例如: 招商银行" /></div>
            <div className="form-group"><label className="form-label">账户/卡号</label><input className="input" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="例如: 6222****1234" /></div>
            <div className="form-group"><label className="form-label">备注</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选" /></div>

            <div className="form-group"><label className="form-label">生成模式</label>
              <div className="segmented">
                <button className={'seg-btn' + (mode === 'deterministic' ? ' active' : '')} onClick={() => setMode('deterministic')}>确定性</button>
                <button className={'seg-btn' + (mode === 'random' ? ' active' : '')} onClick={() => setMode('random')}>随机</button>
              </div>
            </div>

            <div className="form-group"><label className="form-label">密码长度</label>
              <div className="range-group">
                <input type="range" min={6} max={32} value={length} onChange={(e) => setLength(Number(e.target.value))} />
                <span className="range-val">{length}</span>
              </div>
            </div>

            <button className="btn btn-primary w-full" onClick={handleGenerate}>生成密码</button>
            <button className="btn w-full" style={{ marginTop: 10 }} onClick={handleSave} disabled={!generatedPwd}>保存到密码库</button>
          </div>
        </div>

        {/* Right — Display */}
        <div className="gen-right">
          <div className="pwd-display-card">
            <div className="pwd-display-label">生成的密码</div>
            <div className={'pwd-display' + (generatedPwd ? ' has-password' : '') + (blurred && generatedPwd ? ' blurred' : '')}>
              {generatedPwd ? generatedPwd : <span className="pwd-placeholder">点击"生成密码"</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={handleCopy} disabled={!generatedPwd}>📋 复制</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setBlurred(!blurred)} disabled={!generatedPwd}>{blurred ? '👁 显示' : '🙈 隐藏'}</button>
            </div>
            {strength && (
              <div className="strength-wrap">
                <div className="strength-header"><span>密码强度</span><span>{strength.label}</span></div>
                <div className="strength-meter">
                  {[1, 2, 3, 4].map((l) => <div key={l} className="strength-bar" data-level={l <= strength.level ? strength.level : '0'} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Advanced */}
      <div style={{ textAlign: 'center' }}>
        <button className={'advanced-toggle' + (advancedOpen ? ' open' : '')} onClick={() => setAdvancedOpen(!advancedOpen)}>
          <span className="chevron">▶</span> 高级设置
        </button>
      </div>
      <div className={'advanced-panel' + (advancedOpen ? ' open' : '')}>
        <div className="advanced-inner">
          <h4 style={{ marginBottom: 16 }}>数据源偏移</h4>
          <div className="advanced-grid">
            {[
              ['身份证', srcIdCard, setSrcIdCard],
              ['手机号', srcPhone, setSrcPhone],
              ['昵称', srcNickname, setSrcNickname],
              ['账户名', srcAccount, setSrcAccount],
              ['网站名', srcSiteName, setSrcSiteName],
            ].map(([label, val, setter]) => (
              <div key={label}>
                <div className="source-label">{label}</div>
                <div className="source-row">
                  <input className="input" type="number" value={val[0]} onChange={(e) => setter([Number(e.target.value) || 1, val[1]])} />
                  <span className="source-sep">+</span>
                  <input className="input" type="number" value={val[1]} onChange={(e) => setter([val[0], Number(e.target.value) || 1])} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: 16 }}>
            <div className="form-group"><label className="form-label">偏移量</label>
              <div className="range-group">
                <input type="range" min={0} max={20} value={offset} onChange={(e) => setOffset(Number(e.target.value))} />
                <span className="range-val">{offset}</span>
              </div>
            </div>
            <div className="form-group"><label className="form-label">字符集</label>
              <select className="input" value={charset} onChange={(e) => setCharset(e.target.value)}>
                <option value="numeric">仅数字</option>
                <option value="loweralphanumeric">数字 + 小写字母</option>
                <option value="alphanumeric">数字 + 大小写字母</option>
                <option value="full">全字符集</option>
              </select>
            </div>
          </div>

          <h4 style={{ marginBottom: 8, marginTop: 8 }}>网站密码约束</h4>
          <div className="checkbox-list">
            {[
              ['startWithLetter', '必须以字母开头'],
              ['requireUpper', '必须含大写字母'],
              ['requireLower', '必须含小写字母'],
              ['requireDigit', '必须含数字'],
              ['requireSpecial', '必须含特殊字符'],
            ].map(([key, label]) => (
              <label key={key} className="checkbox-item">
                <input type="checkbox" checked={!!cons[key]} onChange={(e) => setCons({ ...cons, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => loadPreset(type)}>重置默认</button>
            <button className="btn btn-primary flex-1" onClick={handleGenerate}>应用并生成</button>
          </div>
        </div>
      </div>
    </div>
  );
}
