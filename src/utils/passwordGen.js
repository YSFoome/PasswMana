import { sha256 } from './crypto';

export const PASSWORD_TYPES = {
  '银行密码': { charset: 'numeric', defaultLength: 6, constraints: { requireDigit: true }, sourceFields: ['idCard', 'account'] },
  '游戏账户': { charset: 'alphanumeric', defaultLength: 12, constraints: { requireLetter: true, requireDigit: true }, sourceFields: ['nickname', 'siteName'] },
  '股票账户': { charset: 'numeric', defaultLength: 6, constraints: { requireDigit: true }, sourceFields: ['idCard', 'account'] },
  '网站密码': { charset: 'full', defaultLength: 16, constraints: { startWithLetter: true, requireUpper: true, requireLower: true, requireDigit: true, requireSpecial: true }, sourceFields: ['nickname', 'siteName'] },
};

export const CHARSETS = {
  numeric: '0123456789',
  alphanumeric: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  loweralphanumeric: '0123456789abcdefghijklmnopqrstuvwxyz',
  full: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()-_=+[]{}|;:,.<>?',
};

function applyConstraints(password, charset, constraints = {}) {
  let result = password;
  if (constraints.startWithLetter && /[^a-zA-Z]/.test(result[0])) {
    const letters = (charset.match(/[a-zA-Z]/g) || ['A']);
    result = letters[0] + result.slice(1);
  }
  if (constraints.requireUpper && !/[A-Z]/.test(result)) result = result.slice(0, -1) + 'A';
  if (constraints.requireLower && !/[a-z]/.test(result)) result = result.slice(0, -1) + 'a';
  if (constraints.requireLetter && !/[a-zA-Z]/.test(result)) result = result.slice(0, -1) + 'a';
  if (constraints.requireDigit && !/[0-9]/.test(result)) result = result.slice(0, -1) + '1';
  if (constraints.requireSpecial && !/[!@#$%^&*()\-_=+\[\]{}|;:,.<>?]/.test(result)) result = result.slice(0, -1) + '!';
  if (constraints.forbiddenChars) {
    result = result.split('').map((c) =>
      constraints.forbiddenChars.includes(c) ? charset[Math.floor(Math.random() * charset.length)] : c
    ).join('');
  }
  return result;
}

export async function generateDeterministic(params, personalInfo = {}) {
  const { siteName = '', account = '', length = 12, sourceOffsets = {}, offset = 0, charset = 'full', constraints = {} } = params;

  const sources = { idCard: personalInfo.idCard || '', phone: personalInfo.phone || '', nickname: personalInfo.nickname || '', birthday: personalInfo.birthday || '', account, siteName };
  let sourceData = '';
  for (const [key, val] of Object.entries(sources)) {
    const cfg = sourceOffsets[key] || [1, String(val).length];
    const start = Math.max(0, (cfg[0] || 1) - 1);
    const count = cfg[1] || String(val).length;
    if (count > 0) sourceData += String(val).substring(start, start + count);
  }

  const hash = await sha256(sourceData);
  const cs = CHARSETS[charset] || CHARSETS.full;
  const hashBytes = hash.match(/.{2}/g).map((b) => parseInt(b, 16));
  let password = '';
  for (let i = 0; i < (isNaN(length) ? 12 : length); i++) {
    password += cs[(hashBytes[i % hashBytes.length] + (isNaN(offset) ? 0 : offset) + i) % cs.length];
  }
  return applyConstraints(password, cs, constraints);
}

export async function generateRandom(params, personalInfo = {}) {
  const { length = 12, charset = 'full', constraints = {} } = params;
  const cs = CHARSETS[charset] || CHARSETS.full;

  const seedStr = Object.values(personalInfo).join('') + Date.now().toString();
  const seedHash = await sha256(seedStr);
  let seed = parseInt(seedHash.substring(0, 8), 16);

  const prng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  let password = '';
  for (let i = 0; i < (isNaN(length) ? 12 : length); i++) {
    password += cs[Math.floor(prng() * cs.length)];
  }
  return applyConstraints(password, cs, constraints);
}

export async function generatePassword(params, personalInfo) {
  const result = params.mode === 'deterministic'
    ? await generateDeterministic(params, personalInfo)
    : await generateRandom(params, personalInfo);
  return (!result || result.includes('NaN')) ? 'Error: 生成失败，请检查参数' : result;
}

export function computeStrength(password, constraints = {}) {
  if (!password) return { score: 0, level: 0, label: '--' };
  let score = 0;
  if (password.length >= 16) score += 3; else if (password.length >= 12) score += 2; else if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[!@#$%^&*()\-_=+\[\]{}|;:,.<>?]/.test(password)) score++;
  if (constraints.requireUpper && /[A-Z]/.test(password)) score++;
  if (constraints.requireLower && /[a-z]/.test(password)) score++;
  if (constraints.requireDigit && /[0-9]/.test(password)) score++;
  if (constraints.requireSpecial && /[!@#$%^&*()\-_=+\[\]{}|;:,.<>?]/.test(password)) score++;
  const level = score <= 3 ? 1 : score <= 5 ? 2 : score <= 7 ? 3 : 4;
  return { score, level, label: { 1: '弱', 2: '一般', 3: '强', 4: '极强' }[level] || '--' };
}
