// ===== Scene 4: power steering fluid (25–32s) =====
SCENES[4] = (function () {
  const C = ACC[4];
  const W0 = [640, 930], WR = 210;
  let title, wheel, pumpV, pumpGlow, ringA, flow, res, resWave, effortFill, effortLbl, wheelsB = [], rack, col, burst, easy, shock;
  const PIPE = 'M200 1064V1440H640V1372';
  function strain(t) { return 30 * eOut(P(t, .4, 1.6)) + (t < 1.9 ? 2.2 * Math.sin(t * 55) * P(t, .4, .6) : 0); }
  function swing(t) { return 120 * Math.sin(2 * Math.PI * (t - 1.5) / 2.8); }
  function angle(t) { return lerp(strain(t), swing(t), eIO(P(t, 1.7, 2.5))); }
  function wave(x0, x1, y, amp, ph, bottom) {
    let d = `M${x0},${bottom}L${x0},${y}`;
    for (let x = x0; x <= x1; x += 10) d += `L${x},${(y + amp * Math.sin(x / 16 + ph)).toFixed(1)}`;
    return d + `L${x1},${bottom}Z`;
  }
  return {
    build(g) {
      title = mkTitle(g, 4, ['ЖИДКОСТЬ', 'ГУР 🛞'], C, .25);
      // effort bar
      this.el1 = el('text', { x: 100, y: 548, 'font-size': 32, 'font-weight': 800, fill: '#fff', opacity: .85, 'letter-spacing': 3 }, g); this.el1.textContent = 'УСИЛИЕ НА РУЛЕ';
      effortLbl = el('text', { x: 980, y: 548, 'text-anchor': 'end', 'font-size': 36, 'font-weight': 900, 'letter-spacing': 3 }, g);
      el('rect', { x: 100, y: 570, width: 880, height: 40, rx: 20, fill: '#fff', opacity: .12 }, g);
      effortFill = el('rect', { x: 100, y: 570, height: 40, rx: 20 }, g);
      // pipe
      el('path', { d: PIPE, fill: 'none', stroke: '#0c1222', 'stroke-width': 40, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      el('path', { d: PIPE, fill: 'none', stroke: '#3a2a55', 'stroke-width': 24, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      flow = el('path', { d: PIPE, fill: 'none', stroke: C, 'stroke-width': 24, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': '34 30' }, g);
      this.pl = el('text', { x: 420, y: 1488, 'text-anchor': 'middle', 'font-size': 28, 'font-weight': 900, fill: '#fff', opacity: .75, 'letter-spacing': 3 }, g); this.pl.textContent = 'ДАВЛЕНИЕ';
      // reservoir
      const rcp = el('clipPath', { id: 'resClip' }, defs); el('rect', { x: 118, y: 690, width: 104, height: 146, rx: 22 }, rcp);
      el('rect', { x: 112, y: 684, width: 116, height: 158, rx: 26, fill: '#0d1426', stroke: '#cfe3ff', 'stroke-width': 5, 'stroke-opacity': .7 }, g);
      const ri = el('g', { 'clip-path': 'url(#resClip)' }, g);
      resWave = el('path', { fill: C }, ri);
      el('rect', { x: 140, y: 650, width: 60, height: 36, rx: 8, fill: '#c9d3e6' }, g);
      el('rect', { x: 128, y: 636, width: 84, height: 24, rx: 8, fill: '#a855f7' }, g);
      el('line', { x1: 170, y1: 842, x2: 170, y2: 950, stroke: '#0c1222', 'stroke-width': 30, 'stroke-linecap': 'round' }, g);
      el('line', { x1: 170, y1: 842, x2: 170, y2: 950, stroke: '#3a2a55', 'stroke-width': 16, 'stroke-linecap': 'round' }, g);
      // pump
      const pg = el('g', { transform: 'translate(200 1000)' }, g);
      pumpGlow = el('circle', { r: 130, fill: glowId(C), opacity: 0 }, pg);
      el('circle', { r: 66, fill: 'url(#darkMetal)', stroke: '#c9d3e6', 'stroke-width': 5 }, pg);
      pumpV = el('g', {}, pg);
      for (let i = 0; i < 4; i++) el('path', { d: 'M0,0L34,-10L50,0L34,10Z', fill: C, transform: `rotate(${i * 90})` }, pumpV);
      el('circle', { r: 12, fill: '#fff' }, pumpV);
      ringA = el('circle', { cx: 200, cy: 1000, r: 66, fill: 'none', stroke: C, 'stroke-width': 8, opacity: 0 }, g);
      this.nl = el('text', { x: 200, y: 1118, 'text-anchor': 'middle', 'font-size': 28, 'font-weight': 900, fill: '#fff', opacity: .8, 'letter-spacing': 3 }, g); this.nl.textContent = 'НАСОС';
      // column
      col = el('g', {}, g);
      el('line', { x1: W0[0], y1: W0[1], x2: W0[0], y2: 1310, stroke: '#8ea0c4', 'stroke-width': 24, 'stroke-linecap': 'round' }, col);
      el('circle', { cx: W0[0], cy: 1190, r: 22, fill: '#c9d3e6' }, col);
      // steering wheel
      wheel = el('g', {}, g);
      el('circle', { r: WR + 40, fill: glowId(C), opacity: .35 }, wheel);
      el('circle', { r: WR, fill: 'none', stroke: '#0e1326', 'stroke-width': 56 }, wheel);
      el('circle', { r: WR, fill: 'none', stroke: '#2a3250', 'stroke-width': 44 }, wheel);
      el('circle', { r: WR + 16, fill: 'none', stroke: '#fff', 'stroke-width': 3, opacity: .35 }, wheel);
      for (let i = 0; i < 28; i++) el('rect', { x: WR - 3, y: -6, width: 6, height: 12, rx: 2, fill: '#ff3b5c', opacity: .0, transform: `rotate(${i * 12.857})` }, wheel);
      el('path', { d: `M${-WR + 20},12L-60,12L-40,50L40,50L60,12L${WR - 20},12L${WR - 20},-8L60,-8L48,-14L-48,-14L-60,-8L${-WR + 20},-8Z`, fill: '#2a3250', stroke: '#8ea0c4', 'stroke-width': 3, transform: 'rotate(0)' }, wheel);
      el('path', { d: `M-34,40L-20,${WR - 16}L20,${WR - 16}L34,40Z`, fill: '#2a3250', stroke: '#8ea0c4', 'stroke-width': 3 }, wheel);
      el('circle', { r: 70, fill: 'url(#darkMetal)', stroke: '#c9d3e6', 'stroke-width': 4 }, wheel);
      const lg = el('circle', { r: 34, fill: C }, wheel);
      const lt = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 3, 'font-size': 34, 'font-weight': 900, fill: '#fff' }, wheel); lt.textContent = '';
      // rack & wheels
      el('rect', { x: 520, y: 1306, width: 240, height: 68, rx: 18, fill: 'url(#steel)', stroke: '#8ea0c4', 'stroke-width': 3 }, g);
      rack = el('g', {}, g);
      el('rect', { x: 380, y: 1332, width: 520, height: 16, rx: 8, fill: '#aab6d3' }, rack);
      el('rect', { x: 560, y: 1324, width: 160, height: 32, rx: 8, fill: C, opacity: .85 }, rack);
      [400, 880].forEach((x, i) => {
        const w = el('g', {}, g);
        el('rect', { x: -34, y: -70, width: 68, height: 140, rx: 16, fill: '#10152a', stroke: '#566282', 'stroke-width': 4 }, w);
        for (let k = -2; k <= 2; k++) el('rect', { x: -34, y: k * 26 - 3, width: 68, height: 6, fill: '#2a3250' }, w);
        w.dataset.x = x; wheelsB.push(w);
      });
      burst = mkBurst(g, { x: 200, y: 1000, n: 16, color: ['#fff', C], spd: 320, life: .8, grav: 200, size: 8, seed: 11 });
      shakeAt(SB[4] + 1.6, 8);
    },
    update(t) {
      title(t);
      const a = angle(t);
      const wi = eOut(P(t, .1, .6));
      const strainJ = t < 1.7 ? (rnd(Math.floor(t * 40)) - .5) * 5 * P(t, .4, .6) : 0;
      TF(wheel, W0[0] + strainJ, W0[1], Math.max(.001, wi), a);
      wheel.setAttribute('opacity', wi.toFixed(2));
      const pumpOn = eOut(P(t, 1.6, 2.2));
      pumpV.setAttribute('transform', `rotate(${(t * 360 * pumpOn * 2.4 + (t > 1.6 ? 0 : 0)).toFixed(1)})`);
      pumpGlow.setAttribute('opacity', (pumpOn * (.6 + .2 * Math.sin(t * 8))).toFixed(2));
      const sr = P(t, 1.6, 2.4);
      set(ringA, { r: 66 + 160 * sr, opacity: (1 - sr).toFixed(2), 'stroke-width': 8 * (1 - sr) + 1 });
      flow.setAttribute('stroke-dashoffset', (-t * 220 * pumpOn).toFixed(1));
      flow.setAttribute('opacity', (.25 + .75 * pumpOn).toFixed(2));
      resWave.setAttribute('d', wave(110, 230, 770 + 4 * Math.sin(t * 6) * pumpOn, 3, t * 5, 850));
      // effort
      const eff = t < 1.7 ? lerp(.55, 1, P(t, .3, 1.3)) : lerp(1, .12, eIO(P(t, 1.7, 2.9)));
      set(effortFill, { width: (880 * eff * P(t, .2, .6)).toFixed(1), fill: mixc('#35e0a1', '#ff3b3b', clamp((eff - .12) / .8)) });
      const heavy = eff > .5;
      effortLbl.textContent = heavy ? 'ТЯЖЕЛО' : 'ЛЕГКО';
      effortLbl.setAttribute('fill', heavy ? '#ff5a5a' : '#35e0a1');
      // steering result
      const s = clamp(a / 130, -1.2, 1.2);
      wheelsB.forEach(w => { TF(w, +w.dataset.x + s * -38 * 0, 1340, 1, s * 26); });
      rack.setAttribute('transform', `translate(${(-s * 34).toFixed(1)} 0)`);
      burst(t - 1.65);
      this.pl.setAttribute('opacity', (.75 * pumpOn).toFixed(2)); this.nl.setAttribute('opacity', (.8 * wi).toFixed(2));
    }
  };
})();
