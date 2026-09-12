// Marktdaten. Läuft nur, wenn in den Einstellungen ein Worker hinterlegt ist -
// eine reine Webseite darf Börsendaten nicht direkt abfragen.

import * as store from './store.js';

const QUOTE_TTL = 60_000;
const NEWS_TTL = 10 * 60_000;

const mem = new Map();            // url -> { at, data }
const inflight = new Map();       // url -> Promise

export const workerUrl = () => String(store.getState().settings.workerUrl || '').replace(/\/+$/, '');
export const hasMarket = () => workerUrl().startsWith('http');

/* ----------------------------------------------------------------- Abruf */

function cacheGet(key, ttl) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  try {
    const raw = sessionStorage.getItem(`bf.market.${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.at < ttl) { mem.set(key, parsed); return parsed.data; }
    }
  } catch { /* sessionStorage kann gesperrt sein */ }
  return null;
}

function cacheSet(key, data) {
  const entry = { at: Date.now(), data };
  mem.set(key, entry);
  try { sessionStorage.setItem(`bf.market.${key}`, JSON.stringify(entry)); } catch { /* egal */ }
}

async function call(path, { ttl = QUOTE_TTL, force = false, base = null, timeout = 12000 } = {}) {
  const root = base ?? workerUrl();
  if (!root) throw new Error('Keine Worker-Adresse hinterlegt.');
  const url = `${root}${path}`;

  if (!force) {
    const hit = cacheGet(url, ttl);
    if (hit) return hit;
    if (inflight.has(url)) return inflight.get(url);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const req = fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    .then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Der Worker antwortete mit ${res.status}.`);
      cacheSet(url, body);
      return body;
    })
    .catch((err) => {
      if (err.name === 'AbortError') throw new Error('Zeitüberschreitung beim Worker.');
      if (err instanceof TypeError) throw new Error('Der Worker war nicht erreichbar. Adresse prüfen.');
      throw err;
    })
    .finally(() => { clearTimeout(timer); inflight.delete(url); });

  inflight.set(url, req);
  return req;
}

/* ---------------------------------------------------------------- Symbole */

export const symbolOf = (key) => store.getState().meta?.[key]?.symbol || null;

export function setSymbol(key, symbol) {
  store.setMeta(key, { symbol: symbol ? symbol.trim().toUpperCase() : null });
}

/** Macht aus comdirects Kurzschreibweise einen brauchbaren Suchbegriff. */
export function suggestQuery(name) {
  let s = ` ${String(name || '')} `;
  const swap = [
    [/\bISHSVII[-\s]*/gi, 'iShares '],
    [/\bISHS\b[-\s]*/gi, 'iShares '],
    [/\bVANG\.?\b/gi, 'Vanguard'],
    [/\bA\.W\.\b/gi, 'All-World'],
    [/\bS\+P\b/gi, 'S&P'],
    [/\bDL\s?ACC\b/gi, ''], [/\bDLACC\b/gi, ''], [/\bDLA\b/gi, ''],
    [/\bEOA\b/gi, ''], [/\bACC\b/gi, ''], [/\bDIS\b/gi, ''],
    [/\bO\.\s?N\.\b/gi, ''], [/\bNA\b(?=\s)/g, ''], [/\bINH\b/gi, ''],
    [/\bDL-?,?\s?\d+\b/gi, ''], [/\bEO-?,?\s?\d+\b/gi, ''],
    [/\bUCITS\b/gi, 'UCITS'],
    [/[-–]+$/g, ''],
  ];
  for (const [re, to] of swap) s = s.replace(re, to);
  return s.replace(/\s{2,}/g, ' ').trim();
}

/* ----------------------------------------------------------------- Kurse */

/**
 * Kurse zu mehreren Symbolen. Gibt immer ein Objekt zurück, nie einen Fehler -
 * die Ansichten sollen auch ohne Marktdaten etwas anzeigen können.
 */
export async function quotes(symbols, { force = false } = {}) {
  const list = [...new Set((symbols || []).filter(Boolean))];
  if (!list.length || !hasMarket()) return { ok: false, bySymbol: new Map(), error: null };
  try {
    const data = await call(`/quote?symbols=${encodeURIComponent(list.join(','))}`, { ttl: QUOTE_TTL, force });
    const bySymbol = new Map();
    for (const q of data.quotes || []) bySymbol.set(q.symbol, q);
    // Auch unter dem angefragten Namen ablegen, falls die Börse anders schreibt.
    list.forEach((s, i) => { if (!bySymbol.has(s) && data.quotes?.[i]) bySymbol.set(s, data.quotes[i]); });
    return { ok: true, bySymbol, fetchedAt: data.fetchedAt || Date.now(), error: null };
  } catch (err) {
    return { ok: false, bySymbol: new Map(), error: err.message };
  }
}

export async function news(query, { limit = 12, force = false } = {}) {
  if (!hasMarket()) return { ok: false, items: [], error: null };
  try {
    const data = await call(`/news?q=${encodeURIComponent(query)}&limit=${limit}`, { ttl: NEWS_TTL, force });
    return { ok: true, items: data.items || [], error: null };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

export async function search(query) {
  if (!hasMarket()) return { ok: false, results: [], error: 'Kein Worker hinterlegt.' };
  try {
    const data = await call(`/search?q=${encodeURIComponent(query)}`, { ttl: 86_400_000 });
    return { ok: true, results: data.results || [], error: null };
  } catch (err) {
    return { ok: false, results: [], error: err.message };
  }
}

/** Prüft eine Worker-Adresse, bevor sie gespeichert wird. */
export async function ping(base) {
  const root = String(base || '').replace(/\/+$/, '');
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(root);
  if (!/^https:\/\//.test(root) && !local) throw new Error('Die Adresse muss mit https:// anfangen.');
  const info = await call('/', { ttl: 0, force: true, base: root, timeout: 9000 });
  if (!info.ok) throw new Error('Unter der Adresse antwortet etwas anderes als der Marktdaten-Worker.');
  return info;
}

/* -------------------------------------------------------------- Auswertung */

/**
 * Tagesveränderung des Depots aus Live-Kursen.
 * Nur Positionen mit Symbol und Stückzahl zählen mit; der Rest wird ausgewiesen,
 * damit nie so getan wird, als sei die Zahl vollständig.
 */
export function todayTotals(positions, bySymbol) {
  let change = 0, base = 0, covered = 0;
  const missing = [];
  for (const p of positions) {
    const sym = symbolOf(p.key);
    const q = sym ? bySymbol.get(sym) : null;
    if (!q || q.error || q.change == null || p.qty == null || q.previousClose == null) {
      missing.push(p);
      continue;
    }
    change += q.change * p.qty;
    base += q.previousClose * p.qty;
    covered++;
  }
  return {
    change: covered ? change : null,
    pct: base ? (change / base) * 100 : null,
    covered,
    total: positions.length,
    missing,
    complete: covered > 0 && missing.length === 0,
  };
}

/** Plausibilitätsprüfung: passt der Börsenkurs zum Kurs aus der CSV? */
export function priceMismatch(position, quote) {
  if (!quote || quote.error || quote.price == null || position.price == null) return null;
  const diff = Math.abs(quote.price - position.price) / position.price;
  return diff > 0.15 ? diff * 100 : null;
}

export function marketStateLabel(state) {
  return {
    REGULAR: 'Börse offen',
    PRE: 'Vorbörslich',
    POST: 'Nachbörslich',
    POSTPOST: 'Nachbörslich',
    PREPRE: 'Vorbörslich',
    CLOSED: 'Börse geschlossen',
  }[state] || null;
}
