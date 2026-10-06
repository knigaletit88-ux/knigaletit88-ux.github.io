// ===== Scene 6: washer fluid (39–46s) =====
SCENES[6] = (function () {
  const C = ACC[6];
  const WS = 'M190 560L890 560Q930 560 938 600L1010 1300L70 1300L142 600Q150 560 190 560Z';
  const PIV = [[470, 1275, 400], [800, 1275, 370]];
  const JETS = [330, 635, 900];
  let title, blur, road, dashes = [], blobs = [], dots = [], haze, dim, wipers = [], jetP = [], vis, visTxt, sparkles = [], flare, wet, sunG;
  function wip(t) {
    if (t < 2.2) return 176;
    if (t < 3.1) return lerp(176, 72, eIO(P(t, 2.2, 3.1)));
    if (t < 4.0) return lerp(72, 176, eIO(P(t, 3.1, 4.0)));
    if (t < 4.9) return lerp(176, 72, eIO(P(t, 4.0, 4.9)));
    return lerp(72, 176, eIO(P(t, 4.9, 5.8)));
  }
  function phiMin(t) { return t < 2.2 ? 176 : t < 3.1 ? wip(t) : 72; }
  return {
    build(g) {
      title = mkTitle(g, 6, ['ОМЫВАЙКА 👀✨'], C, .25);
      // vis meter
      const vl = el('text', { x: 100, y: 490, 'font-size': 30, 'font-weight': 800, fill: '#fff', opacity: .85, 'letter-spacing': 3 }, g); vl.textContent = 'ОБЗОР';
      visTxt = el('text', { x: 980, y: 490, 'text-anchor': 'end', 'font-size': 34, 'font-weight': 900, fill: '#fff' }, g);
      el('rect', { x: 100, y: 504, width: 880, height: 30, rx: 15, fill: '#fff', opacity: .12 }, g);
      vis = el('rect', { x: 100, y: 504, height: 30, rx: 15 }, g);
      // clip
      const cp = el('clipPath', { id: 'wsClip' }, defs); el('path', { d: WS }, cp);
      const f = el('filter', { id: 'wsBlur', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
      blur = el('feGaussianBlur', { stdDeviation: 9 }, f);
      el('path', { d: WS, fill: '#0b1226', stroke: '#9fb4ff', 'stroke-width': 10, 'stroke-opacity': .6, 'stroke-linejoin': 'round' }, g);
      const inner = el('g', { 'clip-path': 'url(#wsClip)' }, g);
      lgrad('sky6', [[0, '#1c2c5e'], [.55, '#6b4a8a'], [1, '#ff9a6a']]);
      const scene = el('g', { filter: 'url(#wsBlur)' }, inner);
      el('rect', { x: 0, y: 540, width: 1080, height: 270, fill: 'url(#sky6)' }, scene);
      sunG = el('circle', { cx: 540, cy: 806, r: 150, fill: glowId('#ffd6a0'), opacity: .9 }, scene);
      el('circle', { cx: 540, cy: 806, r: 58, fill: '#ffe7bf' }, scene);
      el('path', { d: 'M0 810L0 740L90 700L170 760L260 690L360 770L470 740L540 810Z', fill: '#2a2a4d' }, scene);
      el('path', { d: 'M540 810L620 735L720 770L830 690L930 760L1010 710L1080 760L1080 810Z', fill: '#2a2a4d' }, scene);
      el('rect', { x: 0, y: 800, width: 1080, height: 520, fill: '#171c2d' }, scene);
      el('path', { d: 'M520 806L560 806L1160 1320L-80 1320Z', fill: '#2a3148' }, scene);
      el('path', { d: 'M520 806L560 806L1160 1320L1080 1320L540 830Z', fill: '#fff', opacity: .06 }, scene);
      for (let i = 0; i < 8; i++) dashes.push(el('path', { fill: '#ffd36a' }, scene));
      el('rect', { x: 515, y: 842, width: 18, height: 12, rx: 3, fill: '#ff2a44' }, scene);
      el('rect', { x: 549, y: 842, width: 18, height: 12, rx: 3, fill: '#ff2a44' }, scene);
      el('circle', { cx: 524, cy: 848, r: 30, fill: glowId('#ff2a44'), opacity: .8 }, scene);
      el('circle', { cx: 558, cy: 848, r: 30, fill: glowId('#ff2a44'), opacity: .8 }, scene);
      dim = el('rect', { x: 0, y: 540, width: 1080, height: 800, fill: '#7a6a50', opacity: .4 }, inner);
      haze = el('rect', { x: 0, y: 540, width: 1080, height: 800, fill: '#9c8c70', opacity: .4 }, inner);
      // dirt blobs
      const dg = el('g', {}, inner);
      let tries = 0;
      for (let i = 0; blobs.length < 16 && tries < 400; tries++) {
        const x = 170 + rnd(tries * 3.7) * 740, y = 600 + rnd(tries * 5.3) * 640;
        const pv = x < 635 ? PIV[0] : PIV[1];
        const ang = Math.atan2(pv[1] - y, x - pv[0]) * 57.29578;
        const dist = Math.hypot(x - pv[0], y - pv[1]);
        if (ang < 82 || ang > 168 || dist > pv[2] - 40) continue;
        const rx = 36 + rnd(tries * 9.1) * 70, ry = 26 + rnd(tries * 4.1) * 56;
        const b = el('g', {}, dg);
        el('ellipse', { cx: x, cy: y, rx, ry, fill: '#5b4a35', opacity: .88, transform: `rotate(${rnd(tries) * 60 - 30} ${x} ${y})` }, b);
        el('ellipse', { cx: x + 4, cy: y - 5, rx: rx * .6, ry: ry * .55, fill: '#7b6a50', opacity: .8 }, b);
        for (let k = 0; k < 4; k++) el('circle', { cx: x + (rnd(tries + k) - .5) * rx * 2.2, cy: y + (rnd(tries + k * 3) - .5) * ry * 2.4, r: 4 + rnd(k + tries) * 9, fill: '#5b4a35' }, b);
        const smear = el('ellipse', { cx: x, cy: y, rx: rx * 1.5, ry: ry * .7, fill: '#8f7f66', opacity: 0, transform: `rotate(${ang - 90} ${x} ${y})` }, dg);
        blobs.push({ g: b, ang, smear, t0: .45 + blobs.length * .05, x, y });
      }
      wet = el('rect', { x: 0, y: 540, width: 1080, height: 800, fill: '#bff4ff', opacity: 0 }, inner);
      // jets
      JETS.forEach((x, j) => { for (let k = 0; k < 16; k++) jetP.push({ j, k, x, e: el('circle', { r: 6, fill: j % 2 ? '#e8fbff' : '#8be8ff' }, inner) }); });
      // sparkle + flare
      flare = el('path', { d: 'M-80,0L40,0L180,900L60,900Z', fill: '#fff', opacity: 0 }, inner);
      for (let i = 0; i < 9; i++) sparkles.push(el('path', { d: star4(30 + rnd(i) * 26), fill: '#fff' }, inner));
      // dash & wipers
      el('path', { d: 'M40 1300L1040 1300L1060 1340L20 1340Z', fill: '#05070d' }, g);
      el('rect', { x: 20, y: 1290, width: 1040, height: 20, fill: '#05070d' }, inner);
      PIV.forEach(pv => {
        const w = el('g', { transform: `translate(${pv[0]} ${pv[1]})` }, inner);
        const arm = el('g', {}, w);
        el('line', { x1: 0, y1: 0, x2: pv[2], y2: 0, stroke: '#0a0d18', 'stroke-width': 12, 'stroke-linecap': 'round' }, arm);
        el('line', { x1: 60, y1: 8, x2: pv[2], y2: 8, stroke: '#000', 'stroke-width': 8, 'stroke-linecap': 'round' }, arm);
        el('line', { x1: 20, y1: -3, x2: pv[2] - 10, y2: -3, stroke: '#4a5470', 'stroke-width': 3 }, arm);
        el('circle', { r: 16, fill: '#aab6d3' }, w);
        wipers.push(arm);
      });
      for (let i = 0; i < 4; i++) el('rect', { x: 120 + i * 260, y: 560, width: 40, height: 740, fill: '#fff', opacity: .035, transform: `skewX(-8)` }, inner);
      this.stp = el('text', { x: 540, y: 1430, 'text-anchor': 'middle', 'font-size': 44, 'font-weight': 900, fill: '#fff', opacity: 0, 'letter-spacing': 3 }, g);
      this.stp.textContent = 'ЧИСТОЕ СТЕКЛО ✨';
      shakeAt(SB[6] + 5.0, 3);
    },
    update(t) {
      title(t);
      const wi = eOut(P(t, .1, .7));
      // road dashes (driving)
      dashes.forEach((d, i) => {
        const ph = ((i / 8 + t * .55) % 1), p = ph * ph;
        const y0 = 810 + p * 520, y1 = 810 + Math.min(1, (ph + .06)) * Math.min(1, ph + .06) * 520;
        const w0 = 2 + p * 26, w1 = 2 + (y1 - 810) / 520 * 26;
        set(d, { d: `M${540 - w0 / 2},${y0.toFixed(1)}L${540 + w0 / 2},${y0.toFixed(1)}L${540 + w1 / 2},${y1.toFixed(1)}L${540 - w1 / 2},${y1.toFixed(1)}Z` });
      });
      // dirt state
      const pm = phiMin(t);
      blobs.forEach(b => {
        const appear = eOut(P(t, b.t0, b.t0 + .15));
        const clean = clamp((176 - pm) > 0 ? (b.ang - pm + 10) / 10 : 0);
        const op = appear * (1 - clean);
        b.g.setAttribute('opacity', op.toFixed(3));
        const sm = clean > 0 ? .4 * (1 - P(t, 3.9, 4.8)) * clamp(clean * 2) : 0;
        b.smear.setAttribute('opacity', (sm * appear).toFixed(3));
      });
      const hz = t < 2.2 ? .4 * P(t, .3, .9) : t < 3.3 ? lerp(.4, .12, eIO(P(t, 2.2, 3.3))) : lerp(.12, 0, eIO(P(t, 4.0, 4.9)));
      haze.setAttribute('opacity', hz.toFixed(3));
      dim.setAttribute('opacity', (.4 * (1 - eIO(P(t, 2.2, 4.9)))).toFixed(3));
      const bl = t < 2.2 ? 9 * P(t, .3, 1) : t < 3.3 ? lerp(9, 4, eIO(P(t, 2.2, 3.3))) : lerp(4, 0, eIO(P(t, 4.0, 4.9)));
      blur.setAttribute('stdDeviation', bl.toFixed(2));
      wet.setAttribute('opacity', (.14 * P(t, 1.8, 2.2) * (1 - P(t, 4.2, 4.9))).toFixed(3));
      // wipers
      wipers.forEach((w, i) => w.setAttribute('transform', `rotate(${(-wip(t - i * .04)).toFixed(2)})`));
      // jets
      jetP.forEach(p => {
        const jt = t - 1.6;
        const per = .8, a = ((jt - p.k * .05) % per + per) % per;
        const on = jt > 0 && t < 3.0 ? 1 - P(t, 2.5, 3.0) : 0;
        const dir = (p.j - 1) * .16 + (p.k % 3 - 1) * .08;
        const x = p.x + (p.j === 0 ? 110 : p.j === 2 ? -110 : 0) * a * 1.1 + dir * 140 * a, y = 1290 - 640 * a + 700 * a * a;
        set(p.e, { cx: x.toFixed(1), cy: y.toFixed(1), r: (7 * (1 - a / per * .5) * on).toFixed(2), opacity: (on * (1 - a / per * .6)).toFixed(2) });
      });
      // vis
      const pr = eIO(P(t, 2.2, 3.3)) * .72 + eIO(P(t, 4.0, 4.9)) * .28;
      const v = 8 + 92 * pr;
      set(vis, { width: (880 * v / 100 * P(t, .2, .6)).toFixed(1), fill: mixc('#ff5a3c', '#35e0a1', pr) });
      visTxt.textContent = Math.round(v) + '%';
      // shine
      const fl = P(t, 5.0, 5.9);
      flare.setAttribute('transform', `translate(${lerp(-100, 1200, eIO(fl))} 560)`);
      flare.setAttribute('opacity', (.28 * Math.sin(fl * Math.PI)).toFixed(2));
      sparkles.forEach((s, i) => {
        const t0 = 5.0 + i * .12, p = P(t, t0, t0 + .7);
        const sc = Math.sin(p * Math.PI);
        s.setAttribute('transform', `translate(${(200 + rnd(i * 4.4) * 680).toFixed(0)} ${(640 + rnd(i * 6.1) * 560).toFixed(0)}) scale(${(sc * 1.1).toFixed(3)}) rotate(${p * 90})`);
        s.setAttribute('opacity', (p > 0 && p < 1 ? 1 : 0));
      });
      this.stp.setAttribute('opacity', eOut(P(t, 5.2, 5.7)).toFixed(2));
    }
  };
})();
