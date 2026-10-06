// ===== Scene 7: finale (46–55s) =====
SCENES[7] = (function () {
  const WORDS = ['МАСЛО', 'АНТИФРИЗ', 'ТОРМОЗНАЯ', 'ГУР', 'КОРОБКА', 'ОМЫВАЙКА'];
  const ROWS = ['МАСЛО 🛢️', 'АНТИФРИЗ ❄️', 'ТОРМОЗНАЯ 🛑', 'ГУР 🛞', 'КОРОБКА ⚙️', 'ОМЫВАЙКА 💦'];
  let cardG, cards = [], listG, rows = [], head, cta1, cta2, burst, raysG;
  return {
    build(g) {
      // montage cards
      cardG = el('g', {}, g);
      WORDS.forEach((w, i) => {
        const c = FLUID[i], cg = el('g', {}, cardG);
        el('rect', { width: W, height: H, fill: shade(c, -.72) }, cg);
        const rays = el('g', { transform: 'translate(540 860)' }, cg);
        for (let k = 0; k < 16; k++) el('path', { d: 'M0,0L-90,-1400L90,-1400Z', fill: c, opacity: .13, transform: `rotate(${k * 22.5})` }, rays);
        el('circle', { cx: 540, cy: 860, r: 360, fill: glowId(c), opacity: .9 }, cg);
        const ring = el('circle', { cx: 540, cy: 860, r: 300, fill: 'none', stroke: c, 'stroke-width': 14 }, cg);
        const ic = el('g', {}, cg); icon(i, ic, c, 420);
        el('circle', { r: 1 }, ic).setAttribute('opacity', 0);
        const tx = el('text', { x: 540, y: 1260, 'text-anchor': 'middle', 'font-size': 128, 'font-weight': 900, fill: '#fff', 'letter-spacing': 2 }, cg); tx.textContent = w;
        const bar = el('rect', { x: 240, y: 1300, height: 14, rx: 7, fill: c }, cg);
        const num = el('text', { x: 540, y: 520, 'text-anchor': 'middle', 'font-size': 90, 'font-weight': 900, fill: c, opacity: .9 }, cg); num.textContent = String(i + 1) + ' / 6';
        cards.push({ g: cg, rays, ring, ic, tx, bar, num });
      });
      // list
      listG = el('g', {}, g);
      head = el('g', {}, listG);
      const h1 = el('text', { x: 540, y: 400, 'text-anchor': 'middle', 'font-size': 112, 'font-weight': 900, fill: 'url(#rainbow)' }, head); h1.textContent = '6 ЖИДКОСТЕЙ';
      const h2 = el('text', { x: 540, y: 470, 'text-anchor': 'middle', 'font-size': 36, 'font-weight': 800, fill: '#fff', opacity: .7, 'letter-spacing': 8 }, head); h2.textContent = 'ВАЖНЫХ В АВТОМОБИЛЕ';
      ROWS.forEach((r, i) => {
        const c = FLUID[i], y = 540 + i * 138;
        const rg = el('g', {}, listG);
        el('rect', { x: 100, y: y, width: 880, height: 112, rx: 56, fill: '#0a1020', opacity: .92, stroke: c, 'stroke-width': 4 }, rg);
        const glow = el('rect', { x: 100, y: y, width: 880, height: 112, rx: 56, fill: c, opacity: 0 }, rg);
        el('circle', { cx: 156, cy: y + 56, r: 44, fill: c }, rg);
        const ig = el('g', { transform: `translate(156 ${y + 56})` }, rg); icon(i, ig, '#fff', 58);
        const t = el('text', { x: 230, y: y + 76, 'font-size': 58, 'font-weight': 900, fill: '#fff', 'letter-spacing': 1 }, rg); t.textContent = r;
        rows.push({ g: rg, glow, y });
      });
      cta1 = el('text', { x: 540, y: 1500, 'text-anchor': 'middle', 'font-size': 44, 'font-weight': 900, fill: '#fff', 'letter-spacing': 2 }, g); cta1.textContent = 'ПРОВЕРЯЙ ЖИДКОСТИ ВОВРЕМЯ 🔧';
      cta2 = el('g', {}, g);
      el('rect', { x: -340, y: -52, width: 680, height: 104, rx: 52, fill: '#FFC857' }, cta2);
      const ct = el('text', { x: 0, y: 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 52, 'font-weight': 900, fill: '#10141f', 'letter-spacing': 2 }, cta2); ct.textContent = '🔔 ПОДПИСЫВАЙСЯ';
      burst = mkBurst(g, { x: 540, y: 1640, n: 40, color: FLUID.concat(['#fff']), spd: 700, life: 1.2, grav: 600, size: 10, seed: 17, spread: Math.PI * 1.4 });
    },
    update(t) {
      // montage
      const inMont = t < 3.05;
      cardG.setAttribute('display', inMont ? 'inline' : 'none');
      if (inMont) {
        const i = Math.min(5, Math.floor(t / .5)), p = (t - i * .5) / .5;
        cards.forEach((c, k) => c.g.setAttribute('display', k === i ? 'inline' : 'none'));
        const c = cards[i];
        const s = lerp(1.5, 1, eOut4(P(p, 0, .4))) * (1 + .06 * p);
        TF(c.ic, 540, 860, s, (1 - eOut4(P(p, 0, .4))) * -12);
        c.rays.setAttribute('transform', `translate(540 860) rotate(${(t * 25).toFixed(1)})`);
        set(c.ring, { r: 220 + 300 * eOut(P(p, 0, .7)), opacity: (1 - P(p, 0, .7)).toFixed(2) });
        const ty = lerp(120, 0, eOut4(P(p, .05, .4)));
        c.tx.setAttribute('transform', `translate(0 ${ty})`); c.tx.setAttribute('opacity', P(p, .05, .2).toFixed(2));
        set(c.bar, { width: (600 * eOut(P(p, .1, .5))), x: 240 });
        c.num.setAttribute('opacity', (.9 * P(p, .1, .25)).toFixed(2));
        FX.flash += .4 * Math.exp(-(p * .5) * 16);
        cardG.setAttribute('opacity', (1 - eIn(P(t, 2.85, 3.05))).toFixed(2));
      }
      // list
      const lp = P(t, 3.0, 3.5);
      listG.setAttribute('display', t >= 3.0 ? 'inline' : 'none');
      TF(head, 0, 0, 1, 0);
      head.setAttribute('opacity', eOut(lp).toFixed(2));
      head.setAttribute('transform', `translate(0 ${(1 - eOut4(lp)) * -40})`);
      rows.forEach((r, i) => {
        const t0 = 3.45 + i * .5, p = eOut4(P(t, t0, t0 + .5));
        const dir = i % 2 ? 1 : -1;
        const over = P(t, t0 + .5, t0 + .8);
        r.g.setAttribute('transform', `translate(${(dir * 1000 * (1 - p)).toFixed(1)} 0)`);
        r.g.setAttribute('opacity', P(t, t0, t0 + .1).toFixed(2));
        const wv = P(t, 6.5 + i * .12, 6.7 + i * .12) * (1 - P(t, 6.7 + i * .12, 7.1 + i * .12));
        r.glow.setAttribute('opacity', (.55 * wv + .3 * Math.exp(-Math.max(0, t - t0 - .45) * 9) * (t >= t0 + .45 ? 1 : 0)).toFixed(2));
      });
      const cp = eBack(P(t, 7.2, 7.8));
      cta1.setAttribute('opacity', eOut(P(t, 7.0, 7.4)).toFixed(2));
      TF(cta2, 540, 1640, Math.max(.001, cp) * (1 + .03 * Math.sin(Math.max(0, t - 7.9) * 6)), 0);
      cta2.setAttribute('opacity', P(t, 7.2, 7.3).toFixed(2));
      burst(t - 7.3);
      // final fade
      FX.flash += 0;
    }
  };
})();
