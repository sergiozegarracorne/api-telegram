const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { sha256, verifyPassword } = require('../security');
const { setSession, clearSession, getSession } = require('../auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta nuevamente en unos minutos.' },
});

router.post('/admin/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(String(email || '').toLowerCase().trim());
  if (!admin || !verifyPassword(String(password || ''), admin.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  setSession(res, { role: 'admin', id: admin.id });
  res.json({ ok: true, role: 'admin' });
});

router.post('/company/login', loginLimiter, (req, res) => {
  const token = String(req.body?.token || '').trim();
  const company = token && db.prepare('SELECT * FROM companies WHERE api_token_hash = ?').get(sha256(token));
  if (!company) return res.status(401).json({ error: 'Token inválido' });
  if (!company.active) return res.status(403).json({ error: 'La empresa está desactivada. Contacta al administrador.' });

  db.prepare("UPDATE companies SET last_login_at = datetime('now') WHERE id = ?").run(company.id);
  setSession(res, { role: 'company', id: company.id, th: company.api_token_hash.slice(0, 16) });
  res.json({ ok: true, role: 'company', company: { id: company.id, name: company.name } });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/session', (req, res) => {
  const s = getSession(req);
  res.json({ role: s?.role || null });
});

module.exports = router;
