const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const fmt = (n) => nf.format(Math.round((+n || 0) * 100) / 100).replace(/,/g, ' ');
const money = (n) => fmt(n) + " so'm";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ddmm = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}, ${hhmm(iso)}`; };
const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik yuz berdi');
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3200);
}

function renderSide() {
  const el = $('side'); if (!el) return;
  const cur = document.body.dataset.page;
  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${p}</svg>`;
  const items = [
    ['dash', '/', 'Hisobot', svg('<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>')],
    ['sale', '/sale', 'Kassa', svg('<path d="M3 4h2.2l2.3 11.1a2 2 0 002 1.6h7.4a2 2 0 002-1.5L20 8H6.2"/><circle cx="10" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/>')],
    ['input', '/input', 'Tovar kiritish', svg('<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>')],
  ];
  el.innerHTML = `
    <div class="brand">
      <span class="mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/></svg></span>
      <div><b>Do'kon</b><small>hisob tizimi</small></div>
    </div>
    <nav class="nav" aria-label="Bo'limlar">
      ${items.map(([k, href, label, icon]) => `<a href="${href}"${k === cur ? ' aria-current="page"' : ''}>${icon}<span>${label}</span></a>`).join('')}
    </nav>
    <div class="side-foot"><i id="dbDot"></i><span id="dbText">Baza tekshirilmoqda</span></div>`;
}

async function health() {
  try {
    const d = await (await fetch('/api/health')).json();
    $('dbDot').className = d.ok ? 'ok' : 'bad';
    $('dbText').textContent = d.ok ? `MongoDB ulangan (${d.db})` : 'MongoDB ulanmagan';
  } catch { $('dbDot').className = 'bad'; $('dbText').textContent = 'Server javob bermayapti'; }
}

document.addEventListener('click', (e) => {
  if (e.target.tagName === 'DIALOG') e.target.close();
  const c = e.target.closest('[data-close]');
  if (c) c.closest('dialog')?.close();
});

renderSide(); health(); setInterval(health, 15000);