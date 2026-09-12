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

/** Streuungsmaße: Klumpenrisiko und effektive Anzahl Positionen. */
export function concentration(snap) {
  const rows = allocation(snap);
  if (!rows.length) return null;
  const shares = rows.map((r) => r.share / 100);
  const hhi = shares.reduce((s, x) => s + x * x, 0);
  return {
    top1: rows[0].share,
    top1Name: rows[0].name,
    top3: rows.slice(0, 3).reduce((s, r) => s + r.share, 0),
    hhi,
    effective: hhi > 0 ? 1 / hhi : 0,
    count: rows.length,
  };
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

/** Positionen, die sich zwischen zwei Stichtagen am stärksten bewegt haben. */
export function movers(prev, curr, limit = 3) {
  if (!curr) return { up: [], down: [], basis: null };
  const byKey = new Map((prev?.positions || []).map((p) => [p.key, p]));
  const rows = curr.positions.map((p) => {
    const before = byKey.get(p.key);
    // Positionswert ändert sich auch durch Zukauf - darum über den Kurs vergleichen.
    const canCompare = before && typeof before.price === 'number' && typeof p.price === 'number' && before.price > 0;
    const pct = canCompare ? ((p.price - before.price) / before.price) * 100 : null;
    const abs = canCompare && typeof p.qty === 'number' ? (p.price - before.price) * p.qty : null;
    return { ...p, changePct: pct, changeAbs: abs, isNew: !before };
  });
  const comparable = rows.filter((r) => typeof r.changePct === 'number' && Math.abs(r.changePct) > 0.0001);

  if (comparable.length) {
    const sorted = [...comparable].sort((a, b) => b.changePct - a.changePct);
    return {
      basis: 'change',
      up: sorted.filter((r) => r.changePct > 0).slice(0, limit),
      down: sorted.filter((r) => r.changePct < 0).reverse().slice(0, limit),
      newOnes: rows.filter((r) => r.isNew),
    };
  }

  // Kein Vorgänger-Stichtag: dann die größten Gewinner und Verlierer seit Kauf.
  const rated = curr.positions.filter((p) => typeof p.gainPct === 'number');
  const sorted = [...rated].sort((a, b) => b.gainPct - a.gainPct);
  return {
    basis: 'sinceBuy',
    up: sorted.filter((p) => p.gainPct > 0).slice(0, limit),
    down: sorted.filter((p) => p.gainPct < 0).reverse().slice(0, limit),
    newOnes: [],
  };
}
