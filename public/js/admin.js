let companies = [];

const statusBadge = (s) => ({
  connected: '<span class="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">Conectado</span>',
  error: '<span class="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300">Error</span>',
  disabled: '<span class="rounded-full bg-slate-500/15 px-2 py-0.5 text-xs text-slate-300">Deshabilitado</span>',
}[s] || '<span class="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">Pendiente</span>');

async function loadStats() {
  const s = await api('/api/admin/stats');
  const cards = [
    ['Empresas', s.companies, `${s.active_companies} activas`, 'from-sky-500/20 to-sky-500/0', 'text-sky-300'],
    ['Bots conectados', s.bots, 'Números de Telegram', 'from-indigo-500/20 to-indigo-500/0', 'text-indigo-300'],
    ['Mensajes hoy', s.messages_today, 'Entrantes y salientes', 'from-emerald-500/20 to-emerald-500/0', 'text-emerald-300'],
    ['Mensajes totales', s.messages_total, 'Histórico', 'from-fuchsia-500/20 to-fuchsia-500/0', 'text-fuchsia-300'],
  ];
  $('#stats').innerHTML = cards.map(([label, value, sub, grad, color]) => `
    <div class="card relative overflow-hidden p-5">
      <div class="absolute inset-0 bg-gradient-to-br ${grad}"></div>
      <div class="relative">
        <p class="text-sm text-slate-400">${label}</p>
        <p class="mt-2 text-3xl font-bold ${color}">${Number(value).toLocaleString()}</p>
        <p class="mt-1 text-xs text-slate-500">${sub}</p>
      </div>
    </div>`).join('');
}

async function loadCompanies() {
  companies = await api('/api/admin/companies?q=' + encodeURIComponent($('#search').value));
  if (!companies.length) {
    $('#companies').innerHTML = `<tr><td colspan="7" class="px-5 py-16 text-center text-slate-500">No hay empresas registradas todavía.</td></tr>`;
    return;
  }
  $('#companies').innerHTML = companies.map((c) => `
    <tr class="transition hover:bg-white/[.02]">
      <td class="px-5 py-4">
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${avatarColor(c.name)} text-sm font-bold">${esc(initials(c.name))}</div>
          <div class="min-w-0">
            <p class="truncate font-medium">${esc(c.name)}</p>
            <p class="truncate text-xs text-slate-500">${esc([c.tax_id, c.email].filter(Boolean).join(' · ') || 'Sin datos adicionales')}</p>
          </div>
        </div>
      </td>
      <td class="px-5 py-4"><code class="rounded-lg bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300">${esc(c.api_token_prefix)}…</code></td>
      <td class="px-5 py-4 text-center"><button onclick="showBots(${c.id})" class="rounded-lg px-2 py-1 font-semibold text-sky-300 hover:bg-sky-500/10">${c.bots_count}</button></td>
      <td class="px-5 py-4 text-center text-slate-300">${Number(c.messages_count).toLocaleString()}</td>
      <td class="px-5 py-4 text-slate-400">${fmtDate(c.last_login_at)}</td>
      <td class="px-5 py-4">
        <button onclick="toggleCompany(${c.id})" class="relative inline-flex h-6 w-11 items-center rounded-full transition ${c.active ? 'bg-emerald-500' : 'bg-slate-700'}" title="${c.active ? 'Desactivar' : 'Activar'}">
          <span class="inline-block h-5 w-5 rounded-full bg-white shadow transition ${c.active ? 'translate-x-5' : 'translate-x-0.5'}"></span>
        </button>
      </td>
      <td class="px-5 py-4">
        <div class="flex justify-end gap-1">
          <button onclick="openCompanyForm(${c.id})" class="rounded-lg px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10">Editar</button>
          <button onclick="regenerate(${c.id})" class="rounded-lg px-2.5 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10">Nuevo token</button>
          <button onclick="removeCompany(${c.id})" class="rounded-lg px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10">Eliminar</button>
        </div>
      </td>
    </tr>`).join('');
}

function openCompanyForm(id) {
  const form = $('#form-company');
  form.reset();
  const c = companies.find((x) => x.id === id);
  $('#company-form-title').textContent = c ? 'Editar empresa' : 'Nueva empresa';
  form.id.value = c?.id || '';
  if (c) ['name', 'tax_id', 'email', 'phone'].forEach((k) => (form[k].value = c[k] || ''));
  openModal('#modal-company');
  form.name.focus();
}

function showToken(company, token) {
  $('#token-company').textContent = company.name;
  $('#token-value').textContent = token;
  openModal('#modal-token');
}

$('#form-company').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    if (data.id) {
      await api(`/api/admin/companies/${data.id}`, { method: 'PUT', body: data });
      toast('Empresa actualizada');
    } else {
      const res = await api('/api/admin/companies', { method: 'POST', body: data });
      showToken(res.company, res.api_token);
    }
    closeModal('#modal-company');
    refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function regenerate(id) {
  if (!confirm('¿Generar un nuevo token? El token actual dejará de funcionar inmediatamente.')) return;
  try {
    const res = await api(`/api/admin/companies/${id}/regenerate-token`, { method: 'POST' });
    showToken(res.company, res.api_token);
    loadCompanies();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function toggleCompany(id) {
  try {
    const c = await api(`/api/admin/companies/${id}/toggle`, { method: 'POST' });
    toast(c.active ? 'Empresa activada' : 'Empresa desactivada', 'info');
    refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeCompany(id) {
  const c = companies.find((x) => x.id === id);
  if (!confirm(`¿Eliminar "${c.name}"? Se borrarán sus bots, chats y mensajes. Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/api/admin/companies/${id}`, { method: 'DELETE' });
    toast('Empresa eliminada');
    refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function showBots(id) {
  const c = companies.find((x) => x.id === id);
  $('#bots-company').textContent = c.name;
  const bots = await api(`/api/admin/companies/${id}/bots`);
  $('#bots-list').innerHTML = bots.length ? bots.map((b) => `
    <div class="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 p-3">
      <div>
        <p class="font-medium">${esc(b.name)} <span class="text-slate-500">@${esc(b.username)}</span></p>
        <p class="text-xs text-slate-500">Modo ${esc(b.mode)} · registrado ${fmtDate(b.created_at)}${b.last_error ? ` · <span class="text-rose-400">${esc(b.last_error)}</span>` : ''}</p>
      </div>
      ${statusBadge(b.status)}
    </div>`).join('') : '<p class="py-8 text-center text-sm text-slate-500">Esta empresa aún no registró bots.</p>';
  openModal('#modal-bots');
}

$('#form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    toast('Contraseña actualizada');
    e.target.reset();
    closeModal('#modal-password');
  } catch (err) {
    toast(err.message, 'error');
  }
});

let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadCompanies, 250);
});

function refresh() {
  loadStats();
  loadCompanies();
}

api('/api/admin/me').then((me) => {
  $('#admin-email').textContent = me.email;
  refresh();
});
