/**
 * Bela Finanzen - Marktdaten-Zwischenstück
 *
 * Läuft als Cloudflare Worker. Der Browser darf Yahoo Finance und Google News
 * nicht direkt abfragen (CORS), ein Worker schon. Es wird kein API-Schlüssel
 * gebraucht und nichts gespeichert - der Worker reicht nur öffentliche
 * Börsendaten durch und setzt die passenden CORS-Kopfzeilen.
 *
 * Einrichten: siehe worker/README.md
 */

const DEFAULT_ORIGINS = [
  'https://belapfirrmann.github.io',
  'http://localhost:8099',
  'http://127.0.0.1:8099',
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const QUOTE_TTL = 60;    // Sekunden
const NEWS_TTL = 900;
const HISTORY_TTL = 3600;
const SEARCH_TTL = 86400;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsFor(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'Nur GET.' }, cors, 405);

    try {
      switch (url.pathname.replace(/\/+$/, '') || '/') {
        case '/':
          return json({ ok: true, service: 'bela-finanzen-markt', endpoints: ['/quote', '/history', '/news', '/search'] }, cors);
        case '/quote':
          return json(await quotes(splitList(url.searchParams.get('symbols'))), cors, 200, QUOTE_TTL);
        case '/history':
          return json(await history(
            splitList(url.searchParams.get('symbols')),
            url.searchParams.get('range'),
            url.searchParams.get('interval'),
          ), cors, 200, HISTORY_TTL);
        case '/news':
          return json(await news(url.searchParams.get('q') || 'Börse', url.searchParams.get('limit')), cors, 200, NEWS_TTL);
        case '/search':
          return json(await search(url.searchParams.get('q')), cors, 200, SEARCH_TTL);
        default:
          return json({ error: 'Unbekannter Pfad.' }, cors, 404);
      }
    } catch (err) {
      return json({ error: String(err && err.message ? err.message : err) }, cors, 502);
    }
  },
};

/* ------------------------------------------------------------------ CORS */

function corsFor(request, env) {
  const allowed = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : DEFAULT_ORIGINS)
    .map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, cors, status = 200, ttl = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': ttl ? `public, max-age=${ttl}` : 'no-store',
    },
  });
}

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 25);

function upstream(url, ttl) {
  return fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/xml,*/*' },
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
}

/* ---------------------------------------------------------------- Kurse */

/** Ein Symbol über die Chart-API abfragen: Kurs, Vortagesschluss, Tagesspanne, Intraday-Punkte. */
async function quoteOne(symbol) {
  const api = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
            + '?range=1d&interval=5m&includePrePost=false';
  const res = await upstream(api, QUOTE_TTL);
  if (!res.ok) return { symbol, error: `Börse antwortete mit ${res.status}` };

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return { symbol, error: data?.chart?.error?.description || 'Kein Kurs gefunden.' };

  const m = result.meta || {};
  const price = num(m.regularMarketPrice);
  const prev = num(m.chartPreviousClose) ?? num(m.previousClose);
  const closes = (result.indicators?.quote?.[0]?.close || []).filter((v) => typeof v === 'number');

  return {
    symbol: m.symbol || symbol,
    name: m.longName || m.shortName || null,
    currency: m.currency || null,
    exchange: m.fullExchangeName || m.exchangeName || null,
    instrumentType: m.instrumentType || null,
    marketState: m.marketState || null,
    price,
    previousClose: prev,
    change: price != null && prev != null ? price - prev : null,
    changePct: price != null && prev ? ((price - prev) / prev) * 100 : null,
    dayHigh: num(m.regularMarketDayHigh),
    dayLow: num(m.regularMarketDayLow),
    time: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
    // Auf ~60 Punkte eindampfen, das reicht für eine Sparkline.
    spark: thin(closes, 60),
  };
}

async function quotes(symbols) {
  if (!symbols.length) return { quotes: [] };
  const settled = await Promise.allSettled(symbols.map(quoteOne));
  return {
    fetchedAt: Date.now(),
    quotes: settled.map((s, i) =>
      s.status === 'fulfilled' ? s.value : { symbol: symbols[i], error: String(s.reason) }),
  };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function thin(arr, max) {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.min(arr.length - 1, Math.floor(i * step))]);
  return out;
}

/* ------------------------------------------------------------ Kurshistorie */

const RANGES = new Set(['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
const INTERVALS = new Set(['5m', '15m', '1h', '1d', '1wk', '1mo']);

/** Tagesschlusskurse einer Reihe von Symbolen, für den Verlaufschart. */
async function historyOne(symbol, range, interval) {
  const api = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
            + `?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await upstream(api, HISTORY_TTL);
  if (!res.ok) return { symbol, error: `Börse antwortete mit ${res.status}` };

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return { symbol, error: data?.chart?.error?.description || 'Keine Historie gefunden.' };

  const stamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const points = [];
  for (let i = 0; i < stamps.length; i++) {
    const c = closes[i];
    if (typeof c !== 'number' || !Number.isFinite(c)) continue;
    points.push({ t: stamps[i] * 1000, c });
  }
  return {
    symbol: result.meta?.symbol || symbol,
    currency: result.meta?.currency || null,
    instrumentType: result.meta?.instrumentType || null,
    points,
  };
}

async function history(symbols, rangeRaw, intervalRaw) {
  if (!symbols.length) return { series: [] };
  const range = RANGES.has(rangeRaw) ? rangeRaw : '6mo';
  const interval = INTERVALS.has(intervalRaw) ? intervalRaw : '1d';
  const settled = await Promise.allSettled(symbols.map((s) => historyOne(s, range, interval)));
  return {
    fetchedAt: Date.now(),
    range,
    interval,
    series: settled.map((s, i) =>
      s.status === 'fulfilled' ? s.value : { symbol: symbols[i], error: String(s.reason) }),
  };
}

/* ------------------------------------------------------------- Symbolsuche */

async function search(q) {
  const term = String(q || '').trim();
  if (!term) return { results: [] };
  const api = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(term)}`
            + '&quotesCount=10&newsCount=0&listsCount=0';
  const res = await upstream(api, SEARCH_TTL);
  if (!res.ok) throw new Error(`Suche antwortete mit ${res.status}`);
  const data = await res.json();
  return {
    results: (data.quotes || [])
      .filter((r) => r.symbol)
      .map((r) => ({
        symbol: r.symbol,
        name: r.longname || r.shortname || r.symbol,
        exchange: r.exchDisp || r.exchange || null,
        type: r.typeDisp || r.quoteType || null,
      })),
  };
}

/* ---------------------------------------------------------------- News */

async function news(q, limitRaw) {
  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 12, 1), 30);
  const api = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=de&gl=DE&ceid=DE:de`;
  const res = await upstream(api, NEWS_TTL);
  if (!res.ok) throw new Error(`Nachrichten antworteten mit ${res.status}`);
  const xml = await res.text();

  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks.slice(0, limit)) {
    const rawTitle = decodeXml(tag(block, 'title'));
    const source = decodeXml(tag(block, 'source')) || null;
    // Google hängt " - Quelle" an den Titel; wenn die Quelle separat kommt, weg damit.
    const title = source && rawTitle.endsWith(` - ${source}`)
      ? rawTitle.slice(0, -(source.length + 3))
      : rawTitle;
    const pub = tag(block, 'pubDate');
    items.push({
      title,
      link: decodeXml(tag(block, 'link')),
      source,
      published: pub ? Date.parse(pub) || null : null,
    });
  }
  return { query: q, fetchedAt: Date.now(), items };
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}
