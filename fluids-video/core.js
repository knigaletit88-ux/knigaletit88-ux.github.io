'use strict';
// ---------- basics ----------
const W = 1080, H = 1920;
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function set(e, a) { for (const k in a) e.setAttribute(k, a[k]); }
function TF(e, x, y, s, r, sy) {
  s = s === undefined ? 1 : s; r = r || 0; sy = sy === undefined ? s : sy;
  e.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(3)}) scale(${s.toFixed(4)} ${sy.toFixed(4)})`);
}
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const P = (t, a, b) => clamp((t - a) / (b - a));
const eOut = x => 1 - Math.pow(1 - x, 3);
const eOut4 = x => 1 - Math.pow(1 - x, 4);
const eIn = x => x * x * x;
const eIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const eBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const eElastic = x => x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - .75) * (2 * Math.PI) / 3) + 1;
const rnd = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
function hex2rgb(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
function mixc(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b); return 'rgb(' + A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',') + ')'; }
const shade = (c, f) => f >= 0 ? mixc(c, '#ffffff', f) : mixc(c, '#000000', -f);

// ---------- timeline ----------
const SB = [0, 4, 11, 18, 25, 32, 39, 46, 55];
const ACC = ['#6EA8FE', '#FFB020', '#3B82F6', '#FF3B5C', '#A855F7', '#22D3A0', '#22D3EE', '#FFC857'];
const FLUID = ['#FFB020', '#3B82F6', '#FF3B5C', '#A855F7', '#22D3A0', '#22D3EE'];
const SCENES = [];
const FX = { flash: 0 };
const SHAKES = [];
const shakeAt = (t, m) => SHAKES.push([t, m]);

// ---------- svg skeleton ----------
const svg = document.getElementById('root');
const defs = el('defs', {}, svg);
function lgrad(id, stops, attrs) {
  const g = el('linearGradient', Object.assign({ id }, attrs || { x1: 0, y1: 0, x2: 0, y2: 1 }), defs);
  stops.forEach(([o, c, op]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': op === undefined ? 1 : op }, g));
}
function rgrad(id, stops, attrs) {
  const g = el('radialGradient', Object.assign({ id }, attrs || {}), defs);
  stops.forEach(([o, c, op]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': op === undefined ? 1 : op }, g));
}
const glowCache = {};
function glowId(color) {
  const id = 'gl' + color.replace('#', '');
  if (!glowCache[id]) { rgrad(id, [[0, color, .95], [.35, color, .45], [1, color, 0]]); glowCache[id] = 1; }
  return 'url(#' + id + ')';
}
const orbCache = {};
function orbId(color) {
  const id = 'ob' + color.replace('#', '');
  if (!orbCache[id]) { rgrad(id, [[0, shade(color, .75)], [.55, color], [1, shade(color, -.45)]], { cx: .38, cy: .32, r: .8 }); orbCache[id] = 1; }
  return 'url(#' + id + ')';
}
lgrad('steel', [[0, '#e6ecf7'], [.45, '#9aa8c2'], [1, '#475268']]);
lgrad('steelH', [[0, '#48546c'], [.5, '#c9d3e6'], [1, '#48546c']], { x1: 0, y1: 0, x2: 1, y2: 0 });
lgrad('darkMetal', [[0, '#2b3347'], [1, '#121726']]);
lgrad('bodyGrad', [[0, '#4a5473'], [.4, '#2a3148'], [1, '#12172a']], { gradientUnits: 'userSpaceOnUse', x1: 0, y1: 46, x2: 0, y2: 214 });
lgrad('glassG', [[0, '#2a5a8a'], [1, '#0a1530']]);
lgrad('beamG', [[0, '#fff6d6', .55], [1, '#fff6d6', 0]], { gradientUnits: 'userSpaceOnUse', x1: 772, y1: 0, x2: 1400, y2: 0 });
lgrad('rainbow', FLUID.map((c, i) => [i / 5, c]), { x1: 0, y1: 0, x2: 1, y2: 0 });
lgrad('fadeV', [[0, '#fff', 0], [1, '#fff', 1]]);
rgrad('vig', [[.55, '#000', 0], [1, '#000', .6]], { cx: .5, cy: .5, r: .75 });
const pat = el('pattern', { id: 'dots', width: 64, height: 64, patternUnits: 'userSpaceOnUse' }, defs);
el('circle', { cx: 32, cy: 32, r: 2.2, fill: '#fff', opacity: .13 }, pat);

const gBg = el('g', {}, svg);
const gWorld = el('g', {}, svg);
const gUI = el('g', {}, svg);
const gTrans = el('g', {}, svg);

// ---------- background ----------
const bg = {};
bg.base = el('rect', { width: W, height: H, fill: '#070A12' }, gBg);
bg.glow = el('circle', { cx: 540, cy: 940, r: 1100, fill: glowId(ACC[0]), opacity: .5 }, gBg);
bg.glow2 = el('circle', { cx: 540, cy: 200, r: 700, fill: glowId(ACC[0]), opacity: .28 }, gBg);
bg.dots = el('rect', { width: W, height: H, fill: 'url(#dots)' }, gBg);
bg.parts = [];
for (let i = 0; i < 26; i++) bg.parts.push(el('circle', { r: 3 + rnd(i) * 5, fill: '#fff' }, gBg));
el('rect', { width: W, height: H, fill: 'url(#vig)' }, gBg);
function bgUpdate(T, si) {
  const c = ACC[si];
  set(bg.glow, { fill: glowId(c) }); set(bg.glow2, { fill: glowId(c) });
  set(bg.dots, { transform: `translate(${(-T * 14) % 64} ${(T * 22) % 64})` });
  bg.parts.forEach((p, i) => {
    const sp = 30 + rnd(i * 3) * 70;
    const y = ((rnd(i * 5 + 1) * H - T * sp) % H + H) % H;
    const x = rnd(i * 7 + 2) * W + Math.sin(T * .8 + i) * 20;
    set(p, { cx: x.toFixed(1), cy: y.toFixed(1), fill: c, opacity: (0.08 + 0.18 * rnd(i * 11)).toFixed(3) });
  });
}

// ---------- icons ----------
function gearPath(z, rOut, rIn, rHole) {
  const pts = [], step = 2 * Math.PI / z;
  for (let i = 0; i < z; i++) {
    const a = i * step;
    pts.push([rIn, a - step * .30], [rOut, a - step * .17], [rOut, a + step * .17], [rIn, a + step * .30]);
  }
  let d = 'M' + pts.map(([r, a]) => `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`).join('L') + 'Z';
  if (rHole) d += `M${rHole},0A${rHole},${rHole} 0 1 0 ${-rHole},0A${rHole},${rHole} 0 1 0 ${rHole},0Z`;
  return d;
}
const DROP = 'M0,-50C26,-14 40,6 40,26A40,40 0 0 1 -40,26C-40,6 -26,-14 0,-50Z';
function icon(kind, parent, color, size) {
  const g = el('g', {}, parent), k = (size || 100) / 100;
  const inner = el('g', { transform: `scale(${k})` }, g);
  const w = '#fff';
  if (kind === 0) { // oil drop
    el('path', { d: DROP, fill: color }, inner);
    el('path', { d: 'M-18,22C-18,34 -8,42 2,42', stroke: w, 'stroke-width': 7, 'stroke-linecap': 'round', fill: 'none', opacity: .8 }, inner);
  } else if (kind === 1) { // snowflake
    for (let i = 0; i < 3; i++) {
      const gg = el('g', { transform: `rotate(${i * 60})` }, inner);
      el('line', { x1: 0, y1: -46, x2: 0, y2: 46, stroke: color, 'stroke-width': 9, 'stroke-linecap': 'round' }, gg);
      el('polyline', { points: '-14,-32 0,-20 14,-32', fill: 'none', stroke: color, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, gg);
      el('polyline', { points: '-14,32 0,20 14,32', fill: 'none', stroke: color, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, gg);
    }
  } else if (kind === 2) { // stop octagon
    const pts = []; for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; pts.push((50 * Math.cos(a)).toFixed(1) + ',' + (50 * Math.sin(a)).toFixed(1)); }
    el('polygon', { points: pts.join(' '), fill: color }, inner);
    el('rect', { x: -8, y: -30, width: 16, height: 36, rx: 6, fill: w }, inner);
    el('circle', { cx: 0, cy: 28, r: 9, fill: w }, inner);
  } else if (kind === 3) { // steering wheel
    el('circle', { r: 44, fill: 'none', stroke: color, 'stroke-width': 13 }, inner);
    el('circle', { r: 11, fill: color }, inner);
    el('path', { d: 'M-42,6L-11,6M42,6L11,6M0,11L0,44', stroke: color, 'stroke-width': 12, 'stroke-linecap': 'round' }, inner);
  } else if (kind === 4) { // gear
    el('path', { d: gearPath(10, 50, 38, 15), fill: color, 'fill-rule': 'evenodd' }, inner);
  } else { // washer: drop + spray
    el('path', { d: DROP, fill: color, transform: 'translate(0 8) scale(.8)' }, inner);
    [[-46, -26, -30], [46, -26, 30], [0, -52, 0]].forEach(([x, y, r]) =>
      el('line', { x1: x * .55, y1: y * .6 - 6, x2: x, y2: y - 10, stroke: color, 'stroke-width': 7, 'stroke-linecap': 'round', transform: `rotate(${r * .0})` }, inner));
  }
  return g;
}

// ---------- bursts / particles ----------
function mkBurst(g, o) {
  const n = o.n || 14, size = o.size || 7, seed = o.seed || 1;
  const els = [], ps = [];
  for (let i = 0; i < n; i++) {
    els.push(el('circle', { r: size, fill: Array.isArray(o.color) ? o.color[i % o.color.length] : (o.color || '#fff'), opacity: 0 }, g));
    ps.push({ a: (o.dir === undefined ? -Math.PI / 2 : o.dir) + (rnd(seed + i * 3.1) - .5) * (o.spread === undefined ? Math.PI * 2 : o.spread), v: (o.spd || 300) * (.4 + .6 * rnd(seed + i * 7.7)), s: size * (.5 + rnd(seed + i * 1.3)) });
  }
  const life = o.life || .8, grav = o.grav === undefined ? 400 : o.grav;
  return function (age) {
    for (let i = 0; i < n; i++) {
      const e = els[i];
      if (age < 0 || age > life) { e.setAttribute('opacity', 0); continue; }
      const p = ps[i], k = age / life;
      set(e, { cx: (o.x + Math.cos(p.a) * p.v * age).toFixed(1), cy: (o.y + Math.sin(p.a) * p.v * age + .5 * grav * age * age).toFixed(1), r: Math.max(.1, p.s * (1 - k)).toFixed(2), opacity: (1 - k * k).toFixed(3) });
    }
  };
}
function star4(r) { return `M0,${-r}Q${r * .14},${-r * .14} ${r},0Q${r * .14},${r * .14} 0,${r}Q${-r * .14},${r * .14} ${-r},0Q${-r * .14},${-r * .14} 0,${-r}Z`; }

// ---------- titles ----------
function mkTitle(g, n, lines, color, delay) {
  const grp = el('g', {}, g);
  const badge = el('g', {}, grp);
  el('circle', { r: 118, fill: glowId(color), opacity: .9 }, badge);
  el('circle', { r: 68, fill: color }, badge);
  el('circle', { r: 68, fill: 'none', stroke: '#fff', 'stroke-width': 4, opacity: .55 }, badge);
  const num = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 4, 'font-size': 84, 'font-weight': 900, fill: '#fff' }, badge);
  num.textContent = n;
  const ring = el('circle', { r: 68, fill: 'none', stroke: color, 'stroke-width': 5 }, grp);
  const L = [];
  const base = lines.length === 1 ? 372 : 320;
  lines.forEach((txt, i) => {
    const y = base + i * 92;
    const cid = `ct_${n}_${i}`;
    const cp = el('clipPath', { id: cid }, defs);
    el('rect', { x: 236, y: y - 86, width: 830, height: 128 }, cp);
    const cg = el('g', { 'clip-path': `url(#${cid})` }, grp);
    const t = el('text', { x: 256, y: y, 'font-size': 84, 'font-weight': 900, fill: '#fff', 'letter-spacing': 1 }, cg);
    t.textContent = txt;
    L.push(t);
  });
  const bar = el('rect', { x: 256, y: base + (lines.length - 1) * 92 + 34, height: 8, rx: 4, fill: color }, grp);
  return function (t) {
    const s = eElastic(P(t, delay, delay + .9));
    TF(badge, 150, 340, Math.max(.001, s), 0);
    set(ring, { cx: 150, cy: 340, r: 68 + 70 * P(t, delay, delay + .7), opacity: (1 - P(t, delay, delay + .7)).toFixed(3), 'stroke-width': 5 });
    L.forEach((tx, i) => {
      const p = eOut4(P(t, delay + .12 + i * .14, delay + .62 + i * .14));
      tx.setAttribute('transform', `translate(0 ${(1 - p) * 120})`);
    });
    set(bar, { width: (lines.length === 1 ? 560 : 420) * eOut(P(t, delay + .5, delay + 1.1)) });
  };
}

// ---------- captions ----------
const CAPS = {
  0: ['В автомобиле есть несколько важных жидкостей. Давайте разберёмся, за что отвечает каждая!', .55, 3.55],
  1: ['Смазывает двигатель, уменьшает трение и помогает защищать его от износа.', .7, 6.2],
  2: ['Отводит тепло от двигателя и защищает систему охлаждения от замерзания.', .7, 6.4],
  3: ['Передаёт усилие от педали к тормозам. От неё напрямую зависит безопасность.', .7, 6.3],
  4: ['Помогает сделать руль лёгким и обеспечивает работу гидроусилителя.', .7, 6.2],
  5: ['Обеспечивает правильную работу и защищает детали коробки передач.', .7, 6.2],
  6: ['Помогает поддерживать чистое стекло и хороший обзор дороги.', .7, 5.9],
};
const capObjs = {};
const FONT_CAP = 48;
function measure(txt, size, weight) {
  const t = el('text', { 'font-size': size, 'font-weight': weight, visibility: 'hidden' }, svg);
  t.textContent = txt; const w = t.getComputedTextLength(); svg.removeChild(t); return w;
}
function buildUI() {
  // progress
  UI.pills = [];
  for (let i = 0; i < 6; i++) {
    const x = 90 + i * 152;
    el('rect', { x, y: 92, width: 140, height: 12, rx: 6, fill: '#fff', opacity: .14 }, gUI);
    UI.pills.push(el('rect', { x, y: 92, width: 0, height: 12, rx: 6, fill: ACC[i + 1] }, gUI));
  }
  UI.tag = el('text', { x: 540, y: 168, 'text-anchor': 'middle', 'font-size': 32, 'font-weight': 800, fill: '#fff', opacity: .55, 'letter-spacing': 7 }, gUI);
  UI.tag.textContent = '🚗 АВТОЗАПЧАСТИ';
  // captions
  for (const k in CAPS) {
    const [txt, t0, t1] = CAPS[k];
    const words = txt.split(' ');
    const lines = []; let cur = [];
    words.forEach(w => {
      const test = cur.concat([w]).join(' ');
      if (measure(test, FONT_CAP, 700) > 900 && cur.length) { lines.push(cur); cur = [w]; } else cur.push(w);
    });
    lines.push(cur);
    // balance: if last line is a single short word, pull one word down
    const lh = 66, pad = 32, hh = lines.length * lh + pad * 2;
    const bottom = 1800, top = bottom - hh;
    const g = el('g', {}, gUI);
    const card = el('rect', { x: 50, y: top, width: 980, height: hh, rx: 40, fill: '#070a14', opacity: .78, stroke: ACC[+k], 'stroke-opacity': .55, 'stroke-width': 3 }, g);
    const wordEls = [];
    lines.forEach((ln, li) => {
      const t = el('text', { x: 540, y: top + pad + 52 + li * lh, 'text-anchor': 'middle', 'font-size': FONT_CAP, 'font-weight': 700 }, g);
      ln.forEach((w, wi) => {
        const ts = el('tspan', { fill: '#fff', 'fill-opacity': .28 }, t);
        ts.textContent = w + (wi < ln.length - 1 ? ' ' : '');
        wordEls.push(ts);
      });
    });
    capObjs[k] = { g, wordEls, t0, t1, card, top, hh };
  }
}
const UI = {};
function uiUpdate(T, si) {
  UI.pills.forEach((p, i) => {
    const s = i + 1;
    const w = si > s ? 140 : si === s ? 140 * P(T, SB[s] + .2, SB[s + 1] - .4) : 0;
    set(p, { width: Math.max(0, w).toFixed(1) });
  });
  for (const k in capObjs) {
    const c = capObjs[k];
    if (+k !== si) { c.g.setAttribute('display', 'none'); continue; }
    c.g.setAttribute('display', 'inline');
    const t = T - SB[si];
    const a = eOut(P(t, c.t0 - .25, c.t0 + .1));
    const out = si === 0 ? 1 - P(t, 3.45, 3.7) : 1 - P(t, 6.65, 6.9);
    c.g.setAttribute('opacity', (a * out).toFixed(3));
    c.g.setAttribute('transform', `translate(0 ${(1 - a) * 50})`);
    const n = c.wordEls.length;
    c.wordEls.forEach((w, i) => {
      const ws = lerp(c.t0, c.t1, i / n);
      const on = t >= ws;
      const cur = t >= ws && t < ws + .28;
      set(w, { 'fill-opacity': on ? 1 : .28, fill: cur ? ACC[si] : '#fff' });
    });
  }
}

// ---------- transitions ----------
const TB = SB.slice(1, 8);
const bandA = el('path', {}, gTrans), bandS = el('path', {}, gTrans), bandC = el('path', {}, gTrans);
const flashRect = el('rect', { width: W, height: H, fill: '#fff', opacity: 0 }, gTrans);
function bandPath(top, h, ph) {
  let d = '', pts = [];
  for (let i = 0; i <= 24; i++) { const x = i * 45; pts.push([x, top + 46 * Math.sin(x / 95 + ph)]); }
  d = 'M' + pts.map(p => p[0] + ',' + p[1].toFixed(1)).join('L');
  for (let i = 24; i >= 0; i--) { const x = i * 45; d += 'L' + x + ',' + (top + h + 46 * Math.sin(x / 95 + ph + 1.5)).toFixed(1); }
  return d + 'Z';
}
function transUpdate(T) {
  let shown = false;
  for (let i = 0; i < TB.length; i++) {
    const tb = TB[i];
    if (T >= tb - .42 && T <= tb + .42) {
      const p = (T - (tb - .42)) / .84;
      const Hh = 2600, top = 1920 - p * (1920 + Hh);
      const col = ACC[i + 1];
      set(bandA, { d: bandPath(top, Hh, T * 7), fill: col, display: 'inline' });
      set(bandS, { d: bandPath(top - 70, 70, T * 7), fill: '#fff', opacity: .85, display: 'inline' });
      set(bandC, { d: bandPath(top + 160, Hh - 320, T * 7 + 2), fill: '#05070d', opacity: .55, display: 'inline' });
      shown = true;
    }
  }
  if (!shown) { bandA.setAttribute('display', 'none'); bandS.setAttribute('display', 'none'); bandC.setAttribute('display', 'none'); }
  flashRect.setAttribute('opacity', clamp(FX.flash).toFixed(3));
}

// ---------- shake ----------
function shakeUpdate(T) {
  let x = 0, y = 0;
  SHAKES.forEach(([t, m]) => {
    const a = T - t;
    if (a >= 0 && a < 1) { const d = Math.exp(-a * 9) * m; x += d * Math.sin(a * 70); y += d * Math.cos(a * 83); }
  });
  gWorld.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
}

// ---------- main ----------
function sceneIndexAt(T) { for (let i = 0; i < SB.length - 1; i++) if (T < SB[i + 1]) return i; return SB.length - 2; }
function render(T) {
  FX.flash = 0;
  const si = sceneIndexAt(T);
  SCENES.forEach((s, i) => {
    const vis = i === si;
    s.g.setAttribute('display', vis ? 'inline' : 'none');
    if (vis) s.update(T - SB[i], T);
  });
  bgUpdate(T, si); uiUpdate(T, si); transUpdate(T); shakeUpdate(T);
}
function buildAll() {
  SCENES.forEach(s => { s.g = el('g', { display: 'none' }, gWorld); s.build(s.g); });
  buildUI();
}
