// Marktdaten. Läuft nur, wenn in den Einstellungen ein Worker hinterlegt ist -
// eine reine Webseite darf Börsendaten nicht direkt abfragen.

import * as store from './store.js';

const QUOTE_TTL = 60_000;
const NEWS_TTL = 10 * 60_000;
const HISTORY_TTL = 60 * 60_000;

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
export const kindOf = (key) => store.getState().meta?.[key]?.kind || null;

export function setSymbol(key, symbol, kind = undefined) {
  const patch = { symbol: symbol ? symbol.trim().toUpperCase() : null };
  if (kind !== undefined) patch.kind = kind || null;
  store.setMeta(key, patch);
}

/** Grobe Einteilung aus dem, was die Börse über das Papier sagt. */
export function kindFrom(raw) {
  const t = String(raw || '').toUpperCase();
  if (!t) return null;
  if (t.includes('ETF') || t.includes('FUND') || t.includes('MUTUALFUND')) return 'ETF';
  if (t.includes('EQUITY') || t.includes('AKTIE') || t.includes('STOCK')) return 'Aktie';
  if (t.includes('CURRENCY')) return 'Währung';
  if (t.includes('CRYPTO')) return 'Krypto';
  return null;
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

/* ------------------------------------------------------------ Kurshistorie */

/** Schlusskurse zu mehreren Symbolen. */
export async function history(symbols, { range = '6mo', interval = '1d', force = false } = {}) {
  const list = [...new Set((symbols || []).filter(Boolean))];
  if (!list.length || !hasMarket()) return { ok: false, bySymbol: new Map(), error: null };
  try {
    const data = await call(
      `/history?symbols=${encodeURIComponent(list.join(','))}&range=${range}&interval=${interval}`,
      { ttl: HISTORY_TTL, force, timeout: 20000 },
    );
    const bySymbol = new Map();
    for (const s of data.series || []) bySymbol.set(s.symbol, s);
    list.forEach((sym, i) => { if (!bySymbol.has(sym) && data.series?.[i]) bySymbol.set(sym, data.series[i]); });
    return { ok: true, bySymbol, range: data.range, interval: data.interval, error: null };
  } catch (err) {
    return { ok: false, bySymbol: new Map(), error: err.message };
  }
}

const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Wertverlauf des Depots aus Kursdaten.
 *
 * Gerechnet wird mit den heutigen Stückzahlen. Was du früher gekauft oder
 * verkauft hast, steckt da nicht drin - die Kurve zeigt, wie sich dein
 * heutiger Bestand entwickelt hätte, nicht dein tatsächliches Depot.
 * Deshalb wird sie im UI auch genau so benannt.
 */
export async function portfolioHistory(positions, { range = '6mo', interval = '1d', force = false } = {}) {
  const held = positions.filter((p) => symbolOf(p.key) && Number.isFinite(p.qty));
  if (!held.length) return { ok: false, points: [], covered: 0, total: positions.length, error: null };

  const symbols = held.map((p) => symbolOf(p.key));
  const res = await history(symbols, { range, interval, force });
  if (!res.ok) return { ok: false, points: [], covered: 0, total: positions.length, error: res.error };

  // Fremdwährungen brauchen ihre eigene Kurve, sonst verzerrt der heutige Kurs die Vergangenheit.
  const currencies = [...new Set(
    symbols.map((s) => res.bySymbol.get(s)?.currency).filter((c) => c && c !== 'EUR'),
  )];
  const fxSeries = new Map();
  if (currencies.length) {
    const fxRes = await history(currencies.map((c) => `EUR${c}=X`), { range, interval, force });
    for (const c of currencies) {
      const s = fxRes.bySymbol.get(`EUR${c}=X`);
      if (s && !s.error) fxSeries.set(c, indexByDay(s.points));
    }
  }

  const byDay = new Map();          // Symbol -> Map(tag -> Kurs)
  const usable = [];
  for (const p of held) {
    const sym = symbolOf(p.key);
    const s = res.bySymbol.get(sym);
    if (!s || s.error || !s.points?.length) continue;
    const cur = s.currency && s.currency !== 'EUR' ? s.currency : null;
    if (cur && !fxSeries.has(cur)) continue;      // ohne Wechselkurs lieber weglassen
    byDay.set(sym, indexByDay(s.points));
    usable.push({ position: p, symbol: sym, currency: cur });
  }
  if (!usable.length) return { ok: false, points: [], covered: 0, total: positions.length, error: null };

  const days = [...new Set(usable.flatMap(({ symbol }) => [...byDay.get(symbol).keys()]))].sort();
  const last = new Map();
  const lastFx = new Map();
  const points = [];

  for (const day of days) {
    let sum = 0, complete = true;
    for (const { position, symbol, currency } of usable) {
      const px = byDay.get(symbol).get(day) ?? last.get(symbol);
      if (px == null) { complete = false; break; }
      last.set(symbol, px);

      let factor = 1;
      if (currency) {
        const rate = fxSeries.get(currency).get(day) ?? lastFx.get(currency);
        if (rate == null) { complete = false; break; }
        lastFx.set(currency, rate);
        factor = 1 / rate;
      }
      sum += px * factor * position.qty;
    }
    // Erst ab dem Tag zeichnen, an dem alle Papiere einen Kurs haben.
    if (complete) points.push({ date: day, value: sum });
  }

  return { ok: true, points, covered: usable.length, total: positions.length, error: null };
}

function indexByDay(points) {
  const m = new Map();
  for (const p of points || []) m.set(dayKey(p.t), p.c);
  return m;
}

/** Intraday-Verlauf einer einzelnen Position, für die Detailcharts. */
export async function intraday(symbol, { force = false } = {}) {
  if (!symbol || !hasMarket()) return { ok: false, points: [], error: null };
  const res = await history([symbol], { range: '5d', interval: '15m', force });
  const s = res.bySymbol.get(symbol);
  if (!res.ok || !s || s.error) return { ok: false, points: [], error: s?.error || res.error };
  return { ok: true, points: s.points, currency: s.currency, error: null };
}

/* ------------------------------------------------------------ Wechselkurse */

const fxCache = new Map();

/**
 * Faktor, mit dem ein Kurs in `currency` zu Euro wird.
 * Yahoo führt Währungspaare als eigenes Symbol, etwa EURUSD=X.
 */
export async function fxToEur(currency) {
  const cur = String(currency || 'EUR').toUpperCase();
  if (cur === 'EUR') return 1;
  if (fxCache.has(cur)) return fxCache.get(cur);

  const pair = `EUR${cur}=X`;
  const res = await quotes([pair]);
  const q = res.bySymbol.get(pair);
  // Der Kurs sagt, wie viele Einheiten ein Euro kostet - für die Gegenrichtung invertieren.
  const factor = q && !q.error && q.price ? 1 / q.price : null;
  fxCache.set(cur, factor);
  return factor;
}

/* ------------------------------------------------------- Automatik-Zuordnung */

// Handelsplätze, an denen die comdirect üblicherweise abrechnet.
const GERMAN_VENUE = /\.(DE|F|SG|MU|BE|DU|HM|HA|STU)$/i;

/**
 * Wählt aus Suchtreffern den Kandidaten, dessen Kurs zum Kurs aus der CSV passt.
 * Ohne diese Schranke würde bei mehreren Handelsplätzen leicht das falsche
 * Papier landen. Fremdwährungen werden vorher in Euro umgerechnet.
 */
export async function pickCandidate(position, candidates) {
  const quoted = await quotes(candidates.map((c) => c.symbol));
  let best = null;
  for (const c of candidates) {
    const q = quoted.bySymbol.get(c.symbol);
    if (!q || q.error || q.price == null) continue;

    const eur = await priceInEur(q);
    if (eur == null) continue;

    const dev = Number.isFinite(position.price) && position.price
      ? Math.abs(eur - position.price) / position.price
      : null;
    if (dev !== null && dev > 0.12) continue;

    let score = dev === null ? 0 : Math.max(0, 60 - dev * 400);
    if (GERMAN_VENUE.test(c.symbol)) score += 30;
    if (q.currency === 'EUR') score += 15;
    if (!best || score > best.score) {
      best = { symbol: c.symbol, name: c.name, score, dev, quote: q, currency: q.currency };
    }
  }
  return best;
}

/**
 * Sucht zu jeder Position ohne Symbol selbst das passende Wertpapier.
 *
 * Der Name allein ist kein Beweis - darum wird jeder Kandidat abgefragt und
 * sein Kurs gegen den Kurs aus der CSV gehalten. Zugeordnet wird nur, was
 * dicht genug liegt; alles andere bleibt offen und wird zurückgemeldet,
 * statt auf Verdacht ein falsches Papier einzutragen.
 */
export async function autoAssign(positions, { onProgress = () => {} } = {}) {
  const open = positions.filter((p) => !symbolOf(p.key));
  const assigned = [], unsure = [];

  for (let i = 0; i < open.length; i++) {
    const p = open[i];
    onProgress({ done: i, total: open.length, name: p.name });

    const found = await search(suggestQuery(p.name));
    const cands = (found.results || []).slice(0, 6);
    if (!cands.length) { unsure.push({ position: p, reason: 'nichts gefunden', candidates: [] }); continue; }

    const best = await pickCandidate(p, cands);

    if (best) {
      setSymbol(p.key, best.symbol, kindFrom(best.quote?.instrumentType));
      assigned.push({ position: p, ...best });
    } else {
      unsure.push({ position: p, reason: 'kein Kandidat passte zum Kurs aus der CSV', candidates: cands });
    }
  }

  onProgress({ done: open.length, total: open.length, name: null });
  return { assigned, unsure, skipped: positions.length - open.length };
}

/* -------------------------------------------------- Wertpapierliste einlesen */

const ISIN_RE = /\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b/;
const WKN_RE = /\b([A-Z0-9]{6})\b/g;

const slug = (s) => String(s || '')
  .toLowerCase()
  .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]/g, '');

/**
 * Liest eine eingefügte Wertpapierliste. Akzeptiert JSON
 * ([{name, isin, wkn, symbol}, …]) oder eine Zeile je Papier, getrennt durch
 * |, ; oder Tabulator - notfalls werden ISIN und WKN einfach herausgefischt.
 */
export function parseSecurityList(text) {
  const t = String(text || '').trim();
  if (!t) return [];

  const clean = (e) => ({
    name: String(e.name || e.bezeichnung || '').trim(),
    isin: (String(e.isin || '').trim().toUpperCase().match(ISIN_RE) || [])[1] || null,
    wkn: String(e.wkn || '').trim().toUpperCase() || null,
    symbol: String(e.symbol || e.ticker || '').trim().toUpperCase() || null,
  });

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fence ? fence[1].trim() : t;
  if (/^[[{]/.test(jsonText)) {
    try {
      const parsed = JSON.parse(jsonText);
      const arr = Array.isArray(parsed) ? parsed : (parsed.positionen || parsed.positions || [parsed]);
      return arr.map(clean).filter((e) => e.name || e.isin || e.wkn);
    } catch { /* dann eben zeilenweise */ }
  }

  const out = [];
  for (const line of jsonText.split(/\r?\n/)) {
    const row = line.trim();
    if (!row || /^(bezeichnung|name|position)\b/i.test(row)) continue;

    const cells = row.split(/\s*[|;\t]\s*/).map((c) => c.trim()).filter(Boolean);
    const upper = row.toUpperCase();
    const isin = (upper.match(ISIN_RE) || [])[1] || null;

    let wkn = null;
    for (const m of upper.matchAll(WKN_RE)) {
      if (isin && isin.includes(m[1])) continue;
      if (/^[0-9]{6}$/.test(m[1]) || /[0-9]/.test(m[1])) { wkn = m[1]; break; }
    }

    // Der Name ist die Zelle, die keine Kennung ist - sonst der Zeilenanfang.
    const name = (cells.find((c) => c !== isin && c !== wkn && !/^[A-Z0-9.]{1,8}$/.test(c)) || cells[0] || '')
      .replace(ISIN_RE, '').trim();
    const symbol = cells.find((c) => /^[A-Z][A-Z0-9]{0,5}(\.[A-Z]{1,3})?$/.test(c) && c !== wkn) || null;

    if (name || isin || wkn) out.push(clean({ name, isin, wkn, symbol }));
  }
  return out;
}

/** Ordnet einen Listeneintrag der passenden Depotposition zu. */
function matchPosition(entry, positions) {
  if (entry.isin) {
    const byIsin = positions.find((p) => p.isin && p.isin.toUpperCase() === entry.isin);
    if (byIsin) return byIsin;
  }
  if (entry.wkn) {
    const byWkn = positions.find((p) => p.wkn && p.wkn.toUpperCase() === entry.wkn);
    if (byWkn) return byWkn;
  }
  const a = slug(entry.name);
  if (!a) return null;
  const exact = positions.find((p) => slug(p.name) === a);
  if (exact) return exact;
  return positions.find((p) => {
    const b = slug(p.name);
    if (!b || Math.min(a.length, b.length) < 6) return false;
    return a.startsWith(b.slice(0, 10)) || b.startsWith(a.slice(0, 10)) || a.includes(b) || b.includes(a);
  }) || null;
}

/**
 * Spielt eine eingefügte Liste ein: merkt sich ISIN und WKN und bestimmt
 * daraus das Börsensymbol. Ein mitgeliefertes Symbol wird bevorzugt, aber
 * genauso gegen den Kurs geprüft wie ein selbst gesuchtes.
 */
export async function applySecurityList(text, positions, { onProgress = () => {} } = {}) {
  const entries = parseSecurityList(text);
  if (!entries.length) throw new Error('In der Liste war nichts zu erkennen.');

  const applied = [], unsure = [], unmatched = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    onProgress({ done: i, total: entries.length, name: e.name || e.isin });

    const p = matchPosition(e, positions);
    if (!p) { unmatched.push(e); continue; }

    store.setMeta(p.key, { isin: e.isin || null, wkn: e.wkn || null });

    const candidates = [];
    if (e.symbol) candidates.push({ symbol: e.symbol, name: e.name || p.name });
    for (const term of [e.isin, e.wkn, suggestQuery(e.name || p.name)].filter(Boolean)) {
      const found = await search(term);
      for (const r of (found.results || []).slice(0, 6)) {
        if (!candidates.some((c) => c.symbol === r.symbol)) candidates.push(r);
      }
      if (candidates.length >= 8) break;
    }
    if (!candidates.length) { unsure.push({ position: p, entry: e, reason: 'kein Treffer an der Börse' }); continue; }

    const best = await pickCandidate(p, candidates);
    if (best) {
      setSymbol(p.key, best.symbol, kindFrom(best.quote?.instrumentType));
      applied.push({ position: p, entry: e, ...best });
    } else {
      unsure.push({ position: p, entry: e, reason: 'kein Treffer passte zum Kurs aus der CSV' });
    }
  }

  onProgress({ done: entries.length, total: entries.length, name: null });
  return { applied, unsure, unmatched };
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

/** Börsenkurs in Euro, notfalls über den Wechselkurs. */
export async function priceInEur(quote) {
  if (!quote || quote.error || quote.price == null) return null;
  if (!quote.currency || quote.currency === 'EUR') return quote.price;
  const factor = await fxToEur(quote.currency);
  return factor == null ? null : quote.price * factor;
}

/**
 * Plausibilitätsprüfung: passt der Börsenkurs zum Kurs aus der CSV?
 * Gibt die Abweichung in Prozent zurück, sonst null. Bei Fremdwährung wird
 * erst umgerechnet - sonst wäre jede US-Aktie ein Fehlalarm.
 */
export async function priceMismatch(position, quote) {
  if (!quote || quote.error || position.price == null) return null;
  const eur = await priceInEur(quote);
  if (eur == null) return null;
  const diff = Math.abs(eur - position.price) / position.price;
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
