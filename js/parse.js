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

/* ------------------------------------------------------------ Stichtag suchen */

const SKIP_NAME = /^(summe|zwischensumme|gesamt|gesamtsumme|saldo|depotwert|bestand|total|ubertrag|übertrag)\b/i;

/** "Stand: 12.09.2026" o. ä. aus dem Dateikopf. */
export function findStatementDate(rows, headerIdx) {
  const end = headerIdx > -1 ? headerIdx : Math.min(rows.length, 20);
  for (let i = 0; i < end; i++) {
    for (const cell of rows[i]) {
      const m = String(cell).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (m) {
        const [, d, mo, y] = m;
        return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      const iso = String(cell).match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
  }
  return null;
}

/* ------------------------------------------------------------- Positionsbau */

/** Wendet eine Spaltenzuordnung auf die Datenzeilen an. */
export function buildPositions(dataRows, mapping) {
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
    });
  }
  return { positions, skipped };
}

/* ------------------------------------------------------------------ Gesamtlauf */

/**
 * Liest einen comdirect-CSV-Text vollständig aus.
 * Gibt auch Rohzeilen und Zuordnung zurück, damit das UI korrigieren kann.
 */
export function parseDepotCsv(text) {
  const warnings = [];
  const delimiter = detectDelimiter(text);
  const allRows = splitCsv(text, delimiter);
  const rows = allRows.filter((r, i) => r.some((c) => c !== '') || i === 0);

  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    return {
      ok: false, delimiter, rows, headerIdx: -1, header: [], dataRows: [],
      mapping: {}, positions: [], date: null,
      warnings: ['Es war keine Kopfzeile mit bekannten Spaltennamen zu finden. Ordne die Spalten unten von Hand zu.'],
    };
  }

  const header = rows[headerIdx];
  const width = header.length;
  const dataRows = rows.slice(headerIdx + 1).filter((r) => r.some((c) => c !== '') && r.length >= Math.min(3, width));

  const mapping = autoMap(header, dataRows);
  const { positions, skipped } = buildPositions(dataRows, mapping);

  if (mapping.value === undefined && mapping.qty === undefined) {
    warnings.push('Weder eine Wert- noch eine Stückzahl-Spalte erkannt. Bitte unten von Hand zuordnen.');
  }
  if (mapping.buyPrice === undefined && mapping.buyValue === undefined) {
    warnings.push('Kein Einstandskurs erkannt - Gewinn und Verlust lassen sich dann nicht berechnen.');
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
    delimiter, rows, headerIdx, header, dataRows, mapping, positions,
    date: findStatementDate(rows, headerIdx),
    warnings,
  };
}

export { norm, FIELD_BY_KEY };
