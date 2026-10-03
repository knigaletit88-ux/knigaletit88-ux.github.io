// Покадровый рендер index.html → MP4 (через Playwright + ffmpeg).
//   node render.cjs                    — полный ролик (нужен audio.wav, см. audio.py)
//   node render.cjs --frames 10,60,200 --out /tmp/shots   — отдельные кадры в PNG для проверки
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const dir = __dirname;
const outMp4 = opt('mp4', path.join(dir, 'avto-zapchasti-sestram-reel.mp4'));
const audio = opt('audio', path.join(dir, 'audio-sfx.wav'));
const framesArg = opt('frames', null);

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--force-color-profile=srgb', '--disable-lcd-text'],
  });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.join(dir, 'index.html') + '?render&clean');
  await page.evaluate(() => window.ready);
  const total = await page.evaluate(() => window.TOTAL_FRAMES);
  const grab = f => page.evaluate(f => { window.drawFrame(f); return document.getElementById('c').toDataURL('image/png').split(',')[1]; }, f);

  if (framesArg) {
    const out = opt('out', '/tmp/shots'); fs.mkdirSync(out, { recursive: true });
    for (const f of framesArg.split(',').map(Number)) {
      fs.writeFileSync(path.join(out, `f${String(f).padStart(3, '0')}.png`), Buffer.from(await grab(f), 'base64'));
    }
    await browser.close(); return;
  }

  const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-'];
  if (fs.existsSync(audio)) ffArgs.push('-i', audio);
  ffArgs.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', '30', '-movflags', '+faststart');
  if (fs.existsSync(audio)) ffArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  ffArgs.push(outMp4);
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    const ok = ff.stdin.write(Buffer.from(await grab(f), 'base64'));
    if (!ok) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 30 === 0) process.stdout.write(`\rкадр ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)} c`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log(`\nготово: ${outMp4}`);
})();
