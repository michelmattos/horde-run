// Smoke test against the production build: serves dist/ with `vite preview` and plays the
// real game in a phone-sized headless Chromium (SwiftShader GL). Three scenarios, all by
// default or one with SMOKE=campaign|boss|expedition|meta (CI runs them as parallel jobs):
// - campaign: title card, world map, level card and loadout (taps through the menus and
//   Fight into 1-1, which must show the ultimate button), ~3 s
//   of held touch drag, and a crowd pushed past 1000 units (camera must zoom out).
// - boss: level 1-10 played briefly, then its base dropped to reach the victory result card.
// - expedition: a seeded run map, the first node tapped into a generated battle that
//   __horde.win() ends, and the upgrade pick; taking a card must land back on the run map
//   with the upgrade owned.
// - meta: the collection with debug coins buys an upgrade, then the 3D home village puts up
//   a building.
// Each step saves a smoke-*.png screenshot and a JSON summary is printed. Any console error,
// page error, shader compile error or blank-canvas fallback fails the run. The battle
// screenshots are decoded and a flat, featureless frame (a grey void with only the HUD)
// fails, as do too few draw calls. Fps is only reported: software GL runs far below 60.
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

// SMOKE=campaign|boss|expedition|meta runs one scenario (CI runs them as parallel jobs);
// unset runs them all.
const SCENARIOS = ['campaign', 'boss', 'expedition', 'meta'];
const ONLY = process.env.SMOKE;
if (ONLY && !SCENARIOS.includes(ONLY)) throw new Error(`unknown SMOKE=${ONLY}`);
const CAMPAIGN = !ONLY || ONLY === 'campaign';
const BOSS = !ONLY || ONLY === 'boss';
const EXPEDITION = !ONLY || ONLY === 'expedition';
const META = !ONLY || ONLY === 'meta';

const PORT = Number(process.env.PORT) || (await freePort());
const ROOT = `http://localhost:${PORT}/horde-run/`;
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
    // 2 takes the same render path as a 3x iPhone (render ratio capped at 1.5, no MSAA)
    // while keeping screenshots and compositing cheaper under software GL.
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    // The blank-canvas fallback must never trip on a GPU that draws (render/look/blankWatch.ts).
    else if (m.text().includes('canvas stayed blank')) errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }],
    });
  const y = Math.round(H * 0.8);
  const summary = { port: PORT, renderer: 'swiftshader (software)', screenshots: [] };
  const shot = async (path) => {
    await page.screenshot({ path });
    summary.screenshots.push(path);
  };
  const sceneShots = [];

  if (CAMPAIGN) {
    // Menu flow: the app boots to the world map behind its title card; tap the card away,
    // then tap 1-1 and Play on its level card. That battle is the one played below.
    await page.goto(ROOT, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__horde, null, { timeout: 15000 });
    const card = page.locator('[data-title-card]');
    await card.waitFor({ state: 'attached', timeout: 10000 });
    // The card dismisses itself after a couple of seconds; on a slow software-GL boot it can
    // be gone already, so fall back to its accessible name (the same title line).
    const titleText = (await card.isVisible())
      ? (await card.innerText()).split('\n')[0]
      : await card.getAttribute('aria-label');
    await shot('smoke-title.png');
    if (await card.isVisible()) await card.tap({ timeout: 3000 }).catch(() => {});
    await card.waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForSelector('[data-level="1-1"]', { state: 'visible', timeout: 10000 });
    await sleep(300);
    await shot('smoke-map.png');
    await page.waitForSelector('[data-action="expedition"]', { state: 'visible', timeout: 5000 });
    await page.tap('[data-level="1-1"]');
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await play.waitFor({ state: 'visible', timeout: 5000 });
    await sleep(500); // let the card's pop-in settle
    await shot('smoke-card.png');
    await play.tap({ timeout: 5000 });
    // The loadout comes between the card and the battle.
    const fight = page.locator('[data-screen="loadout"] [data-action="fight"]');
    await fight.waitFor({ state: 'visible', timeout: 5000 });
    await sleep(500);
    await shot('smoke-loadout.png');
    const loadoutSlots = await page.locator('[data-screen="loadout"] [data-slot]').count();
    await fight.tap({ timeout: 5000 });
    await page.waitForFunction(() => window.__horde.level() === '1-1' && window.__horde.state().time > 0.5, null, {
      timeout: 15000,
    });

    // Held touch in the lower part of the screen, sweeping left and right for ~3 s.
    await touch('touchStart', W / 2, y);
    const playStart = Date.now();
    while (Date.now() - playStart < 3000) {
      const t = (Date.now() - playStart) / 1000;
      await touch('touchMove', Math.round(W / 2 + Math.sin(t * 1.4) * W * 0.3), y);
      await sleep(50);
    }
    await shot('smoke-play.png');
    sceneShots.push('smoke-play.png');
    const ultButton = await page.locator('.tb-ult').isVisible();
    const afterPlay = await page.evaluate(() => ({
      state: { ...window.__horde.state() },
      units: window.__horde.units(),
      zoom: window.__horde.zoom(),
    }));
    await touch('touchEnd', 0, 0);

    // Push the crowd past 1000 player units, topping up while enemies cancel them.
    let peakPlayer = afterPlay.state.playerUnits;
    for (let i = 0; i < 6; i++) {
      const s = await page.evaluate(() => window.__horde.state());
      if (s.playerUnits >= 1100 || s.outcome !== 'playing') break;
      await page.evaluate((n) => window.__horde.spawn(n), Math.max(200, 1200 - s.playerUnits));
      await sleep(300);
    }
    // The camera eases out as the crowd grows; slow software frames make that take a while.
    await page.waitForFunction(() => window.__horde.zoom() >= 0.08, null, { timeout: 20000 }).catch(() => {});
    await shot('smoke-crowd.png');
    sceneShots.push('smoke-crowd.png');
    const final = await page.evaluate(() => ({
      state: { ...window.__horde.state() },
      level: window.__horde.level(),
      zoom: window.__horde.zoom(),
      render: window.__horde.render(),
      fps: window.__horde.fps(),
    }));

    peakPlayer = Math.max(peakPlayer, final.state.playerUnits);
    Object.assign(summary, {
      titleCard: titleText,
      loadout: { slots: loadoutSlots, ultButton },
      level: final.level,
      afterPlay: {
        time: +afterPlay.state.time.toFixed(2),
        playerUnits: afterPlay.state.playerUnits,
        enemyUnits: afterPlay.state.enemyUnits,
        simUnits: afterPlay.units,
      },
      crowd: { fps: +final.fps.toFixed(1), peakPlayerUnits: peakPlayer, render: final.render },
      camera: { zoomAfterPlay: +afterPlay.zoom.toFixed(3), zoomWithCrowd: +final.zoom.toFixed(3) },
    });

    if (!/World 1 · Bedroom Floor/.test(titleText)) errors.push(`title card read "${titleText}"`);
    if (final.level !== '1-1') errors.push(`expected level 1-1, got ${final.level}`);
    if (loadoutSlots !== 5) errors.push(`expected 5 loadout slots, got ${loadoutSlots}`);
    if (!ultButton) errors.push('the ultimate button is not showing in a campaign battle');
    if (afterPlay.state.time <= 1) errors.push('battle clock did not advance');
    if (peakPlayer < 1000) errors.push(`player units peaked at ${peakPlayer}, expected 1000+`);
    if (!(final.zoom >= 0.08 && final.zoom > afterPlay.zoom))
      errors.push(`camera did not zoom out with the crowd (${afterPlay.zoom} -> ${final.zoom})`);
    if (final.render.drawCalls < MIN_DRAW_CALLS) errors.push(`crowd frame drew only ${final.render.drawCalls} calls`);
  }

  if (BOSS) {
    // Boss level: jump straight in (in place after the campaign, else booting on it) and
    // fire until its battle clock passes 1 s (software GL compiles the boss's new shaders
    // slowly), within a minute.
    if (CAMPAIGN) await page.evaluate(() => window.__horde.goto('1-10'));
    else {
      await page.goto(`${ROOT}?level=1-10`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__horde, null, { timeout: 15000 });
    }
    await sleep(500);
    await touch('touchStart', W / 2, y);
    const bossStart = Date.now();
    while (Date.now() - bossStart < 60000) {
      if ((await page.evaluate(() => window.__horde.state().time)) > 1) break;
      const t = (Date.now() - bossStart) / 1000;
      await touch('touchMove', Math.round(W / 2 + Math.sin(t * 1.1) * W * 0.2), y);
      await sleep(50);
    }
    await shot('smoke-boss.png');
    sceneShots.push('smoke-boss.png');
    await touch('touchEnd', 0, 0);
    const boss = await page.evaluate(() => ({
      level: window.__horde.level(),
      state: { ...window.__horde.state() },
      render: window.__horde.render(),
    }));

    // Result screen: knock the boss's base down; the battle ends and the result card follows.
    await page.evaluate(() => {
      window.__horde.state().enemyBaseHp = 0;
    });
    await page.getByRole('button', { name: /retry/i }).first().waitFor({ state: 'visible', timeout: 30000 });
    await sleep(1500); // stars pop in one by one
    await shot('smoke-result.png');
    const result = await page.evaluate(() => window.__horde.state().outcome);

    summary.boss = {
      level: boss.level,
      time: +boss.state.time.toFixed(2),
      bossPhase: boss.state.bossPhase,
      render: boss.render,
      result,
    };

    if (boss.level !== '1-10' || !(boss.state.time > 1)) errors.push('boss level did not run');
    if (boss.render.drawCalls < MIN_DRAW_CALLS) errors.push(`boss frame drew only ${boss.render.drawCalls} calls`);
    if (result !== 'victory') errors.push(`expected a victory result screen, got ${result}`);
  }

  if (EXPEDITION) {
    // Expedition: a fresh seeded run opens on its map; tap a first-row node twice (select,
    // then confirm) to enter its battle, win it, then take the first upgrade offered.
    await page.goto(`${ROOT}?expedition=4242`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__horde?.level() === 'expedition-map', null, { timeout: 15000 });
    const nodeSel = '[data-node-id][data-available="true"]';
    await page.waitForSelector(nodeSel, { state: 'visible', timeout: 5000 });
    await sleep(500);
    await shot('smoke-expedition-map.png');
    const firstNode = await page.getAttribute(nodeSel, 'data-node-id');
    await page.tap(`[data-node-id="${firstNode}"]`);
    await page.tap(`[data-node-id="${firstNode}"]`);
    await page.waitForFunction(() => window.__horde.level().startsWith('x') && window.__horde.state().time > 1, null, {
      timeout: 30000,
    });
    await shot('smoke-expedition-battle.png');
    sceneShots.push('smoke-expedition-battle.png');
    const expBattle = await page.evaluate(() => ({ level: window.__horde.level(), render: window.__horde.render() }));
    await page.evaluate(() => window.__horde.win());
    const card0 = page.locator('.hx-up[data-upgrade-id]').first();
    await card0.waitFor({ state: 'visible', timeout: 30000 });
    await sleep(600);
    await shot('smoke-expedition-pick.png');
    const offered = await page.locator('.hx-up[data-upgrade-id]').count();
    const picked = await card0.getAttribute('data-upgrade-id');
    await card0.tap();
    await page.tap('[data-action="take"]');
    await page.waitForFunction(() => window.__horde.level() === 'expedition-map', null, { timeout: 10000 });
    const runAfter = await page.evaluate(() => window.__horde.expedition());
    summary.expedition = {
      node: firstNode,
      battle: expBattle.level,
      drawCalls: expBattle.render.drawCalls,
      offered,
      picked,
      hp: runAfter?.hp,
      gold: runAfter?.gold,
      upgrades: runAfter?.upgrades,
    };

    if (expBattle.render.drawCalls < MIN_DRAW_CALLS)
      errors.push(`expedition battle drew only ${expBattle.render.drawCalls} calls`);
    if (offered !== 3) errors.push(`expected 3 upgrade cards after the expedition win, got ${offered}`);
    if (!runAfter || runAfter.upgrades[picked] !== 1 || runAfter.stats.battlesWon !== 1)
      errors.push(`expedition run did not record the win and pick: ${JSON.stringify(summary.expedition)}`);
  }

  if (META) {
    // Collection: a debug coin grant, then the first affordable upgrade.
    await page.goto(`${ROOT}?screen=collection`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__horde?.screen() === 'collection', null, { timeout: 15000 });
    const coinsBefore = await page.evaluate(() => window.__horde.coins(600));
    const upgrade = page.locator('[data-screen="collection"] [data-action="upgrade"]:not([disabled])').first();
    await upgrade.waitFor({ state: 'visible', timeout: 5000 });
    const upgradedId = await upgrade.evaluate((b) => b.closest('[data-item]')?.getAttribute('data-item'));
    await upgrade.tap();
    await sleep(700);
    await shot('smoke-collection.png');
    const afterUpgrade = await page.evaluate(() => window.__horde.profile());
    const collection = {
      coinsBefore,
      upgraded: upgradedId,
      tier: afterUpgrade.tiers[upgradedId] ?? 0,
      coinsAfter: afterUpgrade.coins,
    };

    // Home base: the 3D village with one building put up.
    await page.goto(`${ROOT}?screen=home`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__horde?.screen() === 'home', null, { timeout: 15000 });
    const buildBtn = page.locator('[data-screen="home"] [data-action="build"]:not([disabled])').first();
    await buildBtn.waitFor({ state: 'visible', timeout: 15000 });
    await sleep(1500); // loads and the first frames of the village
    const builtId = await buildBtn.evaluate((b) => b.closest('[data-building]')?.getAttribute('data-building'));
    await buildBtn.tap();
    await sleep(3000); // the new pieces drop in, then confetti
    await shot('smoke-home.png');
    sceneShots.push('smoke-home.png');
    const afterBuild = await page.evaluate(() => window.__horde.profile());
    const home = { built: builtId, tier: afterBuild.village[builtId] ?? 0, coins: afterBuild.coins };
    Object.assign(summary, { collection, home });

    if (!upgradedId || collection.tier !== 1 || collection.coinsAfter >= coinsBefore)
      errors.push(`collection upgrade did not apply: ${JSON.stringify(collection)}`);
    if (!builtId || home.tier !== 1) errors.push(`home build did not apply: ${JSON.stringify(home)}`);
  }

  // The battle screenshots must show the 3D scene, not a flat clear colour behind the HUD.
  summary.content = {};
  for (const path of sceneShots) {
    const c = sceneContent(path);
    summary.content[path] = c;
    if (c.lumaStd < MIN_LUMA_STD || c.colours < MIN_COLOURS)
      errors.push(`${path} shows no 3D scene (luma std ${c.lumaStd}, ${c.colours} colours)`);
  }
  if (errors.some((e) => /Unable to compile effect|SHADER ERROR/i.test(e)))
    errors.push('shader compile errors (see above)');
  summary.errors = errors;
  console.log(JSON.stringify(summary, null, 2));

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
