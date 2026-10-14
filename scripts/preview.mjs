// Headless model preview: node scripts/preview.mjs <key> [port] [--team=enemy] [--variant=name] [--quality=high|medium|low]
// Starts the Vite dev server on <port> (default 5199), opens preview.html?model=<key> in
// SwiftShader Chromium and writes preview-<key>-{front,side,top,game}.png (with an
// enemy team or a variant the names gain -enemy / -<variant>). front/side/top are
// 1200x1200 turntable shots; 'game' is a 390x844 @3x phone shot from the in-game lane
// camera (same pitch, fov and distance) with the model at its usual lane position.
// Prints a JSON summary (triangles, draw calls, materials, bounds). Fails on any console
// error, page error or preview error. Run several at once on different ports.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const key = positional[0];
const port = Number(positional[1] ?? 5199);
if (!key) {
  console.error('usage: node scripts/preview.mjs <model-key> [port] [--team=enemy] [--variant=name] [--quality=high]');
  process.exit(2);
}
const team = flags.team === 'enemy' ? 'enemy' : 'player';
const suffix = `${team === 'enemy' ? '-enemy' : ''}${flags.variant ? `-${flags.variant}` : ''}`;
const query = new URLSearchParams({ model: key, team, bare: '1', view: 'front' });
if (flags.variant) query.set('variant', flags.variant);
if (flags.quality) query.set('quality', flags.quality);
const url = `http://localhost:${port}/preview.html?${query}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(u, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(u);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`dev server did not start at ${u}`);
}

const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // already gone
  }
};

const errors = [];
let browser;
let code = 0;
try {
  await waitForServer(`http://localhost:${port}/preview.html`, 30000);
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const shots = [
    { view: 'front', w: 800, h: 800, dpr: 1.5 },
    { view: 'side', w: 800, h: 800, dpr: 1.5 },
    { view: 'top', w: 800, h: 800, dpr: 1.5 },
    { view: 'game', w: 390, h: 844, dpr: 3 },
  ];
  const files = [];
  let summary = null;
  for (const shot of shots) {
    // A fresh page per size, so the canvas, DPR and camera framing are exactly right.
    const context = await browser.newContext({
      viewport: { width: shot.w, height: shot.h },
      deviceScaleFactor: shot.dpr,
    });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
    await page.goto(url.replace('view=front', `view=${shot.view}`), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__preview && (window.__preview.ready || window.__preview.error), null, {
      timeout: 120000,
    });
    const err = await page.evaluate(() => window.__preview.error);
    if (err) throw new Error(`preview error: ${err}`);
    await page.evaluate((v) => window.__preview.setView(v), shot.view);
    await sleep(300);
    const file = `preview-${key}${suffix}-${shot.view}.png`;
    await page.screenshot({ path: file });
    files.push(file);
    if (!summary) summary = await page.evaluate(() => window.__preview.stats());
    await context.close();
  }
  console.log(
    JSON.stringify(
      { model: key, team, variant: flags.variant ?? null, ...summary, screenshots: files, errors },
      null,
      2,
    ),
  );
  if (errors.length) {
    console.error(`preview FAILED:\n  ${errors.join('\n  ')}`);
    code = 1;
  } else {
    console.log('preview OK');
  }
} catch (e) {
  console.error('preview FAILED:', e);
  if (errors.length) console.error(errors.join('\n'));
  if (serverLog) console.error(serverLog.slice(-4000));
  code = 1;
} finally {
  if (browser) await browser.close();
  stopServer();
}
process.exit(code);
