/**
 * CAK3Dvision usage telemetry.
 *
 * Counts every call to a tracked provider (server/cak3d/usageProviders.js):
 *  - server side: by wrapping globalThis.fetch and https.request/get once per
 *    process, so every provider module is covered without editing it;
 *  - browser side: /cak3d/usage-beacon.js reports the browser's own direct
 *    calls (Google 3D tiles, Cesium ion, Maps JS, ...) from Resource Timing.
 *
 * Daily buckets persist to .gev-cache/cak3d-usage/usage.json. Limits live in
 * config/cak3d-usage-limits.json (editable from the /usage page). A server-side
 * call over a hard limit whose provider has "block": true gets a local 429
 * instead of reaching the upstream, so it can never be billed.
 */
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { admitSameSite } from '../providers/common/same-site.js';
import { PROVIDERS, classifyUsage } from './usageProviders.js';

const HISTORY_DAYS = 400;
const INSTALLED = Symbol.for('cak3d.usage.installed');
const ASSET_DIR = fileURLToPath(new URL('.', import.meta.url));

const DEFAULT_LIMITS = {
  warnAt: 0.8,
  providers: {
    tomtom: { block: true, limits: { tiles: { day: 6000, month: null } } },
    worldnewsapi: { block: true, limits: { reads: { day: 30, month: null } } },
  },
};

/** The billed metric per provider, shown even before the first call so a limit can be set. */
const PRIMARY_METRIC = {
  'google-3d-tiles': 'root',
  'google-places': 'text-search',
  'google-streetview': 'images',
  'google-maps-js': 'loads',
  'cesium-ion': 'assets',
  tomtom: 'tiles',
  firms: 'requests',
  opensky: 'requests',
  openai: 'realtime',
  gemini: 'requests',
  worldnewsapi: 'reads',
  liveuamap: 'requests',
  ll2: 'requests',
  mapillary: 'requests',
};

let state = { days: {} };
let limits = DEFAULT_LIMITS;
let storeFile = '';
let limitsFile = '';
let dirty = false;
const warned = new Set();

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function flush() {
  if (!dirty) return;
  dirty = false;
  const keys = Object.keys(state.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_DAYS)))
    delete state.days[k];
  try {
    writeJsonAtomic(storeFile, state);
  } catch (error) {
    dirty = true;
    console.warn(`[cak3d-usage] could not save usage: ${error.message}`);
  }
}

function bucket(day, provider, metric) {
  const d = (state.days[day] ||= {});
  const p = (d[provider] ||= {});
  return (p[metric] ||= { n: 0, bytes: 0, failed: 0, blocked: 0 });
}

function limitFor(provider, metric) {
  const cfg = limits.providers?.[provider];
  const l = cfg?.limits?.[metric] || {};
  return {
    day: Number.isFinite(l.day) && l.day >= 0 ? l.day : null,
    month: Number.isFinite(l.month) && l.month >= 0 ? l.month : null,
    block: cfg?.block !== false,
  };
}

function totals(provider, metric, today = dayKey()) {
  const month = today.slice(0, 7);
  const out = { today: 0, month: 0, todayBytes: 0, monthBytes: 0, failedToday: 0, blockedToday: 0 };
  for (const [day, provs] of Object.entries(state.days)) {
    if (!day.startsWith(month)) continue;
    const b = provs?.[provider]?.[metric];
    if (!b) continue;
    out.month += b.n;
    out.monthBytes += b.bytes;
    if (day === today) {
      out.today = b.n;
      out.todayBytes = b.bytes;
      out.failedToday = b.failed;
      out.blockedToday = b.blocked;
    }
  }
  return out;
}

function ratio(t, l) {
  const r = [];
  if (l.day) r.push(t.today / l.day);
  if (l.month) r.push(t.month / l.month);
  return r.length ? Math.max(...r) : null;
}

function overLimit(provider, metric) {
  const l = limitFor(provider, metric);
  if (!l.block || (l.day === null && l.month === null)) return false;
  const t = totals(provider, metric);
  return (l.day !== null && t.today >= l.day) || (l.month !== null && t.month >= l.month);
}

function record(provider, metric, { n = 1, bytes = 0, failed = 0, blocked = 0 } = {}) {
  const b = bucket(dayKey(), provider, metric);
  b.n += n;
  b.bytes += bytes;
  b.failed += failed;
  b.blocked += blocked;
  dirty = true;
  if (!n) return;
  const r = ratio(totals(provider, metric), limitFor(provider, metric));
  if (r === null) return;
  const level = r >= 1 ? 'OVER' : r >= (limits.warnAt ?? 0.8) ? 'WARN' : '';
  const tag = `${dayKey()}|${provider}|${metric}|${level}`;
  if (level && !warned.has(tag)) {
    warned.add(tag);
    console.warn(
      `[cak3d-usage] ${level}: ${PROVIDERS[provider]?.label || provider} ${metric} at ${Math.round(r * 100)}% of its limit`,
    );
  }
}

function urlFromRequestArgs(args) {
  const [a] = args;
  if (typeof a === 'string' || a instanceof URL) return String(a);
  if (a && typeof a === 'object')
    return `https://${a.hostname || a.host || 'localhost'}${a.path || '/'}`;
  return '';
}

/** Wrap the process's outgoing HTTP once; later config reloads reuse it. */
function installInterceptors() {
  if (globalThis[INSTALLED]) return;
  globalThis[INSTALLED] = true;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async function cak3dCountedFetch(input, init) {
    const url = typeof input === 'string' || input instanceof URL ? input : input?.url;
    const hit = classifyUsage(url);
    if (!hit) return origFetch.call(this, input, init);
    const [provider, metric] = hit;
    if (overLimit(provider, metric)) {
      record(provider, metric, { n: 0, blocked: 1 });
      return new Response(
        JSON.stringify({
          error: `CAK3Dvision usage limit reached for ${PROVIDERS[provider]?.label || provider} (${metric}). Raise it at /usage.`,
        }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3600' } },
      );
    }
    record(provider, metric);
    try {
      const res = await origFetch.call(this, input, init);
      if (!res.ok) record(provider, metric, { n: 0, failed: 1 });
      return res;
    } catch (error) {
      record(provider, metric, { n: 0, failed: 1 });
      throw error;
    }
  };

  // FIRMS (and radio) use https.request directly. Counted, never blocked.
  for (const name of ['request', 'get']) {
    const orig = https[name];
    https[name] = function cak3dCountedHttps(...args) {
      const hit = classifyUsage(urlFromRequestArgs(args));
      if (hit) record(hit[0], hit[1]);
      return orig.apply(this, args);
    };
  }

  const timer = setInterval(flush, 5000);
  timer.unref?.();
  // Synchronous write, so it also runs from 'exit' (Ctrl+C, server restart).
  process.once('exit', flush);
}

function keySet(spec) {
  return String(spec || '')
    .split(/\s+or\s+/)
    .some((k) => String(process.env[k.trim()] || '').trim() !== '');
}

function report() {
  const today = dayKey();
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  const providers = Object.entries(PROVIDERS).map(([id, meta]) => {
    const seen = new Set([PRIMARY_METRIC[id], ...Object.keys(limits.providers?.[id]?.limits || {})].filter(Boolean));
    for (const provs of Object.values(state.days))
      for (const m of Object.keys(provs?.[id] || {})) seen.add(m);
    const metrics = [...seen].sort().map((metric) => {
      const t = totals(id, metric, today);
      const l = limitFor(id, metric);
      const r = ratio(t, l);
      return {
        metric,
        ...t,
        limit: { day: l.day, month: l.month },
        pct: r === null ? null : Math.round(r * 1000) / 10,
        status: r === null ? 'unset' : r >= 1 ? 'over' : r >= (limits.warnAt ?? 0.8) ? 'warn' : 'ok',
        history: days.map((d) => state.days[d]?.[id]?.[metric]?.n || 0),
      };
    });
    return {
      id,
      ...meta,
      keySet: keySet(meta.key),
      block: limits.providers?.[id]?.block !== false,
      metrics,
    };
  });
  return { generatedAt: new Date().toISOString(), today, days, warnAt: limits.warnAt ?? 0.8, providers };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function intIn(v, lo, hi) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : 0;
}

function handleBeacon(body) {
  const entries = Array.isArray(body?.entries) ? body.entries.slice(0, 500) : [];
  for (const e of entries) {
    const hit = classifyUsage(`https://${String(e?.u || '').slice(0, 300)}`);
    if (!hit || PROVIDERS[hit[0]]?.side === 'server') continue;
    const n = intIn(e.n, 0, 100000);
    if (n) record(hit[0], hit[1], { n, bytes: intIn(e.b, 0, 5e10) });
  }
}

function handleLimits(body) {
  const id = String(body?.provider || '');
  const metric = String(body?.metric || '').slice(0, 40);
  if (!PROVIDERS[id] || !/^[a-z0-9-]+$/.test(metric)) throw new Error('unknown provider or metric');
  const parse = (v) => (v === null || v === '' || v === undefined ? null : intIn(v, 0, 1e12));
  const cfg = (limits.providers[id] ||= { block: true, limits: {} });
  cfg.limits ||= {};
  cfg.limits[metric] = { day: parse(body.day), month: parse(body.month) };
  if (typeof body.block === 'boolean') cfg.block = body.block;
  writeJsonAtomic(limitsFile, limits);
}

const STATIC = {
  '/usage': ['usage-page.html', 'text/html; charset=utf-8'],
  '/cak3d/usage-page.js': ['usage-page.js', 'text/javascript; charset=utf-8'],
  '/cak3d/usage-beacon.js': ['usage-beacon.js', 'text/javascript; charset=utf-8'],
};

/** Vite plugin: counters, /api/cak3d/usage*, the /usage page and the beacon. */
function init(root) {
  if (storeFile) return;
  storeFile = path.join(root, '.gev-cache', 'cak3d-usage', 'usage.json');
  limitsFile = path.join(root, 'config', 'cak3d-usage-limits.json');
  state = readJson(storeFile, { days: {} });
  state.days ||= {};
  if (!fs.existsSync(limitsFile)) writeJsonAtomic(limitsFile, DEFAULT_LIMITS);
  limits = readJson(limitsFile, DEFAULT_LIMITS);
  limits.providers ||= {};
  installInterceptors();
}

// Install as soon as the config imports this module: some providers capture
// `fetch` as a default argument while their plugins are being constructed,
// which happens before any configureServer hook runs.
init(fileURLToPath(new URL('../../', import.meta.url)));

export function cak3dUsagePlugin() {
  return {
    name: 'cak3d-usage',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        const asset = STATIC[url];
        if (!asset && !url.startsWith('/api/cak3d/usage')) return next();
        if (admitSameSite(req, res)) return undefined;
        try {
          if (asset && req.method === 'GET') {
            res.setHeader('Content-Type', asset[1]);
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader(
              'Content-Security-Policy',
              "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
            );
            res.end(fs.readFileSync(path.join(ASSET_DIR, asset[0])));
            return undefined;
          }
          if (url === '/api/cak3d/usage' && req.method === 'GET') return sendJson(res, 200, report());
          if (url === '/api/cak3d/usage/beacon' && req.method === 'POST') {
            handleBeacon(await readBody(req));
            return sendJson(res, 200, { ok: true });
          }
          if (url === '/api/cak3d/usage/limits' && req.method === 'POST') {
            handleLimits(await readBody(req));
            return sendJson(res, 200, report());
          }
          return sendJson(res, 405, { error: 'method not allowed' });
        } catch (error) {
          return sendJson(res, 400, { error: error.message });
        }
      });
    },
    transformIndexHtml() {
      return [
        { tag: 'script', attrs: { type: 'module', src: '/cak3d/usage-beacon.js' }, injectTo: 'body' },
      ];
    },
  };
}
