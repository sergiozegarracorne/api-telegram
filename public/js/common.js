// Utilidades compartidas por todas las páginas
window.$ = (sel, root = document) => root.querySelector(sel);
window.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];

window.api = async function api(url, { method = 'GET', body } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : {},
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/auth/')) {
    location.href = '/';
    throw new Error('Sesión expirada');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
};

window.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

window.fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
};

window.fmtTime = (v) => {
  if (!v) return '';
  const d = new Date(v.replace(' ', 'T') + 'Z');
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
};

window.toast = function toast(message, type = 'success') {
  let wrap = $('#toasts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toasts';
    wrap.className = 'fixed bottom-4 right-4 z-[100] flex flex-col gap-2';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  const color = type === 'error' ? 'bg-rose-600' : type === 'info' ? 'bg-slate-800' : 'bg-emerald-600';
  el.className = `${color} text-white text-sm px-4 py-3 rounded-xl shadow-lg shadow-black/20 transition-all duration-300 translate-y-2 opacity-0 max-w-sm`;
  el.textContent = message;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.remove('translate-y-2', 'opacity-0'));
  setTimeout(() => {
    el.classList.add('opacity-0');
    setTimeout(() => el.remove(), 300);
  }, 3500);
};

window.copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado al portapapeles', 'info');
  } catch {
    toast('No se pudo copiar', 'error');
  }
};

window.initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

window.avatarColor = (seed) => {
  const colors = ['from-sky-500 to-indigo-500', 'from-emerald-500 to-teal-500', 'from-fuchsia-500 to-pink-500', 'from-amber-500 to-orange-500', 'from-violet-500 to-purple-500', 'from-cyan-500 to-blue-500'];
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
};

window.logout = async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/';
};

window.openModal = (id) => { $(id).classList.remove('hidden'); $(id).classList.add('flex'); };
window.closeModal = (id) => { $(id).classList.add('hidden'); $(id).classList.remove('flex'); };
