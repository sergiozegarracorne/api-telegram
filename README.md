# TeleHub · API de Telegram multiempresa

API REST + panel web (Node.js, Express, SQLite y Tailwind CSS) para que **varias empresas** envíen y reciban mensajes de Telegram, cada una con **sus propios bots** (sus propios "números").

## Cómo funciona

```
 Administrador ──► registra Empresa ──► genera token tgk_…  (se muestra una sola vez)
                                          │
 Empresa ──► inicia sesión / usa la API con su token
         ──► registra el token de su(s) bot(s) de Telegram (@BotFather)
                                          │
 Usuario en Telegram ──► escribe al bot ──► Telegram ──► /webhook/telegram/:botId
                                                         │
                         Bandeja del panel (tiempo real) ◄┤
                         Webhook de la empresa (firmado) ◄┘
 Empresa ──► POST /api/v1/messages/send ──► Telegram ──► usuario
```

- **Multiempresa**: cada empresa solo ve sus bots, chats y mensajes.
- **Varios bots por empresa**: cada uno con su token y su webhook propio en Telegram.
- **Seguridad**: los tokens de empresa se guardan como hash SHA-256; los tokens de Telegram cifrados con AES-256-GCM; los webhooks de Telegram se validan con `secret_token`; los webhooks salientes van firmados con HMAC-SHA256.
- **Multimedia**: recibe fotos, documentos, audios, notas de voz y videos (vista previa en el panel) y envía archivos adjuntos (hasta 20 MB).
- **Webhook saliente con reintentos** (3 intentos) e historial de entregas.
- **Recepción**: por **webhook** (producción, requiere `PUBLIC_URL` con HTTPS) o por **polling** automático (desarrollo local, sin dominio).

## Requisitos

- Node.js 20 o superior

## Instalación

```bash
npm install
cp .env.example .env      # edita APP_KEY, ADMIN_EMAIL, ADMIN_PASSWORD y PUBLIC_URL
npm start                 # o: npm run dev
```

Genera una `APP_KEY` segura con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> ⚠️ No cambies la `APP_KEY` después de registrar bots: se usa para descifrar sus tokens.

Abre `http://localhost:3000`:

| Ruta     | Descripción                                              |
|----------|----------------------------------------------------------|
| `/`      | Login (pestaña Empresa con token / pestaña Administrador) |
| `/admin` | Panel del administrador: empresas, tokens, estado         |
| `/app`   | Panel de la empresa: resumen, bandeja, bots, integración  |
| `/docs`  | Documentación de la API                                   |

## Uso rápido

1. Ingresa como administrador (credenciales del `.env`) y crea una empresa → copia el token `tgk_…`.
2. Ingresa como empresa con ese token → **Bots / Números** → pega el token de tu bot de BotFather.
3. Escribe al bot desde Telegram: el mensaje aparece en la **Bandeja** en tiempo real y puedes responder.

## API (resumen)

Autenticación: `Authorization: Bearer <token de empresa>`

| Método | Ruta                                         | Descripción                          |
|--------|----------------------------------------------|--------------------------------------|
| GET    | `/api/v1/me`                                 | Datos y estadísticas de la empresa   |
| GET    | `/api/v1/bots`                               | Listar bots                          |
| POST   | `/api/v1/bots`                               | Registrar bot `{ token }`            |
| POST   | `/api/v1/bots/:id/reconnect`                 | Reconectar bot                       |
| DELETE | `/api/v1/bots/:id`                           | Eliminar bot                         |
| GET    | `/api/v1/chats`                              | Conversaciones (`bot_id`, `q`)       |
| POST   | `/api/v1/chats/:id/read`                     | Marcar como leída                    |
| GET    | `/api/v1/messages`                           | Mensajes (`bot_id`, `chat_id`, `direction`, `after_id`, `before_id`, `limit`) |
| GET    | `/api/v1/messages/:id/file`                  | Descargar el archivo de un mensaje   |
| POST   | `/api/v1/messages/send`                      | Enviar `{ bot_id, chat_id, text, type?, media_url?, parse_mode? }` (JSON) o con `file` (multipart) |
| GET    | `/api/v1/webhook-deliveries`                 | Historial de entregas del webhook    |
| POST   | `/api/v1/settings/test-webhook`              | Enviar un evento `ping` de prueba    |
| PUT    | `/api/v1/settings`                           | Configurar `{ webhook_url }`         |
| POST   | `/api/v1/settings/regenerate-webhook-secret` | Nuevo secreto de firma               |

```bash
curl -X POST http://localhost:3000/api/v1/messages/send \
  -H "Authorization: Bearer tgk_xxx" -H "Content-Type: application/json" \
  -d '{"bot_id": 1, "chat_id": "123456789", "text": "Hola 👋"}'
```

Documentación completa (incluye formato del webhook y verificación de firma en Node/PHP) en `/docs`.

## Tests

```bash
npm test
```

Pruebas de integración (`node:test`) con la Bot API de Telegram simulada: autenticación, registro de bots, webhook entrante y saliente firmado, envío y descarga de archivos, aislamiento entre empresas y regeneración de tokens.

## Docker

```bash
cp .env.example .env   # configura APP_KEY, PUBLIC_URL, etc.
docker compose up -d --build
```

La base de datos se guarda en el volumen `telehub-data`.

## Producción

- Define `PUBLIC_URL=https://tu-dominio.com` (Telegram exige HTTPS) y `NODE_ENV=production` (cookies `secure`).
- Ejecuta detrás de un proxy (Nginx/Caddy) con TLS. Para SSE, desactiva el buffering en `/api/v1/stream`.
- Usa un gestor de procesos (pm2, systemd o el `docker-compose.yml` incluido). El servidor se cierra de forma ordenada con `SIGTERM`/`SIGINT`.
- El panel usa Tailwind vía CDN (`@tailwindcss/browser`); si prefieres compilarlo, puedes migrar a la CLI de Tailwind sin cambiar las clases.

## Estructura

```
src/
  server.js        Arranque de Express, rutas y creación del admin inicial
  config.js        Variables de entorno
  db.js            Esquema SQLite
  security.js      Tokens, cifrado, contraseñas, sesiones firmadas, HMAC
  auth.js          Middlewares requireAdmin / requireCompany
  telegram.js      Cliente Bot API, webhook/polling, entrada y salida de mensajes
  events.js        Bus de eventos para tiempo real (SSE)
  routes/
    auth.js        Login admin / empresa, logout
    admin.js       CRUD de empresas y tokens
    api.js         API v1 de empresas
    webhook.js     Endpoint que recibe las actualizaciones de Telegram
public/
  index.html  admin.html  app.html  docs.html  js/
test/
  api.test.js      Pruebas de integración
```
