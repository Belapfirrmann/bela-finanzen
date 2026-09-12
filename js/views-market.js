// Ansichten „Heute" und „Aktien". Beide arbeiten auch ohne Marktdaten weiter,
// dann eben mit dem, was die comdirect-CSV hergibt.

import * as store from './store.js';
import * as market from './market.js';
import * as stats from './stats.js';
import { sparkline } from './charts.js';
import {
  money, moneySigned, pct, price as fmtPrice, qty as fmtQty,
  deltaHtml, direction, escapeHtml, relTime, clock, dateFull, isNum,
} from './format.js';

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------- Bausteine */

function pillHtml(value, text) {
  const d = direction(value);
  const cls = { 'delta--up': 'pill--up', 'delta--down': 'pill--down', 'delta--flat': 'pill--flat' }[d.cls];
  return `<span class="pill ${cls}"><span aria-hidden="true">${d.arrow}</span>${escapeHtml(text)}</span>`;
}

/** Balken, der zeigt, wo der Kurs zwischen Tagestief und Tageshoch steht. */
function rangeHtml(low, high, value, { label = 'Tagesspanne' } = {}) {
  if (!isNum(low) || !isNum(high) || high <= low || !isNum(value)) return '';
  const at = Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
  return `<div class="range" role="img" aria-label="${escapeHtml(label)} ${escapeHtml(fmtPrice(low))} bis ${escapeHtml(fmtPrice(high))}, aktuell ${escapeHtml(fmtPrice(value))}">
      <div class="range__track"><span class="range__mark" style="left:${at.toFixed(1)}%"></span></div>
      <div class="range__ends"><span>Tief ${escapeHtml(fmtPrice(low))}</span><span>Hoch ${escapeHtml(fmtPrice(high))}</span></div>
    </div>`;
}

const noMarketCard = (what) => `
  <section class="card glass">
    <div class="card__head"><h2 class="card__title">Noch keine Live-Kurse</h2></div>
    <p class="card__note">${escapeHtml(what)} Eine reine Webseite darf Börsendaten nicht selbst abfragen. Dafür gibt es im Repository den Ordner <code>worker/</code> mit einer Anleitung: kostenloser Cloudflare-Account, Code hineinkopieren, Adresse hier eintragen. Kein API-Schlüssel nötig.</p>
    <div class="actions"><button class="btn btn--primary" type="button" data-goto="more">Marktdaten einrichten</button></div>
  </section>`;

/* ==================================================================== HEUTE */

export async function renderToday() {
  const body = $('#today-body');
  const snap = store.latestSnapshot();
  if (!snap) {
    body.innerHTML = '<section class="card glass"><p class="card__note">Noch keine Daten. Importiere zuerst deine comdirect-CSV.</p></section>';
    return;
  }

  const rows = stats.allocation(snap);

  if (!market.hasMarket()) {
    body.innerHTML = noMarketCard('Ohne Anbindung zeigt „Heute" die Tagesspanne aus deinem letzten CSV-Export.') + csvDayHtml(snap, rows);
    return;
  }

  body.innerHTML = `<section class="card glass"><div class="stack">
      <div class="skeleton" style="height:64px"></div>
      <div class="skeleton" style="height:120px"></div>
    </div></section>`;

  const symbols = rows.map((p) => market.symbolOf(p.key)).filter(Boolean);
  const res = await market.quotes(symbols);

  if (res.error) {
    body.innerHTML = `<section class="card glass">
        <div class="note note--bad"><span class="note__icon" aria-hidden="true">!!</span><span>${escapeHtml(res.error)}</span></div>
        <div class="actions"><button class="btn btn--sm" type="button" id="today-retry">Erneut versuchen</button>
        <button class="btn btn--sm btn--ghost" type="button" data-goto="more">Einstellungen</button></div>
      </section>` + csvDayHtml(snap, rows);
    $('#today-retry')?.addEventListener('click', () => renderToday());
    return;
  }

  const t = market.todayTotals(rows, res.bySymbol);
  const anyQuote = [...res.bySymbol.values()].find((q) => q && !q.error);
  const stateLabel = market.marketStateLabel(anyQuote?.marketState);
  const stamp = anyQuote?.time ? `Stand ${clock(anyQuote.time)} Uhr` : '';

  const withSymbol = rows.filter((p) => market.symbolOf(p.key));
  const without = rows.filter((p) => !market.symbolOf(p.key));

  // Abweichungen vorab bestimmen, damit die Zeilen synchron gebaut werden können.
  const mismatches = new Map();
  await Promise.all(withSymbol.map(async (p) => {
    const m = await market.priceMismatch(p, res.bySymbol.get(market.symbolOf(p.key)));
    if (m) mismatches.set(p.key, m);
  }));

  body.innerHTML = `
    ${isNum(t.change) ? `
      <section class="hero">
        <p class="hero__label">Heute<span class="hero__date">${escapeHtml([stateLabel, stamp].filter(Boolean).join(' · '))}</span></p>
        <p class="hero__value">${escapeHtml(moneySigned(t.change))}</p>
        <p class="hero__delta">
          ${deltaHtml(t.pct, pct(t.pct, { signed: true }))}
          <span class="hero__deltalabel">${t.complete
            ? 'alle Positionen erfasst'
            : `${t.covered} von ${t.total} Positionen erfasst`}</span>
        </p>
      </section>` : `
      <section class="card glass"><p class="card__note">Noch keinem Wertpapier ist ein Börsensymbol zugeordnet. Tippe unten auf eine Position, um das nachzuholen.</p></section>`}

    ${withSymbol.length ? `<section class="card glass">
      <div class="card__head"><h2 class="card__title">Deine Werte</h2></div>
      <div class="rows">${withSymbol.map((p) => quoteRow(p, res.bySymbol.get(market.symbolOf(p.key)), mismatches.get(p.key))).join('')}</div>
    </section>` : ''}

    ${without.length ? `<section class="card glass">
      <div class="card__head">
        <h2 class="card__title">Ohne Börsensymbol</h2>
        <button class="btn btn--sm btn--primary" type="button" data-autoassign="1">Automatisch zuordnen</button>
      </div>
      <p class="card__note">Diese Positionen fehlen in der Tagesrechnung. „Automatisch zuordnen“ sucht sie selbst und prüft jeden Treffer gegen den Kurs aus deiner CSV. Du kannst auch einzeln antippen.</p>
      <div class="rows">${without.map((p) => `
        <button type="button" class="row" data-symbolfor="${escapeHtml(p.key)}">
          <span class="row__main">
            <span class="row__name">${escapeHtml(p.name)}</span>
            <span class="row__meta">${escapeHtml(money(p.value))} · ${escapeHtml(pct(p.share))} des Depots</span>
          </span>
          <span class="row__side"><span class="chip">zuordnen</span></span>
        </button>`).join('')}</div>
    </section>` : ''}

    ${tableHtml(withSymbol, res.bySymbol)}`;
}

function quoteRow(p, q, mismatch = null) {
  const sym = market.symbolOf(p.key);
  if (!q || q.error) {
    return `<button type="button" class="row" data-symbolfor="${escapeHtml(p.key)}">
      <span class="row__main">
        <span class="row__name">${escapeHtml(p.name)}</span>
        <span class="row__meta">${escapeHtml(sym || '')} · ${escapeHtml(q?.error || 'kein Kurs')}</span>
      </span>
      <span class="row__side"><span class="chip">prüfen</span></span>
    </button>`;
  }
  const posChange = isNum(q.change) && isNum(p.qty) ? q.change * p.qty : null;
  return `<button type="button" class="row" data-poskey="${escapeHtml(p.key)}">
    <span class="row__main">
      <span class="row__name">${escapeHtml(p.name)}</span>
      <span class="row__meta">${escapeHtml(sym)}${q.currency && q.currency !== 'EUR' ? ` · ${escapeHtml(q.currency)}` : ''}${
        isNum(posChange) ? ` · ${escapeHtml(moneySigned(posChange))} heute` : ''}${
        mismatch ? ' · Symbol prüfen' : ''}</span>
    </span>
    ${sparkline(q.spark)}
    <span class="row__side">
      <span class="row__value">${escapeHtml(fmtPrice(q.price))}</span>
      ${pillHtml(q.changePct, pct(q.changePct, { signed: true }))}
    </span>
  </button>`;
}

function tableHtml(rows, bySymbol) {
  if (!rows.length) return '';
  return `<section class="card glass">
    <div class="card__head"><h2 class="card__title">Tabelle</h2></div>
    <div class="tablewrap"><table class="data">
      <thead><tr><th>Position</th><th>Kurs</th><th>Vortag</th><th>Heute</th><th>Heute %</th><th>Tief</th><th>Hoch</th></tr></thead>
      <tbody>${rows.map((p) => {
        const q = bySymbol.get(market.symbolOf(p.key)) || {};
        return `<tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(fmtPrice(q.price))}</td>
          <td>${escapeHtml(fmtPrice(q.previousClose))}</td>
          <td>${escapeHtml(isNum(q.change) && isNum(p.qty) ? moneySigned(q.change * p.qty) : '–')}</td>
          <td>${escapeHtml(isNum(q.changePct) ? pct(q.changePct, { signed: true }) : '–')}</td>
          <td>${escapeHtml(fmtPrice(q.dayLow))}</td>
          <td>${escapeHtml(fmtPrice(q.dayHigh))}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="card__note">Dieselben Zahlen ohne Farben. „Heute" ist die Kursveränderung mal deiner Stückzahl.</p>
  </section>`;
}

/** Rückfallebene ohne Marktdaten: die Tagesspanne aus dem CSV-Export. */
function csvDayHtml(snap, rows) {
  const withRange = rows.filter((p) => isNum(p.high) && isNum(p.low));
  if (!withRange.length) {
    return `<section class="card glass"><p class="card__note">Dein letzter Export enthält keine Tagesspanne, darum lässt sich hier ohne Anbindung nichts zeigen.</p></section>`;
  }
  const swing = withRange.reduce((s, p) => s + (p.high - p.low) * (p.qty || 0), 0);
  return `
    <section class="card glass">
      <div class="card__head"><h2 class="card__title">Tagesspanne laut Export</h2></div>
      <p class="card__note">Stand ${escapeHtml(dateFull(snap.date))}. Zwischen dem Tagestief und dem Tageshoch aller Positionen liegen ${escapeHtml(money(swing))} Depotwert. Das ist die Schwankungsbreite dieses Börsentages, keine Veränderung gegenüber gestern.</p>
      <div class="rows">${withRange.map((p) => `
        <button type="button" class="row" data-poskey="${escapeHtml(p.key)}">
          <span class="row__main">
            <span class="row__name">${escapeHtml(p.name)}</span>
            <span class="row__meta">${escapeHtml(fmtQty(p.qty))} Stk. · Spanne ${escapeHtml(money((p.high - p.low) * (p.qty || 0)))}</span>
            ${rangeHtml(p.low, p.high, p.price)}
          </span>
          <span class="row__side"><span class="row__value">${escapeHtml(fmtPrice(p.price))}</span>
          <span class="row__meta">geschätzt</span></span>
        </button>`).join('')}</div>
    </section>`;
}

/* =================================================================== AKTIEN */

export async function renderStocks() {
  const body = $('#stocks-body');
  const snap = store.latestSnapshot();
  if (!snap) {
    body.innerHTML = '<section class="card glass"><p class="card__note">Noch keine Daten. Importiere zuerst deine comdirect-CSV.</p></section>';
    return;
  }
  const rows = stats.allocation(snap);

  if (!market.hasMarket()) {
    body.innerHTML = noMarketCard('Ohne Anbindung gibt es hier keine Kurse und keine Schlagzeilen.') + linkListHtml(rows);
    return;
  }

  body.innerHTML = `
    <section class="card glass" id="stocks-list">
      <div class="card__head"><h2 class="card__title">Deine Werte</h2></div>
      <div class="skeleton" style="height:180px"></div>
    </section>
    <section class="card glass" id="stocks-news">
      <div class="card__head"><h2 class="card__title">Marktnachrichten</h2></div>
      <div class="skeleton" style="height:150px"></div>
    </section>`;

  const symbols = rows.map((p) => market.symbolOf(p.key)).filter(Boolean);
  const [res, general] = await Promise.all([
    market.quotes(symbols),
    market.news('Börse Aktienmarkt Dax Nasdaq', { limit: 10 }),
  ]);

  const list = $('#stocks-list');
  const anyMissing = rows.some((p) => !market.symbolOf(p.key));
  list.innerHTML = `
    <div class="card__head">
      <h2 class="card__title">Deine Werte</h2>
      ${anyMissing ? '<button class="btn btn--sm btn--primary" type="button" data-autoassign="1">Automatisch zuordnen</button>' : ''}
    </div>
    ${res.error ? `<div class="note note--bad"><span class="note__icon" aria-hidden="true">!!</span><span>${escapeHtml(res.error)}</span></div>` : ''}
    <div class="rows">${rows.map((p) => {
      const sym = market.symbolOf(p.key);
      const q = sym ? res.bySymbol.get(sym) : null;
      if (!sym) {
        return `<button type="button" class="row" data-symbolfor="${escapeHtml(p.key)}">
          <span class="row__main">
            <span class="row__name">${escapeHtml(p.name)}</span>
            <span class="row__meta">kein Börsensymbol zugeordnet</span>
          </span>
          <span class="row__side"><span class="chip">zuordnen</span></span>
        </button>`;
      }
      return `<button type="button" class="row" data-newsfor="${escapeHtml(p.key)}">
        <span class="row__main">
          <span class="row__name">${escapeHtml(p.name)}</span>
          <span class="row__meta">${escapeHtml(sym)}${q && !q.error && q.exchange ? ` · ${escapeHtml(q.exchange)}` : ''}</span>
        </span>
        ${q && !q.error ? sparkline(q.spark) : ''}
        <span class="row__side">
          <span class="row__value">${escapeHtml(q && !q.error ? fmtPrice(q.price) : '–')}</span>
          ${q && !q.error ? pillHtml(q.changePct, pct(q.changePct, { signed: true })) : '<span class="chip">kein Kurs</span>'}
        </span>
      </button>`;
    }).join('')}</div>
    <p class="card__note">Tippe auf einen Wert für die Schlagzeilen dazu.</p>`;

  $('#stocks-news').innerHTML = `
    <div class="card__head">
      <h2 class="card__title">Marktnachrichten</h2>
      <button class="btn btn--sm btn--ghost" type="button" id="news-refresh">Aktualisieren</button>
    </div>
    ${newsListHtml(general)}`;
  $('#news-refresh')?.addEventListener('click', async () => {
    const box = $('#stocks-news');
    box.querySelector('.news, .note')?.replaceWith(Object.assign(document.createElement('div'), { className: 'skeleton', style: 'height:150px' }));
    const fresh = await market.news('Börse Aktienmarkt Dax Nasdaq', { limit: 10, force: true });
    box.querySelector('.skeleton')?.outerHTML && (box.querySelector('.skeleton').outerHTML = newsListHtml(fresh));
  });
}

function newsListHtml(res) {
  if (res.error) return `<div class="note note--warn"><span class="note__icon" aria-hidden="true">!</span><span>${escapeHtml(res.error)}</span></div>`;
  if (!res.items.length) return '<p class="card__note">Gerade nichts gefunden.</p>';
  return `<div class="news">${res.items.map((n) => `
    <a class="news__item" href="${escapeHtml(n.link)}" target="_blank" rel="noopener noreferrer">
      <span class="news__title">${escapeHtml(n.title)}</span>
      <span class="news__meta">${escapeHtml([n.source, n.published ? relTime(n.published) : ''].filter(Boolean).join(' · '))}</span>
    </a>`).join('')}</div>`;
}

/** Ohne Marktdaten: wenigstens die Wege nach draußen. */
function linkListHtml(rows) {
  return `<section class="card glass">
    <div class="card__head"><h2 class="card__title">Deine Werte</h2></div>
    <p class="card__note">Solange keine Marktdaten angebunden sind, führen diese Links direkt zur Kursseite.</p>
    <div class="rows">${rows.map((p) => {
      const q = encodeURIComponent(market.suggestQuery(p.name));
      return `<div class="row row--static">
        <span class="row__main">
          <span class="row__name">${escapeHtml(p.name)}</span>
          <span class="row__meta">${escapeHtml(money(p.value))} · ${escapeHtml(pct(p.share))} des Depots</span>
        </span>
        <span class="row__side" style="flex-direction:row;gap:6px">
          <a class="btn btn--sm btn--ghost" href="https://de.finance.yahoo.com/lookup?s=${q}" target="_blank" rel="noopener noreferrer">Yahoo</a>
          <a class="btn btn--sm btn--ghost" href="https://www.finanzen.net/suchergebnis.asp?_search=${q}" target="_blank" rel="noopener noreferrer">finanzen.net</a>
        </span>
      </div>`;
    }).join('')}</div>
  </section>`;
}

/* ============================================================ Nachrichten */

export async function openNews(key) {
  const snap = store.latestSnapshot();
  const p = snap?.positions.find((x) => x.key === key);
  if (!p) return;
  const query = market.suggestQuery(p.name);

  $('#news-dialog-title').textContent = p.name;
  $('#news-dialog-body').innerHTML = '<div class="skeleton" style="height:200px"></div>';
  $('#news-dialog').showModal();

  const res = await market.news(query, { limit: 12 });
  $('#news-dialog-body').innerHTML = `
    <p class="card__note">Suchbegriff: „${escapeHtml(query)}“</p>
    ${newsListHtml(res)}
    <p class="card__note">Schlagzeilen kommen von Google News und öffnen sich beim Antippen im Browser.</p>`;
}

/* ========================================================= Symbolzuordnung */

export async function openSymbolPicker(key) {
  const snap = store.latestSnapshot();
  const p = snap?.positions.find((x) => x.key === key);
  if (!p) return;

  const current = market.symbolOf(key);
  const guess = market.suggestQuery(p.name);

  $('#news-dialog-title').textContent = 'Börsensymbol zuordnen';
  $('#news-dialog-body').innerHTML = `
    <p class="card__note">Für <strong>${escapeHtml(p.name)}</strong>${current ? ` · derzeit <span class="chip">${escapeHtml(current)}</span>` : ''}</p>
    <label class="field field--block">
      <span class="field__label">Suchen</span>
      <div class="field__row">
        <input type="search" id="sym-query" value="${escapeHtml(guess)}" placeholder="Name oder ISIN" autocomplete="off">
        <button class="btn btn--sm" type="button" id="sym-go">Suchen</button>
      </div>
      <span class="field__hint">Eine ISIN funktioniert auch. Für deutsche Handelsplätze enden die Symbole meist auf <code>.DE</code>.</span>
    </label>
    <div id="sym-results"></div>
    <label class="field field--block">
      <span class="field__label">Oder von Hand eintragen</span>
      <div class="field__row">
        <input type="text" id="sym-manual" value="${escapeHtml(current || '')}" placeholder="z. B. SXR8.DE" autocomplete="off" spellcheck="false">
        <button class="btn btn--sm" type="button" id="sym-save">Übernehmen</button>
      </div>
    </label>
    ${current ? '<div class="actions"><button class="btn btn--sm btn--danger" type="button" id="sym-clear">Zuordnung entfernen</button></div>' : ''}`;
  $('#news-dialog').showModal();

  const run = async () => {
    const q = $('#sym-query').value.trim();
    if (!q) return;
    $('#sym-results').innerHTML = '<div class="skeleton" style="height:110px"></div>';
    const res = await market.search(q);
    if (res.error) {
      $('#sym-results').innerHTML = `<div class="note note--warn"><span class="note__icon" aria-hidden="true">!</span><span>${escapeHtml(res.error)}</span></div>`;
      return;
    }
    if (!res.results.length) {
      $('#sym-results').innerHTML = '<p class="card__note">Nichts gefunden. Versuch es mit einem kürzeren Begriff oder der ISIN.</p>';
      return;
    }
    $('#sym-results').innerHTML = `<div class="rows">${res.results.map((r) => `
      <button type="button" class="row" data-pick="${escapeHtml(r.symbol)}">
        <span class="row__main">
          <span class="row__name">${escapeHtml(r.name)}</span>
          <span class="row__meta">${escapeHtml([r.exchange, r.type].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="row__side"><span class="chip">${escapeHtml(r.symbol)}</span></span>
      </button>`).join('')}</div>`;
  };

  const apply = (symbol) => {
    market.setSymbol(key, symbol);
    $('#news-dialog').close();
    document.dispatchEvent(new CustomEvent('bf:symbols-changed'));
  };

  $('#sym-go').addEventListener('click', run);
  $('#sym-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  $('#sym-save').addEventListener('click', () => apply($('#sym-manual').value.trim()));
  $('#sym-clear')?.addEventListener('click', () => apply(''));
  $('#sym-results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) apply(b.dataset.pick);
  });

  run();
}

/* ----------------------------------------------------- Automatische Suche */

export async function runAutoAssign() {
  const snap = store.latestSnapshot();
  if (!snap || !market.hasMarket()) return;
  const rows = stats.allocation(snap);

  const dlg = $('#news-dialog');
  $('#news-dialog-title').textContent = 'Symbole werden gesucht';
  const body = $('#news-dialog-body');
  body.innerHTML = '<p class="card__note">Einen Moment …</p><div class="skeleton" style="height:8px"></div>';
  dlg.showModal();

  const res = await market.autoAssign(rows, {
    onProgress: ({ done, total, name }) => {
      body.innerHTML = `
        <p class="card__note">${done} von ${total} geprüft${name ? ` · ${escapeHtml(name)}` : ''}</p>
        <div class="bar__track"><span class="bar__fill" style="width:${total ? (done / total) * 100 : 0}%"></span></div>`;
    },
  });

  $('#news-dialog-title').textContent = 'Zuordnung';
  body.innerHTML = `
    ${res.assigned.length ? `
      <div class="note note--good"><span class="note__icon" aria-hidden="true">✓</span><span>${res.assigned.length} ${res.assigned.length === 1 ? 'Position' : 'Positionen'} zugeordnet.</span></div>
      <div class="rows">${res.assigned.map((a) => `
        <div class="row row--static">
          <span class="row__main">
            <span class="row__name">${escapeHtml(a.position.name)}</span>
            <span class="row__meta">${escapeHtml(a.name || '')}${isNum(a.dev) ? ` · Kursabweichung ${escapeHtml(pct(a.dev * 100))}` : ''}</span>
          </span>
          <span class="row__side"><span class="chip">${escapeHtml(a.symbol)}</span></span>
        </div>`).join('')}</div>` : ''}

    ${res.unsure.length ? `
      <div class="note note--warn"><span class="note__icon" aria-hidden="true">!</span><span>${res.unsure.length} ${res.unsure.length === 1 ? 'Position ließ' : 'Positionen ließen'} sich nicht sicher zuordnen. Lieber offen lassen als das falsche Papier eintragen — tippe darauf und wähl von Hand.</span></div>
      <div class="rows">${res.unsure.map((u) => `
        <button type="button" class="row" data-symbolfor="${escapeHtml(u.position.key)}">
          <span class="row__main">
            <span class="row__name">${escapeHtml(u.position.name)}</span>
            <span class="row__meta">${escapeHtml(u.reason)}</span>
          </span>
          <span class="row__side"><span class="chip">von Hand</span></span>
        </button>`).join('')}</div>` : ''}

    ${!res.assigned.length && !res.unsure.length ? '<p class="card__note">Es war nichts offen.</p>' : ''}
    <div class="actions"><button class="btn" type="button" data-close-dialog="news-dialog">Fertig</button></div>`;

  document.dispatchEvent(new CustomEvent('bf:symbols-changed', { detail: { silent: true } }));
}

/** Ergebnis einer eingefügten Wertpapierliste. */
export async function runSecurityList(text) {
  const snap = store.latestSnapshot();
  if (!snap) { return; }
  if (!market.hasMarket()) {
    alert('Für die Symbolsuche muss erst der Marktdaten-Worker verbunden sein.');
    return;
  }
  const rows = stats.allocation(snap);

  const dlg = $('#news-dialog');
  $('#news-dialog-title').textContent = 'Liste wird eingelesen';
  const body = $('#news-dialog-body');
  body.innerHTML = '<p class="card__note">Einen Moment …</p>';
  dlg.showModal();

  let res;
  try {
    res = await market.applySecurityList(text, rows, {
      onProgress: ({ done, total, name }) => {
        body.innerHTML = `
          <p class="card__note">${done} von ${total} geprüft${name ? ` · ${escapeHtml(name)}` : ''}</p>
          <div class="bar__track"><span class="bar__fill" style="width:${total ? (done / total) * 100 : 0}%"></span></div>`;
      },
    });
  } catch (err) {
    $('#news-dialog-title').textContent = 'Liste';
    body.innerHTML = `<div class="note note--bad"><span class="note__icon" aria-hidden="true">!!</span><span>${escapeHtml(err.message)}</span></div>
      <div class="actions"><button class="btn" type="button" data-close-dialog="news-dialog">Schließen</button></div>`;
    return;
  }

  $('#news-dialog-title').textContent = 'Liste übernommen';
  body.innerHTML = `
    ${res.applied.length ? `
      <div class="note note--good"><span class="note__icon" aria-hidden="true">✓</span><span>${res.applied.length} ${res.applied.length === 1 ? 'Wertpapier' : 'Wertpapiere'} zugeordnet.</span></div>
      <div class="rows">${res.applied.map((a) => `
        <div class="row row--static">
          <span class="row__main">
            <span class="row__name">${escapeHtml(a.position.name)}</span>
            <span class="row__meta">${escapeHtml([a.entry.isin, a.entry.wkn].filter(Boolean).join(' · ') || a.name || '')}${isNum(a.dev) ? ` · Kursabweichung ${escapeHtml(pct(a.dev * 100))}` : ''}</span>
          </span>
          <span class="row__side"><span class="chip">${escapeHtml(a.symbol)}</span></span>
        </div>`).join('')}</div>` : ''}

    ${res.unsure.length ? `
      <div class="note note--warn"><span class="note__icon" aria-hidden="true">!</span><span>Bei ${res.unsure.length} ${res.unsure.length === 1 ? 'Papier' : 'Papieren'} passte kein Börsenkurs zum Kurs aus der CSV. ISIN und WKN sind gespeichert, das Symbol wähl bitte selbst.</span></div>
      <div class="rows">${res.unsure.map((u) => `
        <button type="button" class="row" data-symbolfor="${escapeHtml(u.position.key)}">
          <span class="row__main">
            <span class="row__name">${escapeHtml(u.position.name)}</span>
            <span class="row__meta">${escapeHtml(u.reason)}</span>
          </span>
          <span class="row__side"><span class="chip">von Hand</span></span>
        </button>`).join('')}</div>` : ''}

    ${res.unmatched.length ? `
      <div class="note"><span class="note__icon" aria-hidden="true">i</span><span>${res.unmatched.length} ${res.unmatched.length === 1 ? 'Zeile gehörte' : 'Zeilen gehörten'} zu keiner Position in deinem Depot: ${escapeHtml(res.unmatched.map((e) => e.name || e.isin || e.wkn).slice(0, 5).join(', '))}.</span></div>` : ''}

    <div class="actions"><button class="btn" type="button" data-close-dialog="news-dialog">Fertig</button></div>`;

  document.dispatchEvent(new CustomEvent('bf:symbols-changed', { detail: { silent: true } }));
}

/* ---------------------------------------------- Zusammenfassung Übersicht */

/** Kleine Tagesübersicht für die Startseite. */
export async function renderLiveSummary() {
  const card = $('#card-live');
  const box = $('#live-summary');
  const snap = store.latestSnapshot();
  if (!snap || !market.hasMarket()) { card.hidden = true; return; }

  const rows = stats.allocation(snap);
  const symbols = rows.map((p) => market.symbolOf(p.key)).filter(Boolean);
  if (!symbols.length) { card.hidden = true; return; }

  card.hidden = false;
  box.innerHTML = '<div class="skeleton" style="height:58px"></div>';

  const res = await market.quotes(symbols);
  if (res.error) {
    box.innerHTML = `<p class="card__note">${escapeHtml(res.error)}</p>`;
    return;
  }
  const t = market.todayTotals(rows, res.bySymbol);
  if (!isNum(t.change)) { card.hidden = true; return; }

  const movers = rows
    .map((p) => ({ p, q: res.bySymbol.get(market.symbolOf(p.key)) }))
    .filter((x) => x.q && !x.q.error && isNum(x.q.changePct))
    .sort((a, b) => Math.abs(b.q.changePct) - Math.abs(a.q.changePct))
    .slice(0, 3);

  box.innerHTML = `
    <div class="metric">
      <span class="metric__label">Veränderung seit gestern</span>
      <span class="metric__value">${escapeHtml(moneySigned(t.change))} ${deltaHtml(t.pct, pct(t.pct, { signed: true }))}</span>
    </div>
    <div class="rows">${movers.map(({ p, q }) => `
      <button type="button" class="row" data-poskey="${escapeHtml(p.key)}">
        <span class="row__main">
          <span class="row__name">${escapeHtml(p.name)}</span>
          <span class="row__meta">${escapeHtml(fmtPrice(q.price))}${q.currency && q.currency !== 'EUR' ? ` ${escapeHtml(q.currency)}` : ''}</span>
        </span>
        ${sparkline(q.spark)}
        <span class="row__side">${pillHtml(q.changePct, pct(q.changePct, { signed: true }))}</span>
      </button>`).join('')}</div>
    ${t.complete ? '' : `<p class="card__note">${t.covered} von ${t.total} Positionen haben ein Börsensymbol. Der Rest fehlt in dieser Rechnung.</p>`}`;
}

export { pillHtml, rangeHtml };
