const express = require('express');
const cors = require('cors');
const path = require('path');
const { db, stmts } = require('./database.cjs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve React production build
app.use(express.static(path.join(__dirname, '..', 'dist')));

// ====== User Endpoints ======

// Check if user exists
app.get('/api/users/:username/exists', (req, res) => {
  const row = stmts.getUser.get(req.params.username);
  res.json({ exists: !!row });
});

// Register new user
app.post('/api/users', (req, res) => {
  try {
    const u = req.body;
    const existing = stmts.getUser.get(u.username);
    if (existing) return res.status(409).json({ error: '用户名已存在' });

    stmts.saveUser.run({
      username: u.username,
      password_hash: u.passwordHash,
      password_hint: u.passwordHint || '',
      recovery_code_encrypted: u.recoveryCodeEncrypted || '',
      recovery_code_stored: u.recoveryCodeStored || '',
      unlock_pin_hash: u.unlockPINHash || '',
      id_card: u.idCard || '',
      phone: u.phone || '',
      nickname: u.nickname || '',
      birthday: u.birthday || '',
      created_at: u.createdAt,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user profile
app.get('/api/users/:username', (req, res) => {
  const row = stmts.getUser.get(req.params.username);
  if (!row) return res.status(404).json({ error: '用户不存在' });

  const profile = {
    username: row.username,
    passwordHash: row.password_hash,
    passwordHint: row.password_hint,
    recoveryCodeEncrypted: row.recovery_code_encrypted,
    recoveryCodeStored: row.recovery_code_stored,
    unlockPINHash: row.unlock_pin_hash,
    personalInfo: {
      idCard: row.id_card, phone: row.phone,
      nickname: row.nickname, birthday: row.birthday,
    },
    createdAt: row.created_at,
  };
  res.json(profile);
});

// Update user profile
app.put('/api/users/:username', (req, res) => {
  try {
    const existing = stmts.getUser.get(req.params.username);
    if (!existing) return res.status(404).json({ error: '用户不存在' });

    const u = req.body;
    stmts.saveUser.run({
      username: req.params.username,
      password_hash: u.passwordHash ?? existing.password_hash,
      password_hint: u.passwordHint ?? existing.password_hint,
      recovery_code_encrypted: u.recoveryCodeEncrypted ?? existing.recovery_code_encrypted,
      recovery_code_stored: u.recoveryCodeStored ?? existing.recovery_code_stored,
      unlock_pin_hash: u.unlockPINHash ?? existing.unlock_pin_hash,
      id_card: u.idCard ?? existing.id_card,
      phone: u.phone ?? existing.phone,
      nickname: u.nickname ?? existing.nickname,
      birthday: u.birthday ?? existing.birthday,
      created_at: existing.created_at,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== Vault Endpoints ======

// Get all entries for a user
app.get('/api/vault/:username', (req, res) => {
  const rows = stmts.getEntries.all(req.params.username);
  const entries = rows.map((row) => ({
    id: row.id, type: row.type, siteName: row.site_name,
    account: row.account, password: row.password_encrypted,
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
  res.json(entries);
});

// Save a vault entry
app.post('/api/vault/:username', (req, res) => {
  try {
    const e = req.body;
    stmts.saveEntry.run({
      id: e.id, username: req.params.username,
      type: e.type, site_name: e.siteName, account: e.account,
      password_encrypted: e.password, notes: e.notes || '',
      created_at: e.createdAt, updated_at: e.updatedAt,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a vault entry
app.delete('/api/vault/:username/:id', (req, res) => {
  stmts.deleteEntry.run(req.params.id, req.params.username);
  res.json({ ok: true });
});

// ====== Custom Types Endpoints ======

app.get('/api/types/:username', (req, res) => {
  const rows = stmts.getTypes.all(req.params.username);
  res.json(rows.map((r) => r.type_name));
});

app.post('/api/types/:username', (req, res) => {
  try {
    stmts.addType.run(req.params.username, req.body.typeName);
    res.json({ ok: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.json({ ok: true });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/types/:username/:typeName', (req, res) => {
  stmts.removeType.run(req.params.username, req.params.typeName);
  res.json({ ok: true });
});

// ====== Session Endpoints ======

app.post('/api/sessions', (req, res) => {
  stmts.saveSession.run(req.body.username, req.body.encryptedPassword, Date.now());
  res.json({ ok: true });
});

app.get('/api/sessions/:username', (req, res) => {
  const row = stmts.getSession.get(req.params.username);
  res.json(row ? { encryptedPassword: row.encrypted_password, savedAt: row.saved_at } : null);
});

app.get('/api/sessions', (req, res) => {
  const row = stmts.getLatestSession.get();
  res.json(row ? { username: row.username, encryptedPassword: row.encrypted_password, savedAt: row.saved_at } : null);
});

app.delete('/api/sessions/:username', (req, res) => {
  stmts.deleteSession.run(req.params.username);
  res.json({ ok: true });
});

// ====== Remembered Accounts Endpoints ======

app.get('/api/remembered', (req, res) => {
  const rows = stmts.getRemembered.all(Date.now());
  res.json(rows.map((r) => ({
    username: r.username, encryptedPassword: r.encrypted_password,
    expiresAt: r.expires_at, failCount: r.fail_count,
  })));
});

app.post('/api/remembered', (req, res) => {
  const a = req.body;
  stmts.saveRemembered.run(a.username, a.encryptedPassword, a.expiresAt, a.failCount || 0);
  res.json({ ok: true });
});

app.delete('/api/remembered/:username', (req, res) => {
  stmts.deleteRemembered.run(req.params.username);
  res.json({ ok: true });
});

// ====== Device Token ======

app.get('/api/device-token', (req, res) => {
  const row = stmts.getDeviceToken.get();
  res.json({ token: row ? row.token : null });
});

app.post('/api/device-token', (req, res) => {
  stmts.setDeviceToken.run(req.body.token);
  res.json({ ok: true });
});

// ====== Raw DB Export ======

app.get('/api/db/export', (req, res) => {
  const buffer = db.serialize();
  res.set('Content-Type', 'application/x-sqlite3');
  res.set('Content-Disposition', 'attachment; filename="password-manager.db"');
  res.send(Buffer.from(buffer));
});

// ====== SPA fallback — serve index.html for all non-API routes ======
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
