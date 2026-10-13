const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db');
const { hashPassword } = require('./security');
const telegram = require('./telegram');

// Crea el super administrador en el primer arranque.
if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
  db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)')
    .run(config.adminEmail.toLowerCase(), hashPassword(config.adminPassword));
  console.log(`[setup] Administrador creado: ${config.adminEmail}`);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});

app.use('/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/v1', require('./routes/api'));
app.use('/webhook', require('./routes/webhook'));

const pub = path.join(__dirname, '..', 'public');
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get('/app', (req, res) => res.sendFile(path.join(pub, 'app.html')));
app.get('/docs', (req, res) => res.sendFile(path.join(pub, 'docs.html')));
app.use(express.static(pub));

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.name === 'MulterError') {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 422).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el límite de 20 MB' : err.message });
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose && !(err instanceof telegram.TelegramError) ? 'Error interno del servidor' : err.message });
});

module.exports = app;

if (require.main === module) {
  const server = app.listen(config.port, async () => {
    console.log(`[server] Escuchando en http://localhost:${config.port}`);
    console.log(`[server] Modo Telegram: ${config.publicUrl ? `webhook (${config.publicUrl})` : 'polling (sin PUBLIC_URL)'}`);
    await telegram.bootAllBots();
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} recibido, cerrando…`);
    telegram.stopAllPolling();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
