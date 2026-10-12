const db = require('./db');
const config = require('./config');
const { sha256, signSession, verifySession } = require('./security');

const COOKIE = 'tg_session';

function setSession(res, payload) {
  res.cookie(COOKIE, signSession(payload), {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProd,
    maxAge: 1000 * 60 * 60 * 12,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE);
}

const getSession = (req) => verifySession(req.cookies?.[COOKIE]);

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session || session.role !== 'admin') return res.status(401).json({ error: 'No autorizado' });
  const admin = db.prepare('SELECT id, email FROM admins WHERE id = ?').get(session.id);
  if (!admin) return res.status(401).json({ error: 'No autorizado' });
  req.admin = admin;
  next();
}

/**
 * Autentica a una empresa por:
 *  - Header `Authorization: Bearer <token>` (integraciones / API), o
 *  - Cookie de sesión (panel web), obtenida al iniciar sesión con el token.
 */
function requireCompany(req, res, next) {
  let company = null;
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (match) {
    company = db.prepare('SELECT * FROM companies WHERE api_token_hash = ?').get(sha256(match[1].trim()));
  } else {
    const session = getSession(req);
    if (session?.role === 'company') {
      company = db.prepare('SELECT * FROM companies WHERE id = ?').get(session.id);
      // Si el token se regeneró, la sesión anterior deja de ser válida.
      if (company && company.api_token_hash.slice(0, 16) !== session.th) company = null;
    }
  }

  if (!company) return res.status(401).json({ error: 'Token inválido o sesión expirada' });
  if (!company.active) return res.status(403).json({ error: 'La empresa está desactivada' });
  req.company = company;
  next();
}

module.exports = { setSession, clearSession, getSession, requireAdmin, requireCompany };
