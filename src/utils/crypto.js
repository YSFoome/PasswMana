const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function hex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hexStr) {
  return new Uint8Array(hexStr.match(/.{2}/g).map((b) => parseInt(b, 16)));
}

export async function sha256(text) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return hex(hash);
}

export async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, encoder.encode(plaintext)
  );
  return hex(iv) + ':' + hex(new Uint8Array(ciphertext));
}

export async function decrypt(ciphertext, key) {
  const [ivHex, dataHex] = ciphertext.split(':');
  const iv = hexToBytes(ivHex);
  const data = hexToBytes(dataHex);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return decoder.decode(decrypted);
}

export function generateRecoveryCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const groups = [];
  for (let i = 0; i < 4; i++) {
    let g = '';
    for (let j = 0; j < 4; j++) {
      g += chars[crypto.getRandomValues(new Uint8Array(1))[0] % chars.length];
    }
    groups.push(g);
  }
  return groups.join('-');
}

// Derive a deterministic AES-GCM key from password + salt using SHA-256.
// Unlike PBKDF2-derived keys, this guarantees the same key every time.
export async function deriveKeyFromHash(password, salt) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(password + ':' + salt));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export function uuid() {
  return crypto.randomUUID();
}
