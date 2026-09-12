// Schlanke SVG-Charts ohne Fremdbibliothek: offlinefähig und in beiden Themes lesbar.

import { money, dateShort, dateFull, escapeHtml, pct } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  return n;
};

/** Rundet eine Achsenskala auf angenehme Schritte. */
function niceScale(min, max, ticks = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1 };
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const raw = (max - min) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

/* ------------------------------------------------------- Verlaufschart (Linie) */

/**
 * Linienchart mit Fläche, Fadenkreuz und Tooltip.
 * points: [{ date: 'YYYY-MM-DD', value: number }]
 */
export function lineChart(container, points) {
  container.innerHTML = '';
  if (!points || points.length === 0) return;

  const W = Math.max(240, container.clientWidth || 320);
  const H = 208;
  const padL = 52, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (points.length === 1) {
    const only = points[0];
    container.innerHTML = `<p class="card__note">Erst ein Stichtag (${escapeHtml(dateFull(only.date))}, ${escapeHtml(money(only.value))}). Ab dem zweiten Import zeichnet sich hier die Wertentwicklung.</p>`;
    return;
  }

  const values = points.map((p) => p.value);
  // Mindestspanne: sonst bläht die Achse einen Zehntelprozent zur Steilkurve auf.
  const vMin = Math.min(...values), vMax = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const minSpan = Math.abs(mean) * 0.03;
  let lo = vMin, hi = vMax;
  if (hi - lo < minSpan) {
    const pad = (minSpan - (hi - lo)) / 2;
    lo -= pad; hi += pad;
    if (vMin >= 0 && lo < 0) { hi -= lo; lo = 0; }
  }
  const scale = niceScale(lo, hi, 4);
  const t0 = new Date(points[0].date).getTime();
  const t1 = new Date(points[points.length - 1].date).getTime();
  const span = Math.max(1, t1 - t0);

  const x = (p) => padL + ((new Date(p.date).getTime() - t0) / span) * innerW;
  const y = (v) => padT + innerH - ((v - scale.min) / (scale.max - scale.min || 1)) * innerH;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
  svg.appendChild(el('title')).textContent =
    `Depotwert von ${dateFull(points[0].date)} bis ${dateFull(points[points.length - 1].date)}`;

  // Farbverlauf für die Fläche
  const defs = el('defs');
  const grad = el('linearGradient', { id: 'areaGrad', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.appendChild(el('stop', { offset: '0%', 'stop-color': 'var(--series-1)', 'stop-opacity': '.22' }));
  grad.appendChild(el('stop', { offset: '100%', 'stop-color': 'var(--series-1)', 'stop-opacity': '0' }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Gitter + Y-Beschriftung (durchgezogene Haarlinien)
  for (let v = scale.min; v <= scale.max + 1e-6; v += scale.step) {
    const yy = Math.round(y(v)) + 0.5;
    svg.appendChild(el('line', { class: 'chart__grid', x1: padL, y1: yy, x2: W - padR, y2: yy }));
    const label = el('text', { class: 'chart__tick', x: padL - 8, y: yy + 3.5, 'text-anchor': 'end' });
    label.textContent = money(v, { cents: false });
    svg.appendChild(label);
  }

  // X-Beschriftung: erster, letzter und - wenn Platz ist - ein mittlerer Punkt
  const xTicks = points.length > 3 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0, points.length - 1];
  for (const i of [...new Set(xTicks)]) {
    const p = points[i];
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    const t = el('text', { class: 'chart__tick', x: x(p), y: H - 8, 'text-anchor': anchor });
    t.textContent = dateShort(p.date);
    svg.appendChild(t);
  }
  svg.appendChild(el('line', { class: 'chart__axis', x1: padL, y1: padT + innerH + 0.5, x2: W - padR, y2: padT + innerH + 0.5 }));

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  svg.appendChild(el('path', { class: 'chart__area', d: `${line} L${x(points[points.length - 1]).toFixed(1)} ${padT + innerH} L${x(points[0]).toFixed(1)} ${padT + innerH} Z` }));
  svg.appendChild(el('path', { class: 'chart__line', d: line }));

  // Endpunkt wird direkt beschriftet - nicht jeder Punkt.
  const last = points[points.length - 1];
  svg.appendChild(el('circle', { class: 'chart__dot', cx: x(last), cy: y(last.value), r: 4.5 }));

  // Fadenkreuz
  const cross = el('g', { opacity: 0 });
  const crossLine = el('line', { class: 'chart__cross', y1: padT, y2: padT + innerH });
  const crossDot = el('circle', { class: 'chart__dot', r: 5 });
  cross.append(crossLine, crossDot);
  svg.appendChild(cross);

  container.appendChild(svg);

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  container.appendChild(tip);

  const nearest = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    points.forEach((p, i) => { const d = Math.abs(x(p) - px); if (d < bestD) { bestD = d; best = i; } });
    return best;
  };

  const show = (clientX) => {
    const i = nearest(clientX);
    const p = points[i];
    const px = x(p), py = y(p.value);
    crossLine.setAttribute('x1', px); crossLine.setAttribute('x2', px);
    crossDot.setAttribute('cx', px); crossDot.setAttribute('cy', py);
    cross.setAttribute('opacity', 1);
    const first = points[0].value;
    const diff = p.value - first;
    tip.innerHTML = `<div class="tip__date">${escapeHtml(dateFull(p.date))}</div>
      <div class="tip__val">${escapeHtml(money(p.value))}</div>
      ${i > 0 ? `<div class="tip__date">seit Start ${diff >= 0 ? '+' : '−'}${escapeHtml(money(Math.abs(diff)))}</div>` : ''}`;
    tip.hidden = false;
    const ratio = container.clientWidth / W;
    tip.style.left = `${Math.min(Math.max(px * ratio, 60), container.clientWidth - 60)}px`;
    tip.style.top = `${py * ratio}px`;
  };
  const hide = () => { cross.setAttribute('opacity', 0); tip.hidden = true; };

  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
}

/* ----------------------------------------------------------------- Donut */

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];

/**
 * Donut für Teil-vom-Ganzen. Maximal 6 Segmente, der Rest wird zu „Sonstige“.
 * slices: [{ label, value, share }]
 */
export function donut(container, slices) {
  container.innerHTML = '';
  if (!slices.length) return;

  const R = 52, STROKE = 16, C = 2 * Math.PI * R, GAP = slices.length > 1 ? 3 : 0;
  const svg = el('svg', { class: 'donut', viewBox: '0 0 132 132', role: 'img' });
  svg.appendChild(el('title')).textContent = 'Aufteilung des Depots';
  svg.appendChild(el('circle', { cx: 66, cy: 66, r: R, fill: 'none', stroke: 'var(--surface-sunk)', 'stroke-width': STROKE }));

  let offset = 0;
  slices.forEach((s, i) => {
    const len = Math.max((s.share / 100) * C - GAP, 1);
    svg.appendChild(el('circle', {
      cx: 66, cy: 66, r: R, fill: 'none',
      stroke: SERIES[i % SERIES.length], 'stroke-width': STROKE, 'stroke-linecap': 'butt',
      'stroke-dasharray': `${len} ${C - len}`,
      'stroke-dashoffset': -offset,
      transform: 'rotate(-90 66 66)',
    }));
    offset += (s.share / 100) * C;
  });

  const wrap = document.createElement('div');
  wrap.className = 'donut-wrap';
  wrap.appendChild(svg);

  // Direkte Beschriftung in der Legende - Farbe trägt die Bedeutung nie allein.
  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = slices.map((s, i) => `
    <div class="legend__row">
      <span class="legend__swatch" style="background:${SERIES[i % SERIES.length]}"></span>
      <span class="legend__name" title="${escapeHtml(s.label)}">${escapeHtml(s.label)}</span>
      <span class="legend__val">${escapeHtml(pct(s.share))}</span>
    </div>`).join('');
  wrap.appendChild(legend);
  container.appendChild(wrap);
}

/**
 * Fasst eine Liste auf max. `max` Segmente zusammen, Rest als „Sonstige“.
 */
export function foldToTop(rows, max = 6) {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max - 1);
  const tail = rows.slice(max - 1);
  const value = tail.reduce((s, r) => s + (r.value || 0), 0);
  const share = tail.reduce((s, r) => s + (r.share || 0), 0);
  return [...head, { label: `Sonstige (${tail.length})`, name: `Sonstige (${tail.length})`, value, share }];
}

/** Zeichnet ein Chart neu, wenn sich die Breite ändert. */
export function responsive(container, draw) {
  draw();
  if (container.__ro) container.__ro.disconnect();
  let w = container.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - w) < 8) return;
    w = container.clientWidth;
    draw();
  });
  ro.observe(container);
  container.__ro = ro;
}

/* ------------------------------------------------------------- Sparkline */

/**
 * Winzige Kurslinie für Zeilen. Die Farbe folgt der Richtung und steht nie
 * allein - daneben stehen immer Vorzeichen und Prozentwert.
 */
export function sparkline(values, { width = 60, height = 26 } = {}) {
  const pts = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (pts.length < 2) return '';

  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 2.5;
  const stepX = (width - pad * 2) / (pts.length - 1);
  const d = pts
    .map((v, i) => `${i ? 'L' : 'M'}${(pad + i * stepX).toFixed(1)} ${(pad + (height - pad * 2) * (1 - (v - min) / span)).toFixed(1)}`)
    .join(' ');

  const dir = pts[pts.length - 1] > pts[0] ? 'up' : pts[pts.length - 1] < pts[0] ? 'down' : 'flat';
  return `<svg class="spark spark--${dir}" viewBox="0 0 ${width} ${height}" style="width:${width}px;height:${height}px" aria-hidden="true"><path d="${d}"/></svg>`;
}
