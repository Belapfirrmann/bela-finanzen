// Bela Finanzen - App-Logik

import * as store from './store.js';
import { ASSET_CLASSES } from './store.js';
import { parseDepotCsv, buildPositions, decodeBuffer, FIELDS, parseNumber } from './parse.js';
import * as stats from './stats.js';
import * as market from './market.js';
import { lineChart, donut, foldToTop, responsive, sparkline } from './charts.js';
import {
  renderToday, renderStocks, renderLiveSummary, openNews, openSymbolPicker,
  runAutoAssign, runSecurityList, pillHtml, rangeHtml,
} from './views-market.js';
import {
  money, moneySigned, pct, qty as fmtQty, price as fmtPrice, decimal,
  deltaHtml, dateFull, dateShort, todayIso, escapeHtml, isNum, clock,
} from './format.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ------------------------------------------------------------------ Toast */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3400);
}

/* ------------------------------------------------------------------ Design */

const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'System', light: 'Hell', dark: 'Dunkel' };

function applyTheme(mode) {
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  $$('#theme-picker .seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.theme === mode));
}

function setTheme(mode, { announce = true } = {}) {
  store.setSetting('theme', mode);
  applyTheme(mode);
  if (announce) toast(mode === 'auto' ? 'Design folgt dem System' : `${THEME_LABEL[mode]}es Design`);
}

/* --------------------------------------------------------------- Navigation */

let currentView = 'overview';

function goto(view) {
  currentView = view;
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.goto === view));
  window.scrollTo({ top: 0, behavior: 'auto' });
  render();
}

/* ------------------------------------------------------------------ Rendern */

let range = 'max';
let allocMode = 'position';
let posSort = 'value';
let posQuery = '';

function render() {
  const state = store.getState();
  const has = state.snapshots.length > 0;

  $('#empty-state').hidden = has;
  $('#overview-content').hidden = !has;
  $('#btn-refresh').hidden = !(has && market.hasMarket());

  if (currentView === 'overview' && has) { renderOverview(); renderLiveSummary(); }
  if (currentView === 'today') renderToday();
  if (currentView === 'stocks') renderStocks();
  if (currentView === 'positions') renderPositions();
  if (currentView === 'history') renderHistory();
  if (currentView === 'more') renderMore();
}

/* ---------------------------------------------------------------- Übersicht */

function renderOverview() {
  const snaps = store.getState().snapshots;
  const curr = snaps[snaps.length - 1];
  const prev = snaps[snaps.length - 2] ?? null;
  const t = stats.totals(curr);

  $('#hero-date').textContent = `Stand ${dateFull(curr.date)}`;
  $('#hero-value').textContent = money(t.value, { cents: t.value < 100000 });

  const change = stats.changeBetween(prev, curr);
  if (change) {
    const useAdj = change.flow !== 0;
    const abs = useAdj ? change.adjustedAbs : change.abs;
    const p = useAdj ? change.adjustedPct : change.pct;
    $('#hero-delta').outerHTML = deltaHtml(abs, `${moneySigned(abs).replace(/^[+−]/, '')} · ${pct(p, { signed: true })}`, 'id="hero-delta"');
    $('#hero-delta-label').textContent = `seit ${dateShort(prev.date)}${useAdj ? ' (ohne Ein-/Auszahlung)' : ''}`;
  } else {
    $('#hero-delta').outerHTML = '<span id="hero-delta" class="delta delta--flat">Erster Stichtag</span>';
    $('#hero-delta-label').textContent = 'Ab dem zweiten Import zeigt sich hier die Veränderung.';
  }

  $('#tile-invested').textContent = isNum(t.invested) ? money(t.invested) : '–';
  $('#tile-invested-sub').textContent = isNum(t.invested)
    ? (t.partial ? 'nur Positionen mit Einstandskurs' : 'Kaufwert laut Depotauszug')
    : 'kein Einstandskurs in der Datei';

  $('#tile-gain').textContent = isNum(t.gainAbs) ? moneySigned(t.gainAbs) : '–';
  $('#tile-gain-pct').outerHTML = isNum(t.gainPct)
    ? deltaHtml(t.gainPct, `${pct(t.gainPct, { signed: true })} seit Kauf`, 'id="tile-gain-pct"')
    : '<span id="tile-gain-pct" class="delta delta--flat">–</span>';

  $('#tile-count').textContent = String(t.count);
  $('#tile-count-sub').textContent = t.rated ? `${t.winners} im Plus · ${t.losers} im Minus` : 'Wertpapiere im Depot';

  const alloc = stats.allocation(curr);
  const top = alloc[0];
  $('#tile-top').textContent = top ? pct(top.share) : '–';
  $('#tile-top-sub').textContent = top ? top.name : '';

  // Verlauf
  $$('#range-picker .seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.range === range));
  const series = stats.valueSeries(snaps, range);
  const chartBox = $('#chart-history');
  responsive(chartBox, () => lineChart(chartBox, series));
  $('#history-note').textContent = series.length > 1
    ? `${series.length} Stichtage · ${dateFull(series[0].date)} bis ${dateFull(series[series.length - 1].date)}`
    : 'Importiere die CSV regelmäßig, dann entsteht hier ein echter Verlauf.';

  // Aufteilung
  $$('#alloc-picker .seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.alloc === allocMode));
  const allocBody = $('#alloc-body');
  if (allocMode === 'class') {
    const rows = foldToTop(stats.allocationByClass(curr, store.assetClassOf), 6);
    if (rows.length < 2) {
      allocBody.innerHTML = `<div class="note"><span class="note__icon" aria-hidden="true">i</span><span>${
        rows[0]?.label === 'Nicht zugeordnet'
          ? 'Noch keine Anlageklassen vergeben, darum gibt es hier nichts aufzuteilen.'
          : `Alles liegt in einer Klasse: ${escapeHtml(rows[0]?.label ?? '–')}.`
      }</span></div>`;
      $('#alloc-note').textContent = 'Tippe in „Positionen“ auf ein Wertpapier und ordne es ETF, Aktie, Anleihe, Fonds oder Krypto zu.';
    } else {
      donut(allocBody, rows);
      $('#alloc-note').textContent = rows.some((r) => r.label === 'Nicht zugeordnet')
        ? 'Tippe in „Positionen“ auf ein Wertpapier, um ihm eine Anlageklasse zu geben.'
        : 'Anlageklassen hast du selbst vergeben.';
    }
  } else {
    const rows = alloc.slice(0, 8);
    allocBody.innerHTML = `<div class="bars">${rows.map((r) => `
      <button type="button" class="bar" data-poskey="${escapeHtml(r.key)}">
        <span class="bar__top">
          <span class="bar__name">${escapeHtml(r.name)}</span>
          <span class="bar__val">${escapeHtml(pct(r.share))}</span>
        </span>
        <span class="bar__track"><span class="bar__fill" style="width:${Math.max(r.share, 1.2).toFixed(2)}%"></span></span>
      </button>`).join('')}</div>`;
    $('#alloc-note').textContent = alloc.length > 8
      ? `Die 8 größten von ${alloc.length} Positionen. Alle in „Positionen“.`
      : `Alle ${alloc.length} Positionen nach Anteil am Depotwert.`;
  }
  if (t.estimated) {
    $('#alloc-note').textContent += ' Die Aufteilung ist auf wenige Zehntelprozent genau, weil der Export keinen Einzelkurs enthält.';
  }

  // Bewegungen zwischen Stichtagen
  const mv = stats.movers(prev, curr, 3);
  const moversBody = $('#movers-body');
  const useChange = mv.basis === 'change';
  const mvRow = (p) => {
    const v = useChange ? p.changePct : p.gainPct;
    const a = useChange ? p.changeAbs : p.gainAbs;
    return `<button type="button" class="row" data-poskey="${escapeHtml(p.key)}">
      <span class="row__main">
        <span class="row__name">${escapeHtml(p.name)}</span>
        <span class="row__meta">${escapeHtml(money(p.value))}${isNum(a) ? ` · ${escapeHtml(moneySigned(a))}` : ''}</span>
      </span>
      <span class="row__side">${pillHtml(v, pct(v, { signed: true }))}</span>
    </button>`;
  };
  if (!mv.up.length && !mv.down.length) {
    moversBody.innerHTML = '<p class="card__note">Noch nichts zu vergleichen. Nach dem nächsten Import steht hier, was sich am stärksten bewegt hat.</p>';
  } else {
    moversBody.innerHTML = `
      <p class="card__note">${useChange ? `Kursveränderung seit ${escapeHtml(dateFull(prev.date))}` : 'Entwicklung seit Kauf (erst ein Stichtag vorhanden)'}</p>
      ${mv.up.length ? `<p class="subhead">${useChange ? 'Gestiegen' : 'Größte Gewinner'}</p><div class="rows">${mv.up.map(mvRow).join('')}</div>` : ''}
      ${mv.down.length ? `<p class="subhead">${useChange ? 'Gefallen' : 'Größte Verlierer'}</p><div class="rows">${mv.down.map(mvRow).join('')}</div>` : ''}
      ${mv.newOnes?.length ? `<p class="card__note">Neu im Depot: ${mv.newOnes.map((p) => escapeHtml(p.name)).join(', ')}</p>` : ''}`;
  }

  // Streuung
  const c = stats.concentration(curr);
  const riskBody = $('#risk-body');
  if (!c) { riskBody.innerHTML = ''; return; }
  const level = c.top1 >= 40 ? 'bad' : c.top1 >= 25 ? 'warn' : 'good';
  const levelText = {
    good: 'Gut gestreut, keine Position dominiert das Depot.',
    warn: `Eine Position macht ${pct(c.top1)} aus. Im Blick behalten.`,
    bad: `Klumpenrisiko: ${escapeHtml(c.top1Name)} allein macht ${pct(c.top1)} deines Depots aus.`,
  }[level];
  riskBody.innerHTML = `
    <div class="metrics">
      <div class="metric"><span class="metric__label">Größte Position</span><span class="metric__value">${escapeHtml(pct(c.top1))}</span></div>
      <div class="metric"><span class="metric__label">Top 3 zusammen</span><span class="metric__value">${escapeHtml(pct(c.top3))}</span></div>
      <div class="metric"><span class="metric__label">Effektive Positionen</span><span class="metric__value">${escapeHtml(decimal(c.effective))} von ${c.count}</span></div>
    </div>
    <div class="note note--${level}"><span class="note__icon" aria-hidden="true">${{ good: '✓', warn: '!', bad: '!!' }[level]}</span><span>${levelText}</span></div>
    <p class="card__note">„Effektive Positionen“ sagt, auf wie viele gleich große Posten dein Depot hinauslaufen würde. Liegt der Wert deutlich unter der tatsächlichen Anzahl, hängt viel an wenigen Titeln.</p>`;
}

/* -------------------------------------------------------------- Positionen */

async function renderPositions() {
  const curr = store.latestSnapshot();
  const body = $('#positions-body');
  if (!curr) {
    body.innerHTML = '<section class="card glass"><p class="card__note">Noch keine Daten. Importiere zuerst deine comdirect-CSV.</p></section>';
    $('#positions-sub').textContent = '';
    return;
  }
  paintPositions(null);
  if (!market.hasMarket()) return;

  const symbols = curr.positions.map((p) => market.symbolOf(p.key)).filter(Boolean);
  if (!symbols.length) return;
  const res = await market.quotes(symbols);
  if (currentView === 'positions' && res.ok) paintPositions(res.bySymbol);
}

function paintPositions(bySymbol) {
  const curr = store.latestSnapshot();
  const body = $('#positions-body');
  const total = stats.totals(curr);
  $('#positions-sub').textContent = `${total.count} Positionen · Stand ${dateFull(curr.date)}`;

  const quoteFor = (p) => {
    if (!bySymbol) return null;
    const q = bySymbol.get(market.symbolOf(p.key));
    return q && !q.error ? q : null;
  };

  let rows = stats.allocation(curr).map((p) => ({ ...p, q: quoteFor(p) }));
  if (posQuery) {
    const q = posQuery.toLowerCase();
    rows = rows.filter((p) => [p.name, p.wkn, p.isin, market.symbolOf(p.key)]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }
  const cmp = {
    value: (a, b) => (b.value || 0) - (a.value || 0),
    today: (a, b) => (b.q?.changePct ?? -Infinity) - (a.q?.changePct ?? -Infinity),
    gainAbs: (a, b) => (b.gainAbs ?? -Infinity) - (a.gainAbs ?? -Infinity),
    gainPct: (a, b) => (b.gainPct ?? -Infinity) - (a.gainPct ?? -Infinity),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
  }[posSort];
  rows = [...rows].sort(cmp);

  if (!rows.length) {
    body.innerHTML = '<section class="card glass"><p class="card__note">Nichts gefunden.</p></section>';
    return;
  }

  const live = rows.some((p) => p.q);
  body.innerHTML = `
    <section class="card glass"><div class="rows">${rows.map((p) => {
      const cls = store.assetClassOf(p.key);
      return `<button type="button" class="row" data-poskey="${escapeHtml(p.key)}">
        <span class="row__main">
          <span class="row__name">${escapeHtml(p.name)}</span>
          <span class="row__meta">${escapeHtml(pct(p.share))} des Depots${isNum(p.qty) ? ` · ${escapeHtml(fmtQty(p.qty))} Stk.` : ''}${
            p.q ? ` · ${escapeHtml(fmtPrice(p.q.price))}${p.q.currency && p.q.currency !== 'EUR' ? ` ${escapeHtml(p.q.currency)}` : ''}` : ''}${cls ? ` · ${escapeHtml(cls)}` : ''}</span>
        </span>
        ${p.q ? sparkline(p.q.spark) : ''}
        <span class="row__side">
          <span class="row__value">${escapeHtml(money(p.value))}</span>
          ${p.q ? pillHtml(p.q.changePct, `${pct(p.q.changePct, { signed: true })} heute`)
                : (isNum(p.gainPct) ? deltaHtml(p.gainPct, pct(p.gainPct, { signed: true })) : '<span class="row__meta">–</span>')}
        </span>
      </button>`;
    }).join('')}</div>
    ${live ? '<p class="card__note">Der Prozentwert rechts ist die Veränderung von heute. Gewinn und Verlust seit Kauf stehen in der Tabelle.</p>' : ''}
    </section>
    <section class="card glass">
      <div class="card__head"><h2 class="card__title">Tabelle</h2></div>
      <div class="tablewrap">
        <table class="data">
          <thead><tr><th>Position</th><th>Stück</th><th>Einstand</th><th>Kurs</th>${live ? '<th>Heute %</th>' : ''}<th>Wert</th><th>G/V</th><th>G/V %</th></tr></thead>
          <tbody>${rows.map((p) => `<tr>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(fmtQty(p.qty))}</td>
            <td>${escapeHtml(fmtPrice(p.buyPrice))}</td>
            <td>${escapeHtml(fmtPrice(p.q ? p.q.price : p.price))}</td>
            ${live ? `<td>${escapeHtml(p.q && isNum(p.q.changePct) ? pct(p.q.changePct, { signed: true }) : '–')}</td>` : ''}
            <td>${escapeHtml(money(p.value))}</td>
            <td>${escapeHtml(isNum(p.gainAbs) ? moneySigned(p.gainAbs) : '–')}</td>
            <td>${escapeHtml(isNum(p.gainPct) ? pct(p.gainPct, { signed: true }) : '–')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <p class="card__note">Dieselben Zahlen ohne Farben, zum Nachrechnen und Vorlesen.${
        total.estimated ? ' Ohne Börsensymbol ist der Kurs die Mitte aus Tages-Hoch und Tages-Tief, verrechnet auf den ausgewiesenen Depotwert.' : ''}</p>
    </section>`;
}

/* ----------------------------------------------------------------- Verlauf */

function renderHistory() {
  const snaps = store.getState().snapshots;
  const body = $('#history-body');
  if (!snaps.length) {
    body.innerHTML = '<section class="card glass"><p class="card__note">Noch keine Stichtage gespeichert.</p></section>';
    return;
  }
  const rows = [...snaps].reverse().map((s, i, arr) => ({
    snap: s, total: stats.totals(s), ch: stats.changeBetween(arr[i + 1] ?? null, s),
  }));

  body.innerHTML = `
    <section class="card glass">
      <div class="card__head"><h2 class="card__title">Stichtage</h2></div>
      <div class="rows">${rows.map(({ snap, total, ch }) => `
        <div class="row row--static">
          <span class="row__main">
            <span class="row__name">${escapeHtml(dateFull(snap.date))}</span>
            <span class="row__meta">${total.count} Positionen${isNum(snap.flow) && snap.flow !== 0 ? ` · ${escapeHtml(moneySigned(snap.flow))} ${snap.flow > 0 ? 'eingezahlt' : 'entnommen'}` : ''}${ch ? ` · ${ch.days} Tage` : ''}</span>
          </span>
          <span class="row__side">
            <span class="row__value">${escapeHtml(money(total.value))}</span>
            ${ch ? deltaHtml(ch.adjustedAbs, pct(ch.adjustedPct, { signed: true })) : '<span class="row__meta">Start</span>'}
          </span>
          <button type="button" class="iconbtn" data-delsnap="${escapeHtml(snap.date)}" aria-label="Stichtag ${escapeHtml(dateFull(snap.date))} löschen">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>`).join('')}</div>
    </section>
    <section class="card glass">
      <div class="card__head"><h2 class="card__title">Tabelle</h2></div>
      <div class="tablewrap">
        <table class="data">
          <thead><tr><th>Stichtag</th><th>Depotwert</th><th>Veränderung</th><th>Ein/Aus</th><th>bereinigt</th><th>Positionen</th></tr></thead>
          <tbody>${rows.map(({ snap, total, ch }) => `<tr>
            <td>${escapeHtml(dateFull(snap.date))}</td>
            <td>${escapeHtml(money(total.value))}</td>
            <td>${escapeHtml(ch ? moneySigned(ch.abs) : '–')}</td>
            <td>${escapeHtml(isNum(snap.flow) && snap.flow !== 0 ? moneySigned(snap.flow) : '–')}</td>
            <td>${escapeHtml(ch ? `${moneySigned(ch.adjustedAbs)} (${pct(ch.adjustedPct, { signed: true })})` : '–')}</td>
            <td>${total.count}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <p class="card__note">„bereinigt“ heißt: Ein- und Auszahlungen sind herausgerechnet, es bleibt die reine Wertentwicklung.</p>
    </section>`;
}

/* -------------------------------------------------------------------- Mehr */

function renderMore() {
  const n = store.getState().snapshots.length;
  const kb = store.storageSize();
  $('#storage-note').textContent = n
    ? `${n} Stichtag${n === 1 ? '' : 'e'} gespeichert, rund ${kb} KB im Browser-Speicher.`
    : 'Noch nichts gespeichert.';
  $('#more-history-note').textContent = n
    ? `${n} gespeicherte${n === 1 ? 'r' : ''} Stichtag${n === 1 ? '' : 'e'}.`
    : 'Noch keine Stichtage.';

  applyTheme(store.getState().settings.theme || 'auto');
  $('#worker-url').value = market.workerUrl();
  paintMarketStatus();
}

function paintMarketStatus(state) {
  const el = $('#market-status');
  const has = market.hasMarket();
  const s = state || (has ? 'ok' : 'off');
  el.className = `pill ${s === 'ok' ? 'pill--up' : s === 'err' ? 'pill--down' : 'pill--flat'}`;
  el.textContent = { ok: 'verbunden', err: 'Fehler', off: 'nicht verbunden', test: 'prüfe …' }[s];
}

/* ------------------------------------------------------------------ Import */

let pending = null;

function readFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { handleCsvText(decodeBuffer(reader.result)); }
    catch (err) { console.error(err); toast('Die Datei ließ sich nicht lesen.'); }
  };
  reader.onerror = () => toast('Die Datei ließ sich nicht lesen.');
  reader.readAsArrayBuffer(file);
}

function handleCsvText(text) {
  if (!text || !text.trim()) { toast('Die Datei ist leer.'); return; }
  const res = parseDepotCsv(text);
  pending = {
    header: res.header, dataRows: res.dataRows, mapping: { ...res.mapping },
    positions: res.positions, footer: res.footer || {},
    date: res.date || todayIso(), warnings: res.warnings,
  };
  $('#import-date').value = pending.date;
  $('#import-flow').value = '';
  $('#import-preview').hidden = false;
  renderPreview();
  $('#import-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function recompute() {
  pending.positions = buildPositions(pending.dataRows, pending.mapping, pending.footer).positions;
  renderPreview();
}

function renderPreview() {
  const { positions, warnings, header, mapping, footer } = pending;
  const withBuy = positions.filter((p) => isNum(p.buyValue));
  const total = isNum(footer?.value) ? footer.value : positions.reduce((s, p) => s + (p.value || 0), 0);
  const invested = isNum(footer?.invested) ? footer.invested : withBuy.reduce((s, p) => s + p.buyValue, 0);
  const hasInvested = isNum(footer?.invested) || withBuy.length > 0;

  const notes = [];
  if (positions.length) {
    notes.push(`<div class="note note--good"><span class="note__icon" aria-hidden="true">✓</span><span><strong>${positions.length} Positionen</strong> erkannt, Depotwert ${escapeHtml(money(total))}${hasInvested ? ` · Kaufwert ${escapeHtml(money(invested))} · ${escapeHtml(moneySigned(total - invested))}` : ''}.${isNum(footer?.value) ? ' Die Summen kommen direkt aus der Datei.' : ''}</span></div>`);
  } else {
    notes.push('<div class="note note--bad"><span class="note__icon" aria-hidden="true">!!</span><span>Keine Positionen erkannt. Ordne die Spalten unten von Hand zu.</span></div>');
  }
  for (const w of warnings) {
    notes.push(`<div class="note note--warn"><span class="note__icon" aria-hidden="true">!</span><span>${escapeHtml(w)}</span></div>`);
  }
  $('#preview-status').innerHTML = `<div class="stack">${notes.join('')}</div>`;

  const options = (selected) => [
    '<option value="">– keine –</option>',
    ...header.map((h, i) => `<option value="${i}"${selected === i ? ' selected' : ''}>${escapeHtml(h || `Spalte ${i + 1}`)}</option>`),
  ].join('');
  $('#mapping-body').innerHTML = `
    <details class="details" ${positions.length ? '' : 'open'}>
      <summary>Spaltenzuordnung prüfen oder ändern</summary>
      <div class="mapgrid">${FIELDS.map((f) => `
        <label class="field">
          <span class="field__label">${escapeHtml(f.label)}</span>
          <select data-mapfield="${f.key}">${options(mapping[f.key])}</select>
        </label>`).join('')}</div>
      <p class="field__hint">Links steht, was das Dashboard braucht, rechts die Spalte aus deiner Datei. Fehlendes wird, wo möglich, aus den anderen Spalten berechnet.</p>
    </details>`;

  const show = positions.slice(0, 8);
  $('#preview-table').innerHTML = show.length ? `
    <div class="tablewrap">
      <table class="data">
        <thead><tr><th>Position</th><th>Stück</th><th>Kurs</th><th>Wert</th><th>G/V</th></tr></thead>
        <tbody>${show.map((p) => `<tr>
          <td>${escapeHtml(p.name)}</td><td>${escapeHtml(fmtQty(p.qty))}</td>
          <td>${escapeHtml(fmtPrice(p.price))}</td><td>${escapeHtml(money(p.value))}</td>
          <td>${escapeHtml(isNum(p.gainAbs) ? moneySigned(p.gainAbs) : '–')}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    ${positions.length > show.length ? `<p class="card__note">… und ${positions.length - show.length} weitere.</p>` : ''}` : '';
}

function saveImport() {
  if (!pending || !pending.positions.length) { toast('Es gibt nichts zu speichern.'); return; }
  const date = $('#import-date').value || todayIso();
  const flowRaw = $('#import-flow').value.trim();
  const flow = flowRaw ? parseNumber(flowRaw) : null;
  if (flowRaw && flow === null) { toast('Die Ein-/Auszahlung ist keine gültige Zahl.'); return; }

  try {
    const { replaced, count } = store.saveSnapshot({
      date, positions: pending.positions, flow,
      reported: { value: pending.footer?.value, invested: pending.footer?.invested },
    });
    pending = null;
    $('#import-preview').hidden = true;
    $('#file-input').value = '';
    $('#paste-area').value = '';
    toast(replaced ? `Stichtag ${dateFull(date)} aktualisiert (${count} Positionen).` : `${count} Positionen zum ${dateFull(date)} gespeichert.`);
    goto('overview');
  } catch (err) { toast(err.message); }
}

/* ------------------------------------------------------------ Positionsblatt */

async function openPosition(key) {
  const snaps = store.getState().snapshots;
  const curr = snaps[snaps.length - 1];
  if (!curr) return;
  const p = stats.allocation(curr).find((r) => r.key === key);
  if (!p) return;

  const history = snaps.map((s) => ({ date: s.date, pos: s.positions.find((x) => x.key === key) }))
    .filter((h) => h.pos).reverse();
  const cls = store.assetClassOf(key);
  const sym = market.symbolOf(key);
  const meta = store.getState().meta?.[key] || {};
  const isin = p.isin || meta.isin || null;
  const wkn = p.wkn || meta.wkn || null;

  $('#pos-dialog-title').textContent = p.name;
  $('#pos-dialog-body').innerHTML = `
    <div id="pos-live">${sym && market.hasMarket() ? '<div class="skeleton" style="height:86px"></div>' : ''}</div>
    <div class="metrics">
      ${[
        ['Wert', money(p.value)],
        ['Anteil am Depot', pct(p.share)],
        ['Stück / Nominal', fmtQty(p.qty)],
        ['Einstandskurs', fmtPrice(p.buyPrice)],
        [p.priceEstimated ? 'Kurs (geschätzt)' : 'Kurs laut Export', fmtPrice(p.price)],
        ...(isNum(p.high) || isNum(p.low) ? [['Tagesspanne im Export', `${fmtPrice(p.low)} – ${fmtPrice(p.high)}`]] : []),
        ['Einstandswert', isNum(p.buyValue) ? money(p.buyValue) : '–'],
      ].map(([l, v]) => `<div class="metric"><span class="metric__label">${l}</span><span class="metric__value">${escapeHtml(v)}</span></div>`).join('')}
      <div class="metric">
        <span class="metric__label">Gewinn / Verlust</span>
        <span class="metric__value">${isNum(p.gainAbs) ? `${escapeHtml(moneySigned(p.gainAbs))} ` : '–'}${isNum(p.gainPct) ? deltaHtml(p.gainPct, pct(p.gainPct, { signed: true })) : ''}</span>
      </div>
    </div>
    <p class="card__note">${[wkn ? `WKN ${escapeHtml(wkn)}` : '', isin ? `ISIN ${escapeHtml(isin)}` : '', p.currency ? escapeHtml(p.currency) : ''].filter(Boolean).join(' · ') || 'Keine Kennnummer bekannt. Der comdirect-Export liefert keine, du kannst sie unter Mehr als Liste einfügen.'}</p>
    ${p.priceEstimated ? '<div class="note"><span class="note__icon" aria-hidden="true">i</span><span>Der Export enthält keinen aktuellen Kurs. Gerechnet wird mit der Mitte aus Tages-Hoch und Tages-Tief, anteilig auf den ausgewiesenen Depotwert gebracht.</span></div>' : ''}
    <div class="actions">
      <button class="btn btn--sm" type="button" data-symbolfor="${escapeHtml(key)}">${sym ? `Symbol: ${escapeHtml(sym)}` : 'Börsensymbol zuordnen'}</button>
      ${sym ? `<button class="btn btn--sm btn--ghost" type="button" data-newsfor="${escapeHtml(key)}">Nachrichten</button>` : ''}
    </div>
    <label class="field field--block">
      <span class="field__label">Anlageklasse</span>
      <select id="pos-class">
        <option value="">– nicht zugeordnet –</option>
        ${ASSET_CLASSES.map((c) => `<option value="${c}"${cls === c ? ' selected' : ''}>${c}</option>`).join('')}
      </select>
      <span class="field__hint">Wird gespeichert und bei jedem weiteren Import automatisch wieder zugeordnet.</span>
    </label>
    ${history.length > 1 ? `
      <div>
        <p class="subhead">Verlauf dieser Position</p>
        <div class="tablewrap">
          <table class="data">
            <thead><tr><th>Stichtag</th><th>Stück</th><th>Kurs</th><th>Wert</th></tr></thead>
            <tbody>${history.map((h) => `<tr>
              <td>${escapeHtml(dateShort(h.date))}</td><td>${escapeHtml(fmtQty(h.pos.qty))}</td>
              <td>${escapeHtml(fmtPrice(h.pos.price))}</td><td>${escapeHtml(money(h.pos.value))}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>` : ''}`;

  $('#pos-class').addEventListener('change', (e) => {
    store.setAssetClass(key, e.target.value);
    toast(e.target.value ? `Als ${e.target.value} eingeordnet.` : 'Zuordnung entfernt.');
  });
  $('#pos-dialog').showModal();

  if (sym && market.hasMarket()) {
    const res = await market.quotes([sym]);
    const q = res.bySymbol.get(sym);
    const box = $('#pos-live');
    if (!box) return;
    if (!q || q.error) {
      box.innerHTML = `<div class="note note--warn"><span class="note__icon" aria-hidden="true">!</span><span>${escapeHtml(q?.error || res.error || 'Kein Kurs zu diesem Symbol.')}</span></div>`;
      return;
    }
    const mismatch = await market.priceMismatch(p, q);
    box.innerHTML = `
      <div class="metrics">
        <div class="metric">
          <span class="metric__label">Börsenkurs${q.time ? ` · ${clock(q.time)} Uhr` : ''}</span>
          <span class="metric__value">${escapeHtml(fmtPrice(q.price))}${q.currency ? ` ${escapeHtml(q.currency)}` : ''} ${pillHtml(q.changePct, pct(q.changePct, { signed: true }))}</span>
        </div>
        <div class="metric">
          <span class="metric__label">Heute auf deine ${escapeHtml(fmtQty(p.qty))} Stück</span>
          <span class="metric__value">${escapeHtml(isNum(q.change) && isNum(p.qty) ? moneySigned(q.change * p.qty) : '–')}</span>
        </div>
      </div>
      ${rangeHtml(q.dayLow, q.dayHigh, q.price)}
      ${sparkline(q.spark, { width: 240, height: 46 })}
      ${mismatch ? `<div class="note note--warn"><span class="note__icon" aria-hidden="true">!</span><span>Der Börsenkurs weicht um ${escapeHtml(pct(mismatch))} vom Kurs aus deiner CSV ab. Vermutlich gehört ein anderes Symbol zu dieser Position.</span></div>` : ''}`;
  }
}

/* ---------------------------------------------------------------- Sicherung */

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------- Events */

function wireEvents() {
  $('#btn-theme').addEventListener('click', () => {
    const cur = store.getState().settings.theme || 'auto';
    setTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
  });
  $('#theme-picker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]');
    if (b) setTheme(b.dataset.theme, { announce: false });
  });

  $('#btn-refresh').addEventListener('click', async () => {
    const curr = store.latestSnapshot();
    const symbols = (curr?.positions || []).map((p) => market.symbolOf(p.key)).filter(Boolean);
    if (!symbols.length) { toast('Noch kein Börsensymbol zugeordnet.'); return; }
    toast('Kurse werden geladen …');
    const res = await market.quotes(symbols, { force: true });
    toast(res.ok ? 'Kurse aktualisiert.' : res.error || 'Kurse ließen sich nicht laden.');
    render();
  });

  document.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close-dialog]');
    if (close) { document.getElementById(close.dataset.closeDialog)?.close(); return; }

    const nav = e.target.closest('[data-goto]');
    if (nav) { goto(nav.dataset.goto); return; }

    if (e.target.closest('[data-autoassign]')) { runAutoAssign(); return; }

    const symBtn = e.target.closest('[data-symbolfor]');
    if (symBtn) { document.getElementById('pos-dialog')?.close(); openSymbolPicker(symBtn.dataset.symbolfor); return; }

    const newsBtn = e.target.closest('[data-newsfor]');
    if (newsBtn) { document.getElementById('pos-dialog')?.close(); openNews(newsBtn.dataset.newsfor); return; }

    const posBtn = e.target.closest('[data-poskey]');
    if (posBtn) { openPosition(posBtn.dataset.poskey); return; }

    const del = e.target.closest('[data-delsnap]');
    if (del && confirm(`Stichtag ${dateFull(del.dataset.delsnap)} wirklich löschen?`)) {
      store.deleteSnapshot(del.dataset.delsnap);
      toast('Stichtag gelöscht.');
      render();
    }
  });

  document.addEventListener('bf:symbols-changed', (e) => {
    if (!e.detail?.silent) toast('Symbol gespeichert.');
    render();
  });

  $('#range-picker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    range = b.dataset.range;
    store.setSetting('range', range);
    renderOverview();
  });
  $('#alloc-picker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-alloc]');
    if (!b) return;
    allocMode = b.dataset.alloc;
    renderOverview();
  });

  $('#pos-search').addEventListener('input', (e) => { posQuery = e.target.value; renderPositions(); });
  $('#pos-sort').addEventListener('change', (e) => { posSort = e.target.value; renderPositions(); });

  // Marktdaten
  $('#btn-test-worker').addEventListener('click', async () => {
    const url = $('#worker-url').value.trim();
    if (!url) {
      store.setSetting('workerUrl', '');
      paintMarketStatus('off');
      $('#market-hint').innerHTML = '<div class="note"><span class="note__icon" aria-hidden="true">i</span><span>Adresse entfernt. Die App läuft weiter, nur ohne Live-Kurse.</span></div>';
      render();
      return;
    }
    paintMarketStatus('test');
    $('#market-hint').innerHTML = '<div class="skeleton" style="height:46px"></div>';
    try {
      await market.ping(url);
      store.setSetting('workerUrl', url.replace(/\/+$/, ''));
      paintMarketStatus('ok');
      $('#market-hint').innerHTML = '<div class="note note--good"><span class="note__icon" aria-hidden="true">✓</span><span>Verbunden. Ordne deinen Positionen jetzt Börsensymbole zu, dann füllen sich „Heute“ und „Aktien“.</span></div>';
      toast('Marktdaten verbunden.');
      render();
    } catch (err) {
      paintMarketStatus('err');
      $('#market-hint').innerHTML = `<div class="note note--bad"><span class="note__icon" aria-hidden="true">!!</span><span>${escapeHtml(err.message)}</span></div>`;
    }
  });

  $('#btn-seclist').addEventListener('click', () => {
    const text = $('#seclist').value.trim();
    if (!text) { toast('Erst eine Liste einfügen.'); return; }
    runSecurityList(text);
  });

  // Datei
  const drop = $('#drop');
  const fileInput = $('#file-input');
  drop.setAttribute('tabindex', '0');
  drop.setAttribute('role', 'button');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', (e) => readFile(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => readFile(e.dataTransfer?.files?.[0]));
  $('#btn-paste').addEventListener('click', () => handleCsvText($('#paste-area').value));

  $('#mapping-body').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-mapfield]');
    if (!sel || !pending) return;
    if (sel.value === '') delete pending.mapping[sel.dataset.mapfield];
    else pending.mapping[sel.dataset.mapfield] = Number(sel.value);
    recompute();
  });
  $('#btn-save-import').addEventListener('click', saveImport);
  $('#btn-cancel-import').addEventListener('click', () => {
    pending = null;
    $('#import-preview').hidden = true;
    $('#file-input').value = '';
  });

  // Sicherung
  $('#btn-export').addEventListener('click', () => {
    download(`bela-finanzen-sicherung-${todayIso()}.json`, store.exportBackup());
    toast('Sicherung heruntergeladen.');
  });
  $('#btn-import-backup').addEventListener('click', () => $('#backup-input').click());
  $('#backup-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const n = store.importBackup(String(r.result));
        applyTheme(store.getState().settings.theme || 'auto');
        toast(`${n} Stichtage eingespielt.`);
        goto('overview');
      } catch (err) { toast(err.message || 'Die Sicherung ließ sich nicht lesen.'); }
    };
    r.readAsText(file);
    e.target.value = '';
  });
  $('#btn-wipe').addEventListener('click', () => {
    if (!confirm('Wirklich alle Stichtage und Einstellungen auf diesem Gerät löschen? Das lässt sich nicht rückgängig machen.')) return;
    store.wipe();
    applyTheme('auto');
    toast('Alle Daten gelöscht.');
    goto('overview');
  });

  for (const id of ['pos-dialog', 'news-dialog']) {
    const dlg = document.getElementById(id);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  $('#pos-dialog').addEventListener('close', () => render());
  $('#news-dialog').addEventListener('close', () => render());
}

/* --------------------------------------------------------------------- Start */

function init() {
  const state = store.load();
  applyTheme(state.settings.theme || 'auto');
  range = state.settings.range || 'max';
  wireEvents();
  goto('overview');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline ist optional */ });
    });
  }
}

init();
