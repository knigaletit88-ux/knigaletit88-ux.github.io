// usage: node render.js frames_dir [fps] [workers]   -> renders every frame as JPEG
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const [out, fpsArg, wArg] = process.argv.slice(2);
const FPS = +(fpsArg || 30), WORKERS = +(wArg || 4), DUR = 55, N = FPS * DUR;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  let next = 0;
  async function worker(id) {
    const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
    p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.goto('file://' + path.resolve(__dirname, 'index.html') + '?t=0');
    while (true) {
      const i = next++; if (i >= N) break;
      const f = path.join(out, `f${String(i).padStart(5, '0')}.jpg`);
      if (fs.existsSync(f)) continue;
      await p.evaluate(t => renderFrame(t), i / FPS);
      await p.screenshot({ path: f, type: 'jpeg', quality: 93 });
      if (i % 100 === 0) console.log('frame', i, '/', N);
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
  await b.close(); console.log('done');
})();
