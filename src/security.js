const crypto = require('crypto');
const config = require('./config');

const encKey = crypto.createHash('sha256').update('enc:' + config.appKey).digest();
const signKey = crypto.createHash('sha256').update('sign:' + config.appKey).digest();

const randomHex = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Token de API de una empresa: se muestra una sola vez, en BD solo se guarda su hash. */
function generateApiToken() {
  const token = 'tgk_' + randomHex(24);
  return { token, hash: sha256(token), prefix: token.slice(0, 12) };
}

/** Cifrado AES-256-GCM para los tokens de bots de Telegram. */
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(payload) {
  const [iv, tag, data] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

/** Sesión firmada con HMAC (para el panel web). */
function signSession(payload, ttlSeconds = 60 * 60 * 12) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', signKey).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(value) {
  if (!value || typeof value !== 'string') return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', signKey).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function hmacHex(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

module.exports = {
  randomHex, sha256, safeEqual, generateApiToken, encrypt, decrypt,
  hashPassword, verifyPassword, signSession, verifySession, hmacHex,
};
