// Pruebas de integración con la Bot API de Telegram simulada.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'telehub-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.APP_KEY = 'k'.repeat(64);
process.env.PUBLIC_URL = 'https://example.test';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'secret123';

/* ---------- Mock de api.telegram.org y del webhook de la empresa ---------- */
const realFetch = global.fetch;
const telegramCalls = [];
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (!url.startsWith('https://api.telegram.org/')) return realFetch(url, opts);
  const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  if (url.includes('/file/bot')) return new Response(Buffer.from('IMAGEN'), { status: 200 });
  const method = url.split('/').pop();
  const body = opts.body instanceof FormData ? Object.fromEntries(opts.body) : JSON.parse(opts.body || '{}');
  telegramCalls.push({ method, body });
  const token = url.split('/bot')[1].split('/')[0];
  const botId = Number(token.split(':')[0]);
  switch (method) {
    case 'getMe': return ok({ id: botId, first_name: `Bot ${botId}`, username: `bot${botId}_bot` });
    case 'setWebhook':
    case 'deleteWebhook': return ok(true);
    case 'getFile': return ok({ file_id: body.file_id, file_path: 'photos/file_1.jpg' });
    case 'sendMessage': return ok({ message_id: 100, chat: { id: Number(body.chat_id), type: 'private', first_name: 'Ana' } });
    case 'sendDocument': return ok({ message_id: 101, chat: { id: Number(body.chat_id), type: 'private' }, document: { file_id: 'DOC1' } });
    default: return new Response(JSON.stringify({ ok: false, description: 'método no simulado' }));
  }
};

const app = require('../src/server');
const db = require('../src/db');

let base;
let server;
let hookServer;
const hookHits = [];
let adminCookie;

async function req(method, url, { body, token, cookie, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await realFetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  hookServer = http.createServer((rq, rs) => {
    let raw = '';
    rq.on('data', (c) => (raw += c));
    rq.on('end', () => {
      hookHits.push({ headers: rq.headers, raw });
      rs.end('ok');
    });
  }).listen(0);
  await new Promise((r) => hookServer.once('listening', r));

  const res = await realFetch(`${base}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.local', password: 'secret123' }),
  });
  assert.equal(res.status, 200);
  adminCookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => {
  server.close();
  hookServer.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const state = {};

test('el admin crea empresas y recibe el token una sola vez', async () => {
  const a = await req('POST', '/api/admin/companies', { cookie: adminCookie, body: { name: 'Acme' } });
  const b = await req('POST', '/api/admin/companies', { cookie: adminCookie, body: { name: 'Beta' } });
  assert.equal(a.status, 201);
  assert.match(a.data.api_token, /^tgk_[0-9a-f]{48}$/);
  state.tokenA = a.data.api_token;
  state.tokenB = b.data.api_token;
  state.companyA = a.data.company.id;

  const list = await req('GET', '/api/admin/companies', { cookie: adminCookie });
  assert.ok(!JSON.stringify(list.data).includes(state.tokenA), 'el listado no expone el token');
});

test('rutas protegidas exigen autenticación', async () => {
  assert.equal((await req('GET', '/api/v1/me')).status, 401);
  assert.equal((await req('GET', '/api/v1/me', { token: 'tgk_falso' })).status, 401);
  assert.equal((await req('GET', '/api/admin/companies')).status, 401);
  assert.equal((await req('GET', '/api/admin/companies', { token: state.tokenA })).status, 401);
});

test('la empresa registra su bot y otra empresa no puede reutilizarlo', async () => {
  const r = await req('POST', '/api/v1/bots', { token: state.tokenA, body: { token: '111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'connected');
  assert.equal(r.data.mode, 'webhook');
  assert.equal(r.data.token_enc, undefined);
  state.botA = r.data.id;

  const hook = telegramCalls.find((c) => c.method === 'setWebhook');
  assert.equal(hook.body.url, `https://example.test/webhook/telegram/${state.botA}`);

  const dup = await req('POST', '/api/v1/bots', { token: state.tokenB, body: { token: '111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
  assert.equal(dup.status, 409);

  const raw = db.prepare('SELECT token_enc FROM bots WHERE id = ?').get(state.botA).token_enc;
  assert.ok(!raw.includes('111:'), 'el token de Telegram se guarda cifrado');
});

test('webhook de Telegram: valida el secreto, guarda el mensaje y lo reenvía firmado', async () => {
  const webhookUrl = `http://127.0.0.1:${hookServer.address().port}/hook`;
  await req('PUT', '/api/v1/settings', { token: state.tokenA, body: { webhook_url: webhookUrl } });

  const update = {
    update_id: 1,
    message: { message_id: 7, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: 'private', first_name: 'Ana' }, from: { id: 42, first_name: 'Ana' }, photo: [{ file_id: 'small' }, { file_id: 'BIG' }], caption: 'mira' },
  };
  const bad = await realFetch(`${base}/webhook/telegram/${state.botA}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'no' }, body: JSON.stringify(update) });
  assert.equal(bad.status, 401);

  const secret = db.prepare('SELECT webhook_secret FROM bots WHERE id = ?').get(state.botA).webhook_secret;
  const ok = await realFetch(`${base}/webhook/telegram/${state.botA}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update) });
  assert.equal(ok.status, 200);

  const msgs = await req('GET', '/api/v1/messages?direction=in', { token: state.tokenA });
  assert.equal(msgs.data.length, 1);
  assert.equal(msgs.data[0].type, 'photo');
  assert.equal(msgs.data[0].file_id, 'BIG');
  state.photoMsg = msgs.data[0].id;

  for (let i = 0; i < 20 && !hookHits.length; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(hookHits.length, 1);
  const me = await req('GET', '/api/v1/me', { token: state.tokenA });
  const expected = crypto.createHmac('sha256', me.data.webhook_secret).update(hookHits[0].raw).digest('hex');
  assert.equal(hookHits[0].headers['x-signature'], expected);
  assert.equal(JSON.parse(hookHits[0].raw).event, 'message.received');

  const deliveries = await req('GET', '/api/v1/webhook-deliveries', { token: state.tokenA });
  assert.equal(deliveries.data[0].success, 1);
});

test('descarga del archivo recibido a través del proxy', async () => {
  const r = await req('GET', `/api/v1/messages/${state.photoMsg}/file`, { token: state.tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(r.data, 'IMAGEN');
  const other = await req('GET', `/api/v1/messages/${state.photoMsg}/file`, { token: state.tokenB });
  assert.equal(other.status, 404);
});

test('envío de texto y de archivo (multipart)', async () => {
  const t = await req('POST', '/api/v1/messages/send', { token: state.tokenA, body: { chat_id: '42', text: 'Hola' } });
  assert.equal(t.status, 201);
  assert.equal(t.data.status, 'sent');

  const form = new FormData();
  form.append('bot_id', String(state.botA));
  form.append('chat_id', '42');
  form.append('text', 'Factura');
  form.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'factura.pdf');
  const f = await req('POST', '/api/v1/messages/send', { token: state.tokenA, form });
  assert.equal(f.status, 201);
  assert.equal(f.data.type, 'document');
  assert.equal(f.data.file_name, 'factura.pdf');
  const call = telegramCalls.filter((c) => c.method === 'sendDocument').pop();
  assert.equal(call.body.caption, 'Factura');
});

test('aislamiento entre empresas', async () => {
  const msgs = await req('GET', '/api/v1/messages', { token: state.tokenB });
  assert.deepEqual(msgs.data, []);
  const chats = await req('GET', '/api/v1/chats', { token: state.tokenB });
  assert.deepEqual(chats.data, []);
  const send = await req('POST', '/api/v1/messages/send', { token: state.tokenB, body: { bot_id: state.botA, chat_id: '42', text: 'x' } });
  assert.equal(send.status, 404);
  const del = await req('DELETE', `/api/v1/bots/${state.botA}`, { token: state.tokenB });
  assert.equal(del.status, 404);
});

test('paginación de mensajes con before_id', async () => {
  const all = await req('GET', '/api/v1/messages?limit=200', { token: state.tokenA });
  const last = all.data[all.data.length - 1].id;
  const older = await req('GET', `/api/v1/messages?before_id=${last}&limit=1`, { token: state.tokenA });
  assert.equal(older.data.length, 1);
  assert.ok(older.data[0].id < last);
});

test('regenerar el token invalida el anterior; desactivar bloquea el acceso', async () => {
  const r = await req('POST', `/api/admin/companies/${state.companyA}/regenerate-token`, { cookie: adminCookie });
  assert.equal((await req('GET', '/api/v1/me', { token: state.tokenA })).status, 401);
  state.tokenA = r.data.api_token;
  assert.equal((await req('GET', '/api/v1/me', { token: state.tokenA })).status, 200);

  await req('POST', `/api/admin/companies/${state.companyA}/toggle`, { cookie: adminCookie });
  assert.equal((await req('GET', '/api/v1/me', { token: state.tokenA })).status, 403);
  const login = await req('POST', '/auth/company/login', { body: { token: state.tokenA } });
  assert.equal(login.status, 403);
});

test('cambio de contraseña del administrador', async () => {
  const bad = await req('POST', '/api/admin/password', { cookie: adminCookie, body: { current_password: 'mal', new_password: 'nueva12345' } });
  assert.equal(bad.status, 422);
  const ok = await req('POST', '/api/admin/password', { cookie: adminCookie, body: { current_password: 'secret123', new_password: 'nueva12345' } });
  assert.equal(ok.status, 200);
  const login = await req('POST', '/auth/admin/login', { body: { email: 'admin@test.local', password: 'nueva12345' } });
  assert.equal(login.status, 200);
});
