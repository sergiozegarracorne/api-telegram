require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  appKey: process.env.APP_KEY || '',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin12345',
  dbPath: process.env.DB_PATH || './data/app.db',
  isProd: process.env.NODE_ENV === 'production',
};

if (config.appKey.length < 32) {
  console.error('[config] APP_KEY debe tener al menos 32 caracteres. Revisa tu archivo .env');
  process.exit(1);
}

module.exports = config;
