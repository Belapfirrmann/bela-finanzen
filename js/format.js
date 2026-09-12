// Zahlen-, Datums- und Textformatierung (de-DE)

const eur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFlex = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });
const pct1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Betrag in Euro. Große Beträge ohne Nachkommastellen, damit Kacheln ruhig bleiben. */
export function money(v, { cents = null } = {}) {
  if (!isNum(v)) return '–';
  const withCents = cents === null ? Math.abs(v) < 10000 : cents;
  return (withCents ? eur2 : eur0).format(v);
}

/** Betrag mit erzwungenem Vorzeichen (für Veränderungen). */
export function moneySigned(v, opts) {
  if (!isNum(v)) return '–';
  const s = money(Math.abs(v), opts);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + s;
}

export function pct(v, { signed = false } = {}) {
  if (!isNum(v)) return '–';
  const s = pct1.format(Math.abs(v)) + ' %';
  if (!signed) return (v < 0 ? '−' : '') + s;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + s;
}

export function decimal(v, digits = 1) {
  if (!isNum(v)) return '–';
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

export function qty(v) {
  if (!isNum(v)) return '–';
  return numFlex.format(v);
}

export function price(v) {
  if (!isNum(v)) return '–';
  return num2.format(v);
}

/** Richtung einer Veränderung -> CSS-Klasse + Pfeil. Farbe trägt nie allein die Bedeutung. */
export function direction(v) {
  if (!isNum(v) || Math.abs(v) < 1e-9) return { cls: 'delta--flat', arrow: '→' };
  return v > 0 ? { cls: 'delta--up', arrow: '▲' } : { cls: 'delta--down', arrow: '▼' };
}

/** <span class="delta …">▲ +12,3 %</span> als HTML-String. `attrs` z. B. 'id="x"'. */
export function deltaHtml(value, text, attrs = '') {
  const d = direction(value);
  return `<span ${attrs} class="delta ${d.cls}"><span class="delta__arrow" aria-hidden="true">${d.arrow}</span>${escapeHtml(text)}</span>`;
}

const dFull  = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const dMonth = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' });

const asDate = (iso) => new Date(`${iso}T12:00:00`);
export const dateFull  = (iso) => dFull.format(asDate(iso));
export const dateShort = (iso) => dShort.format(asDate(iso));
export const dateMonth = (iso) => dMonth.format(asDate(iso));

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const daysBetween = (isoA, isoB) =>
  Math.round((asDate(isoB) - asDate(isoA)) / 86400000);

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
