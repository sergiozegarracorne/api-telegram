const state = { me: null, bots: [], chats: [], current: null };

const statusBadge = (s) => ({
  connected: '<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300"><span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>Conectado</span>',
  error: '<span class="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-300"><span class="h-1.5 w-1.5 rounded-full bg-rose-400"></span>Error</span>',
  disabled: '<span class="rounded-full bg-slate-500/15 px-2.5 py-0.5 text-xs font-medium text-slate-300">Deshabilitado</span>',
}[s] || '<span class="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">Pendiente</span>');

const typeIcon = { photo: '🖼️', document: '📎', voice: '🎤', audio: '🎵', video: '🎬', sticker: '💟', location: '📍', contact: '👤', other: '✳️' };

/* ----------------------------- Navegación ----------------------------- */

function route() {
  const view = (location.hash || '#dashboard').slice(1);
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  if (view === 'dashboard') loadDashboard();
  if (view === 'inbox') loadChats();
  if (view === 'bots') renderBots();
  if (view === 'integration') renderIntegration();
}
window.addEventListener('hashchange', route);

/* ------------------------------- Datos -------------------------------- */

async function loadMe() {
  state.me = await api('/api/v1/me');
  $('#company-name').textContent = state.me.name;
  $('#hello-name').textContent = state.me.name;
  $('#company-avatar').textContent = initials(state.me.name);
  updateUnread(state.me.stats.unread);
}

async function loadBots() {
  state.bots = await api('/api/v1/bots');
  const opts = state.bots.map((b) => `<option value="${b.id}">${esc(b.name)} (@${esc(b.username)})</option>`).join('');
  $('#chat-bot-filter').innerHTML = `<option value="">Todos los bots</option>${opts}`;
  $('#form-new').bot_id.innerHTML = opts;
}

function updateUnread(n) {
  const el = $('#nav-unread');
  el.textContent = n;
  el.classList.toggle('hidden', !n);
}

/* ------------------------------ Resumen ------------------------------- */

async function loadDashboard() {
  await loadMe();
  const s = state.me.stats;
  const cards = [
    ['Bots conectados', s.bots, 'from-sky-500/20', 'text-sky-300'],
    ['Conversaciones', s.chats, 'from-indigo-500/20', 'text-indigo-300'],
    ['Recibidos', s.messages_in, 'from-emerald-500/20', 'text-emerald-300'],
    ['Enviados', s.messages_out, 'from-fuchsia-500/20', 'text-fuchsia-300'],
  ];
  $('#stats').innerHTML = cards.map(([label, value, grad, color]) => `
    <div class="card relative overflow-hidden p-5">
      <div class="absolute inset-0 bg-gradient-to-br ${grad} to-transparent"></div>
      <div class="relative"><p class="text-sm text-slate-400">${label}</p><p class="mt-2 text-3xl font-bold ${color}">${Number(value).toLocaleString()}</p></div>
    </div>`).join('');

  const chats = await api('/api/v1/chats');
  $('#recent-chats').innerHTML = chats.slice(0, 6).map(chatItem).join('') || emptyText('Aún no hay conversaciones.');
  $('#dash-bots').innerHTML = state.bots.map((b) => `
    <div class="flex items-center justify-between rounded-xl bg-white/[.03] p-3">
      <div><p class="text-sm font-medium">${esc(b.name)}</p><p class="text-xs text-slate-500">@${esc(b.username)}</p></div>
      ${statusBadge(b.status)}
    </div>`).join('') || emptyText('No tienes bots. <a href="#bots" class="text-sky-400">Conecta el primero →</a>');
}

const emptyText = (html) => `<p class="py-8 text-center text-sm text-slate-500">${html}</p>`;

/* ------------------------------ Bandeja ------------------------------- */

function chatItem(c) {
  const active = state.current?.id === c.id;
  return `
    <button onclick="openChat(${c.id})" class="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition ${active ? 'bg-sky-500/15 ring-1 ring-sky-500/30' : 'hover:bg-white/5'}">
      <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${avatarColor(c.chat_id)} text-sm font-bold">${esc(initials(c.title || c.chat_id))}</div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <p class="truncate text-sm font-semibold">${esc(c.title || c.chat_id)}</p>
          <span class="shrink-0 text-[11px] text-slate-500">${fmtTime(c.last_message_at)}</span>
        </div>
        <div class="flex items-center justify-between gap-2">
          <p class="truncate text-xs text-slate-400">${esc(c.last_message || '')}</p>
          ${c.unread ? `<span class="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-sky-500 px-1.5 text-[11px] font-bold text-white">${c.unread}</span>` : ''}
        </div>
        ${c.bot_username ? `<p class="mt-0.5 truncate text-[11px] text-slate-600">vía @${esc(c.bot_username)}</p>` : ''}
      </div>
    </button>`;
}

async function loadChats() {
  const params = new URLSearchParams();
  if ($('#chat-bot-filter').value) params.set('bot_id', $('#chat-bot-filter').value);
  if ($('#chat-search').value) params.set('q', $('#chat-search').value);
  state.chats = await api('/api/v1/chats?' + params);
  renderChatList();
}

function renderChatList() {
  $('#chat-list').innerHTML = state.chats.map(chatItem).join('') || emptyText('Sin conversaciones todavía.<br>Escribe a tu bot desde Telegram para comenzar.');
}

function bubble(m) {
  const out = m.direction === 'out';
  const failed = m.status === 'failed';
  const media = m.type !== 'text' ? `<p class="mb-1 text-xs opacity-80">${typeIcon[m.type] || ''} ${esc(m.type)}${m.media_url ? ` · <a href="${esc(m.media_url)}" target="_blank" class="underline">abrir</a>` : ''}</p>` : '';
  return `
    <div class="flex ${out ? 'justify-end' : 'justify-start'}" data-mid="${m.id}">
      <div class="max-w-[75%] rounded-2xl px-4 py-2 shadow-sm ${out ? (failed ? 'rounded-br-md bg-rose-600/80' : 'rounded-br-md bg-gradient-to-br from-sky-500 to-indigo-600') : 'rounded-bl-md bg-slate-800'}">
        ${!out && m.sender_name ? `<p class="mb-0.5 text-xs font-semibold text-sky-300">${esc(m.sender_name)}</p>` : ''}
        ${media}
        ${m.text ? `<p class="whitespace-pre-wrap break-words text-sm">${esc(m.text)}</p>` : ''}
        <p class="mt-1 text-right text-[10px] ${out ? 'text-white/70' : 'text-slate-500'}">${fmtTime(m.created_at)}${out ? (failed ? ` · ⚠ ${esc(m.error || 'falló')}` : ' · ✓') : ''}</p>
      </div>
    </div>`;
}

async function openChat(id) {
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return;
  state.current = chat;
  renderChatList();
  $('#conv-empty').classList.add('hidden');
  $('#conv').classList.remove('hidden');
  $('#conv').classList.add('flex');
  $('#conversation-pane').classList.remove('hidden');
  $('#conversation-pane').classList.add('flex');
  $('#chat-list-pane').classList.add('hidden', 'sm:flex');

  $('#conv-title').textContent = chat.title || chat.chat_id;
  $('#conv-sub').textContent = `${chat.username ? '@' + chat.username + ' · ' : ''}ID ${chat.chat_id} · vía @${chat.bot_username}`;
  $('#conv-avatar').className = `grid h-10 w-10 place-items-center rounded-xl text-sm font-bold bg-gradient-to-br ${avatarColor(chat.chat_id)}`;
  $('#conv-avatar').textContent = initials(chat.title || chat.chat_id);

  const msgs = await api(`/api/v1/messages?chat=${id}&limit=100`);
  $('#messages').innerHTML = msgs.map(bubble).join('');
  scrollBottom();

  if (chat.unread) {
    await api(`/api/v1/chats/${id}/read`, { method: 'POST' });
    chat.unread = 0;
    renderChatList();
    loadMe();
  }
}

function closeConversation() {
  state.current = null;
  $('#conversation-pane').classList.add('hidden');
  $('#conversation-pane').classList.remove('flex');
  $('#chat-list-pane').classList.remove('hidden');
  renderChatList();
}

const scrollBottom = () => { const el = $('#messages'); el.scrollTop = el.scrollHeight; };

const composer = $('#composer');
composer.text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
composer.text.addEventListener('input', () => {
  composer.text.style.height = 'auto';
  composer.text.style.height = composer.text.scrollHeight + 'px';
});
composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = composer.text.value.trim();
  if (!text || !state.current) return;
  composer.text.value = '';
  composer.text.style.height = 'auto';
  try {
    await api('/api/v1/messages/send', { method: 'POST', body: { bot_id: state.current.bot_id, chat_id: state.current.chat_id, text } });
  } catch (err) {
    toast(err.message, 'error');
  }
});

let chatSearchTimer;
$('#chat-search').addEventListener('input', () => { clearTimeout(chatSearchTimer); chatSearchTimer = setTimeout(loadChats, 250); });
$('#chat-bot-filter').addEventListener('change', loadChats);

const formNew = $('#form-new');
formNew.type.addEventListener('change', () => $('#media-field').classList.toggle('hidden', formNew.type.value === 'text'));
formNew.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(formNew));
  try {
    await api('/api/v1/messages/send', { method: 'POST', body });
    toast('Mensaje enviado');
    closeModal('#modal-new');
    formNew.reset();
    $('#media-field').classList.add('hidden');
    loadChats();
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* -------------------------------- Bots -------------------------------- */

function renderBots() {
  $('#bots-grid').innerHTML = state.bots.map((b) => `
    <div class="card p-5">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${avatarColor(b.username)} text-lg font-bold">${esc(initials(b.name))}</div>
          <div>
            <p class="font-semibold">${esc(b.name)}</p>
            <a href="https://t.me/${esc(b.username)}" target="_blank" class="text-sm text-sky-400 hover:underline">@${esc(b.username)}</a>
          </div>
        </div>
        ${statusBadge(b.status)}
      </div>
      <dl class="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div class="rounded-xl bg-white/[.03] p-3"><dt class="text-slate-500">ID del bot (bot_id API)</dt><dd class="mt-0.5 font-mono text-slate-200">${b.id}</dd></div>
        <div class="rounded-xl bg-white/[.03] p-3"><dt class="text-slate-500">Modo</dt><dd class="mt-0.5 text-slate-200">${b.mode === 'webhook' ? 'Webhook' : 'Polling'}</dd></div>
      </dl>
      ${b.last_error ? `<p class="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">${esc(b.last_error)}</p>` : ''}
      <div class="mt-4 flex gap-2">
        <button onclick="reconnectBot(${b.id})" class="btn btn-ghost flex-1 !py-2 text-xs">Reconectar</button>
        <button onclick="removeBot(${b.id})" class="btn flex-1 border border-rose-500/30 !py-2 text-xs text-rose-300 hover:bg-rose-500/10">Eliminar</button>
      </div>
    </div>`).join('') || `<div class="card col-span-full p-10 text-center text-slate-500">Aún no conectaste ningún bot.</div>`;
}

$('#form-bot').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Conectando…';
  try {
    const bot = await api('/api/v1/bots', { method: 'POST', body: { token: e.target.token.value } });
    toast(`Bot @${bot.username} conectado`);
    e.target.reset();
    await loadBots();
    renderBots();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Conectar bot';
  }
});

async function reconnectBot(id) {
  try {
    const bot = await api(`/api/v1/bots/${id}/reconnect`, { method: 'POST' });
    toast(bot.status === 'connected' ? 'Bot reconectado' : bot.last_error || 'No se pudo reconectar', bot.status === 'connected' ? 'success' : 'error');
    await loadBots();
    renderBots();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeBot(id) {
  if (!confirm('¿Eliminar este bot? Se borrarán también sus conversaciones y mensajes.')) return;
  try {
    await api(`/api/v1/bots/${id}`, { method: 'DELETE' });
    toast('Bot eliminado');
    await loadBots();
    renderBots();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ----------------------------- Integración ---------------------------- */

function renderIntegration() {
  const origin = location.origin;
  const botId = state.bots[0]?.id ?? 1;
  $('#token-hint').textContent = state.me.api_token_prefix;
  $('#form-webhook').webhook_url.value = state.me.webhook_url || '';
  $('#webhook-secret').textContent = state.me.webhook_secret;
  $('#ex-send').textContent = `curl -X POST ${origin}/api/v1/messages/send \\
  -H "Authorization: Bearer TU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"bot_id": ${botId}, "chat_id": "123456789", "text": "Hola desde mi sistema 👋"}'`;
  $('#ex-list').textContent = `curl ${origin}/api/v1/messages?direction=in&limit=20 \\
  -H "Authorization: Bearer TU_TOKEN"`;
}

$('#form-webhook').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/api/v1/settings', { method: 'PUT', body: { webhook_url: e.target.webhook_url.value } });
    state.me.webhook_url = res.webhook_url;
    toast('Webhook guardado');
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function regenSecret() {
  if (!confirm('¿Regenerar el secreto? Deberás actualizarlo en tu sistema.')) return;
  const res = await api('/api/v1/settings/regenerate-webhook-secret', { method: 'POST' });
  state.me.webhook_secret = res.webhook_secret;
  $('#webhook-secret').textContent = res.webhook_secret;
  toast('Secreto regenerado');
}

/* --------------------------- Tiempo real (SSE) ------------------------ */

function connectStream() {
  const es = new EventSource('/api/v1/stream');

  es.addEventListener('message', (e) => {
    const { message, chat } = JSON.parse(e.data);
    if (chat) {
      const idx = state.chats.findIndex((c) => c.id === chat.id);
      const bot = state.bots.find((b) => b.id === chat.bot_id);
      const merged = { ...state.chats[idx], ...chat, bot_username: bot?.username, bot_name: bot?.name };
      if (state.current?.id === chat.id) merged.unread = 0;
      if (idx >= 0) state.chats.splice(idx, 1);
      state.chats.unshift(merged);
      if (!$('#view-inbox').classList.contains('hidden')) renderChatList();
    }
    if (state.current && message.chat_ref === state.current.id && !$(`[data-mid="${message.id}"]`)) {
      $('#messages').insertAdjacentHTML('beforeend', bubble(message));
      scrollBottom();
      if (message.direction === 'in') api(`/api/v1/chats/${state.current.id}/read`, { method: 'POST' }).catch(() => {});
    } else if (message.direction === 'in') {
      toast(`Nuevo mensaje de ${message.sender_name || chat?.title || 'Telegram'}`, 'info');
      updateUnread((Number($('#nav-unread').textContent) || 0) + 1);
    }
  });

  es.addEventListener('bot', (e) => {
    const bot = JSON.parse(e.data);
    const idx = state.bots.findIndex((b) => b.id === bot.id);
    if (idx >= 0) state.bots[idx] = bot;
    if (location.hash === '#bots') renderBots();
  });
}

/* -------------------------------- Init -------------------------------- */

(async () => {
  await Promise.all([loadMe(), loadBots()]);
  route();
  connectStream();
})();
