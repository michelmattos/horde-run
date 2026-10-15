// Smoke test against the production build: serves dist/ with `vite preview`, opens it
// in a phone-sized headless Chromium (SwiftShader GL). First it checks the world title
// card (smoke-title.png), taps it away and taps through the menus (world map → level
// 1-1 card → Play), saving smoke-map.png and smoke-card.png; then it reloads with ?level=1-1 (which skips
// the menus) and plays ~8 s with a held touch drag, then pushes the crowd past 1000
// player units, samples fps and checks the camera zoomed out with the crowd. Last it
// jumps to the boss (1-10), plays a few seconds, then drops the boss's HP to end the
// battle and saves the result card. Then an Expedition run (?expedition=<seed>): the run
// map (smoke-expedition-map.png), the first node tapped into a generated battle that
// __horde.win() ends, and the upgrade pick (smoke-expedition-pick.png); taking a card
// must land back on the run map with the upgrade owned. Screenshots go to smoke-play.png, smoke-crowd.png,
// smoke-boss.png and smoke-result.png; render stats (draw calls, indices) are reported; a JSON summary is printed. Any console error or
// page error fails the run. Low fps is reported, never failed (software rendering);
// fps above the 60 cap fails. The battle screenshots (play, crowd, boss) must show the 3D
// scene: their pixels are decoded and a flat, featureless frame (a grey void with only the
// HUD) fails the run, as do too few draw calls and any shader compile error.
// The preview server takes PORT from the environment, else a free port, so parallel runs
// never collide.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Minimal PNG reader (8-bit RGB / RGBA, non-interlaced: what Chromium writes).
function decodePng(buf) {
  let p = 8;
  let w = 0,
    h = 0,
    ch = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      ch = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!ch) throw new Error(`unsupported PNG colour type ${data[9]}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a),
          pb = Math.abs(pp - b),
          pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

// Detail in the middle of the frame (between the HUD bands): luminance spread and the
// number of distinct coarse colours. A frame where the 3D scene failed to draw is a flat
// clear colour there.
function sceneContent(path) {
  const { w, h, ch, data } = decodePng(readFileSync(path));
  const colours = new Set();
  let n = 0,
    sum = 0,
    sum2 = 0;
  for (let y = Math.floor(h * 0.22); y < h * 0.78; y += 3) {
    for (let x = Math.floor(w * 0.08); x < w * 0.92; x += 3) {
      const i = (y * w + x) * ch;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += l;
      sum2 += l * l;
      n++;
      colours.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
  }
  const mean = sum / n;
  return { lumaStd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1), colours: colours.size };
}

const MIN_LUMA_STD = 14;
const MIN_COLOURS = 60;
const MIN_DRAW_CALLS = 20;

const PORT = Number(process.env.PORT) || (await freePort());
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
    if (server.pid) process.kill(-server.pid, 'SIGTERM');
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
  await card.waitFor({ state: 'attached', timeout: 10000 });
  // The card dismisses itself after a couple of seconds; on a slow software-GL boot it can
  // be gone already, so fall back to its accessible name (the same title line).
  const titleText = (await card.isVisible())
    ? (await card.innerText()).split('\n')[0]
    : await card.getAttribute('aria-label');
  await page.screenshot({ path: 'smoke-title.png' });
  // The card also dismisses itself after a couple of seconds; tap it only if it is still up.
  if (await card.isVisible()) await card.tap({ timeout: 3000 }).catch(() => {});
  await card.waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForSelector('[data-level="1-1"]', { state: 'visible', timeout: 10000 });
  await sleep(300);
  await page.screenshot({ path: 'smoke-map.png' });
  await page.waitForSelector('[data-action="expedition"]', { state: 'visible', timeout: 5000 });
  await page.tap('[data-level="1-1"]');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await play.waitFor({ state: 'visible', timeout: 5000 });
  await sleep(500); // let the card's pop-in settle
  await page.screenshot({ path: 'smoke-card.png' });
  await play.tap({ timeout: 5000 });
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
  const afterPlay = await page.evaluate(() => ({
    state: { ...window.__horde.state() },
    units: window.__horde.units(),
    zoom: window.__horde.zoom(),
  }));
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
  const final = await page.evaluate(() => ({
    state: { ...window.__horde.state() },
    level: window.__horde.level(),
    zoom: window.__horde.zoom(),
  }));
  const crowdRender = await page.evaluate(() => window.__horde.render());

  // Boss level: jump straight in and fire for a few seconds.
  await page.evaluate(() => window.__horde.goto('1-10'));
  await sleep(500);
  await touch('touchStart', W / 2, y);
  const bossStart = Date.now();
  // At least 5 s of play, and until the boss battle clock passes 2.5 s (software GL
  // compiles the boss's new shaders slowly), within a minute.
  while (Date.now() - bossStart < 60000) {
    if (Date.now() - bossStart > 5000 && (await page.evaluate(() => window.__horde.state().time)) > 2.5) break;
    const t = (Date.now() - bossStart) / 1000;
    await touch('touchMove', Math.round(W / 2 + Math.sin(t * 1.1) * W * 0.2), y);
    await sleep(50);
  }
  await page.screenshot({ path: 'smoke-boss.png' });
  await touch('touchEnd', 0, 0);
  const boss = await page.evaluate(() => ({
    level: window.__horde.level(),
    state: { ...window.__horde.state() },
    render: window.__horde.render(),
  }));

  // Result screen: knock the boss's base down to its last hit point; the next base hit
  // (or the base's own HP check) ends the battle and the result card follows.
  await page.evaluate(() => {
    window.__horde.state().enemyBaseHp = 0;
  });
  await page.getByRole('button', { name: /retry/i }).first().waitFor({ state: 'visible', timeout: 30000 });
  await sleep(1500); // stars pop in one by one
  await page.screenshot({ path: 'smoke-result.png' });
  const result = await page.evaluate(() => window.__horde.state().outcome);

  // Expedition: a fresh seeded run opens on its map; tap a first-row node twice (select,
  // then confirm) to enter its battle, win it, then take the first upgrade offered.
  await page.goto(`${ROOT}?expedition=4242`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__horde?.level() === 'expedition-map', null, { timeout: 15000 });
  const nodeSel = '[data-node-id][data-available="true"]';
  await page.waitForSelector(nodeSel, { state: 'visible', timeout: 5000 });
  await sleep(500);
  await page.screenshot({ path: 'smoke-expedition-map.png' });
  const firstNode = await page.getAttribute(nodeSel, 'data-node-id');
  await page.tap(`[data-node-id="${firstNode}"]`);
  await page.tap(`[data-node-id="${firstNode}"]`);
  await page.waitForFunction(() => window.__horde.level().startsWith('x') && window.__horde.state().time > 1, null, {
    timeout: 30000,
  });
  const expBattle = await page.evaluate(() => ({
    level: window.__horde.level(),
    render: window.__horde.render(),
  }));
  await page.evaluate(() => window.__horde.win());
  const card0 = page.locator('.hx-up[data-upgrade-id]').first();
  await card0.waitFor({ state: 'visible', timeout: 30000 });
  await sleep(600);
  await page.screenshot({ path: 'smoke-expedition-pick.png' });
  const offered = await page.locator('.hx-up[data-upgrade-id]').count();
  const picked = await card0.getAttribute('data-upgrade-id');
  await card0.tap();
  await page.tap('[data-action="take"]');
  await page.waitForFunction(() => window.__horde.level() === 'expedition-map', null, { timeout: 10000 });
  const runAfter = await page.evaluate(() => window.__horde.expedition());
  const expedition = {
    node: firstNode,
    battle: expBattle.level,
    drawCalls: expBattle.render.drawCalls,
    offered,
    picked,
    hp: runAfter?.hp,
    gold: runAfter?.gold,
    upgrades: runAfter?.upgrades,
  };

  const fpsMin = Math.min(...fpsSamples);
  const fpsAvg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  const content = {};
  for (const shot of ['smoke-play.png', 'smoke-crowd.png', 'smoke-boss.png']) {
    const c = sceneContent(shot);
    content[shot] = c;
    if (c.lumaStd < MIN_LUMA_STD || c.colours < MIN_COLOURS)
      errors.push(`${shot} shows no 3D scene (luma std ${c.lumaStd}, ${c.colours} colours)`);
  }
  if (crowdRender.drawCalls < MIN_DRAW_CALLS) errors.push(`crowd frame drew only ${crowdRender.drawCalls} calls`);
  if (boss.render.drawCalls < MIN_DRAW_CALLS) errors.push(`boss frame drew only ${boss.render.drawCalls} calls`);
  if (errors.some((e) => /Unable to compile effect|SHADER ERROR/i.test(e)))
    errors.push('shader compile errors (see above)');

  const summary = {
    port: PORT,
    content,
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
    boss: {
      level: boss.level,
      time: +boss.state.time.toFixed(2),
      bossPhase: boss.state.bossPhase,
      enemyBaseX: +(boss.state.enemyBaseX ?? 0).toFixed(2),
    },
    render: { crowd: crowdRender, boss: boss.render },
    result,
    expedition,
    screenshots: [
      'smoke-title.png',
      'smoke-map.png',
      'smoke-card.png',
      'smoke-play.png',
      'smoke-crowd.png',
      'smoke-boss.png',
      'smoke-result.png',
      'smoke-expedition-map.png',
      'smoke-expedition-pick.png',
    ],
    errors,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (final.level !== '1-1') errors.push(`expected level 1-1, got ${final.level}`);
  if (afterPlay.state.time <= 1) errors.push('battle clock did not advance');
  if (peakPlayer < 1000) errors.push(`player units peaked at ${peakPlayer}, expected 1000+`);
  if (!/World 1 \u00b7 Bedroom Floor/.test(titleText)) errors.push(`title card read "${titleText}"`);
  if (!(final.zoom >= 0.08 && final.zoom > afterPlay.zoom))
    errors.push(`camera did not zoom out with the crowd (${afterPlay.zoom} -> ${final.zoom})`);
  if (fpsAvg > 62) errors.push(`fps ${fpsAvg.toFixed(1)} is above the 60 fps cap`);
  if (boss.level !== '1-10' || !(boss.state.time > 2)) errors.push('boss level did not run');
  if (result !== 'victory') errors.push(`expected a victory result screen, got ${result}`);
  if (offered !== 3) errors.push(`expected 3 upgrade cards after the expedition win, got ${offered}`);
  if (!runAfter || runAfter.upgrades[picked] !== 1 || runAfter.stats.battlesWon !== 1)
    errors.push(`expedition run did not record the win and pick: ${JSON.stringify(expedition)}`);
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
