// ===== Scene 0: hook (0–4s) =====
SCENES[0] = (function () {
  let car, carIn, wheels = [], hood, wedge, bayGlow, shafts, beam, orbs = [], l1, l2, emo, rays;
  const ORIGIN = [[606, 152], [636, 152], [666, 152], [696, 152], [726, 152], [756, 152]];
  const FIN = i => [150 + i * 156, 770 - 70 * Math.sin(Math.PI * i / 5)];
  const CX = 540, CY = 1130, SC = 1.12;
  const BODY = 'M28 196C24 170 30 150 56 142L172 126C196 122 214 114 238 92C268 62 312 48 366 46L470 46C520 48 556 74 586 114L744 136C772 142 786 156 790 178L792 200C792 210 784 214 772 214L44 214C34 214 28 208 28 196Z';
  function mkWheel(parent, cx, cy) {
    const g = el('g', { transform: `translate(${cx} ${cy})` }, parent);
    el('circle', { r: 45, fill: '#0b0e16', stroke: '#1d2332', 'stroke-width': 3 }, g);
    const rot = el('g', {}, g);
    el('circle', { r: 31, fill: 'url(#steel)' }, rot);
    for (let i = 0; i < 5; i++) el('path', { d: 'M-5,-7L-8,-28L8,-28L5,-7Z', fill: '#3b465c', transform: `rotate(${i * 72})` }, rot);
    el('circle', { r: 7, fill: '#e8eefc' }, rot);
    el('circle', { r: 31, fill: 'none', stroke: '#fff', 'stroke-width': 1.5, opacity: .5 }, g);
    return rot;
  }
  return {
    build(g) {
      car = el('g', {}, g);
      carIn = el('g', { transform: 'translate(-400 -150)' }, car);
      el('ellipse', { cx: 400, cy: 250, rx: 380, ry: 16, fill: '#000', opacity: .55 }, carIn);
      beam = el('path', { d: 'M776 152L1400 40L1400 330Z', fill: 'url(#beamG)', opacity: 0 }, carIn);
      const cp = el('clipPath', { id: 'bodyClip' }, defs); el('path', { d: BODY }, cp);
      el('path', { d: BODY, fill: 'url(#bodyGrad)', stroke: '#7d8db3', 'stroke-width': 2.5 }, carIn);
      const arch = el('g', { 'clip-path': 'url(#bodyClip)' }, carIn);
      el('circle', { cx: 190, cy: 200, r: 53, fill: '#05070d' }, arch);
      el('circle', { cx: 620, cy: 200, r: 53, fill: '#05070d' }, arch);
      // glass
      el('path', { d: 'M252 108C270 80 300 64 336 60L342 60L342 110Z', fill: 'url(#glassG)', stroke: '#6f86ad', 'stroke-width': 2 }, carIn);
      el('path', { d: 'M352 60L464 60C498 62 528 84 552 112L352 112Z', fill: 'url(#glassG)', stroke: '#6f86ad', 'stroke-width': 2 }, carIn);
      el('path', { d: 'M347 58L347 205', stroke: '#0a0e1a', 'stroke-width': 3, opacity: .7 }, carIn);
      el('rect', { x: 405, y: 124, width: 46, height: 7, rx: 3.5, fill: '#aab6d3', opacity: .8 }, carIn);
      el('path', { d: 'M62 150L580 128', stroke: '#9fb4ff', 'stroke-width': 2.5, opacity: .55 }, carIn);
      el('rect', { x: 28, y: 152, width: 9, height: 22, rx: 3, fill: '#ff2a44' }, carIn);
      el('path', { d: 'M758 148L784 154L778 166L754 160Z', fill: '#fff6d6' }, carIn);
      // engine bay
      el('path', { d: 'M586 114L744 136L782 162L586 170Z', fill: '#04060b' }, carIn);
      bayGlow = el('circle', { cx: 680, cy: 150, r: 110, fill: glowId('#ffe9a8'), opacity: 0 }, carIn);
      el('rect', { x: 618, y: 138, width: 120, height: 26, rx: 6, fill: '#2b3347', stroke: '#6f86ad' }, carIn);
      for (let i = 0; i < 6; i++) el('rect', { x: ORIGIN[i][0] - 7, y: 126, width: 14, height: 14, rx: 3, fill: FLUID[i] }, carIn);
      wedge = el('path', { d: 'M586 114L744 136L782 162L586 170Z', fill: 'url(#bodyGrad)' }, carIn);
      hood = el('path', { d: 'M586 114L744 136L783 158L779 165L742 146L586 126Z', fill: 'url(#bodyGrad)', stroke: '#9fb4ff', 'stroke-width': 2 }, carIn);
      wheels.push(mkWheel(carIn, 190, 200), mkWheel(carIn, 620, 200));
      // light shafts
      rays = el('path', { d: 'M640 130L560 -330L860 -330L740 130Z', fill: 'url(#fadeV)', opacity: 0, transform: 'scale(1 -1) translate(0 -260)' }, carIn);
      rays.setAttribute('d', 'M650 134L590 -60L860 -60L730 134Z');
      rays.setAttribute('transform', '');
      rays.setAttribute('fill', glowId('#ffe9a8'));
      // orbs
      for (let i = 0; i < 6; i++) {
        const o = el('g', {}, g);
        el('circle', { r: 100, fill: glowId(FLUID[i]), opacity: .8 }, o);
        el('circle', { r: 56, fill: orbId(FLUID[i]) }, o);
        el('circle', { r: 56, fill: 'none', stroke: '#fff', 'stroke-width': 3, opacity: .55 }, o);
        el('ellipse', { cx: -18, cy: -26, rx: 20, ry: 11, fill: '#fff', opacity: .45, transform: 'rotate(-30 -18 -26)' }, o);
        const q = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 5, 'font-size': 66, 'font-weight': 900, fill: '#fff' }, o); q.textContent = '?';
        orbs.push(o);
      }
      // title
      l1 = el('g', {}, g); l2 = el('g', {}, g); emo = el('g', {}, g);
      const mk = (parent, txt, anchor, fill) => { const t = el('text', { 'text-anchor': anchor, 'font-size': 84, 'font-weight': 900, fill, 'letter-spacing': 1 }, parent); t.textContent = txt; return t; };
      mk(l1, 'ЗНАЕТЕ, ЧТО ЭТО', 'middle', '#fff');
      const t2 = mk(l2, 'ЗА ЖИДКОСТИ?', 'middle', 'url(#rainbow)');
      const w2 = t2.getComputedTextLength();
      l2.dataset.w = w2;
      const te = el('text', { 'text-anchor': 'middle', 'font-size': 120 }, emo); te.textContent = '🤔💧';
      this.w2 = w2;
      shakeAt(.85, 7); shakeAt(1.75, 9);
    },
    update(t) {
      // car drive-in
      const dp = eOut4(P(t, 0, .9));
      const off = (1 - dp) * -560;
      let pitch = 0;
      if (t > .85) pitch = 2.2 * Math.exp(-(t - .85) * 5) * Math.sin((t - .85) * 16);
      TF(car, CX + off, CY, SC * (1 + .05 * P(t, 1, 4)), pitch);
      wheels.forEach(w => w.setAttribute('transform', `rotate(${(off / SC / 45 * 57.3).toFixed(2)})`));
      // headlight
      const bl = t > .15 ? (.55 + .1 * Math.sin(t * 40) * (t < .6 ? 1 : 0)) : 0;
      beam.setAttribute('opacity', (bl * P(t, .15, .5)).toFixed(3));
      // hood
      const open = eOut(P(t, 1.0, 1.75));
      const ang = -34 * eBack(P(t, 1.0, 1.75)) * 1;
      hood.setAttribute('transform', `rotate(${ang.toFixed(2)} 588 120)`);
      wedge.setAttribute('opacity', (1 - open).toFixed(3));
      bayGlow.setAttribute('opacity', (open * (.8 + .15 * Math.sin(t * 9))).toFixed(3));
      rays.setAttribute('opacity', (open * .55 * (1 - P(t, 3.0, 3.5))).toFixed(3));
      // title
      const slam = (grp, t0, x, y) => {
        const p = P(t, t0, t0 + .22);
        const s = lerp(2.4, 1, eOut4(p));
        grp.setAttribute('opacity', eOut(P(t, t0, t0 + .08)).toFixed(3));
        TF(grp, x, y, s * (p >= 1 ? 1 + .03 * Math.exp(-(t - t0 - .22) * 10) * Math.sin((t - t0) * 30) : 1), 0);
      };
      const out = 1 - P(t, 3.45, 3.75);
      slam(l1, .35, 540, 300);
      slam(l2, .8, 540, 405);
      const ep = eElastic(P(t, 1.3, 2.0));
      TF(emo, 540, 545, Math.max(.001, ep) * 1, 0);
      emo.setAttribute('opacity', P(t, 1.3, 1.4).toFixed(2));
      [l1, l2, emo].forEach(x => x.setAttribute('opacity', (+x.getAttribute('opacity') * out).toFixed(3)));
      // orbs
      orbs.forEach((o, i) => {
        const t0 = 1.75 + i * .13;
        const p = eOut(P(t, t0, t0 + .8));
        const ox = CX + (ORIGIN[i][0] - 400) * SC * (1 + .05 * P(1.75, 1, 4)), oy = CY + (ORIGIN[i][1] - 150) * SC;
        const fin = FIN(i);
        let x = lerp(ox, fin[0], p), y = lerp(oy, fin[1], p) - Math.sin(p * Math.PI) * 140;
        let s = p * (1 + .05 * Math.sin(t * 5 + i));
        if (p >= 1) y += 12 * Math.sin(t * 3.2 + i * 1.1);
        const im = eIn(P(t, 3.1 + i * .05, 3.7));
        x = lerp(x, 540, im); y = lerp(y, 960, im); s *= 1 - .9 * im;
        TF(o, x, y, Math.max(.001, s), 0);
        o.setAttribute('opacity', (p > 0 ? 1 : 0));
      });
    }
  };
})();
