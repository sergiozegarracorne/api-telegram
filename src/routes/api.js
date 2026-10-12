const express = require('express');
const db = require('../db');
const { requireCompany } = require('../auth');
const { randomHex } = require('../security');
const { bus } = require('../events');
const telegram = require('../telegram');

const router = express.Router();
router.use(requireCompany);

const ownBot = (req) => db.prepare('SELECT * FROM bots WHERE id = ? AND company_id = ?').get(req.params.id, req.company.id);

/* ---------------------------- Empresa ---------------------------- */

router.get('/me', (req, res) => {
  const c = req.company;
  const one = (sql) => db.prepare(sql).get(c.id).n;
  res.json({
    id: c.id,
    name: c.name,
    tax_id: c.tax_id,
    email: c.email,
    phone: c.phone,
    api_token_prefix: c.api_token_prefix,
    webhook_url: c.webhook_url,
    webhook_secret: c.webhook_secret,
    stats: {
      bots: one('SELECT COUNT(*) n FROM bots WHERE company_id = ?'),
      chats: one('SELECT COUNT(*) n FROM chats WHERE company_id = ?'),
      unread: one('SELECT IFNULL(SUM(unread),0) n FROM chats WHERE company_id = ?'),
      messages_in: one("SELECT COUNT(*) n FROM messages WHERE company_id = ? AND direction = 'in'"),
      messages_out: one("SELECT COUNT(*) n FROM messages WHERE company_id = ? AND direction = 'out'"),
      messages_today: one("SELECT COUNT(*) n FROM messages WHERE company_id = ? AND created_at >= date('now')"),
    },
  });
});

router.put('/settings', (req, res) => {
  const url = String(req.body?.webhook_url || '').trim();
  if (url && !/^https?:\/\/.+/i.test(url)) return res.status(422).json({ error: 'webhook_url debe ser una URL http(s) válida' });
  db.prepare('UPDATE companies SET webhook_url = ? WHERE id = ?').run(url || null, req.company.id);
  res.json({ ok: true, webhook_url: url || null });
});

router.post('/settings/regenerate-webhook-secret', (req, res) => {
  const secret = randomHex(24);
  db.prepare('UPDATE companies SET webhook_secret = ? WHERE id = ?').run(secret, req.company.id);
  res.json({ webhook_secret: secret });
});

/* ------------------------------ Bots ----------------------------- */

router.get('/bots', (req, res) => {
  const bots = db.prepare('SELECT * FROM bots WHERE company_id = ? ORDER BY id DESC').all(req.company.id);
  res.json(bots.map(telegram.publicBot));
});

router.post('/bots', async (req, res) => {
  const bot = await telegram.registerBot(req.company.id, req.body?.token);
  res.status(201).json(bot);
});

router.post('/bots/:id/reconnect', async (req, res) => {
  const bot = ownBot(req);
  if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });
  await telegram.connectBot(bot.id);
  res.json(telegram.publicBot(telegram.getBot(bot.id)));
});

router.delete('/bots/:id', async (req, res) => {
  const bot = ownBot(req);
  if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });
  await telegram.removeBot(bot.id);
  res.json({ ok: true });
});

/* ------------------------------ Chats ---------------------------- */

router.get('/chats', (req, res) => {
  const params = [req.company.id];
  let where = 'c.company_id = ?';
  if (req.query.bot_id) {
    where += ' AND c.bot_id = ?';
    params.push(req.query.bot_id);
  }
  if (req.query.q) {
    where += ' AND (IFNULL(c.title,\'\') LIKE ? OR IFNULL(c.username,\'\') LIKE ? OR c.chat_id LIKE ?)';
    const q = `%${req.query.q}%`;
    params.push(q, q, q);
  }
  const chats = db.prepare(`
    SELECT c.*, b.username AS bot_username, b.name AS bot_name
    FROM chats c JOIN bots b ON b.id = c.bot_id
    WHERE ${where}
    ORDER BY c.last_message_at DESC LIMIT 200
  `).all(...params);
  res.json(chats);
});

router.post('/chats/:id/read', (req, res) => {
  db.prepare('UPDATE chats SET unread = 0 WHERE id = ? AND company_id = ?').run(req.params.id, req.company.id);
  res.json({ ok: true });
});

/* ---------------------------- Mensajes --------------------------- */

router.get('/messages', (req, res) => {
  const params = [req.company.id];
  let where = 'company_id = ?';
  for (const [key, col] of [['bot_id', 'bot_id'], ['chat_id', 'chat_id'], ['chat', 'chat_ref'], ['direction', 'direction']]) {
    if (req.query[key]) {
      where += ` AND ${col} = ?`;
      params.push(String(req.query[key]));
    }
  }
  if (req.query.after_id) {
    where += ' AND id > ?';
    params.push(Number(req.query.after_id));
  }
  if (req.query.before_id) {
    where += ' AND id < ?';
    params.push(Number(req.query.before_id));
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const rows = db.prepare(`SELECT * FROM messages WHERE ${where} ORDER BY id DESC LIMIT ${limit}`).all(...params);
  res.json(rows.reverse().map(telegram.publicMessage));
});

router.post('/messages/send', async (req, res) => {
  const { bot_id, chat_id, type, text, media_url, parse_mode, reply_to_message_id } = req.body || {};
  let botId = bot_id;
  if (!botId) {
    // Si la empresa tiene un único bot, se usa por defecto.
    const bots = db.prepare('SELECT id FROM bots WHERE company_id = ?').all(req.company.id);
    if (bots.length !== 1) return res.status(422).json({ error: 'bot_id es obligatorio' });
    botId = bots[0].id;
  }
  try {
    const message = await telegram.sendMessage(req.company.id, botId, chat_id, { type, text, media_url, parse_mode, reply_to_message_id });
    res.status(201).json(message);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, message: err.messageRecord || null });
  }
});

/* ------------------- Tiempo real (Server-Sent Events) ------------------- */

router.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const channel = `company:${req.company.id}`;
  const listener = ({ event, data }) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  bus.on(channel, listener);
  req.on('close', () => {
    clearInterval(ping);
    bus.off(channel, listener);
  });
});

module.exports = router;
