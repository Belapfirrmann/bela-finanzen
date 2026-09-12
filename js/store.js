// Persistenz. Alles liegt ausschließlich im localStorage dieses Browsers -
// nichts wird jemals an einen Server geschickt.

const KEY = 'bela-finanzen.v1';

export const ASSET_CLASSES = ['ETF', 'Aktie', 'Anleihe', 'Fonds', 'Krypto', 'Sonstiges'];

const emptyState = () => ({
  version: 1,
  snapshots: [],           // [{ date, importedAt, flow, positions: [...] }]
  meta: {},                // key -> { assetClass }
  settings: { theme: 'auto', range: 'max', workerUrl: '' },
});

let state = emptyState();
const listeners = new Set();

/* ------------------------------------------------------------------ Laden */

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') state = migrate(parsed);
    }
  } catch (err) {
    console.warn('Gespeicherte Daten konnten nicht gelesen werden:', err);
  }
  return state;
}

function migrate(obj) {
  const base = emptyState();
  return {
    ...base,
    ...obj,
    snapshots: Array.isArray(obj.snapshots) ? obj.snapshots : [],
    meta: obj.meta && typeof obj.meta === 'object' ? obj.meta : {},
    settings: { ...base.settings, ...(obj.settings || {}) },
  };
}

export const getState = () => state;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error(err);
    throw new Error('Der Browser-Speicher ist voll oder gesperrt. Lade eine Sicherung herunter und lösche alte Stichtage.');
  }
  listeners.forEach((fn) => fn(state));
}

/* -------------------------------------------------------------- Stichtage */

const sortByDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Legt einen Stichtag an oder überschreibt den mit gleichem Datum. */
export function saveSnapshot({ date, positions, flow = null, source = 'csv', reported = null }) {
  const clean = positions.map((p) => ({
    key: p.key, name: p.name, wkn: p.wkn ?? null, isin: p.isin ?? null,
    qty: p.qty ?? null, buyPrice: p.buyPrice ?? null, buyValue: p.buyValue ?? null,
    price: p.price ?? null, value: p.value ?? null,
    gainAbs: p.gainAbs ?? null, gainPct: p.gainPct ?? null,
    currency: p.currency ?? null,
    high: p.high ?? null, low: p.low ?? null,
    priceEstimated: p.priceEstimated === true,
  }));
  // Nur Summen der Bank - niemals Name, Kundennummer oder Depotnummer.
  const rep = reported && (Number.isFinite(reported.value) || Number.isFinite(reported.invested))
    ? { value: reported.value ?? null, invested: reported.invested ?? null }
    : null;
  const snap = { date, importedAt: new Date().toISOString(), flow, source, reported: rep, positions: clean };
  const replaced = state.snapshots.some((s) => s.date === date);
  state.snapshots = state.snapshots.filter((s) => s.date !== date).concat(snap).sort(sortByDate);
  persist();
  return { replaced, count: clean.length };
}

export function deleteSnapshot(date) {
  state.snapshots = state.snapshots.filter((s) => s.date !== date);
  persist();
}

export function updateSnapshotFlow(date, flow) {
  const s = state.snapshots.find((x) => x.date === date);
  if (!s) return;
  s.flow = flow;
  persist();
}

export const latestSnapshot = () => state.snapshots[state.snapshots.length - 1] ?? null;

/* ------------------------------------------------ Zusatzinfos je Position */

/** Zusatzinfos zu einer Position (Anlageklasse, Börsensymbol). */
export function setMeta(key, patch) {
  if (!key) return;
  state.meta[key] = { ...(state.meta[key] || {}), ...patch };
  persist();
}

export const setAssetClass = (key, assetClass) => setMeta(key, { assetClass: assetClass || null });
export const assetClassOf = (key) => state.meta?.[key]?.assetClass ?? null;

/* -------------------------------------------------------------- Einstellungen */

export function setSetting(key, value) {
  state.settings[key] = value;
  persist();
}

/* ------------------------------------------------------------- Sicherung */

export function exportBackup() {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString(), app: 'Bela Finanzen' }, null, 2);
}

export function importBackup(json) {
  const parsed = JSON.parse(json);
  if (!parsed || !Array.isArray(parsed.snapshots)) {
    throw new Error('Das sieht nicht nach einer Sicherung von Bela Finanzen aus.');
  }
  state = migrate(parsed);
  state.snapshots.sort(sortByDate);
  persist();
  return state.snapshots.length;
}

export function wipe() {
  state = emptyState();
  try { localStorage.removeItem(KEY); } catch { /* egal */ }
  listeners.forEach((fn) => fn(state));
}

/** Grobe Größe der gespeicherten Daten in KB. */
export function storageSize() {
  try { return Math.round((localStorage.getItem(KEY) || '').length / 1024); } catch { return 0; }
}
