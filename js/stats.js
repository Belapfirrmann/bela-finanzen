// Auswertungen, die die comdirect-Oberfläche so nicht liefert.

import { daysBetween } from './format.js';

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

/** Summenwerte eines Stichtags. */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Depotwert eines Stichtags - die Summe der Bank schlägt die eigene Addition. */
export const snapValue = (snap) =>
  num(snap?.reported?.value) ?? sum(snap?.positions ?? [], (p) => p.value);

export function totals(snap) {
  if (!snap) return null;
  const ps = snap.positions;
  const rep = snap.reported || {};

  // Die von der Bank ausgewiesenen Summen haben Vorrang vor der eigenen Addition.
  const value = num(rep.value) ?? sum(ps, (p) => p.value);
  const withBuy = ps.filter((p) => num(p.buyValue) !== null);
  const invested = num(rep.invested) ?? (withBuy.length ? sum(withBuy, (p) => p.buyValue) : null);

  const partial = num(rep.invested) === null && withBuy.length > 0 && withBuy.length < ps.length;
  // Bei unvollständigem Einstand nur die vergleichbaren Positionen gegenrechnen.
  const base = partial ? sum(withBuy, (p) => p.value) : value;
  const gainAbs = invested === null ? null : base - invested;
  const gainPct = invested ? (gainAbs / invested) * 100 : null;

  const rated = ps.filter((p) => num(p.gainAbs) !== null);
  return {
    value,
    invested,
    gainAbs,
    gainPct,
    count: ps.length,
    winners: rated.filter((p) => p.gainAbs > 0).length,
    losers: rated.filter((p) => p.gainAbs < 0).length,
    rated: rated.length,
    partial,
    estimated: ps.some((p) => p.priceEstimated),
    fromBank: num(rep.value) !== null,
  };
}

/** Positionen nach Wert, mit Anteil am Depot. */
export function allocation(snap) {
  if (!snap) return [];
  const total = sum(snap.positions, (p) => p.value) || 1;
  return snap.positions
    .map((p) => ({ ...p, share: ((p.value || 0) / total) * 100 }))
    .sort((a, b) => (b.value || 0) - (a.value || 0));
}

/** Aufteilung nach Anlageklasse. Ohne Zuordnung landet alles unter „Nicht zugeordnet“. */
export function allocationByClass(snap, classOf) {
  if (!snap) return [];
  const total = sum(snap.positions, (p) => p.value) || 1;
  const buckets = new Map();
  for (const p of snap.positions) {
    const label = classOf(p.key) || 'Nicht zugeordnet';
    buckets.set(label, (buckets.get(label) || 0) + (p.value || 0));
  }
  return [...buckets.entries()]
    .map(([label, value]) => ({ label, value, share: (value / total) * 100 }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Veränderung zwischen zwei Stichtagen.
 * `flow` des späteren Stichtags ist frisches Geld und wird herausgerechnet,
 * damit Wertentwicklung und Einzahlung nicht verwechselt werden.
 */
export function changeBetween(prev, curr) {
  if (!prev || !curr) return null;
  const a = snapValue(prev);
  const b = snapValue(curr);
  const flow = typeof curr.flow === 'number' ? curr.flow : 0;
  const abs = b - a;
  const adjustedAbs = abs - flow;
  const base = a + flow;
  return {
    from: prev.date,
    to: curr.date,
    days: daysBetween(prev.date, curr.date),
    abs,
    pct: a ? (abs / a) * 100 : null,
    flow,
    adjustedAbs,
    adjustedPct: base ? (adjustedAbs / base) * 100 : null,
  };
}

/** Zeitreihe des Depotwerts, optional auf die letzten n Tage begrenzt. */
export function valueSeries(snapshots, range = 'max') {
  const pts = snapshots.map((s) => ({
    date: s.date,
    value: snapValue(s),
    flow: typeof s.flow === 'number' ? s.flow : 0,
  }));
  if (range === 'max' || pts.length < 2) return pts;
  const last = pts[pts.length - 1].date;
  const days = Number(range);
  return pts.filter((p) => daysBetween(p.date, last) <= days);
}
