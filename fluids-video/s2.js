// ===== Scene 2: coolant (11–18s) =====
SCENES[2] = (function () {
  const C = ACC[2];
  let title, tankG, tankLbl, liq, liqHi, bubbles = [], steam = [], loopG, flames = [], fan, pipeHot, pipeCool, flowHot, flowCool, frost, snow = [], needle, readout, status, engGlow, tankHose, cap, ticks = {}, arcs = [];
  const GC = [540, 1330], GR = 170;
  function wave(x0, x1, y, amp, ph, bottom) {
    let d = `M${x0},${bottom}L${x0},${y}`;
    for (let x = x0; x <= x1; x += 14) d += `L${x},${(y + amp * Math.sin(x / 30 + ph)).toFixed(1)}`;
    return d + `L${x1},${bottom}Z`;
  }
  function tempAt(t) {
    if (t < 2.9) return 120;
    if (t < 4.6) return lerp(120, 90, eIO(P(t, 2.9, 4.6)));
    if (t < 5.2) return 90;
    return lerp(90, -40, eIO(P(t, 5.2, 6.4)));
  }
  return {
    build(g) {
      title = mkTitle(g, 2, ['АНТИФРИЗ ❄️🔥'], C, .25);
      // ---------- tank ----------
      tankG = el('g', {}, g);
      el('circle', { r: 320, fill: glowId(C), opacity: .45 }, tankG);
      // hoses
      [-1, 1].forEach(s => {
        el('rect', { x: s < 0 ? -340 : 160, y: 118, width: 180, height: 56, rx: 18, fill: '#18213a', stroke: '#51618a', 'stroke-width': 4 }, tankG);
        el('rect', { x: s < 0 ? -340 : 160, y: 138, width: 180, height: 16, rx: 8, fill: C, opacity: .8 }, tankG);
      });
      const cp = el('clipPath', { id: 'tankClip' }, defs);
      el('rect', { x: -168, y: -228, width: 336, height: 456, rx: 44 }, cp);
      el('rect', { x: -170, y: -230, width: 340, height: 460, rx: 46, fill: '#0d1426', stroke: '#cfe3ff', 'stroke-width': 6, 'stroke-opacity': .7 }, tankG);
      const inner = el('g', { 'clip-path': 'url(#tankClip)' }, tankG);
      liq = el('path', { fill: C, opacity: .92 }, inner);
      liqHi = el('path', { fill: '#fff', opacity: .28 }, inner);
      for (let i = 0; i < 12; i++) bubbles.push(el('circle', { r: 4 + rnd(i) * 7, fill: '#fff', opacity: 0 }, inner));
      el('rect', { x: -150, y: -210, width: 26, height: 400, rx: 13, fill: '#fff', opacity: .14 }, tankG);
      // MIN/MAX
      [['MAX', -138], ['MIN', 92]].forEach(([n, y]) => {
        el('rect', { x: 110, y: y - 3, width: 62, height: 6, rx: 3, fill: '#fff' }, tankG);
        const lt = el('text', { x: 190, y: y + 11, 'font-size': 38, 'font-weight': 800, fill: '#fff' }, tankG); lt.textContent = n;
      });
      // cap
      cap = el('g', {}, tankG);
      el('rect', { x: -48, y: -266, width: 96, height: 40, rx: 6, fill: '#c9d3e6' }, cap);
      el('rect', { x: -70, y: -304, width: 140, height: 46, rx: 12, fill: '#ff3b5c' }, cap);
      for (let i = -3; i <= 3; i++) el('rect', { x: i * 18 - 3, y: -296, width: 6, height: 30, rx: 3, fill: '#fff', opacity: .35 }, cap);
      for (let i = 0; i < 4; i++) steam.push(el('circle', { r: 14, fill: '#fff' }, tankG));
      tankLbl = el('text', { x: 0, y: 310, 'text-anchor': 'middle', 'font-size': 42, 'font-weight': 900, fill: '#fff', 'letter-spacing': 2 }, tankG);
      tankLbl.textContent = 'РАСШИРИТЕЛЬНЫЙ БАЧОК';
      // ---------- loop ----------
      loopG = el('g', {}, g);
      // pipes
      const mkPipe = (d, col) => {
        el('path', { d, fill: 'none', stroke: '#0c1222', 'stroke-width': 52, 'stroke-linecap': 'round' }, loopG);
        const inner = el('path', { d, fill: 'none', stroke: col, 'stroke-width': 32, 'stroke-linecap': 'round' }, loopG);
        const flow = el('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-dasharray': '26 34', opacity: .55 }, loopG);
        return [inner, flow];
      };
      tankHose = el('path', { d: 'M540 830L540 910', stroke: '#0c1222', 'stroke-width': 40, 'stroke-linecap': 'round', fill: 'none' }, loopG);
      [pipeHot, flowHot] = mkPipe('M382 910L700 910', '#ff6a3d');
      [pipeCool, flowCool] = mkPipe('M700 1090L382 1090', C);
      // engine
      engGlow = el('rect', { x: 80, y: 850, width: 320, height: 300, rx: 34, fill: '#ff4d2e', opacity: 0 }, loopG);
      el('rect', { x: 100, y: 860, width: 280, height: 290, rx: 30, fill: 'url(#darkMetal)', stroke: '#8ea0c4', 'stroke-width': 4 }, loopG);
      for (let i = 0; i < 4; i++) el('rect', { x: 126 + i * 62, y: 884, width: 44, height: 150, rx: 8, fill: '#0a0f1d', stroke: '#566282', 'stroke-width': 3 }, loopG);
      el('rect', { x: 126, y: 1060, width: 228, height: 54, rx: 14, fill: '#1c2438', stroke: '#566282', 'stroke-width': 3 }, loopG);
      const et = el('text', { x: 240, y: 1226, 'text-anchor': 'middle', 'font-size': 34, 'font-weight': 800, fill: '#fff', opacity: .8, 'letter-spacing': 3 }, loopG); et.textContent = 'ДВИГАТЕЛЬ';
      // flames
      for (let i = 0; i < 5; i++) {
        const f = el('g', {}, loopG);
        el('path', { d: 'M0,0C-26,-34 -10,-70 0,-110C16,-70 28,-34 0,0Z', fill: '#ff6a2a' }, f);
        el('path', { d: 'M0,0C-14,-20 -6,-40 0,-62C8,-40 14,-20 0,0Z', fill: '#ffd36a' }, f);
        flames.push(f);
      }
      // radiator
      el('rect', { x: 700, y: 860, width: 280, height: 290, rx: 24, fill: '#18213a', stroke: '#8ea0c4', 'stroke-width': 4 }, loopG);
      for (let i = 0; i < 12; i++) el('rect', { x: 716 + i * 22.5, y: 880, width: 8, height: 250, rx: 4, fill: '#51618a' }, loopG);
      el('rect', { x: 700, y: 860, width: 280, height: 38, rx: 18, fill: '#2b3656' }, loopG);
      el('rect', { x: 700, y: 1112, width: 280, height: 38, rx: 18, fill: '#2b3656' }, loopG);
      const rt = el('text', { x: 840, y: 1226, 'text-anchor': 'middle', 'font-size': 34, 'font-weight': 800, fill: '#fff', opacity: .8, 'letter-spacing': 3 }, loopG); rt.textContent = 'РАДИАТОР';
      fan = el('g', { transform: 'translate(840 1005)' }, loopG);
      const fr = el('g', {}, fan);
      el('circle', { r: 96, fill: '#05070d', opacity: .55, stroke: '#aab6d3', 'stroke-width': 4 }, fr);
      for (let i = 0; i < 6; i++) el('path', { d: 'M0,0C20,-30 50,-60 20,-86C0,-70 -14,-30 0,0Z', fill: '#cfe3ff', opacity: .85, transform: `rotate(${i * 60})` }, fr);
      el('circle', { r: 16, fill: '#fff' }, fr);
      fan.fr = fr;
      // frost
      frost = el('g', { opacity: 0 }, loopG);
      el('rect', { x: 700, y: 860, width: 280, height: 290, rx: 24, fill: '#dff1ff', opacity: .38 }, frost);
      for (let i = 0; i < 9; i++) el('path', { d: star4(16 + rnd(i) * 22), fill: '#fff', transform: `translate(${720 + rnd(i * 3) * 240} ${880 + rnd(i * 5) * 250})` }, frost);
      for (let i = 0; i < 18; i++) snow.push(el('path', { d: star4(8 + rnd(i) * 10), fill: '#e8f6ff' }, loopG));
      // gauge
      const segs = [['#3b82f6', 0, .35], ['#35e0a1', .35, .7], ['#ffb020', .7, .85], ['#ff3b3b', .85, 1]];
      segs.forEach(([c, a0, a1]) => {
        const A0 = Math.PI * (1 - a0), A1 = Math.PI * (1 - a1);
        const p = (a) => `${(GC[0] + GR * Math.cos(a)).toFixed(1)},${(GC[1] - GR * Math.sin(a)).toFixed(1)}`;
        el('path', { d: `M${p(A0)}A${GR},${GR} 0 0 1 ${p(A1)}`, fill: 'none', stroke: c, 'stroke-width': 28, opacity: .9 }, loopG);
      });
      needle = el('g', {}, loopG);
      el('path', { d: 'M-8,0L0,-150L8,0Z', fill: '#fff' }, needle);
      el('circle', { r: 20, fill: '#fff' }, loopG).setAttribute('transform', `translate(${GC[0]} ${GC[1]})`);
      readout = el('text', { x: 540, y: 1440, 'text-anchor': 'middle', 'font-size': 100, 'font-weight': 900, fill: '#fff' }, loopG);
      status = el('text', { x: 540, y: 1496, 'text-anchor': 'middle', 'font-size': 36, 'font-weight': 900, 'letter-spacing': 4, fill: '#ff5a3c' }, loopG);
      shakeAt(SB[2] + 5.2, 5);
    },
    update(t) {
      title(t);
      // ----- tank -----
      const tin = eBack(P(t, .3, 1.0));
      const mv = eIO(P(t, 2.5, 3.3));
      const tx = 540, ty = lerp(1010, 772, mv), ts = lerp(1, .3, mv) * Math.max(.001, tin);
      TF(tankG, tx, ty, ts, 0);
      tankLbl.setAttribute('opacity', (1 - P(t, 2.3, 2.6)).toFixed(2));
      const lvl = eOut(P(t, .6, 2.0));
      const ly = lerp(228 - .08 * 456, 228 - .62 * 456, lvl);
      liq.setAttribute('d', wave(-190, 190, ly, 7, t * 4, 240));
      liqHi.setAttribute('d', wave(-190, 190, ly + 3, 3, t * 4, ly + 12));
      bubbles.forEach((b, i) => {
        const per = 1.4 + rnd(i) * 1.2, ph = ((t * .8 + rnd(i * 4)) / per * 1.4) % 1;
        const x = -120 + rnd(i * 9) * 240, yy = lerp(210, ly + 10, ph);
        set(b, { cx: (x + 8 * Math.sin(t * 5 + i)).toFixed(1), cy: yy.toFixed(1), opacity: (yy > ly + 4 && P(t, .7, 1) > 0 ? .5 * Math.sin(ph * Math.PI) : 0).toFixed(2) });
      });
      steam.forEach((s, i) => {
        const a = (t - 2.0 - i * .13);
        const p = P(a, 0, 1);
        set(s, { cx: (Math.sin(i * 2) * 20 * p).toFixed(1), cy: (-310 - 120 * p).toFixed(1), r: (12 + 36 * p).toFixed(1), opacity: (a > 0 ? .5 * (1 - p) : 0).toFixed(2) });
      });
      cap.setAttribute('transform', `translate(0 ${-10 * Math.exp(-Math.max(0, t - 2.0) * 9) * Math.sin(Math.max(0, t - 2.0) * 40)})`);
      // ----- loop -----
      const lp = P(t, 2.7, 3.5);
      loopG.setAttribute('opacity', eOut(lp).toFixed(3));
      const T = tempAt(t);
      const hotCol = mixc('#ff6a3d', C, eIO(P(t, 4.9, 6.2)));
      pipeHot.setAttribute('stroke', hotCol);
      const spd = t < 5.2 ? 1 : 1 - .6 * P(t, 5.2, 6);
      flowHot.setAttribute('stroke-dashoffset', (-t * 200 * spd).toFixed(1));
      flowCool.setAttribute('stroke-dashoffset', (t * 200 * spd).toFixed(1));
      flowHot.setAttribute('transform', '');
      fan.fr.setAttribute('transform', `rotate(${(t * 720 * spd).toFixed(1)})`);
      // heat
      const heat = t < 4.9 ? (T - 90) / 30 : 0;
      engGlow.setAttribute('opacity', (clamp(heat) * (.45 + .2 * Math.sin(t * 18)) * lp).toFixed(3));
      flames.forEach((f, i) => {
        const fl = clamp(heat * 1.1) * lp;
        const sy = fl * (.7 + .4 * Math.sin(t * 14 + i * 1.7));
        TF(f, 140 + i * 50, 872, .9 * fl + .001, 0, Math.max(.001, .9 * sy));
        f.setAttribute('opacity', fl.toFixed(2));
      });
      // frost + snow
      const fr = eOut(P(t, 5.3, 6.4));
      frost.setAttribute('opacity', fr.toFixed(2));
      snow.forEach((s, i) => {
        const per = 2.2 + rnd(i) * 1.4, ph = (((t - 5.2) / per + rnd(i * 3)) % 1 + 1) % 1;
        const a = P(t, 5.2, 5.8);
        s.setAttribute('transform', `translate(${(120 + rnd(i * 5) * 840 + 24 * Math.sin(t * 2 + i)).toFixed(0)} ${(790 + ph * 400).toFixed(0)}) rotate(${(t * 90 + i * 40).toFixed(0)})`);
        s.setAttribute('opacity', (a * Math.sin(ph * Math.PI) * .9).toFixed(2));
      });
      // gauge
      const th = clamp((T + 40) / 170) * 180;
      needle.setAttribute('transform', `translate(${GC[0]} ${GC[1]}) rotate(${(th - 90).toFixed(1)})`);
      readout.textContent = Math.round(T).toString().replace('-', '−') + '°C';
      readout.setAttribute('fill', t < 4.4 ? mixc('#ff5a3c', '#35e0a1', P(t, 2.9, 4.4)) : t < 5.2 ? '#35e0a1' : mixc('#35e0a1', '#8fd3ff', P(t, 5.2, 6)));
      let st = 'ПЕРЕГРЕВ', sc = '#ff5a3c';
      if (t >= 4.2 && t < 5.2) { st = 'ОПТИМУМ'; sc = '#35e0a1'; }
      else if (t >= 5.2) { st = 'НЕ ЗАМЕРЗАЕТ'; sc = '#8fd3ff'; }
      status.textContent = st; status.setAttribute('fill', sc);
    }
  };
})();
