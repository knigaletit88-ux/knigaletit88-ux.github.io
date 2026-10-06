// ===== Scene 5: gearbox fluid (32–39s) =====
SCENES[5] = (function () {
  const C = ACC[5];
  const G = [
    { x: 230, y: 880, z: 16 },
    { x: 550, y: 880, z: 24 },
    { x: 550 + 288 * Math.cos(40 * Math.PI / 180), y: 880 + 288 * Math.sin(40 * Math.PI / 180), z: 12 }
  ];
  const SHIFTS = [1.3, 2.2, 3.1, 4.0, 4.9];
  const POS = { N: [330, 1355], 1: [180, 1270], 2: [180, 1440], 3: [330, 1270], 4: [330, 1440], 5: [480, 1270] };
  const WP = [[0, 'N'], [.8, 'N'], [1.0, [180, 1355]], [1.3, 1], [1.9, 1], [2.2, 2], [2.5, 2], [2.7, [180, 1355]], [2.9, [330, 1355]], [3.1, 3], [3.7, 3], [4.0, 4], [4.3, 4], [4.5, [330, 1355]], [4.7, [480, 1355]], [4.9, 5], [8, 5]];
  const DT = 1 / 120, theta = [];
  let title, gears = [], knob, digit, dlabel, shield, check, drops = [], burst, aura, sparks = [], ring;
  function omega(t) {
    let k = 0; SHIFTS.forEach((s, i) => { if (t >= s) k = i + 1; });
    const s0 = k ? SHIFTS[k - 1] : 0;
    return 2.0 + .8 * k + 1.7 * eOut(P(t, s0 + .08, s0 + 1.0)) - (k ? .0 : 0) - 1.2 * (1 - P(t, s0, s0 + .12)) * (k ? 1 : 0);
  }
  function gearNow(t) { let k = 0; SHIFTS.forEach((s, i) => { if (t >= s) k = i + 1; }); return k; }
  function knobPos(t) {
    for (let i = 0; i < WP.length - 1; i++) {
      const [t0, a] = WP[i], [t1, b] = WP[i + 1];
      if (t >= t0 && t < t1) {
        const pa = Array.isArray(a) ? a : POS[a], pb = Array.isArray(b) ? b : POS[b];
        const p = eIO(P(t, t0, t1));
        return [lerp(pa[0], pb[0], p), lerp(pa[1], pb[1], p)];
      }
    }
    return POS[5];
  }
  function angOf(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
  return {
    build(g) {
      title = mkTitle(g, 5, ['ЖИДКОСТЬ', 'КПП ⚙️'], C, .25);
      let th = 0; for (let i = 0; i <= 7 * 120; i++) { theta.push(th); th += omega(i * DT) * DT; }
      aura = el('circle', { cx: 480, cy: 960, r: 440, fill: glowId(C), opacity: 0 }, g);
      G.forEach((o, i) => {
        const rp = o.z * 8, g1 = el('g', {}, g);
        o.rp = rp;
        const inner = el('g', {}, g1);
        el('path', { d: gearPath(o.z, rp + 14, rp - 14, 0), fill: 'url(#darkMetal)', stroke: C, 'stroke-width': 5, 'stroke-linejoin': 'round' }, inner);
        el('circle', { r: rp - 26, fill: 'none', stroke: '#8ea0c4', 'stroke-width': 3, opacity: .7 }, inner);
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; el('circle', { cx: Math.cos(a) * rp * .55, cy: Math.sin(a) * rp * .55, r: rp * .17, fill: '#080c17', stroke: '#566282', 'stroke-width': 3 }, inner); }
        el('circle', { r: rp * .3, fill: 'url(#steel)', stroke: '#e6ecf7', 'stroke-width': 3 }, inner);
        el('circle', { r: rp * .1, fill: '#222a3d' }, inner);
        gears.push({ g: g1, inner, o });
      });
      // H pattern
      const hp = el('g', {}, g);
      el('rect', { x: 100, y: 1226, width: 460, height: 250, rx: 36, fill: '#080c17', opacity: .6, stroke: C, 'stroke-opacity': .4, 'stroke-width': 3 }, hp);
      const gate = 'M180 1270V1440M330 1270V1440M480 1270V1355M180 1355H480';
      el('path', { d: gate, stroke: '#0c1222', 'stroke-width': 30, 'stroke-linecap': 'round', fill: 'none' }, hp);
      el('path', { d: gate, stroke: '#2a3250', 'stroke-width': 14, 'stroke-linecap': 'round', fill: 'none' }, hp);
      Object.keys(POS).filter(k => k !== 'N').forEach(k => {
        const p = POS[k], up = p[1] < 1350;
        const tx = el('text', { x: p[0], y: p[1] + (up ? -28 : 56), 'text-anchor': 'middle', 'font-size': 34, 'font-weight': 900, fill: '#fff', opacity: .75 }, hp); tx.textContent = k;
      });
      ring = el('circle', { r: 30, fill: 'none', stroke: C, 'stroke-width': 6, opacity: 0 }, hp);
      knob = el('g', {}, hp);
      el('circle', { r: 50, fill: glowId(C), opacity: .9 }, knob);
      el('circle', { r: 26, fill: orbId(C) }, knob);
      el('circle', { r: 26, fill: 'none', stroke: '#fff', 'stroke-width': 3, opacity: .6 }, knob);
      // digit
      dlabel = el('text', { x: 800, y: 1290, 'text-anchor': 'middle', 'font-size': 32, 'font-weight': 900, fill: '#fff', opacity: .75, 'letter-spacing': 5 }, g); dlabel.textContent = 'ПЕРЕДАЧА';
      digit = el('text', { x: 800, y: 1440, 'text-anchor': 'middle', 'font-size': 190, 'font-weight': 900, fill: C }, g);
      // droplets
      for (let i = 0; i < 9; i++) drops.push(el('path', { d: 'M0,-14C8,-2 10,2 10,6A10,10 0 0 1 -10,6C-10,2 -8,-2 0,-14Z', fill: C }, g));
      // shield
      shield = el('g', {}, g);
      el('circle', { r: 160, fill: glowId('#35e0a1'), opacity: .7 }, shield);
      el('path', { d: 'M0,-96L76,-66L76,2C76,56 34,86 0,106C-34,86 -76,56 -76,2L-76,-66Z', fill: '#1fbf86', stroke: '#fff', 'stroke-width': 6 }, shield);
      el('path', { d: 'M0,-96L76,-66L76,2C76,56 34,86 0,106Z', fill: '#fff', opacity: .14 }, shield);
      check = el('path', { d: 'M-32,4L-8,30L36,-26', fill: 'none', stroke: '#fff', 'stroke-width': 16, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': 120 }, shield);
      this.sl = el('text', { x: 880, y: 860, 'text-anchor': 'middle', 'font-size': 34, 'font-weight': 900, fill: '#35e0a1', 'letter-spacing': 2 }, g); this.sl.textContent = 'ЗАЩИТА ДЕТАЛЕЙ';
      burst = mkBurst(g, { x: 880, y: 700, n: 22, color: ['#fff', '#35e0a1', C], spd: 420, life: .9, grav: 300, size: 9, seed: 4 });
      SHIFTS.forEach(s => shakeAt(SB[5] + s, 4));
      shakeAt(SB[5] + 5.5, 5);
    },
    update(t) {
      title(t);
      const th = theta[Math.min(theta.length - 1, Math.floor(t / DT))];
      const gi = eBack(P(t, .2, .9));
      const al = G.map(o => angOf(o, o)); // placeholder
      const th0 = th;
      const angs = [];
      angs[0] = th0;
      // mesh G0-G1 along +x
      angs[1] = Math.PI - Math.PI / G[1].z - (G[0].z / G[1].z) * th0 + 0;
      // mesh G1-G2 along direction a
      const a = Math.atan2(G[2].y - G[1].y, G[2].x - G[1].x);
      angs[2] = a + Math.PI - Math.PI / G[2].z + (a - angs[1]) * G[1].z / G[2].z;
      gears.forEach((o, i) => {
        TF(o.g, G[i].x, G[i].y, Math.max(.001, gi), 0);
        o.inner.setAttribute('transform', `rotate(${(angs[i] * 57.29578).toFixed(2)})`);
      });
      aura.setAttribute('opacity', (.5 * eOut(P(t, 5.3, 6.0))).toFixed(2));
      // drops
      drops.forEach((d, i) => {
        const per = 1.3 + rnd(i) * .6, ph = (((t - .9) / per + rnd(i * 3)) % 1 + 1) % 1;
        const src = G[i % 3];
        const x = src.x + (rnd(i * 7) - .5) * src.rp * 1.5, y = lerp(src.y + src.rp * .6, 1210, ph * ph);
        TF(d, x, y, .5 * P(t, .9, 1.2), 0);
        d.setAttribute('opacity', (P(t, .9, 1.2) * Math.sin(ph * Math.PI) * .85).toFixed(2));
      });
      // shifter
      const kp = knobPos(t);
      TF(knob, kp[0], kp[1], 1 + .1 * Math.sin(t * 10), 0);
      knob.setAttribute('opacity', eOut(P(t, .3, .8)).toFixed(2));
      const gn = gearNow(t);
      let sa = -9; SHIFTS.forEach(s => { if (t - s >= 0 && t - s < .6) sa = t - s; });
      const sp = sa >= 0 ? sa / .6 : 1;
      set(ring, { cx: kp[0], cy: kp[1], r: 30 + 70 * sp, opacity: sa >= 0 ? (1 - sp).toFixed(2) : 0 });
      digit.textContent = gn === 0 ? 'N' : String(gn);
      const pop = sa >= 0 ? 1 + .35 * Math.exp(-sa * 9) * Math.cos(sa * 16) : 1;
      digit.setAttribute('transform', `translate(800 ${gn === 0 ? 1440 : 1440}) scale(${pop.toFixed(3)}) translate(-800 -1440)`);
      digit.setAttribute('opacity', eOut(P(t, .3, .8)).toFixed(2));
      dlabel.setAttribute('opacity', (.75 * eOut(P(t, .3, .8))).toFixed(2));
      // shield
      const ss = P(t, 5.5, 6.3);
      TF(shield, 880, 700, Math.max(.001, eElastic(ss)) * .8, 0);
      shield.setAttribute('opacity', P(t, 5.5, 5.6).toFixed(2));
      check.setAttribute('stroke-dashoffset', (120 * (1 - eOut(P(t, 5.8, 6.3)))).toFixed(1));
      this.sl.setAttribute('opacity', eOut(P(t, 6.0, 6.4)).toFixed(2));
      burst(t - 5.55);
    }
  };
})();
