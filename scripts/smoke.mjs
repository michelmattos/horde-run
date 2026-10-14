// Smoke test against the production build: serves dist/ with `vite preview`, opens it
// in a phone-sized headless Chromium (SwiftShader GL). First it checks the world title
// card (smoke-title.png), taps it away and taps through the menus (world map → level
// 1-1 card → Play), saving smoke-map.png; then it reloads with ?level=1-1 (which skips
// the menus) and plays ~8 s with a held touch drag, then pushes the crowd past 1000
// player units, samples fps and checks the camera zoomed out with the crowd. Last it
// jumps to the boss (1-10) and plays a few seconds. Screenshots go to smoke-play.png,
// smoke-crowd.png and smoke-boss.png; a JSON summary is printed. Any console error or
// page error fails the run. Low fps is reported, never failed (software rendering);
// fps above the 60 cap fails.
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

  // Menu flow: the app boots to the world map behind its title card; tap the card away,
  // then tap 1-1 and Play on its level card.
  await page.goto(ROOT, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__horde, null, { timeout: 15000 });
  const card = page.locator('[data-title-card]');
  await card.waitFor({ state: 'visible', timeout: 10000 });
  const titleText = (await card.innerText()).split('\n')[0];
  await page.screenshot({ path: 'smoke-title.png' });
  await card.tap();
  await card.waitFor({ state: 'hidden', timeout: 5000 });
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
  const afterPlay = await page.evaluate(() => ({ state: { ...window.__horde.state() }, units: window.__horde.units(), zoom: window.__horde.zoom() }));
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
  const final = await page.evaluate(() => ({ state: { ...window.__horde.state() }, level: window.__horde.level(), zoom: window.__horde.zoom() }));

  // Boss level: jump straight in and fire for a few seconds.
  await page.evaluate(() => window.__horde.goto('1-10'));
  await sleep(500);
  await touch('touchStart', W / 2, y);
  const bossStart = Date.now();
  while (Date.now() - bossStart < 5000) {
    const t = (Date.now() - bossStart) / 1000;
    await touch('touchMove', Math.round(W / 2 + Math.sin(t * 1.1) * W * 0.2), y);
    await sleep(50);
  }
  await page.screenshot({ path: 'smoke-boss.png' });
  await touch('touchEnd', 0, 0);
  const boss = await page.evaluate(() => ({ level: window.__horde.level(), state: { ...window.__horde.state() } }));

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
    camera: { zoomAfterPlay: +afterPlay.zoom.toFixed(3), zoomWithCrowd: +final.zoom.toFixed(3) },
    titleCard: titleText,
    outcome: final.state.outcome,
    finalTime: +final.state.time.toFixed(2),
    boss: { level: boss.level, time: +boss.state.time.toFixed(2), bossPhase: boss.state.bossPhase, enemyBaseX: +(boss.state.enemyBaseX ?? 0).toFixed(2) },
    screenshots: ['smoke-title.png', 'smoke-map.png', 'smoke-play.png', 'smoke-crowd.png', 'smoke-boss.png'],
    errors,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (final.level !== '1-1') errors.push(`expected level 1-1, got ${final.level}`);
  if (afterPlay.state.time <= 1) errors.push('battle clock did not advance');
  if (peakPlayer < 1000) errors.push(`player units peaked at ${peakPlayer}, expected 1000+`);
  if (!/World 1 \u00b7 Bedroom Floor/.test(titleText)) errors.push(`title card read "${titleText}"`);
  if (!(final.zoom >= 0.08 && final.zoom > afterPlay.zoom)) errors.push(`camera did not zoom out with the crowd (${afterPlay.zoom} -> ${final.zoom})`);
  if (fpsAvg > 62) errors.push(`fps ${fpsAvg.toFixed(1)} is above the 60 fps cap`);
  if (boss.level !== '1-10' || !(boss.state.time > 2)) errors.push('boss level did not run');
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
