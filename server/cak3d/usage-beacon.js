// CAK3Dvision usage beacon. Counts this browser's own direct calls to metered
// providers (Google 3D tiles, Cesium ion, Maps JS, Street View, ...) from
// Resource Timing and reports them to /api/cak3d/usage/beacon. Calls the app
// makes through its own /api/* routes are same-origin and counted server-side.
// Also shows a small pill when any tracked limit is near or over.
const WATCH = [
  'googleapis.com',
  'cesium.com',
  'tomtom.com',
  'mapillary.com',
  'openai.com',
  'opensky-network.org',
  'nasa.gov',
  'worldnewsapi.com',
  'liveuamap.com',
  'thespacedevs.com',
];
const SKIP = ['fonts.googleapis.com'];
const pending = new Map();

function keyFor(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin === location.origin) return null;
  const h = u.hostname;
  if (SKIP.includes(h) || !WATCH.some((d) => h === d || h.endsWith(`.${d}`))) return null;
  const p = u.pathname.includes('/root.json')
    ? '/v1/3dtiles/root.json'
    : u.pathname.split('/').slice(0, 5).join('/');
  return `${h}${p}`;
}

function onEntries(list) {
  for (const e of list.getEntries()) {
    const k = keyFor(e.name);
    if (!k) continue;
    const cur = pending.get(k) || { n: 0, b: 0 };
    cur.n += 1;
    cur.b += e.transferSize || e.encodedBodySize || 0;
    pending.set(k, cur);
  }
}

function flush() {
  if (!pending.size) return;
  const entries = [...pending].slice(0, 500).map(([u, v]) => ({ u, n: v.n, b: v.b }));
  pending.clear();
  fetch('/api/cak3d/usage/beacon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
    keepalive: true,
  }).catch(() => {});
}

try {
  performance.setResourceTimingBufferSize?.(20000);
  new PerformanceObserver(onEntries).observe({ type: 'resource', buffered: true });
} catch {
  /* Resource Timing unavailable: server-side counts still work. */
}
setInterval(flush, 20000);
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});

// ---- near-limit pill ------------------------------------------------------
let pill;
async function checkLimits() {
  let data;
  try {
    data = await fetch('/api/cak3d/usage', { cache: 'no-store' }).then((r) => r.json());
  } catch {
    return;
  }
  let worst = null;
  for (const p of data.providers || [])
    for (const m of p.metrics || [])
      if ((m.status === 'warn' || m.status === 'over') && (!worst || m.pct > worst.pct))
        worst = { ...m, label: p.label };
  if (!worst) {
    pill?.remove();
    pill = null;
    return;
  }
  if (!pill) {
    pill = document.createElement('a');
    pill.href = '/usage';
    pill.target = '_blank';
    pill.rel = 'noopener';
    Object.assign(pill.style, {
      position: 'fixed',
      top: '8px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483000',
      padding: '4px 12px',
      borderRadius: '999px',
      font: '600 12px/1.4 system-ui, sans-serif',
      textDecoration: 'none',
      boxShadow: '0 2px 10px rgba(0,0,0,.4)',
    });
    document.body.appendChild(pill);
  }
  const over = worst.status === 'over';
  pill.style.background = over ? '#d64545' : '#e0a030';
  pill.style.color = over ? '#fff' : '#1a1200';
  pill.textContent = `${over ? 'LIMIT HIT' : 'API usage'}: ${worst.label} ${worst.metric} ${worst.pct}%`;
}
setTimeout(checkLimits, 5000);
setInterval(checkLimits, 60000);
