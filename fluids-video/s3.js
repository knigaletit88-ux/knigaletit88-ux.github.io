// ===== Scene 3: brake fluid (18–25s) =====
SCENES[3] = (function () {
  const C = ACC[3];
  const D = [650, 1040], R = 240;
  const PIPE = 'M340 1010H400V700H940V950';
  let title, disc, ghost, heatRing, caliper, arrows = [], pedal, pedalPad, pulses = [], pipeFill, pipePath, stopG, sparks = [], thetaArr = [], speed, speedLbl, masterGlow, safe, flashS, pressureLbl, burstStop;
  const DT = 1 / 120;
  function omega(t) { return 7.5 * (1 - eIO(P(t, 2.35, 4.3))); }
  return {
    build(g) {
      title = mkTitle(g, 3, ['ТОРМОЗНАЯ', 'ЖИДКОСТЬ 🛑'], C, .25);
      // precompute disc angle
      let th = 0; for (let i = 0; i <= 7 * 120; i++) { thetaArr.push(th); th += omega(i * DT) * DT; }
      // pipe
      el('path', { d: PIPE, fill: 'none', stroke: '#0c1222', 'stroke-width': 44, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      el('path', { d: PIPE, fill: 'none', stroke: '#3a2430', 'stroke-width': 26, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      pipePath = el('path', { d: PIPE, fill: 'none', stroke: '#ff3b5c', 'stroke-width': 26, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      this.len = pipePath.getTotalLength();
      pipePath.setAttribute('stroke-dasharray', `${this.len} ${this.len}`);
      for (let i = 0; i < 6; i++) {
        const gp = el('g', {}, g);
        el('circle', { r: 36, fill: glowId('#ff8fa3'), opacity: .9 }, gp);
        el('circle', { r: 10, fill: '#fff' }, gp);
        pulses.push(gp);
      }
      pressureLbl = el('text', { x: 670, y: 664, 'text-anchor': 'middle', 'font-size': 32, 'font-weight': 900, fill: '#fff', 'letter-spacing': 5, opacity: .8 }, g);
      pressureLbl.textContent = 'ДАВЛЕНИЕ ЖИДКОСТИ';
      // master cylinder
      masterGlow = el('circle', { cx: 270, cy: 1010, r: 120, fill: glowId('#ff3b5c'), opacity: 0 }, g);
      el('rect', { x: 190, y: 984, width: 150, height: 52, rx: 14, fill: 'url(#steel)', stroke: '#8ea0c4', 'stroke-width': 3 }, g);
      el('rect', { x: 215, y: 948, width: 60, height: 40, rx: 8, fill: '#ff3b5c' }, g);
      el('rect', { x: 150, y: 997, width: 46, height: 26, rx: 8, fill: '#c9d3e6' }, g);
      // pedal
      pedal = el('g', { transform: 'translate(160 1130)' }, g);
      el('line', { x1: 0, y1: 0, x2: 90, y2: 250, stroke: '#aab6d3', 'stroke-width': 22, 'stroke-linecap': 'round' }, pedal);
      pedalPad = el('g', { transform: 'translate(90 250) rotate(-20)' }, pedal);
      el('rect', { x: -66, y: -22, width: 132, height: 44, rx: 12, fill: '#1a2238', stroke: '#ff3b5c', 'stroke-width': 4 }, pedalPad);
      for (let i = -3; i <= 3; i++) el('rect', { x: i * 16 - 3, y: -12, width: 6, height: 24, rx: 3, fill: '#ff3b5c', opacity: .6 }, pedalPad);
      el('circle', { r: 16, fill: '#fff', transform: 'translate(160 1130)' }, g);
      const pl = el('text', { x: 190, y: 1500, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 900, fill: '#fff', opacity: .8, 'letter-spacing': 4 }, g); pl.textContent = 'ПЕДАЛЬ';
      // disc
      const dg = el('g', { transform: `translate(${D[0]} ${D[1]})` }, g);
      el('circle', { r: R + 30, fill: glowId('#ff3b5c'), opacity: .25 }, dg);
      heatRing = el('circle', { r: R + 6, fill: 'none', stroke: '#ff7a2a', 'stroke-width': 18, opacity: 0 }, dg);
      disc = el('g', {}, dg);
      el('circle', { r: R, fill: 'url(#steel)', stroke: '#e6ecf7', 'stroke-width': 3 }, disc);
      el('circle', { r: R - 22, fill: 'none', stroke: '#6a7690', 'stroke-width': 3 }, disc);
      for (let i = 0; i < 20; i++) el('rect', { x: 150, y: -6, width: 70, height: 12, rx: 6, fill: '#262f45', transform: `rotate(${i * 18})` }, disc);
      el('circle', { r: 130, fill: '#323c55', stroke: '#8ea0c4', 'stroke-width': 4 }, disc);
      el('circle', { r: 96, fill: 'url(#darkMetal)', stroke: '#c9d3e6', 'stroke-width': 3 }, disc);
      for (let i = 0; i < 5; i++) { const a = i * 72 * Math.PI / 180; el('circle', { cx: 62 * Math.cos(a), cy: 62 * Math.sin(a), r: 12, fill: '#e6ecf7' }, disc); }
      el('circle', { r: 28, fill: '#c9d3e6' }, disc);
      ghost = el('g', { opacity: 0 }, dg);
      for (let i = 0; i < 20; i++) el('rect', { x: 150, y: -5, width: 70, height: 10, rx: 5, fill: '#fff', opacity: .55, transform: `rotate(${i * 18 + 9})` }, ghost);
      // caliper
      caliper = el('g', { transform: `translate(${D[0] + R - 20} ${D[1]})` }, g);
      el('rect', { x: -70, y: -92, width: 150, height: 184, rx: 28, fill: '#ff3b5c', stroke: '#fff', 'stroke-width': 4 }, caliper);
      el('rect', { x: -70, y: -92, width: 50, height: 184, rx: 28, fill: '#fff', opacity: .22 }, caliper);
      el('rect', { x: -26, y: -64, width: 70, height: 128, rx: 14, fill: '#05070d', opacity: .85 }, caliper);
      [-1, 1].forEach(s => arrows.push(el('path', { d: 'M-12,-14L12,0L-12,14Z', fill: '#fff', transform: `translate(${s * 56} 0) scale(${-s} 1)` }, caliper)));
      // sparks
      for (let i = 0; i < 16; i++) sparks.push(el('circle', { r: 5, fill: '#ffd36a' }, g));
      // speed
      speed = el('text', { x: 760, y: 1470, 'text-anchor': 'end', 'font-size': 130, 'font-weight': 900, fill: '#fff' }, g);
      speedLbl = el('text', { x: 780, y: 1470, 'text-anchor': 'start', 'font-size': 40, 'font-weight': 900, fill: '#fff', opacity: .7, 'letter-spacing': 3 }, g);
      speedLbl.textContent = 'км/ч';
      // stop
      stopG = el('g', {}, g);
      el('circle', { r: 150, fill: glowId('#ff3b5c'), opacity: .9 }, stopG);
      const pts = []; for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; pts.push((98 * Math.cos(a)).toFixed(1) + ',' + (98 * Math.sin(a)).toFixed(1)); }
      el('polygon', { points: pts.join(' '), fill: '#e8203f', stroke: '#fff', 'stroke-width': 8, 'stroke-linejoin': 'round' }, stopG);
      const st = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 4, 'font-size': 52, 'font-weight': 900, fill: '#fff', 'letter-spacing': 1 }, stopG); st.textContent = 'СТОП';
      burstStop = mkBurst(g, { x: 230, y: 830, n: 22, color: ['#fff', '#ff3b5c', '#ffd36a'], spd: 420, life: .8, grav: 300, size: 9, seed: 3 });
      // safety pill
      safe = el('g', {}, g);
      el('rect', { x: -250, y: -42, width: 500, height: 84, rx: 42, fill: '#0a1020', stroke: '#35e0a1', 'stroke-width': 4 }, safe);
      el('circle', { cx: -200, r: 26, fill: '#35e0a1' }, safe);
      el('path', { d: 'M-212,0L-203,10L-186,-10', fill: 'none', stroke: '#fff', 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, safe);
      const sl = el('text', { x: 20, y: 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 38, 'font-weight': 900, fill: '#fff', 'letter-spacing': 3 }, safe); sl.textContent = 'БЕЗОПАСНОСТЬ';
      shakeAt(SB[3] + 2.35, 7); shakeAt(SB[3] + 4.3, 12);
    },
    update(t) {
      title(t);
      const idx = Math.min(thetaArr.length - 1, Math.max(0, Math.floor(t / DT)));
      const th = thetaArr[idx] * 57.2958;
      disc.setAttribute('transform', `rotate(${th.toFixed(2)})`);
      const w = omega(t) / 7.5;
      ghost.setAttribute('transform', `rotate(${(th * 1.0).toFixed(1)})`);
      ghost.setAttribute('opacity', (.55 * w * w).toFixed(2));
      const brake = P(t, 2.35, 2.6) * (1 - P(t, 5.2, 6.6));
      heatRing.setAttribute('opacity', (brake * (1 - .5 * (1 - w)) * (.6 + .3 * Math.sin(t * 20))).toFixed(2));
      // pedal press
      const press = eOut(P(t, 1.0, 1.3)) * (1 - eIO(P(t, 4.6, 5.4)));
      pedal.setAttribute('transform', `translate(160 1130) rotate(${(-13 * press).toFixed(2)})`);
      // pulses
      const front = eIO(P(t, 1.35, 2.45));
      pipePath.setAttribute('stroke-dashoffset', (this.len * (1 - front)).toFixed(1));
      masterGlow.setAttribute('opacity', (.9 * Math.exp(-Math.max(0, t - 1.3) * 3) * P(t, 1.28, 1.36)).toFixed(2));
      pulses.forEach((p, i) => {
        const a = P(t, 1.35 + i * .13, 2.45 + i * .02);
        const on = a > 0 && a < 1;
        if (on) { const pt = pipePath.getPointAtLength(this.len * eIO(a)); TF(p, pt.x, pt.y, 1, 0); }
        p.setAttribute('opacity', on ? 1 : 0);
      });
      // caliper
      const cl = eOut(P(t, 2.35, 2.55)) * (1 - P(t, 5.0, 5.6) * .8);
      caliper.setAttribute('transform', `translate(${D[0] + R - 20} ${D[1]}) scale(${(1 - .06 * cl).toFixed(3)} 1)`);
      arrows.forEach((a, i) => { const s = i ? 1 : -1; a.setAttribute('transform', `translate(${s * (56 - 16 * cl)} 0) scale(${-s} 1)`); a.setAttribute('opacity', (.4 + .6 * cl).toFixed(2)); });
      // sparks
      sparks.forEach((s, i) => {
        const per = .28 + .06 * (i % 5), ph = (t / per + rnd(i * 3)) % 1;
        const amp = brake * Math.min(1, w * 1.6 + .15) * P(t, 2.35, 2.5);
        const vy = 40 + 90 * rnd(i * 5), vx = 130 + 150 * rnd(i * 7);
        set(s, { cx: (D[0] + R - 22 + ph * vx).toFixed(1), cy: (D[1] + 40 * (rnd(i * 9) - .5) + ph * vy + ph * ph * 160).toFixed(1), r: (6 * (1 - ph) * amp).toFixed(2), opacity: (amp * (1 - ph)).toFixed(2), fill: ph < .4 ? '#fff3c4' : '#ff8a3c' });
      });
      // speed readout
      const v = 120 * (1 - eIO(P(t, 2.35, 4.3)));
      speed.textContent = Math.round(v);
      speed.setAttribute('fill', mixc('#ffffff', '#ff5a73', 1 - clamp(v / 120)));
      const sp = eOut(P(t, .9, 1.4));
      speed.setAttribute('opacity', sp.toFixed(2)); speedLbl.setAttribute('opacity', (.7 * sp).toFixed(2));
      // stop
      const so = P(t, 4.3, 4.65);
      TF(stopG, 230, 830, Math.max(.001, lerp(3, 1, eOut4(so))) * (so >= 1 ? 1 + .04 * Math.exp(-(t - 4.65) * 8) * Math.sin(t * 30) : 1), (1 - so) * -14);
      stopG.setAttribute('opacity', P(t, 4.3, 4.4).toFixed(2));
      burstStop(t - 4.4);
      FX.flash += .22 * Math.exp(-Math.max(0, t - 4.3) * 14) * (t >= 4.3 ? 1 : 0);
      // safety
      const sf = eBack(P(t, 5.0, 5.6));
      TF(safe, 540, 580, Math.max(.001, sf), 0);
      pressureLbl.setAttribute('opacity', (.8 * (1 - P(t, 4.6, 5.0))).toFixed(2));
    }
  };
})();
