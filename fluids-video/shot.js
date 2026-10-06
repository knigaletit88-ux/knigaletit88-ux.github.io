// usage: node shot.js out_dir t1 t2 ...   (preview screenshots)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const [out, ...ts] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await p.goto('file://' + path.resolve(__dirname, 'index.html') + '?t=0');
  for (const t of ts) { await p.evaluate(t => renderFrame(t), parseFloat(t)); await p.screenshot({ path: `${out}/p_${t}.png` }); }
  await b.close();
})();
