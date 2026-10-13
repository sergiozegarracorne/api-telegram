const express = require('express');
const db = require('../db');
const { generateApiToken, randomHex, hashPassword, verifyPassword } = require('../security');
const { requireAdmin } = require('../auth');
const telegram = require('../telegram');

const router = express.Router();
router.use(requireAdmin);

const companyFields = `
  c.id, c.name, c.tax_id, c.email, c.phone, c.api_token_prefix, c.webhook_url, c.active, c.last_login_at, c.created_at,
  (SELECT COUNT(*) FROM bots b WHERE b.company_id = c.id) AS bots_count,
  (SELECT COUNT(*) FROM messages m WHERE m.company_id = c.id) AS messages_count
`;
const findCompany = (id) => db.prepare(`SELECT ${companyFields} FROM companies c WHERE c.id = ?`).get(id);

function validate(body) {
  const name = String(body?.name || '').trim();
  if (!name) return { error: 'El nombre de la empresa es obligatorio' };
  return {
    data: {
      name,
      tax_id: String(body.tax_id || '').trim() || null,
      email: String(body.email || '').trim() || null,
      phone: String(body.phone || '').trim() || null,
    },
  };
}

router.get('/me', (req, res) => res.json(req.admin));

router.post('/password', (req, res) => {
  const { current_password, new_password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!verifyPassword(String(current_password || ''), admin.password_hash)) {
    return res.status(422).json({ error: 'La contraseña actual es incorrecta' });
  }
  if (String(new_password || '').length < 8) return res.status(422).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(String(new_password)), admin.id);
  res.json({ ok: true });
});

router.get('/stats', (req, res) => {
  const one = (sql) => db.prepare(sql).get().n;
  res.json({
    companies: one('SELECT COUNT(*) n FROM companies'),
    active_companies: one('SELECT COUNT(*) n FROM companies WHERE active = 1'),
    bots: one('SELECT COUNT(*) n FROM bots'),
    messages_today: one("SELECT COUNT(*) n FROM messages WHERE created_at >= date('now')"),
    messages_total: one('SELECT COUNT(*) n FROM messages'),
  });
});

router.get('/companies', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = db.prepare(`
    SELECT ${companyFields} FROM companies c
    WHERE c.name LIKE ? OR IFNULL(c.tax_id,'') LIKE ? OR IFNULL(c.email,'') LIKE ?
    ORDER BY c.id DESC
  `).all(q, q, q);
  res.json(rows);
});

router.post('/companies', (req, res) => {
  const { data, error } = validate(req.body);
  if (error) return res.status(422).json({ error });
  const tok = generateApiToken();
  const info = db.prepare(`
    INSERT INTO companies (name, tax_id, email, phone, api_token_hash, api_token_prefix, webhook_secret)
    VALUES (@name, @tax_id, @email, @phone, @hash, @prefix, @secret)
  `).run({ ...data, hash: tok.hash, prefix: tok.prefix, secret: randomHex(24) });
  res.status(201).json({ company: findCompany(info.lastInsertRowid), api_token: tok.token });
});

router.put('/companies/:id', (req, res) => {
  if (!findCompany(req.params.id)) return res.status(404).json({ error: 'Empresa no encontrada' });
  const { data, error } = validate(req.body);
  if (error) return res.status(422).json({ error });
  db.prepare('UPDATE companies SET name=@name, tax_id=@tax_id, email=@email, phone=@phone WHERE id=@id')
    .run({ ...data, id: req.params.id });
  res.json(findCompany(req.params.id));
});

router.post('/companies/:id/regenerate-token', (req, res) => {
  if (!findCompany(req.params.id)) return res.status(404).json({ error: 'Empresa no encontrada' });
  const tok = generateApiToken();
  db.prepare('UPDATE companies SET api_token_hash = ?, api_token_prefix = ? WHERE id = ?').run(tok.hash, tok.prefix, req.params.id);
  res.json({ company: findCompany(req.params.id), api_token: tok.token });
});

router.post('/companies/:id/toggle', async (req, res) => {
  const company = findCompany(req.params.id);
  if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });
  const active = company.active ? 0 : 1;
  db.prepare('UPDATE companies SET active = ? WHERE id = ?').run(active, company.id);
  if (active) await telegram.connectCompanyBots(company.id);
  else await telegram.disconnectCompanyBots(company.id);
  res.json(findCompany(company.id));
});

router.delete('/companies/:id', async (req, res) => {
  const company = findCompany(req.params.id);
  if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });
  await telegram.disconnectCompanyBots(company.id);
  db.prepare('DELETE FROM companies WHERE id = ?').run(company.id);
  res.json({ ok: true });
});

router.get('/companies/:id/bots', (req, res) => {
  const bots = db.prepare('SELECT * FROM bots WHERE company_id = ? ORDER BY id DESC').all(req.params.id);
  res.json(bots.map(telegram.publicBot));
});

module.exports = router;
