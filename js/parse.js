// CSV-Import für comdirect-Depotbestände.
// Die Exportformate der comdirect variieren, darum: Trennzeichen, Kodierung,
// Kopfzeile und Spalten werden erkannt - und lassen sich im UI korrigieren.

/* ------------------------------------------------------------------ Kodierung */

/** Dekodiert einen ArrayBuffer. comdirect liefert oft Windows-1252 statt UTF-8. */
export function decodeBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  // BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return utf8;
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/* -------------------------------------------------------------------- Zahlen */

/** "1.234,56 EUR" -> 1234.56 · "−12,3 %" -> -12.3 · "(45,00)" -> -45 */
export function parseNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || s === '-' || s === '–' || s === '—') return null;

  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }

  s = s.replace(/−/g, '-')
       .replace(/[\s   ']/g, '')
       .replace(/EUR|USD|CHF|GBP|JPY|€|\$|£|%/gi, '');

  while (/^[-+]/.test(s)) { if (s[0] === '-') neg = !neg; s = s.slice(1); }
  if (!/^[0-9]+([.,][0-9]+)*$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let out;

  if (lastComma > -1 && lastDot > -1) {
    // Das zuletzt stehende Zeichen ist das Dezimaltrennzeichen.
    out = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const groups = s.split(',');
    const thousands = groups.length > 2 && groups.slice(1).every((g) => g.length === 3);
    out = thousands ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot > -1) {
    const groups = s.split('.');
    const thousands = groups.slice(1).every((g) => g.length === 3) && groups[0].length <= 3;
    out = thousands ? s.replace(/\./g, '') : s;
  } else {
    out = s;
  }

  const n = parseFloat(out);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/* ----------------------------------------------------------------------- CSV */

const DELIMS = [';', '\t', ',', '|'];

export function detectDelimiter(text) {
  const sample = text.slice(0, 40000);
  let best = ';', bestScore = -1;
  for (const d of DELIMS) {
    const rows = splitCsv(sample, d).filter((r) => r.some((c) => c.trim() !== ''));
    if (!rows.length) continue;
    const counts = rows.map((r) => r.length);
    const max = Math.max(...counts);
    if (max < 2) continue;
    // Viele Spalten und gleichmäßige Zeilenlängen sprechen für das Trennzeichen.
    const consistent = counts.filter((c) => c === max).length;
    const score = max * 2 + consistent;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** RFC-4180-Parser mit Quotes, doppelten Quotes und CRLF. */
export function splitCsv(text, delim) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/* -------------------------------------------------------------- Spaltenlogik */

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9%]/g, '');

/** Feldkatalog. Reihenfolge = Priorität bei der Zuordnung. */
export const FIELDS = [
  { key: 'name',      label: 'Bezeichnung',    aliases: ['bezeichnung', 'wertpapier', 'wertpapierbezeichnung', 'name', 'produkt', 'instrument', 'titel'] },
  { key: 'wkn',       label: 'WKN',            aliases: ['wkn', 'wertpapierkennnummer'] },
  { key: 'isin',      label: 'ISIN',           aliases: ['isin', 'isinwkn'] },
  { key: 'qty',       label: 'Stück / Nom.',   aliases: ['stucknom', 'stucknominal', 'stuck', 'stuckzahl', 'nominal', 'anzahl', 'menge', 'bestand', 'quantity'] },
  { key: 'buyPrice',  label: 'Einstandskurs',  aliases: ['einstandskurs', 'einstandspreis', 'kaufkurs', 'durchschnittskurs', 'einstand', 'anschaffungskurs'] },
  { key: 'buyValue',  label: 'Einstandswert',  aliases: ['einstandswert', 'einstandswertineur', 'kaufwert', 'anschaffungswert', 'investiert', 'einstandswerteur'] },
  { key: 'price',     label: 'Aktueller Kurs', aliases: ['aktuellerkurs', 'aktuellerpreis', 'aktkurs', 'kursaktuell', 'letzterkurs', 'kurs', 'preis'] },
  { key: 'value',     label: 'Wert',           aliases: ['wertineur', 'wertineuro', 'aktuellerwert', 'kurswert', 'gesamtwert', 'bestandswert', 'depotwert', 'marktwert', 'wert', 'wertpapierwert'] },
  { key: 'gainAbs',   label: 'Gewinn / Verlust', aliases: ['entwicklungabsolut', 'gewinnverlust', 'gewinnverlustabsolut', 'guv', 'guvabsolut', 'veranderungabsolut', 'entwicklung', 'veranderung', 'differenz'] },
  { key: 'gainPct',   label: 'Entwicklung %',  aliases: ['entwicklungin%', 'entwicklung%', 'gewinnverlustin%', 'guv%', 'veranderungin%', 'veranderung%', 'rendite', 'performance', 'prozent', '%'] },
  { key: 'high',      label: 'Tages-Hoch',     aliases: ['tageshoch', 'tageshochstkurs', 'hochstkurs', 'hoch'] },
  { key: 'low',       label: 'Tages-Tief',     aliases: ['tagestief', 'tiefstkurs', 'tief'] },
  { key: 'currency',  label: 'Währung',        aliases: ['wahrung', 'currency', 'whrg'] },
];

const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

function scoreHeaderCell(cell) {
  const n = norm(cell);
  if (!n) return null;
  let best = null;
  for (const f of FIELDS) {
    for (const a of f.aliases) {
      let s = 0;
      if (n === a) s = 100;
      else if (n.startsWith(a)) s = 70 - (n.length - a.length);
      else if (n.includes(a)) s = 45 - (n.length - a.length);
      if (s > 0 && (!best || s > best.score)) best = { key: f.key, score: s };
    }
  }
  return best;
}

/** Findet die Kopfzeile: die Zeile mit den meisten erkannten Spaltennamen. */
export function findHeaderRow(rows) {
  let bestIdx = -1, bestScore = 0;
  const limit = Math.min(rows.length, 80);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (row.filter((c) => c !== '').length < 3) continue;
    let hits = 0;
    for (const cell of row) if (scoreHeaderCell(cell)) hits++;
    if (hits > bestScore) { bestScore = hits; bestIdx = i; }
  }
  return bestScore >= 3 ? bestIdx : -1;
}

/** Ordnet Spaltenindizes den Feldern zu (bestes Match gewinnt, je Feld eine Spalte). */
export function autoMap(headerRow, dataRows) {
  const candidates = [];
  headerRow.forEach((cell, idx) => {
    const m = scoreHeaderCell(cell);
    if (m) candidates.push({ idx, ...m });
  });
  candidates.sort((a, b) => b.score - a.score);

  const mapping = {};
  const usedCols = new Set();
  for (const c of candidates) {
    if (mapping[c.key] !== undefined || usedCols.has(c.idx)) continue;
    mapping[c.key] = c.idx;
    usedCols.add(c.idx);
  }

  // Nachbesserung anhand der Werte: Prozent- und Währungsspalten ohne Überschrift.
  const colValues = (idx) => dataRows.map((r) => r[idx] ?? '').filter((v) => v !== '');
  for (let idx = 0; idx < headerRow.length; idx++) {
    if (usedCols.has(idx)) continue;
    const vals = colValues(idx);
    if (vals.length < 2) continue;
    if (mapping.gainPct === undefined && vals.filter((v) => v.includes('%')).length > vals.length * 0.6) {
      mapping.gainPct = idx; usedCols.add(idx); continue;
    }
    if (mapping.currency === undefined && vals.filter((v) => /^[A-Z]{3}$/.test(v)).length > vals.length * 0.6) {
      mapping.currency = idx; usedCols.add(idx); continue;
    }
    if (mapping.isin === undefined && vals.filter((v) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(v)).length > vals.length * 0.6) {
      mapping.isin = idx; usedCols.add(idx); continue;
    }
  }
  return mapping;
}

/* ------------------------------------------------------ Summenblock am Ende */

const FOOTER_KEYS = [
  ['value', ['depotwert', 'bestandswert', 'gesamtwert', 'marktwert', 'depotgesamtwert']],
  ['invested', ['kaufwert', 'einstandswert', 'anschaffungswert']],
  ['change', ['veranderung', 'entwicklung', 'gewinnverlust']],
  ['collateral', ['beleihungswert']],
];

/**
 * Liest den Summenblock unter der Positionstabelle.
 * Die comdirect schreibt dort Zeilen wie: "Depotwert";"EUR";"8.570,16"
 */
export function parseFooter(rows) {
  const out = {};
  for (const row of rows) {
    const label = norm(row[0]);
    if (!label) continue;
    for (const [key, aliases] of FOOTER_KEYS) {
      if (out[key] !== undefined) continue;
      if (!aliases.some((a) => label === a || label.startsWith(a))) continue;
      // Der Betrag steht in der ersten Zelle rechts davon, die eine Zahl ist.
      for (let i = 1; i < row.length; i++) {
        const n = parseNumber(row[i]);
        if (n !== null) { out[key] = n; break; }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------ Stichtag suchen */

const SKIP_NAME = /^(summe|zwischensumme|gesamt|gesamtsumme|saldo|depotwert|bestand|total|ubertrag|übertrag)\b/i;

const toIso = (cell) => {
  const m = String(cell).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = String(cell).match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
};

/**
 * Sucht den Stichtag in der ganzen Datei - die comdirect schreibt ihn in der
 * Depotübersicht ganz ans Ende ("Datum: ";"12.09.2026";"12:29").
 */
export function findStatementDate(rows) {
  // Erst eine ausdrücklich als Datum beschriftete Zeile.
  for (const row of rows) {
    if (!/^datum/.test(norm(row[0]))) continue;
    for (const cell of row.slice(1)) {
      const iso = toIso(cell);
      if (iso) return iso;
    }
  }
  // Sonst das erste Datum überhaupt.
  for (const row of rows) {
    for (const cell of row) {
      const iso = toIso(cell);
      if (iso) return iso;
    }
  }
  return null;
}

/* ------------------------------------------------------------- Positionsbau */

/**
 * Zieht geschätzte Positionswerte auf den ausgewiesenen Depotwert zurecht.
 * Positionen mit echtem Kurs bleiben unangetastet, die Differenz verteilt sich
 * anteilig auf die geschätzten - so stimmt die Summe exakt mit der comdirect.
 */
export function reconcile(positions, footer) {
  const target = footer?.value;
  if (!Number.isFinite(target) || target <= 0) return positions;

  const estimated = positions.filter((p) => p.priceEstimated && Number.isFinite(p.value));
  if (!estimated.length) return positions;

  const fixedSum = positions
    .filter((p) => !p.priceEstimated)
    .reduce((s, p) => s + (p.value || 0), 0);
  const estSum = estimated.reduce((s, p) => s + p.value, 0);
  if (estSum <= 0) return positions;

  const factor = (target - fixedSum) / estSum;
  // Ein Faktor weit weg von 1 heißt: die Zuordnung passt nicht. Dann lieber nichts anfassen.
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) > 0.25) return positions;

  return positions.map((p) => {
    if (!p.priceEstimated || !Number.isFinite(p.value)) return p;
    const value = p.value * factor;
    const price = p.qty ? value / p.qty : p.price;
    const gainAbs = Number.isFinite(p.buyValue) ? value - p.buyValue : p.gainAbs;
    const gainPct = Number.isFinite(gainAbs) && p.buyValue ? (gainAbs / p.buyValue) * 100 : p.gainPct;
    return { ...p, value, price, gainAbs, gainPct, reconciled: factor !== 1 };
  });
}

/** Wendet eine Spaltenzuordnung auf die Datenzeilen an. */
export function buildPositions(dataRows, mapping, footer = null) {
  const get = (row, key) => {
    const idx = mapping[key];
    return idx === undefined || idx === null || idx < 0 ? '' : (row[idx] ?? '');
  };
  const positions = [];
  const skipped = [];

  for (const row of dataRows) {
    if (!row.some((c) => c !== '')) continue;

    const name = String(get(row, 'name') || '').trim();
    const wkn = String(get(row, 'wkn') || '').trim();
    const isin = String(get(row, 'isin') || '').trim();

    let qty = parseNumber(get(row, 'qty'));
    let buyPrice = parseNumber(get(row, 'buyPrice'));
    let buyValue = parseNumber(get(row, 'buyValue'));
    let price = parseNumber(get(row, 'price'));
    let value = parseNumber(get(row, 'value'));
    const high = parseNumber(get(row, 'high'));
    const low = parseNumber(get(row, 'low'));

    // Die Depotübersicht der comdirect enthält keinen aktuellen Kurs, nur die
    // Tagesspanne. Deren Mitte ist die beste verfügbare Näherung.
    let priceEstimated = false;
    if (price == null && (high != null || low != null)) {
      price = high != null && low != null ? (high + low) / 2 : (high ?? low);
      priceEstimated = true;
    }
    let gainAbs = parseNumber(get(row, 'gainAbs'));
    let gainPct = parseNumber(get(row, 'gainPct'));
    const currency = String(get(row, 'currency') || '').trim().toUpperCase() || null;

    const label = name || isin || wkn;
    if (!label) continue;

    // Summen- und Zwischenzeilen aussortieren: Sie tragen ein Summenwort und
    // keine gültige Wertpapierkennung.
    const validIsin = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin);
    const validWkn = /^[A-Z0-9]{6}$/i.test(wkn);
    const identified = validIsin || validWkn;
    const looksLikeSum = [label, name, wkn, isin].some((v) => v && SKIP_NAME.test(v));
    if (!identified && (looksLikeSum || !name)) { skipped.push(label); continue; }

    // Ableitungen
    if (value == null && qty != null && price != null) value = qty * price;
    if (buyValue == null && qty != null && buyPrice != null) buyValue = qty * buyPrice;
    if (buyValue == null && value != null && gainAbs != null) buyValue = value - gainAbs;
    if (buyValue == null && value != null && gainPct != null && gainPct > -100) {
      buyValue = value / (1 + gainPct / 100);
    }
    if (value == null && buyValue != null && gainAbs != null) value = buyValue + gainAbs;
    if (price == null && value != null && qty) price = value / qty;
    if (buyPrice == null && buyValue != null && qty) buyPrice = buyValue / qty;
    if (gainAbs == null && value != null && buyValue != null) gainAbs = value - buyValue;
    if (gainPct == null && gainAbs != null && buyValue) gainPct = (gainAbs / buyValue) * 100;

    if (value == null && qty == null) { skipped.push(label); continue; }

    const baseKey = isin || wkn || norm(label);
    // Derselbe Titel kann mehrfach auftauchen (z. B. Teildepots) - Schlüssel eindeutig halten.
    let key = baseKey, n = 2;
    while (positions.some((p) => p.key === key)) key = `${baseKey}#${n++}`;

    positions.push({
      key,
      name: name || isin || wkn,
      wkn: wkn || null,
      isin: isin || null,
      qty, buyPrice, buyValue, price, value, gainAbs, gainPct, currency,
      high, low, priceEstimated: priceEstimated && value != null,
    });
  }
  return { positions: reconcile(positions, footer), skipped };
}

/* ------------------------------------------------------------------ Gesamtlauf */

/**
 * Liest einen comdirect-CSV-Text vollständig aus.
 * Gibt auch Rohzeilen und Zuordnung zurück, damit das UI korrigieren kann.
 */
export function parseDepotCsv(text) {
  const warnings = [];
  const delimiter = detectDelimiter(text);
  // Leerzeilen bleiben stehen: Sie trennen Positionstabelle und Summenblock.
  const rows = splitCsv(text, delimiter);
  const isBlank = (r) => !r.some((c) => c !== '');

  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    return {
      ok: false, delimiter, rows, headerIdx: -1, header: [], dataRows: [], footerRows: [],
      mapping: {}, positions: [], footer: {}, date: findStatementDate(rows),
      warnings: ['Es war keine Kopfzeile mit bekannten Spaltennamen zu finden. Ordne die Spalten unten von Hand zu.'],
    };
  }

  const header = rows[headerIdx];
  const width = header.length;

  // Die Tabelle endet bei der ersten Leerzeile. Alles danach ist Summenblock
  // und Briefkopf - dort stehen auch Name und Kundennummer, die nichts in den
  // gespeicherten Daten zu suchen haben.
  let end = headerIdx + 1;
  while (end < rows.length && !isBlank(rows[end])) end++;

  const dataRows = rows.slice(headerIdx + 1, end)
    .filter((r) => !isBlank(r) && r.length >= Math.min(3, width));
  const footerRows = rows.slice(end).filter((r) => !isBlank(r));

  const footer = parseFooter(footerRows);
  const mapping = autoMap(header, dataRows);
  const { positions, skipped } = buildPositions(dataRows, mapping, footer);

  if (mapping.value === undefined && mapping.qty === undefined) {
    warnings.push('Weder eine Wert- noch eine Stückzahl-Spalte erkannt. Bitte unten von Hand zuordnen.');
  }
  if (mapping.buyPrice === undefined && mapping.buyValue === undefined) {
    warnings.push('Kein Einstandskurs erkannt, Gewinn und Verlust lassen sich dann nicht berechnen.');
  }
  if (positions.some((p) => p.priceEstimated)) {
    warnings.push(
      Number.isFinite(footer.value)
        ? 'Die Datei enthält keinen aktuellen Kurs, nur Tages-Hoch und Tages-Tief. Die Werte je Position sind daraus geschätzt und auf den ausgewiesenen Depotwert normiert. Die Gesamtsummen stimmen dadurch exakt, die Aufteilung auf die einzelnen Positionen ist auf wenige Zehntelprozent genau.'
        : 'Die Datei enthält keinen aktuellen Kurs, nur Tages-Hoch und Tages-Tief. Die Werte je Position sind daraus geschätzt.'
    );
  }
  if (skipped.length) {
    const n = skipped.length;
    warnings.push(`${n} ${n === 1 ? 'Zeile' : 'Zeilen'} übersprungen (Summen- oder Leerzeilen): ${skipped.slice(0, 3).join(', ')}${n > 3 ? ' …' : ''}`);
  }
  const foreign = positions.filter((p) => p.currency && p.currency !== 'EUR');
  if (foreign.length) {
    warnings.push(`${foreign.length} Position(en) in Fremdwährung. Die Werte werden so übernommen, wie sie in der Datei stehen.`);
  }

  return {
    ok: positions.length > 0,
    delimiter, rows, headerIdx, header, dataRows, footerRows, mapping, positions, footer,
    date: findStatementDate(rows),
    warnings,
  };
}

/* ============================================================== Umsätze */

/** Spalten, wie sie in Wertpapierumsatz-Exporten vorkommen. */
export const TX_FIELDS = [
  { key: 'date',   label: 'Geschäftstag', aliases: ['geschaftstag', 'geschafts', 'handelstag', 'buchungstag', 'valuta', 'datum', 'ausfuhrungstag'] },
  { key: 'type',   label: 'Art',          aliases: ['umsatzart', 'geschaftsart', 'transaktionsart', 'art', 'typ', 'vorgang', 'buchungstext'] },
  { key: 'name',   label: 'Bezeichnung',  aliases: ['bezeichnung', 'wertpapier', 'wertpapierbezeichnung', 'name', 'produkt'] },
  { key: 'isin',   label: 'ISIN',         aliases: ['isin'] },
  { key: 'wkn',    label: 'WKN',          aliases: ['wkn', 'wertpapierkennnummer'] },
  { key: 'qty',    label: 'Stück / Nom.', aliases: ['stucknom', 'stucknominal', 'stuck', 'stuckzahl', 'nominal', 'anzahl', 'menge'] },
  { key: 'price',  label: 'Kurs',         aliases: ['ausfuhrungskurs', 'ausfuhrungspreis', 'abrechnungskurs', 'kurs', 'preis'] },
  { key: 'amount', label: 'Betrag',       aliases: ['umsatzineur', 'gesamtbetrag', 'betrag', 'umsatz', 'wert', 'kurswert'] },
];

const BUY_RE = /(kauf|zeichnung|einbuchung|sparplan|erwerb|einlieferung|zugang|bezug)/i;
const SELL_RE = /(verkauf|ausbuchung|veraußerung|veräußerung|auslieferung|abgang|tilgung|ruckzahlung|rückzahlung)/i;

/**
 * Liest einen Wertpapierumsatz-Export. Daraus lässt sich rekonstruieren, was
 * wann im Depot lag - die Voraussetzung für einen echten Verlauf statt einer
 * Hochrechnung aus dem heutigen Bestand.
 */
export function parseTransactionsCsv(text) {
  const warnings = [];
  const delimiter = detectDelimiter(text);
  const rows = splitCsv(text, delimiter);
  const isBlank = (r) => !r.some((c) => c !== '');

  const headerIdx = findTxHeader(rows);
  if (headerIdx === -1) {
    return {
      ok: false, delimiter, rows, headerIdx: -1, header: [], dataRows: [],
      mapping: {}, transactions: [],
      warnings: ['Keine Kopfzeile mit bekannten Spaltennamen gefunden. Ordne die Spalten von Hand zu.'],
    };
  }

  const header = rows[headerIdx];
  let end = headerIdx + 1;
  while (end < rows.length && !isBlank(rows[end])) end++;
  const dataRows = rows.slice(headerIdx + 1, end).filter((r) => !isBlank(r) && r.length >= 3);

  const mapping = autoMapTx(header, dataRows);
  const { transactions, skipped } = buildTransactions(dataRows, mapping);

  if (mapping.date === undefined) warnings.push('Keine Datumsspalte erkannt. Ohne Datum lässt sich kein Verlauf bauen.');
  if (mapping.qty === undefined) warnings.push('Keine Stückzahl erkannt. Ohne sie bleibt unklar, wie viel wann im Depot lag.');
  if (mapping.type === undefined) warnings.push('Keine Spalte für Kauf oder Verkauf erkannt. Die Richtung wird aus den Vorzeichen abgeleitet.');
  if (skipped) warnings.push(`${skipped} ${skipped === 1 ? 'Zeile' : 'Zeilen'} übersprungen, weil Datum oder Stückzahl fehlten.`);

  return { ok: transactions.length > 0, delimiter, rows, headerIdx, header, dataRows, mapping, transactions, warnings };
}

function scoreTxCell(cell) {
  const n = norm(cell);
  if (!n) return null;
  let best = null;
  for (const f of TX_FIELDS) {
    for (const a of f.aliases) {
      let sc = 0;
      if (n === a) sc = 100;
      else if (n.startsWith(a)) sc = 70 - (n.length - a.length);
      else if (n.includes(a)) sc = 45 - (n.length - a.length);
      if (sc > 0 && (!best || sc > best.score)) best = { key: f.key, score: sc };
    }
  }
  return best;
}

function findTxHeader(rows) {
  let bestIdx = -1, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    if (rows[i].filter((c) => c !== '').length < 3) continue;
    let hits = 0;
    for (const cell of rows[i]) if (scoreTxCell(cell)) hits++;
    if (hits > bestScore) { bestScore = hits; bestIdx = i; }
  }
  return bestScore >= 3 ? bestIdx : -1;
}

function autoMapTx(headerRow, dataRows) {
  const cands = [];
  headerRow.forEach((cell, idx) => {
    const m = scoreTxCell(cell);
    if (m) cands.push({ idx, ...m });
  });
  cands.sort((a, b) => b.score - a.score);

  const mapping = {};
  const used = new Set();
  for (const c of cands) {
    if (mapping[c.key] !== undefined || used.has(c.idx)) continue;
    mapping[c.key] = c.idx;
    used.add(c.idx);
  }
  // Spalten ohne Überschrift anhand ihres Inhalts erkennen
  for (let idx = 0; idx < headerRow.length; idx++) {
    if (used.has(idx)) continue;
    const vals = dataRows.map((r) => r[idx] ?? '').filter(Boolean);
    if (vals.length < 2) continue;
    if (mapping.isin === undefined && vals.filter((v) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(v)).length > vals.length * 0.6) {
      mapping.isin = idx; used.add(idx);
    }
  }
  return mapping;
}

function buildTransactions(dataRows, mapping) {
  const get = (row, key) => {
    const i = mapping[key];
    return i === undefined || i === null || i < 0 ? '' : (row[i] ?? '');
  };
  const transactions = [];
  let skipped = 0;

  for (const row of dataRows) {
    const iso = toIso(get(row, 'date'));
    let qty = parseNumber(get(row, 'qty'));
    const price = parseNumber(get(row, 'price'));
    const amount = parseNumber(get(row, 'amount'));
    const typeRaw = String(get(row, 'type') || '').trim();
    const name = String(get(row, 'name') || '').trim();
    const isin = (String(get(row, 'isin') || '').toUpperCase().match(/\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b/) || [])[0] || null;
    const wkn = String(get(row, 'wkn') || '').trim().toUpperCase() || null;

    if (!iso || qty == null || qty === 0) { skipped++; continue; }
    if (!name && !isin && !wkn) { skipped++; continue; }

    // Richtung: erst die Textspalte, sonst die Vorzeichen von Stück oder Betrag.
    // Verkauf zuerst prüfen - das Wort enthält "kauf".
    let side = SELL_RE.test(typeRaw) ? -1 : BUY_RE.test(typeRaw) ? 1 : 0;
    if (!side) side = qty < 0 ? -1 : (amount != null && amount < 0 ? 1 : 1);
    qty = Math.abs(qty);

    transactions.push({
      date: iso,
      side,                                    // 1 = Zugang, -1 = Abgang
      type: typeRaw || (side > 0 ? 'Kauf' : 'Verkauf'),
      name: name || isin || wkn,
      isin, wkn,
      qty,
      price: price != null ? Math.abs(price) : (amount != null && qty ? Math.abs(amount) / qty : null),
      amount: amount != null ? Math.abs(amount) : (price != null ? price * qty : null),
    });
  }
  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { transactions, skipped };
}

export { norm, FIELD_BY_KEY };
