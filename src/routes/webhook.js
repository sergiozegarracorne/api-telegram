const express = require('express');
const db = require('../db');
const { safeEqual } = require('../security');
const telegram = require('../telegram');

const router = express.Router();

// Telegram llama aquí por cada actualización de cada bot (un endpoint por bot).
router.post('/telegram/:botId', async (req, res) => {
  const bot = telegram.getBot(req.params.botId);
  const secret = req.get('x-telegram-bot-api-secret-token') || '';
  if (!bot || !safeEqual(secret, bot.webhook_secret)) return res.sendStatus(401);

  const company = db.prepare('SELECT active FROM companies WHERE id = ?').get(bot.company_id);
  if (!company?.active) return res.sendStatus(200);

  try {
    await telegram.handleUpdate(bot, req.body || {});
  } catch (err) {
    console.error('[webhook]', err);
  }
  res.sendStatus(200);
});

module.exports = router;
