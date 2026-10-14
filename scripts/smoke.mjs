// Smoke test against the production build: serves dist/ with `vite preview`, opens it
// in a phone-sized headless Chromium (SwiftShader GL). First it taps through the menus
// (world map → level 1-1 card → Play) and saves smoke-map.png, then it reloads with
// ?level=1-1 (which skips the menus) and plays ~8 s with a held touch
// drag, then pushes the crowd past 1000 player units and samples fps. Screenshots go to
// smoke-play.png and smoke-crowd.png; a JSON summary is printed. Any console error or
// page error fails the run. Low fps is reported, never failed (software rendering).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4173;
const ROOT = `http://localhost:${PORT}/horde-run/`;
const URL = `${ROOT}?level=1-1`;
const W = 390;
const H = 844;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`preview server did not start at ${url}`);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const errors = [];
let browser;
let exitCode = 0;

function stopServer() {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

try {
  await waitForServer(ROOT, 20000);

  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // Menu flow: the app boots to the world map; tap 1-1, then Play on its level card.
  await page.goto(ROOT, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__horde, null, { timeout: 15000 });
  await page.waitForSelector('[data-level="1-1"]', { state: 'visible', timeout: 10000 });
  await sleep(300);
  await page.screenshot({ path: 'smoke-map.png' });
  await page.tap('[data-level="1-1"]');
  await page.getByRole('button', { name: 'Play', exact: true }).tap({ timeout: 5000 });
  await page.waitForFunction(() => window.__horde.level() === '1-1' && window.__horde.state().time > 0.5, null, {
    timeout: 15000,
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__horde, null, { timeout: 15000 });
  await sleep(1000);

  // Held touch in the lower part of the screen, sweeping left and right for ~8 s.
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }],
    });
  const y = Math.round(H * 0.8);
  await touch('touchStart', W / 2, y);
  const playStart = Date.now();
  while (Date.now() - playStart < 8000) {
    const t = (Date.now() - playStart) / 1000;
    const x = W / 2 + Math.sin(t * 1.4) * W * 0.3;
    await touch('touchMove', Math.round(x), y);
    await sleep(50);
  }
  await page.screenshot({ path: 'smoke-play.png' });
  const afterPlay = await page.evaluate(() => ({ state: { ...window.__horde.state() }, units: window.__horde.units() }));
  await touch('touchEnd', 0, 0);

  // Push the crowd past 1000 player units, topping up while enemies cancel them.
  let peakPlayer = afterPlay.state.playerUnits;
  let peakUnits = afterPlay.units;
  for (let i = 0; i < 6; i++) {
    const s = await page.evaluate(() => window.__horde.state());
    if (s.playerUnits >= 1100 || s.outcome !== 'playing') break;
    await page.evaluate((n) => window.__horde.spawn(n), Math.max(200, 1200 - s.playerUnits));
    await sleep(300);
  }

  const fpsSamples = [];
  const sampleStart = Date.now();
  while (Date.now() - sampleStart < 4000) {
    await sleep(500);
    const s = await page.evaluate(() => ({
      fps: window.__horde.fps(),
      player: window.__horde.state().playerUnits,
      units: window.__horde.units(),
    }));
    fpsSamples.push(s.fps);
    peakPlayer = Math.max(peakPlayer, s.player);
    peakUnits = Math.max(peakUnits, s.units);
  }
  await page.screenshot({ path: 'smoke-crowd.png' });
  const final = await page.evaluate(() => ({ state: { ...window.__horde.state() }, level: window.__horde.level() }));

  const fpsMin = Math.min(...fpsSamples);
  const fpsAvg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  const summary = {
    level: final.level,
    renderer: 'swiftshader (software)',
    afterPlay: {
      time: +afterPlay.state.time.toFixed(2),
      playerUnits: afterPlay.state.playerUnits,
      enemyUnits: afterPlay.state.enemyUnits,
      enemyBaseHp: afterPlay.state.enemyBaseHp,
      simUnits: afterPlay.units,
    },
    crowd: {
      fpsMin: +fpsMin.toFixed(1),
      fpsAvg: +fpsAvg.toFixed(1),
      peakPlayerUnits: peakPlayer,
      peakSimUnits: peakUnits,
    },
    outcome: final.state.outcome,
    finalTime: +final.state.time.toFixed(2),
    screenshots: ['smoke-map.png', 'smoke-play.png', 'smoke-crowd.png'],
    errors,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (final.level !== '1-1') errors.push(`expected level 1-1, got ${final.level}`);
  if (afterPlay.state.time <= 1) errors.push('battle clock did not advance');
  if (peakPlayer < 1000) errors.push(`player units peaked at ${peakPlayer}, expected 1000+`);
  if (errors.length) {
    console.error(`smoke FAILED:\n  ${errors.join('\n  ')}`);
    exitCode = 1;
  } else {
    console.log('smoke OK');
  }
} catch (e) {
  console.error('smoke FAILED:', e);
  if (serverLog) console.error(serverLog);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  stopServer();
}
process.exit(exitCode);
