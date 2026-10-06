// ===== Scene 1: oil (4–11s) =====
SCENES[1] = (function () {
  const C = ACC[1];
  const CXS = [340, 540, 740], CRANK_Y = 1215, R = 45, L = 110;
  let title, engine, pistons = [], rods = [], cranks = [], film = [], sparks = [], drips = [], oilWave, oilClip, jug, jugBody, stream, streamHi, heat, shield, check, burst, bars = {}, pan, glint;
  const PORT = [700, 900];
  function jugPos(t) {
    // enter 0.6–1.2, tilt 1.2–1.9, tilt back 4.3–4.9, exit 4.9–5.5
    const enter = eOut(P(t, .6, 1.3)), exit = eIn(P(t, 4.6, 5.2));
    const tilt = eBack(P(t, 1.2, 1.9)) - eIO(P(t, 4.0, 4.6));
    const x = lerp(1250, 800, enter) + exit * 500, y = 690 - exit * 160;
    return { x, y, rot: -76 * tilt };
  }
  function spoutTip(j) {
    const a = j.rot * Math.PI / 180, lx = -86, ly = -60;
    return [j.x + lx * Math.cos(a) - ly * Math.sin(a), j.y + lx * Math.sin(a) + ly * Math.cos(a)];
  }
  function waveD(x0, x1, y, amp, ph, bottom) {
    let d = `M${x0},${bottom}L${x0},${y}`;
    for (let x = x0; x <= x1; x += 20) d += `L${x},${(y + amp * Math.sin(x / 38 + ph)).toFixed(1)}`;
    return d + `L${x1},${bottom}Z`;
  }
  return {
    build(g) {
      title = mkTitle(g, 1, ['МОТОРНОЕ', 'МАСЛО 🛢️'], C, .25);
      engine = el('g', {}, g);
      // block
      el('rect', { x: 200, y: 890, width: 680, height: 400, rx: 36, fill: 'url(#darkMetal)', stroke: '#8ea0c4', 'stroke-width': 4 }, engine);
      el('rect', { x: 226, y: 916, width: 628, height: 350, rx: 24, fill: '#080c17' }, engine);
      heat = el('rect', { x: 226, y: 916, width: 628, height: 350, rx: 24, fill: '#ff4d2e', opacity: 0 }, engine);
      // oil filler neck
      el('rect', { x: PORT[0] - 26, y: 860, width: 52, height: 40, rx: 8, fill: 'url(#steel)' }, engine);
      el('rect', { x: PORT[0] - 34, y: 850, width: 68, height: 18, rx: 6, fill: '#c9d3e6' }, engine);
      // oil pan
      pan = el('path', { d: 'M250 1290L810 1290L780 1405Q776 1420 760 1420L300 1420Q284 1420 280 1405Z', fill: 'url(#darkMetal)', stroke: '#8ea0c4', 'stroke-width': 4 }, engine);
      const cpid = 'panClip'; const cp = el('clipPath', { id: cpid }, defs);
      el('path', { d: 'M262 1294L798 1294L772 1402Q770 1410 760 1410L300 1410Q290 1410 288 1402Z' }, cp);
      const panIn = el('g', { 'clip-path': 'url(#panClip)' }, engine);
      el('rect', { x: 240, y: 1290, width: 600, height: 130, fill: '#05070d' }, panIn);
      oilWave = el('path', { fill: C, opacity: .95 }, panIn);
      glint = el('path', { fill: '#fff', opacity: .25 }, panIn);
      // cylinders
      CXS.forEach((cx, i) => {
        el('rect', { x: cx - 64, y: 950, width: 128, height: 236, rx: 10, fill: '#121a2e', stroke: '#566282', 'stroke-width': 3 }, engine);
        // oil film on walls
        const f = el('g', {}, engine);
        el('rect', { x: cx - 66, y: 952, width: 6, height: 232, rx: 3, fill: C }, f);
        el('rect', { x: cx + 60, y: 952, width: 6, height: 232, rx: 3, fill: C }, f);
        film.push(f);
        // rod, piston
        rods.push(el('line', { stroke: '#b7c3dc', 'stroke-width': 14, 'stroke-linecap': 'round' }, engine));
        const p = el('g', {}, engine);
        el('rect', { x: -56, y: -32, width: 112, height: 66, rx: 8, fill: 'url(#steel)' }, p);
        [-14, -3, 8].forEach(yy => el('rect', { x: -56, y: yy - 14, width: 112, height: 4, fill: '#2a3347' }, p));
        el('circle', { r: 9, fill: '#2a3347', cy: 12 }, p);
        pistons.push(p);
        // crank
        const c = el('g', { transform: `translate(${cx} ${CRANK_Y})` }, engine);
        const cr = el('g', {}, c);
        el('circle', { r: 40, fill: '#4a566e', stroke: '#8ea0c4', 'stroke-width': 3 }, cr);
        el('circle', { r: 16, fill: '#222a3d' }, cr);
        el('circle', { cy: -R, r: 14, fill: '#c9d3e6' }, cr);
        cranks.push(cr);
        // sparks
        for (let k = 0; k < 6; k++) sparks.push({ i, k, e: el('circle', { r: 5, fill: '#ffb347' }, engine) });
      });
      // drips
      for (let k = 0; k < 9; k++) drips.push(el('path', { d: 'M0,-14C8,-2 10,2 10,6A10,10 0 0 1 -10,6C-10,2 -8,-2 0,-14Z', fill: C }, engine));
      // jug
      jug = el('g', {}, g);
      jugBody = el('g', {}, jug);
      el('circle', { r: 150, fill: glowId(C), opacity: .35 }, jugBody);
      el('path', { d: 'M70,-10C130,-20 140,70 70,90', fill: 'none', stroke: '#e4eaf7', 'stroke-width': 18, 'stroke-linecap': 'round' }, jugBody);
      el('rect', { x: -92, y: -22, width: 184, height: 200, rx: 30, fill: C }, jugBody);
      el('rect', { x: -92, y: -22, width: 60, height: 200, rx: 30, fill: '#fff', opacity: .22 }, jugBody);
      el('rect', { x: -94, y: -50, width: 70, height: 36, rx: 8, fill: '#e4eaf7' }, jugBody);
      el('rect', { x: -88, y: -62, width: 58, height: 18, rx: 5, fill: '#2a3347' }, jugBody);
      el('rect', { x: -60, y: 36, width: 150, height: 92, rx: 14, fill: '#0b1020', opacity: .85 }, jugBody);
      const lab = el('text', { x: 15, y: 98, 'text-anchor': 'middle', 'font-size': 44, 'font-weight': 900, fill: '#fff' }, jugBody); lab.textContent = '5W-30';
      el('rect', { x: -60, y: 136, width: 150, height: 8, rx: 4, fill: '#fff', opacity: .55 }, jugBody);
      stream = el('path', { fill: 'none', stroke: C, 'stroke-width': 18, 'stroke-linecap': 'round', 'stroke-dasharray': '70 14' }, g);
      streamHi = el('path', { fill: 'none', stroke: '#fff', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: .55, 'stroke-dasharray': '50 34' }, g);
      // meters
      const mk = (y, label, col) => {
        const lt = el('text', { x: 100, y: y - 14, 'font-size': 32, 'font-weight': 800, fill: '#fff', opacity: .85, 'letter-spacing': 3 }, g); lt.textContent = label;
        el('rect', { x: 100, y, width: 440, height: 34, rx: 17, fill: '#fff', opacity: .12 }, g);
        const f = el('rect', { x: 100, y, height: 34, rx: 17, fill: col }, g);
        return f;
      };
      bars.fr = mk(595, 'ТРЕНИЕ', '#ff5a36'); bars.pr = mk(690, 'ЗАЩИТА', '#35e0a1');
      // shield
      shield = el('g', {}, g);
      el('circle', { r: 160, fill: glowId('#35e0a1'), opacity: .75 }, shield);
      el('path', { d: 'M0,-96L76,-66L76,2C76,56 34,86 0,106C-34,86 -76,56 -76,2L-76,-66Z', fill: '#1fbf86', stroke: '#fff', 'stroke-width': 6 }, shield);
      el('path', { d: 'M0,-96L76,-66L76,2C76,56 34,86 0,106Z', fill: '#fff', opacity: .14 }, shield);
      check = el('path', { d: 'M-32,4L-8,30L36,-26', fill: 'none', stroke: '#fff', 'stroke-width': 16, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': 120 }, shield);
      burst = mkBurst(g, { x: 800, y: 700, n: 22, color: ['#fff', '#35e0a1', C], spd: 420, life: .9, grav: 300, size: 9, seed: 5 });
      this.lab = el('text', { x: 800, y: 870, 'text-anchor': 'middle', 'font-size': 40, 'font-weight': 900, fill: '#35e0a1', 'letter-spacing': 2 }, g);
      this.lab.textContent = 'ЗАЩИТА';
      shakeAt(SB[1] + 5.35, 6);
    },
    update(t) {
      title(t);
      // engine intro + vibration while dry
      const ein = eOut(P(t, .1, .6));
      const dry = 1 - P(t, 2.2, 4.0);
      const jx = (rnd(Math.floor(t * 30)) - .5) * 6 * dry, jy = (rnd(Math.floor(t * 30) + 9) - .5) * 5 * dry;
      engine.setAttribute('transform', `translate(${jx.toFixed(2)} ${(jy + (1 - ein) * 80).toFixed(2)})`);
      engine.setAttribute('opacity', ein.toFixed(3));
      const w = (t * 2 * Math.PI * 1.9) * (1 + .0);
      CXS.forEach((cx, i) => {
        const a = w + i * 2.094;
        const cpx = cx + R * Math.sin(a), cpy = CRANK_Y - R * Math.cos(a);
        const py = CRANK_Y - R * Math.cos(a) - Math.sqrt(L * L - R * R * Math.sin(a) * Math.sin(a));
        TF(pistons[i], cx, py - 4, 1, 0);
        set(rods[i], { x1: cx, y1: py, x2: cpx.toFixed(1), y2: cpy.toFixed(1) });
        cranks[i].setAttribute('transform', `rotate(${(a * 57.2958).toFixed(1)})`);
        film[i].setAttribute('opacity', eOut(P(t, 2.0 + i * .3, 3.8)).toFixed(3));
        // pistons also recorded for sparks
        sparks.filter(s => s.i === i).forEach(s => {
          const per = .22 + .05 * s.k, ph = (t / per + rnd(i * 10 + s.k)) % 1;
          const side = s.k % 2 ? 1 : -1;
          const amp = dry * P(t, .25, .5);
          const x = cx + side * (62 + ph * 36 * side * side), y = py + 20 - ph * 36 + ph * ph * 80;
          set(s.e, { cx: x.toFixed(1), cy: y.toFixed(1), r: (5 * (1 - ph) * amp).toFixed(2), opacity: (amp * (1 - ph)).toFixed(2), fill: ph < .35 ? '#fff3c4' : '#ff7a3c' });
        });
      });
      heat.setAttribute('opacity', (.22 * dry * (.7 + .3 * Math.sin(t * 22))).toFixed(3));
      // oil level
      const lvl = eOut(P(t, 1.9, 4.5));
      const y = lerp(1405, 1330, lvl);
      oilWave.setAttribute('d', waveD(240, 840, y, 5, t * 4, 1420));
      glint.setAttribute('d', waveD(240, 840, y + 2, 1.5, t * 4, y + 6));
      // drips
      drips.forEach((d, k) => {
        const act = P(t, 2.1, 2.6) * (1 - P(t, 4.6, 5.2));
        const per = 1.1, ph = ((t - 2.1 - k * .13) / per % 1 + 1) % 1;
        const x = 280 + (k + .5) * 62, yy = lerp(930, 1300, ph * ph);
        TF(d, x, yy, .55 * act, 0);
        d.setAttribute('opacity', (act * (1 - P(ph, .85, 1)) * .9).toFixed(2));
      });
      // jug + stream
      const j = jugPos(t);
      TF(jug, j.x, j.y, 1, 0);
      jugBody.setAttribute('transform', `rotate(${j.rot.toFixed(2)})`);
      const flow = P(t, 1.7, 1.95) * (1 - P(t, 3.9, 4.2));
      if (flow > 0.01) {
        const tip = spoutTip(j);
        const d = `M${tip[0].toFixed(1)},${tip[1].toFixed(1)}Q${(tip[0] - 14).toFixed(1)},${(tip[1] + 80).toFixed(1)} ${PORT[0]},${PORT[1] - 10}`;
        set(stream, { d, opacity: flow.toFixed(2), 'stroke-width': (18 * flow).toFixed(1), 'stroke-dashoffset': (-t * 260).toFixed(1) });
        set(streamHi, { d, opacity: (.55 * flow).toFixed(2), 'stroke-dashoffset': (-t * 300).toFixed(1) });
      } else { stream.setAttribute('opacity', 0); streamHi.setAttribute('opacity', 0); }
      jug.setAttribute('opacity', (1 - P(t, 4.9, 5.2)).toFixed(2));
      // meters
      const mi = eOut(P(t, 1.0, 1.5));
      const fr = lerp(1, .12, eIO(P(t, 2.4, 4.6)));
      const pr = lerp(.08, 1, eIO(P(t, 2.4, 4.6)));
      set(bars.fr, { width: (440 * fr * mi).toFixed(1), fill: mixc('#35e0a1', '#ff4a30', clamp(fr * 1.4)) });
      set(bars.pr, { width: (440 * pr * mi).toFixed(1) });
      // shield
      const sp = P(t, 5.3, 6.1);
      TF(shield, 800, 700, Math.max(.001, eElastic(sp)) * .9, 0);
      shield.setAttribute('opacity', P(t, 5.3, 5.4).toFixed(2));
      check.setAttribute('stroke-dashoffset', (120 * (1 - eOut(P(t, 4.8, 5.3)))).toFixed(1));
      burst(t - 4.55);
      this.lab.setAttribute('opacity', eOut(P(t, 5.8, 6.2)).toFixed(2));
    }
  };
})();
