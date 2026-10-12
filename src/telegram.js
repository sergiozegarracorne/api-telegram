const db = require('./db');
const config = require('./config');
const { encrypt, decrypt, randomHex, hmacHex } = require('./security');
const { emitToCompany } = require('./events');

const API_BASE = 'https://api.telegram.org';
const pollers = new Map(); // botId -> AbortController

class TelegramError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Cliente HTTP de la Bot API                                          */
/* ------------------------------------------------------------------ */

async function callApi(token, method, params = {}, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new TelegramError(`No se pudo conectar con Telegram: ${err.message}`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new TelegramError(data.description || `Error de Telegram (${res.status})`, res.status === 401 ? 400 : 502);
  return data.result;
}

const botToken = (bot) => decrypt(bot.token_enc);
const getBot = (id) => db.prepare('SELECT * FROM bots WHERE id = ?').get(id);

function publicBot(bot) {
  if (!bot) return null;
  const { token_enc, webhook_secret, update_offset, ...rest } = bot;
  return rest;
}

function setStatus(botId, status, lastError = null) {
  db.prepare('UPDATE bots SET status = ?, last_error = ? WHERE id = ?').run(status, lastError, botId);
  const bot = getBot(botId);
  if (bot) emitToCompany(bot.company_id, 'bot', publicBot(bot));
}

/* ------------------------------------------------------------------ */
/* Registro y conexión de bots                                         */
/* ------------------------------------------------------------------ */

async function registerBot(companyId, token) {
  token = String(token || '').trim();
  if (!/^\d+:[\w-]{30,}$/.test(token)) throw new TelegramError('El token de Telegram no tiene un formato válido');

  const me = await callApi(token, 'getMe');
  const exists = db.prepare('SELECT company_id FROM bots WHERE telegram_bot_id = ?').get(String(me.id));
  if (exists) {
    throw new TelegramError(
      exists.company_id === companyId ? 'Este bot ya está registrado en tu empresa' : 'Este bot ya está registrado por otra empresa',
      409,
    );
  }

  const info = db.prepare(`
    INSERT INTO bots (company_id, telegram_bot_id, name, username, token_enc, webhook_secret)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(companyId, String(me.id), me.first_name, me.username, encrypt(token), randomHex(24));

  await connectBot(info.lastInsertRowid);
  return publicBot(getBot(info.lastInsertRowid));
}

/** Conecta el bot por webhook (si hay PUBLIC_URL) o por long polling. */
async function connectBot(botId) {
  const bot = getBot(botId);
  if (!bot) return;
  stopPolling(botId);
  const token = botToken(bot);

  try {
    if (config.publicUrl) {
      await callApi(token, 'setWebhook', {
        url: `${config.publicUrl}/webhook/telegram/${bot.id}`,
        secret_token: bot.webhook_secret,
        allowed_updates: ['message', 'edited_message', 'channel_post'],
        drop_pending_updates: false,
      });
      db.prepare("UPDATE bots SET mode = 'webhook' WHERE id = ?").run(bot.id);
      setStatus(bot.id, 'connected');
    } else {
      await callApi(token, 'deleteWebhook', { drop_pending_updates: false });
      db.prepare("UPDATE bots SET mode = 'polling' WHERE id = ?").run(bot.id);
      startPolling(bot.id);
      setStatus(bot.id, 'connected');
    }
  } catch (err) {
    setStatus(bot.id, 'error', err.message);
  }
}

async function disconnectBot(botId) {
  const bot = getBot(botId);
  stopPolling(botId);
  if (!bot) return;
  try {
    await callApi(botToken(bot), 'deleteWebhook', { drop_pending_updates: false });
  } catch {
    /* el token pudo haber sido revocado: no es crítico */
  }
}

async function removeBot(botId) {
  await disconnectBot(botId);
  db.prepare('DELETE FROM bots WHERE id = ?').run(botId);
}

/* ------------------------------------------------------------------ */
/* Long polling (desarrollo o servidores sin HTTPS público)            */
/* ------------------------------------------------------------------ */

function startPolling(botId) {
  stopPolling(botId);
  const controller = new AbortController();
  pollers.set(botId, controller);

  (async () => {
    let failures = 0;
    while (!controller.signal.aborted) {
      const bot = getBot(botId);
      if (!bot) break;
      try {
        const updates = await callApi(
          botToken(bot),
          'getUpdates',
          { offset: bot.update_offset, timeout: 25, allowed_updates: ['message', 'edited_message', 'channel_post'] },
          { signal: controller.signal },
        );
        for (const update of updates) {
          db.prepare('UPDATE bots SET update_offset = ? WHERE id = ?').run(update.update_id + 1, botId);
          await handleUpdate(bot, update);
        }
        if (failures) setStatus(botId, 'connected');
        failures = 0;
      } catch (err) {
        if (controller.signal.aborted) break;
        failures += 1;
        setStatus(botId, 'error', err.message);
        await new Promise((r) => setTimeout(r, Math.min(30000, 2000 * failures)));
      }
    }
  })();
}

function stopPolling(botId) {
  const controller = pollers.get(botId);
  if (controller) {
    controller.abort();
    pollers.delete(botId);
  }
}

/* ------------------------------------------------------------------ */
/* Mensajes entrantes                                                  */
/* ------------------------------------------------------------------ */

function describeMessage(msg) {
  if (msg.text) return { type: 'text', text: msg.text };
  if (msg.photo) return { type: 'photo', text: msg.caption || '' };
  if (msg.document) return { type: 'document', text: msg.caption || msg.document.file_name || '' };
  if (msg.voice) return { type: 'voice', text: '' };
  if (msg.audio) return { type: 'audio', text: msg.caption || '' };
  if (msg.video) return { type: 'video', text: msg.caption || '' };
  if (msg.sticker) return { type: 'sticker', text: msg.sticker.emoji || '' };
  if (msg.location) return { type: 'location', text: `${msg.location.latitude},${msg.location.longitude}` };
  if (msg.contact) return { type: 'contact', text: `${msg.contact.first_name} ${msg.contact.phone_number}` };
  return { type: 'other', text: '' };
}

const fullName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.title || u?.username || '';

function upsertChat(bot, chat, preview, at) {
  db.prepare(`
    INSERT INTO chats (company_id, bot_id, chat_id, type, title, username, last_message, last_message_at, unread)
    VALUES (@company_id, @bot_id, @chat_id, @type, @title, @username, @preview, @at, @unread)
    ON CONFLICT (bot_id, chat_id) DO UPDATE SET
      title = excluded.title,
      username = excluded.username,
      last_message = excluded.last_message,
      last_message_at = excluded.last_message_at,
      unread = chats.unread + excluded.unread
  `).run({
    company_id: bot.company_id,
    bot_id: bot.id,
    chat_id: String(chat.id),
    type: chat.type,
    title: fullName(chat),
    username: chat.username || null,
    preview,
    at,
    unread: 1,
  });
  return db.prepare('SELECT * FROM chats WHERE bot_id = ? AND chat_id = ?').get(bot.id, String(chat.id));
}

async function handleUpdate(bot, update) {
  const msg = update.message || update.edited_message || update.channel_post;
  if (!msg) return;

  const { type, text } = describeMessage(msg);
  const at = new Date(msg.date * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const chat = upsertChat(bot, msg.chat, text || `[${type}]`, at);

  const info = db.prepare(`
    INSERT INTO messages (company_id, bot_id, chat_ref, chat_id, direction, type, text, telegram_message_id, sender_name, status, raw, created_at)
    VALUES (?, ?, ?, ?, 'in', ?, ?, ?, ?, 'received', ?, ?)
  `).run(bot.company_id, bot.id, chat.id, String(msg.chat.id), type, text, msg.message_id, fullName(msg.from || msg.chat), JSON.stringify(msg), at);

  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  const payload = { message: publicMessage(message), chat, bot: publicBot(bot) };
  emitToCompany(bot.company_id, 'message', payload);
  forwardToCompany(bot.company_id, payload).catch(() => {});
}

/** Reenvía el mensaje entrante al webhook configurado por la empresa (firmado con HMAC-SHA256). */
async function forwardToCompany(companyId, payload) {
  const company = db.prepare('SELECT webhook_url, webhook_secret FROM companies WHERE id = ?').get(companyId);
  if (!company?.webhook_url) return;
  const body = JSON.stringify({ event: 'message.received', ...payload });
  await fetch(company.webhook_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': hmacHex(company.webhook_secret, body),
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
}

/* ------------------------------------------------------------------ */
/* Mensajes salientes                                                  */
/* ------------------------------------------------------------------ */

function publicMessage(m) {
  if (!m) return null;
  const { raw, ...rest } = m;
  return rest;
}

/**
 * Envía un mensaje desde un bot de la empresa.
 * @param {object} opts { type: text|photo|document, text, media_url, parse_mode, reply_to_message_id }
 */
async function sendMessage(companyId, botId, chatId, opts) {
  const bot = db.prepare('SELECT * FROM bots WHERE id = ? AND company_id = ?').get(botId, companyId);
  if (!bot) throw new TelegramError('Bot no encontrado', 404);
  if (chatId === undefined || chatId === null || chatId === '') throw new TelegramError('chat_id es obligatorio');

  const type = opts.type || 'text';
  const common = {
    chat_id: chatId,
    ...(opts.parse_mode ? { parse_mode: opts.parse_mode } : {}),
    ...(opts.reply_to_message_id ? { reply_parameters: { message_id: Number(opts.reply_to_message_id) } } : {}),
  };

  let method;
  let params;
  if (type === 'text') {
    if (!opts.text) throw new TelegramError('text es obligatorio');
    method = 'sendMessage';
    params = { ...common, text: opts.text };
  } else if (type === 'photo' || type === 'document') {
    if (!opts.media_url) throw new TelegramError('media_url es obligatorio para fotos y documentos');
    method = type === 'photo' ? 'sendPhoto' : 'sendDocument';
    params = { ...common, [type]: opts.media_url, ...(opts.text ? { caption: opts.text } : {}) };
  } else {
    throw new TelegramError('type debe ser text, photo o document');
  }

  let result = null;
  let error = null;
  try {
    result = await callApi(botToken(bot), method, params);
  } catch (err) {
    error = err;
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let chat = db.prepare('SELECT * FROM chats WHERE bot_id = ? AND chat_id = ?').get(bot.id, String(chatId));
  if (result) {
    db.prepare(`
      INSERT INTO chats (company_id, bot_id, chat_id, type, title, username, last_message, last_message_at, unread)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT (bot_id, chat_id) DO UPDATE SET last_message = excluded.last_message, last_message_at = excluded.last_message_at
    `).run(bot.company_id, bot.id, String(chatId), result.chat.type, fullName(result.chat), result.chat.username || null, opts.text || `[${type}]`, now);
    chat = db.prepare('SELECT * FROM chats WHERE bot_id = ? AND chat_id = ?').get(bot.id, String(chatId));
  }

  const info = db.prepare(`
    INSERT INTO messages (company_id, bot_id, chat_ref, chat_id, direction, type, text, media_url, telegram_message_id, status, error, raw, created_at)
    VALUES (?, ?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bot.company_id, bot.id, chat?.id ?? null, String(chatId), type, opts.text || null, opts.media_url || null,
    result?.message_id ?? null, result ? 'sent' : 'failed', error?.message ?? null, result ? JSON.stringify(result) : null, now,
  );

  const message = publicMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid));
  emitToCompany(bot.company_id, 'message', { message, chat, bot: publicBot(bot) });

  if (error) {
    error.messageRecord = message;
    throw error;
  }
  return message;
}

/* ------------------------------------------------------------------ */

async function bootAllBots() {
  const bots = db.prepare(`
    SELECT b.id FROM bots b JOIN companies c ON c.id = b.company_id WHERE c.active = 1
  `).all();
  for (const { id } of bots) await connectBot(id);
  if (bots.length) console.log(`[telegram] ${bots.length} bot(s) conectados en modo ${config.publicUrl ? 'webhook' : 'polling'}`);
}

async function disconnectCompanyBots(companyId) {
  const bots = db.prepare('SELECT id FROM bots WHERE company_id = ?').all(companyId);
  for (const { id } of bots) {
    await disconnectBot(id);
    setStatus(id, 'disabled');
  }
}

async function connectCompanyBots(companyId) {
  const bots = db.prepare('SELECT id FROM bots WHERE company_id = ?').all(companyId);
  for (const { id } of bots) await connectBot(id);
}

module.exports = {
  TelegramError,
  registerBot,
  connectBot,
  removeBot,
  handleUpdate,
  sendMessage,
  publicBot,
  publicMessage,
  getBot,
  bootAllBots,
  disconnectCompanyBots,
  connectCompanyBots,
};
