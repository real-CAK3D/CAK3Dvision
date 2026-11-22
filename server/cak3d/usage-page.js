const app = document.getElementById('app');
const meta = document.getElementById('meta');
const COLORS = { ok: 'var(--ok)', warn: 'var(--warn)', over: 'var(--over)', unset: 'var(--unset)' };
let editing = false;

const fmt = (n) => (n ?? 0).toLocaleString();
const bytes = (b) =>
  !b ? '' : b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}

async function save(provider, metric, day, month, block) {
  const body = { provider, metric, day, month };
  if (typeof block === 'boolean') body.block = block;
  const r = await fetch('/api/cak3d/usage/limits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  render(await r.json());
}

function metricRow(p, m) {
  const dayIn = el('input', { type: 'number', min: 0, placeholder: 'none', value: m.limit.day ?? '' });
  const monIn = el('input', { type: 'number', min: 0, placeholder: 'none', value: m.limit.month ?? '' });
  for (const i of [dayIn, monIn]) {
    i.addEventListener('focus', () => (editing = true));
    i.addEventListener('blur', () => (editing = false));
  }
  const btn = el('button', {
    onclick: async () => {
      btn.textContent = '…';
      try {
        await save(p.id, m.metric, dayIn.value, monIn.value);
      } catch (e) {
        btn.textContent = 'error';
        alert(e.message);
      }
    },
  }, 'Save');
  const max = Math.max(1, ...m.history);
  const pct = Math.min(100, m.pct ?? 0);
  const extra = [
    bytes(m.monthBytes) && `${bytes(m.monthBytes)} this month`,
    m.failedToday && `${fmt(m.failedToday)} failed today`,
    m.blockedToday && `${fmt(m.blockedToday)} BLOCKED today`,
  ].filter(Boolean).join(' · ');
  return el('div', { class: 'metric' },
    el('div', { class: 'mrow' },
      el('span', { class: 'mname' }, m.metric, ' ',
        el('span', { class: `s-${m.status}`, style: 'font-size:12px' },
          m.status === 'unset' ? 'no limit set' : `${m.pct}%`)),
      el('span', { class: 'nums' }, 'today ', el('b', {}, fmt(m.today)), '  ·  month ', el('b', {}, fmt(m.month)))),
    el('div', { class: 'bar' }, el('i', { style: `width:${pct}%;background:${COLORS[m.status]}` })),
    el('div', { class: 'spark', title: 'last 14 days' },
      m.history.map((v) => el('i', { style: `height:${Math.round((v / max) * 100)}%`, title: fmt(v) }))),
    extra && el('div', { class: 'note' }, extra),
    el('div', { class: 'limits' }, 'per day', dayIn, 'per month', monIn, btn),
  );
}

function card(p) {
  const used = p.metrics.some((m) => m.month > 0);
  const blockable = p.side !== 'browser';
  const blockBox = el('input', {
    type: 'checkbox',
    checked: p.block,
    onchange: async () => {
      const m = p.metrics[0];
      if (!m) return;
      await save(p.id, m.metric, m.limit.day ?? '', m.limit.month ?? '', blockBox.checked);
    },
  });
  return el('section', { class: `card${!p.keySet && !used ? ' dim' : ''}` },
    el('h2', {}, p.label,
      el('span', { class: 'tag' }, p.side === 'both' ? 'server + browser' : p.side),
      el('span', { class: `tag ${p.keySet ? 'key-on' : 'key-off'}` }, p.keySet ? 'key set' : 'no key')),
    el('div', { class: 'note' }, p.note || '', p.note ? ' ' : '', el('a', { href: p.console, target: '_blank', rel: 'noopener' }, 'provider console ↗')),
    p.metrics.length ? p.metrics.map((m) => metricRow(p, m)) : el('div', { class: 'empty' }, 'No calls recorded yet.'),
    blockable && p.metrics.length
      ? el('label', { class: 'block' }, blockBox, 'Hard stop: refuse server calls once a limit is hit')
      : p.side === 'browser'
        ? el('div', { class: 'note' }, 'Browser-side calls can be counted, not stopped. Set a hard quota in the provider console.')
        : null,
  );
}

function render(data) {
  const all = data.providers.flatMap((p) => p.metrics.map((m) => ({ ...m, label: p.label })));
  const over = all.filter((m) => m.status === 'over').length;
  const warn = all.filter((m) => m.status === 'warn').length;
  const unset = data.providers.filter((p) => p.keySet && p.metrics.every((m) => m.status === 'unset')).length;
  meta.textContent = `${data.today} · updated ${new Date(data.generatedAt).toLocaleTimeString()} · warns at ${Math.round(data.warnAt * 100)}%`;
  const sorted = [...data.providers].sort(
    (a, b) => Number(b.keySet) - Number(a.keySet) || b.metrics.reduce((s, m) => s + m.month, 0) - a.metrics.reduce((s, m) => s + m.month, 0),
  );
  app.replaceChildren(
    el('div', { class: 'summary' },
      el('span', { class: 'chip s-over' }, `${over} over limit`),
      el('span', { class: 'chip s-warn' }, `${warn} near limit`),
      el('span', { class: 'chip s-unset' }, `${unset} keyed providers with no limit set`)),
    ...sorted.map(card),
  );
}

async function refresh() {
  if (editing) return;
  try {
    render(await fetch('/api/cak3d/usage', { cache: 'no-store' }).then((r) => r.json()));
  } catch (e) {
    app.replaceChildren(el('div', { id: 'err' }, `Could not load usage: ${e.message}`));
  }
}
refresh();
setInterval(refresh, 30000);
