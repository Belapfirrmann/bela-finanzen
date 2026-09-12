// Bela Finanzen - App-Logik

import * as store from './store.js';
import { ASSET_CLASSES } from './store.js';
import { parseDepotCsv, buildPositions, decodeBuffer, FIELDS, parseNumber } from './parse.js';
import * as stats from './stats.js';
import { lineChart, donut, foldToTop, responsive } from './charts.js';
import {
  money, moneySigned, pct, qty as fmtQty, price as fmtPrice, decimal,
  deltaHtml, dateFull, dateShort, todayIso, daysBetween, escapeHtml, isNum,
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
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ------------------------------------------------------------------ Theme */

function applyTheme(mode) {
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const cur = store.getState().settings.theme || 'auto';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  store.setSetting('theme', next);
  applyTheme(next);
  toast({ auto: 'Design folgt dem System', light: 'Helles Design', dark: 'Dunkles Design' }[next]);
}

/* --------------------------------------------------------------- Navigation */

let currentView = 'overview';

function goto(view) {
  currentView = view;
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.goto === view));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
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

  if (currentView === 'overview' && has) renderOverview();
  if (currentView === 'positions') renderPositions();
  if (currentView === 'history') renderHistory();
  if (currentView === 'import') renderStorageNote();
}

/* --------------------------------------------------------------- Übersicht */

function renderOverview() {
  const state = store.getState();
  const snaps = state.snapshots;
  const curr = snaps[snaps.length - 1];
  const prev = snaps[snaps.length - 2] ?? null;
  const t = stats.totals(curr);

  $('#hero-date').textContent = `Stand ${dateFull(curr.date)}`;
  $('#hero-value').textContent = money(t.value, { cents: t.value < 100000 });

  const change = stats.changeBetween(prev, curr);
  const heroDelta = $('#hero-delta');
  const heroLabel = $('#hero-delta-label');
  if (change) {
    const useAdj = change.flow !== 0;
    const abs = useAdj ? change.adjustedAbs : change.abs;
    const p = useAdj ? change.adjustedPct : change.pct;
    heroDelta.outerHTML = deltaHtml(abs, `${moneySigned(abs).replace(/^[+\u2212]/, '')} · ${pct(p, { signed: true })}`, 'id="hero-delta"');
    heroLabel.textContent = `seit ${dateShort(prev.date)}${useAdj ? ' (ohne Ein-/Auszahlung)' : ''}`;
  } else {
    heroDelta.outerHTML = `<span id="hero-delta" class="delta delta--flat">Erster Stichtag</span>`;
    heroLabel.textContent = 'Ab dem zweiten Import zeigt sich hier die Veränderung.';
  }

  // Kacheln
  $('#tile-invested').textContent = isNum(t.invested) ? money(t.invested) : '–';
  $('#tile-invested-sub').textContent = isNum(t.invested)
    ? (t.partial ? 'nur Positionen mit Einstandskurs' : 'Kaufwert aller Positionen')
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
      // Ein einziges Segment ist kein Diagramm, sondern eine Aufforderung.
      allocBody.innerHTML = `<div class="note"><span class="note__icon" aria-hidden="true">i</span><span>${
        rows[0]?.label === 'Nicht zugeordnet'
          ? 'Noch keine Anlageklassen vergeben - darum gibt es hier nichts aufzuteilen.'
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

  // Bewegungen
  const mv = stats.movers(prev, curr, 3);
  const moversBody = $('#movers-body');
  const mvRow = (p, useChange) => {
    const v = useChange ? p.changePct : p.gainPct;
    const a = useChange ? p.changeAbs : p.gainAbs;
    return `<button type="button" class="row" data-poskey="${escapeHtml(p.key)}">
      <span class="row__main">
        <span class="row__name">${escapeHtml(p.name)}</span>
        <span class="row__meta">${escapeHtml(money(p.value))}${isNum(a) ? ` · ${escapeHtml(moneySigned(a))}` : ''}</span>
      </span>
      <span class="row__side">${deltaHtml(v, pct(v, { signed: true }))}</span>
    </button>`;
  };
  const useChange = mv.basis === 'change';
  if (!mv.up.length && !mv.down.length) {
    moversBody.innerHTML = '<p class="card__note">Noch nichts zu vergleichen. Nach dem nächsten Import steht hier, was sich am stärksten bewegt hat.</p>';
  } else {
    moversBody.innerHTML = `
      <p class="card__note">${useChange ? `Kursveränderung seit ${escapeHtml(dateFull(prev.date))}` : 'Entwicklung seit Kauf (erst ein Stichtag vorhanden)'}</p>
      ${mv.up.length ? `<p class="subhead">${useChange ? 'Gestiegen' : 'Größte Gewinner'}</p><div class="rows">${mv.up.map((p) => mvRow(p, useChange)).join('')}</div>` : ''}
      ${mv.down.length ? `<p class="subhead">${useChange ? 'Gefallen' : 'Größte Verlierer'}</p><div class="rows">${mv.down.map((p) => mvRow(p, useChange)).join('')}</div>` : ''}
      ${mv.newOnes?.length ? `<p class="card__note">Neu im Depot: ${mv.newOnes.map((p) => escapeHtml(p.name)).join(', ')}</p>` : ''}`;
  }

  // Streuung
  const c = stats.concentration(curr);
  const riskBody = $('#risk-body');
  if (!c) { riskBody.innerHTML = ''; return; }
  const level = c.top1 >= 40 ? 'bad' : c.top1 >= 25 ? 'warn' : 'good';
  const levelText = {
    good: 'Gut gestreut - keine Position dominiert das Depot.',
    warn: `Eine Position macht ${pct(c.top1)} aus. Im Blick behalten.`,
    bad: `Klumpenrisiko: ${escapeHtml(c.top1Name)} allein macht ${pct(c.top1)} deines Depots aus.`,
  }[level];
  const levelIcon = { good: '✓', warn: '!', bad: '!!' }[level];
  riskBody.innerHTML = `
    <div class="metrics">
      <div class="metric"><span class="metric__label">Größte Position</span><span class="metric__value">${escapeHtml(pct(c.top1))}</span></div>
      <div class="metric"><span class="metric__label">Top 3 zusammen</span><span class="metric__value">${escapeHtml(pct(c.top3))}</span></div>
      <div class="metric"><span class="metric__label">Effektive Positionen</span><span class="metric__value">${escapeHtml(decimal(c.effective))} von ${c.count}</span></div>
    </div>
    <div class="note note--${level}"><span class="note__icon" aria-hidden="true">${levelIcon}</span><span>${levelText}</span></div>
    <p class="card__note">„Effektive Positionen“ sagt, auf wie viele gleich große Posten dein Depot hinauslaufen würde. Liegt der Wert deutlich unter der tatsächlichen Anzahl, hängt viel an wenigen Titeln.</p>`;
}

/* -------------------------------------------------------------- Positionen */

function renderPositions() {
  const curr = store.latestSnapshot();
  const body = $('#positions-body');
  if (!curr) {
    body.innerHTML = '<p class="card__note">Noch keine Daten. Importiere zuerst deine comdirect-CSV.</p>';
    $('#positions-sub').textContent = '';
    return;
  }
  const total = stats.totals(curr);
  $('#positions-sub').textContent = `${total.count} Positionen · Stand ${dateFull(curr.date)}`;

  let rows = stats.allocation(curr);
  if (posQuery) {
    const q = posQuery.toLowerCase();
    rows = rows.filter((p) => [p.name, p.wkn, p.isin].some((v) => String(v || '').toLowerCase().includes(q)));
  }
  const cmp = {
    value: (a, b) => (b.value || 0) - (a.value || 0),
    gainAbs: (a, b) => (b.gainAbs ?? -Infinity) - (a.gainAbs ?? -Infinity),
    gainPct: (a, b) => (b.gainPct ?? -Infinity) - (a.gainPct ?? -Infinity),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
  }[posSort];
  rows = [...rows].sort(cmp);

  if (!rows.length) {
    body.innerHTML = '<p class="card__note">Nichts gefunden.</p>';
    return;
  }

  body.innerHTML = `
    <div class="card"><div class="rows">${rows.map((p) => {
      const cls = store.assetClassOf(p.key);
      return `<button type="button" class="row" data-poskey="${escapeHtml(p.key)}">
        <span class="row__main">
          <span class="row__name">${escapeHtml(p.name)}</span>
          <span class="row__meta">${escapeHtml(pct(p.share))} des Depots${isNum(p.qty) ? ` · ${escapeHtml(fmtQty(p.qty))} Stk.` : ''}${cls ? ` · ${escapeHtml(cls)}` : ''}</span>
        </span>
        <span class="row__side">
          <span class="row__value">${escapeHtml(money(p.value))}</span>
          ${isNum(p.gainPct) ? deltaHtml(p.gainPct, pct(p.gainPct, { signed: true })) : '<span class="row__meta">–</span>'}
        </span>
      </button>`;
    }).join('')}</div></div>
    <section class="card">
      <div class="card__head"><h2 class="card__title">Tabelle</h2></div>
      <div class="tablewrap">
        <table class="data">
          <thead><tr><th>Position</th><th>Stück</th><th>Einstand</th><th>Kurs</th><th>Wert</th><th>G/V</th><th>G/V %</th></tr></thead>
          <tbody>${rows.map((p) => `<tr>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(fmtQty(p.qty))}</td>
            <td>${escapeHtml(fmtPrice(p.buyPrice))}</td>
            <td>${escapeHtml(fmtPrice(p.price))}</td>
            <td>${escapeHtml(money(p.value))}</td>
            <td>${escapeHtml(isNum(p.gainAbs) ? moneySigned(p.gainAbs) : '–')}</td>
            <td>${escapeHtml(isNum(p.gainPct) ? pct(p.gainPct, { signed: true }) : '–')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <p class="card__note">Dieselben Zahlen ohne Farbcodierung - zum Nachrechnen und Vorlesen.</p>
    </section>`;
}

/* ----------------------------------------------------------------- Verlauf */

function renderHistory() {
  const snaps = store.getState().snapshots;
  const body = $('#history-body');
  if (!snaps.length) {
    body.innerHTML = '<p class="card__note">Noch keine Stichtage gespeichert.</p>';
    return;
  }
  const rows = [...snaps].reverse().map((s, i, arr) => {
    const prev = arr[i + 1] ?? null;
    const ch = stats.changeBetween(prev, s);
    const t = stats.totals(s);
    return { snap: s, total: t, ch };
  });

  body.innerHTML = `
    <section class="card">
      <div class="card__head"><h2 class="card__title">Stichtage</h2></div>
      <div class="rows">${rows.map(({ snap, total, ch }) => `
        <div class="row" style="cursor:default">
          <span class="row__main">
            <span class="row__name">${escapeHtml(dateFull(snap.date))}</span>
            <span class="row__meta">${total.count} Positionen${isNum(snap.flow) && snap.flow !== 0 ? ` · ${escapeHtml(moneySigned(snap.flow))} ${snap.flow > 0 ? 'eingezahlt' : 'entnommen'}` : ''}${ch ? ` · ${ch.days} Tage` : ''}</span>
          </span>
          <span class="row__side">
            <span class="row__value">${escapeHtml(money(total.value))}</span>
            ${ch ? deltaHtml(ch.adjustedAbs, pct(ch.adjustedPct, { signed: true })) : '<span class="row__meta">Start</span>'}
          </span>
          <button type="button" class="iconbtn" data-delsnap="${escapeHtml(snap.date)}" aria-label="Stichtag ${escapeHtml(dateFull(snap.date))} löschen">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>`).join('')}</div>
    </section>
    <section class="card">
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

/* ------------------------------------------------------------------ Import */

let pending = null; // { header, dataRows, mapping, positions, date, warnings }

function readFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      handleCsvText(decodeBuffer(reader.result));
    } catch (err) {
      console.error(err);
      toast('Die Datei ließ sich nicht lesen.');
    }
  };
  reader.onerror = () => toast('Die Datei ließ sich nicht lesen.');
  reader.readAsArrayBuffer(file);
}

function handleCsvText(text) {
  if (!text || !text.trim()) { toast('Die Datei ist leer.'); return; }
  const res = parseDepotCsv(text);
  pending = {
    header: res.header, dataRows: res.dataRows, mapping: { ...res.mapping },
    positions: res.positions, date: res.date || todayIso(), warnings: res.warnings,
  };
  $('#import-date').value = pending.date;
  $('#import-flow').value = '';
  $('#import-preview').hidden = false;
  renderPreview();
  $('#import-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function recompute() {
  const { positions } = buildPositions(pending.dataRows, pending.mapping);
  pending.positions = positions;
  renderPreview();
}

function renderPreview() {
  const { positions, warnings, header, mapping } = pending;
  const total = positions.reduce((s, p) => s + (p.value || 0), 0);
  const withBuy = positions.filter((p) => isNum(p.buyValue));
  const invested = withBuy.reduce((s, p) => s + p.buyValue, 0);

  const notes = [];
  if (positions.length) {
    notes.push(`<div class="note note--good"><span class="note__icon" aria-hidden="true">✓</span><span><strong>${positions.length} Positionen</strong> erkannt, Depotwert ${escapeHtml(money(total))}${withBuy.length ? ` · Einstand ${escapeHtml(money(invested))}` : ''}.</span></div>`);
  } else {
    notes.push('<div class="note note--bad"><span class="note__icon" aria-hidden="true">!!</span><span>Keine Positionen erkannt. Ordne die Spalten unten von Hand zu.</span></div>');
  }
  for (const w of warnings) {
    notes.push(`<div class="note note--warn"><span class="note__icon" aria-hidden="true">!</span><span>${escapeHtml(w)}</span></div>`);
  }
  $('#preview-status').innerHTML = `<div class="stack">${notes.join('')}</div>`;

  // Spaltenzuordnung
  const options = (selected) => [
    `<option value="">– keine –</option>`,
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
      <p class="field__hint">Links steht, was das Dashboard braucht, rechts die Spalte aus deiner Datei. Fehlendes wird - wo möglich - aus den anderen Spalten berechnet.</p>
    </details>`;

  // Vorschau
  const show = positions.slice(0, 8);
  $('#preview-table').innerHTML = show.length ? `
    <div class="tablewrap">
      <table class="data">
        <thead><tr><th>Position</th><th>Stück</th><th>Kurs</th><th>Wert</th><th>G/V</th></tr></thead>
        <tbody>${show.map((p) => `<tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(fmtQty(p.qty))}</td>
          <td>${escapeHtml(fmtPrice(p.price))}</td>
          <td>${escapeHtml(money(p.value))}</td>
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
    const { replaced, count } = store.saveSnapshot({ date, positions: pending.positions, flow });
    pending = null;
    $('#import-preview').hidden = true;
    $('#file-input').value = '';
    $('#paste-area').value = '';
    toast(replaced ? `Stichtag ${dateFull(date)} aktualisiert (${count} Positionen).` : `${count} Positionen zum ${dateFull(date)} gespeichert.`);
    goto('overview');
  } catch (err) {
    toast(err.message);
  }
}

function renderStorageNote() {
  const n = store.getState().snapshots.length;
  const kb = store.storageSize();
  $('#storage-note').textContent = n
    ? `${n} Stichtag${n === 1 ? '' : 'e'} gespeichert, rund ${kb} KB im Browser-Speicher.`
    : 'Noch nichts gespeichert.';
}

/* ------------------------------------------------------------- Positionsblatt */

function openPosition(key) {
  const snaps = store.getState().snapshots;
  const curr = snaps[snaps.length - 1];
  if (!curr) return;
  const rows = stats.allocation(curr);
  const p = rows.find((r) => r.key === key);
  if (!p) return;

  const history = snaps
    .map((s) => ({ date: s.date, pos: s.positions.find((x) => x.key === key) }))
    .filter((h) => h.pos)
    .reverse();

  const cls = store.assetClassOf(key);
  $('#pos-dialog-title').textContent = p.name;
  $('#pos-dialog-body').innerHTML = `
    <div class="metrics">
      ${[
        ['Wert', money(p.value)],
        ['Anteil am Depot', pct(p.share)],
        ['Stück / Nominal', fmtQty(p.qty)],
        ['Einstandskurs', fmtPrice(p.buyPrice)],
        ['Aktueller Kurs', fmtPrice(p.price)],
        ['Einstandswert', isNum(p.buyValue) ? money(p.buyValue) : '–'],
      ].map(([l, v]) => `<div class="metric"><span class="metric__label">${l}</span><span class="metric__value">${escapeHtml(v)}</span></div>`).join('')}
      <div class="metric">
        <span class="metric__label">Gewinn / Verlust</span>
        <span class="metric__value">${isNum(p.gainAbs) ? `${escapeHtml(moneySigned(p.gainAbs))} ` : '–'}${isNum(p.gainPct) ? deltaHtml(p.gainPct, pct(p.gainPct, { signed: true })) : ''}</span>
      </div>
    </div>
    <p class="card__note">${[p.wkn ? `WKN ${escapeHtml(p.wkn)}` : '', p.isin ? `ISIN ${escapeHtml(p.isin)}` : '', p.currency ? escapeHtml(p.currency) : ''].filter(Boolean).join(' · ') || 'Keine Kennnummer in der Datei.'}</p>
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
              <td>${escapeHtml(dateShort(h.date))}</td>
              <td>${escapeHtml(fmtQty(h.pos.qty))}</td>
              <td>${escapeHtml(fmtPrice(h.pos.price))}</td>
              <td>${escapeHtml(money(h.pos.value))}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>` : ''}`;

  const dlg = $('#pos-dialog');
  $('#pos-class').addEventListener('change', (e) => {
    store.setAssetClass(key, e.target.value);
    toast(e.target.value ? `Als ${e.target.value} eingeordnet.` : 'Zuordnung entfernt.');
  });
  dlg.showModal();
}

/* ---------------------------------------------------------------- Sicherung */

function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------- Events */

function wireEvents() {
  $('#btn-theme').addEventListener('click', cycleTheme);

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-goto]');
    if (nav) { goto(nav.dataset.goto); return; }

    const posBtn = e.target.closest('[data-poskey]');
    if (posBtn) { openPosition(posBtn.dataset.poskey); return; }

    const del = e.target.closest('[data-delsnap]');
    if (del) {
      const d = del.dataset.delsnap;
      if (confirm(`Stichtag ${dateFull(d)} wirklich löschen?`)) {
        store.deleteSnapshot(d);
        toast('Stichtag gelöscht.');
        render();
      }
    }
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

  // Datei
  const drop = $('#drop');
  const fileInput = $('#file-input');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  drop.setAttribute('tabindex', '0');
  drop.setAttribute('role', 'button');
  fileInput.addEventListener('change', (e) => readFile(e.target.files[0]));

  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => readFile(e.dataTransfer?.files?.[0]));

  $('#btn-paste').addEventListener('click', () => handleCsvText($('#paste-area').value));

  $('#mapping-body').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-mapfield]');
    if (!sel || !pending) return;
    const v = sel.value === '' ? undefined : Number(sel.value);
    if (v === undefined) delete pending.mapping[sel.dataset.mapfield];
    else pending.mapping[sel.dataset.mapfield] = v;
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
    toast('Alle Daten gelöscht.');
    goto('overview');
  });

  $('#pos-dialog-close').addEventListener('click', () => $('#pos-dialog').close());
  $('#pos-dialog').addEventListener('click', (e) => { if (e.target.id === 'pos-dialog') $('#pos-dialog').close(); });
  $('#pos-dialog').addEventListener('close', () => render());
}

/* --------------------------------------------------------------------- Start */

function init() {
  const state = store.load();
  applyTheme(state.settings.theme || 'auto');
  range = state.settings.range || 'max';
  wireEvents();
  store.subscribe(() => { /* Neuzeichnen steuern die Aufrufer */ });
  goto('overview');
  renderStorageNote();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline ist optional */ });
    });
  }
}

init();
