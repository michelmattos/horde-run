// Boot and per-frame wiring. One renderer, input, HUD, overlay set and world map live
// for the whole session; each battle (card Play, retry, next level) gets a fresh RNG,
// sim and battle. Flow: world map → level card → battle → result (stars saved via
// recordResult) → Next opens the next level's card / Map / Retry. `?level=1-1` skips
// the menus straight into a battle (used by the smoke test).
// Expedition (concept §4.2): a second flow next to the campaign. The world map's
// Expedition button opens the start screen (New, Daily, Resume); `?expedition=<seed>`
// or `?expedition=daily` starts or resumes a run straight onto the run map. The run
// rules are pure (src/expedition); this file only walks the run's phases: run map →
// battle (generated level with the upgrades applied) → upgrade pick / lost card → map,
// plus shop and rest stops, until the run result. Every step is saved, so a reload
// resumes where the player was (a battle restarts from its beginning).
// Per rendered frame: loop.advance → input.sample → battle.step (which steps the sim)
// → renderer.frame → hud.update. The sim runs at a fixed SIM_HZ. While a menu covers
// the battlefield nothing moves, so the loop draws one frame under it and then stops
// (concept §8 "Heat and battery"); wake() restarts it. Drawing is capped at 60 fps even
// on a 120 Hz screen (iPhone 17 Pro Max): rAF callbacks that come too soon are skipped.
// The camera only zooms out gently as the crowd grows; it never shakes.
import { Engine } from '@babylonjs/core/Engines/engine';
import { LAYOUT, Team, UnitKind, starGoalLabels } from './contracts.ts';
import type { BattleState, LevelDef, RunBattleSpec, RunState, SaveData, SimEvent, WorldDef } from './contracts.ts';
import { createSim } from './sim/index.ts';
import type { Sim } from './sim/index.ts';
import { createBattle } from './game/battle.ts';
import type { Battle } from './game/battle.ts';
import { getLevel, getLevelById, getWorld } from './game/levels.ts';
import { evaluateStars } from './game/stars.ts';
import { createRenderer } from './render/index.ts';
import type { RenderStats } from './render/index.ts';
import { createRng } from './core/rng.ts';
import { createFixedStep, createFrameCap } from './core/loop.ts';
import { loadSettings } from './core/settings.ts';
import { createInput } from './core/input.ts';
import { isLandscapeTouch, watchInterruptions } from './core/lifecycle.ts';
import type { InterruptReason } from './core/lifecycle.ts';
import { createHaptics } from './core/haptics.ts';
import { registerServiceWorker } from './core/pwa.ts';
import { planRecovery, readRecovery, takeRecoveryTarget, writeRecovery } from './core/recovery.ts';
import type { RecoveryTarget } from './core/recovery.ts';
import { writeSavedRender } from './render/look/quality.ts';
import { loadSave, recordResult, writeSave } from './core/save.ts';
import { createWorldMap } from './meta/worldMap.ts';
import { createHud, hudReserve } from './ui/hud.ts';
import { createOverlays } from './ui/overlays.ts';
import { createLoadingScreen, LOADING_TIMEOUT_MS, settle } from './ui/loading.ts';
import {
  abandonRun,
  applyUpgrades,
  availableNodes,
  battleSpec,
  buyHeal,
  buyItem,
  chooseNode,
  dailySeed,
  finishBattle,
  getUpgrade,
  leaveShop,
  loadExpedition,
  newRun,
  pickUpgrade,
  randomRunSeed,
  recordRunEnd,
  restHeal,
  RUN_RULES,
  runScore,
  saveExpedition,
} from './expedition/index.ts';
import type { ExpeditionSave } from './expedition/index.ts';
import { generateRunBattle } from './game/expedition.ts';
import { createExpeditionScreens, upgradeIconSvg } from './ui/expedition/index.ts';
import type { OwnedUpgrade } from './ui/expedition/index.ts';

// Seconds the battlefield keeps playing after the outcome before the result screen.
const RESULT_DELAY = 1.2;

declare global {
  interface Window {
    __hordeBooted?: boolean; // set once the first screen is up (index.html boot guard)
    __hordeBootError?: (message: string) => void; // shows a start-up failure on screen (index.html)
    __hordeFatal?: (message: string) => void; // shows a later, unrecoverable failure on screen (index.html)
    __horde?: {
      state(): BattleState;
      fps(): number; // frames actually drawn per second (capped at 60)
      zoom(): number; // current crowd zoom-out of the camera (0 = none)
      level(): string;
      spawn(n: number, champion?: boolean): void; // debug: player units at the cannon
      units(): number; // live sim units (stacked units count once)
      goto(levelId: string): boolean; // start a battle on that level, skipping menus
      render(): RenderStats; // last frame's draw calls, active meshes/indices, quality tier
      expedition(): RunState | null; // the current Expedition run, null when none is active
      expeditionChoose(nodeId: string): boolean; // enter that run map node, as a tap would
      win(): void; // debug: drains the enemy base so the battle ends in victory
    };
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const app = document.getElementById('app') as HTMLElement;

// MSAA is expensive at phone DPRs and barely visible there; keep it for low-DPR screens.
const antialias = window.devicePixelRatio < 2;
const engine = createEngine();
// iOS can hand out a WebGL context that is already lost. Babylon then reads every GPU
// limit as 0, and building the bloom blur on those limits throws (the "e.toFixed" start-up
// error). Recover the same way as a context lost mid-game, before anything is built on it.
if (!contextUsable(engine)) recoverDeadContextAtBoot();

// True when the context is alive and reported real limits.
function contextUsable(e: Engine): boolean {
  const gl = (e as unknown as { _gl?: WebGLRenderingContext | null })._gl;
  if (!gl || gl.isContextLost()) return false;
  const caps = e.getCaps();
  return caps.maxVaryingVectors > 0 && caps.maxTextureSize > 0;
}

function recoverDeadContextAtBoot(): never {
  const prev = readRecovery();
  const { plan, count } = planRecovery(prev, Date.now());
  // Keep the place an earlier recovery asked to return to (this boot has not used it yet).
  const target: RecoveryTarget = prev?.target ?? { kind: 'map' };
  if (plan !== 'give-up' && writeRecovery({ at: Date.now(), count, target })) {
    console.warn(`WebGL context lost at start-up: reloading (${plan})`);
    if (plan === 'reload-low') writeSavedRender({ quality: 'low', post: 'off' });
    window.__hordeBooted = true; // a reload is coming: the boot guard must not report this stop
    reloadWhenVisible();
  } else {
    window.__hordeBootError?.(
      'The phone did not give the game its graphics (the WebGL context was lost at start-up).\n\n' +
        'Close the game and Safari completely, then open it again. If that does not help, restart the phone.',
    );
  }
  throw new Error('WebGL context lost at start-up');
}

function createEngine(): Engine {
  try {
    return new Engine(
      canvas,
      antialias,
      { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', audioEngine: false },
      false, // the renderer owns hardware scaling (automatic resolution scaling)
    );
  } catch (e) {
    // No WebGL context (the browser refused one): the index.html boot guard shows why.
    window.__hordeBootError?.(
      `The graphics (WebGL) would not start: ${e instanceof Error ? e.message : String(e)}\n\n` +
        'Close the game and Safari completely, then open it again. If that does not help, restart the phone.',
    );
    throw e;
  }
}

const world: WorldDef = getWorld('w1') ?? {
  id: 'w1',
  name: 'Bedroom Floor',
  faction: 'Tan Army',
  levels: [getLevel(0).id],
};
const levelDef = (id: string): LevelDef => getLevelById(id) ?? getLevel(0);

const loading = createLoadingScreen();
const settings = loadSettings();
const renderer = createRenderer(engine, canvas, { hudReserve });
const input = createInput(canvas, settings);
const haptics = createHaptics(settings);
const overlays = createOverlays(app, settings);
const loop = createFixedStep();
const frameCap = createFrameCap();
const hud = createHud(renderer.scene, input, { onPause: () => pause('user') });

let save: SaveData = loadSave();
const map = createWorldMap(app, {
  world,
  levels: world.levels.map((id) => ({ id, name: levelDef(id).name, boss: !!levelDef(id).boss })),
  onPlay: (id) => openLevelCard(id),
  onSaveReplaced: (s) => {
    save = s;
  },
  onExpedition: () => openExpeditionStart(),
  whenUncovered: () => loading.whenHidden(),
});
const screens = createExpeditionScreens(app);
// The UI font, so no screen is first shown in the fallback face and then re-laid out.
const fontsReady: Promise<unknown> = document.fonts
  ? Promise.all(['600', '700'].map((w) => document.fonts.load(`${w} 16px 'Horde Fredoka'`)))
  : Promise.resolve();

// Optional ?seed=N makes a session reproducible; otherwise every battle differs.
const params = new URLSearchParams(location.search);
const seedParam = Number(params.get('seed'));
let seedCounter = Number.isFinite(seedParam) && seedParam !== 0 ? seedParam : Date.now();

let level: LevelDef = getLevel(0);
let sim: Sim | undefined;
let battle: Battle | undefined;
let inBattle = false; // a battle is on screen (playing, paused or showing its result)
let outcomeAt = -1; // sim time the outcome was reached, -1 while playing
let resultShown = false;
// Which flow the battle on screen belongs to; an Expedition battle ends in the run's
// pick / lost card instead of the campaign result.
let mode: 'campaign' | 'expedition' = 'campaign';
let stageLoading = false; // the battle's scene is still loading behind the loading screen: the sim waits
let battleLoad = 0; // bumped per battle, so a slow load never releases a newer battle
let runMapShown = false; // the run map is the Expedition screen up (for __horde.level())
const events: SimEvent[] = []; // sim and battle events since the last rendered frame

function nextLevelId(id: string): string | undefined {
  const i = world.levels.indexOf(id);
  return i >= 0 && i + 1 < world.levels.length ? world.levels[i + 1] : undefined;
}

// Level card over whatever is showing (the map, or the stopped battlefield after a win).
function openLevelCard(id: string): void {
  const l = levelDef(id);
  overlays.showLevelIntro({
    code: l.id,
    levelName: l.name,
    intro: l.intro,
    goals: starGoalLabels(l),
    earned: save.levels[l.id]?.stars ?? [false, false, false],
    boss: l.boss?.name,
    onPlay: () => startLevel(l.id),
    onMap: () => showMap(),
  });
}

// Leaves the battlefield (if any) for a full-screen menu: nothing steps or draws under it.
function leaveBattlefield(): void {
  overlays.hide();
  inBattle = false;
  input.setPaused(true);
  hud.setVisible(false);
}

function showMap(): void {
  screens.hide();
  leaveBattlefield();
  map.show(save, {
    expedition: {
      active: !!run && run.outcome === 'active',
      dailyDone: exp.best.daily[dailySeed(new Date()).daily] !== undefined,
    },
  });
}

function startLevel(id: string): void {
  mode = 'campaign';
  hud.setRun(null);
  beginBattle(levelDef(id), seedCounter++);
}

// Fresh RNG, sim and battle on `def`. hud.setRun must already be set for this battle:
// the renderer frames the lane from hudReserve() when the level loads.
function beginBattle(def: LevelDef, seed: number): void {
  map.hide();
  overlays.hide();
  screens.hide();
  level = def;
  const rng = createRng(seed);
  const rand = (): number => rng.next();
  const s = createSim(level, rand);
  sim = s;
  battle = createBattle(level, s, rand);
  inBattle = true;
  outcomeAt = -1;
  resultShown = false;
  events.length = 0;
  // Cover the screen until the scene can draw its finished picture; frames keep
  // rendering under the cover (that is when shaders compile) but the battle waits.
  loading.show();
  stageLoading = true;
  const load = ++battleLoad;
  renderer.loadLevel(level);
  const ready = settle(Promise.all([fontsReady, renderer.whenReady()]), LOADING_TIMEOUT_MS);
  void ready.then(() => {
    if (load === battleLoad) stageLoading = false;
  });
  void loading.hideWhen(ready);
  input.configure({ laneWidth: level.lane.width, aimLimit: level.cannon.aimLimit });
  input.setPaused(false);
  hud.setVisible(true);
  loop.reset();
  wake();
  // Every battle entry path (map, retry, next) honours the portrait-only rule.
  if (isLandscapeTouch()) pause('orientation');
}

// ---------- Expedition session ----------

let exp: ExpeditionSave = loadExpedition();
let run: RunState | undefined = exp.run?.outcome === 'active' ? exp.run : undefined;

function ownedUpgrades(r: RunState): OwnedUpgrade[] {
  const out: OwnedUpgrade[] = [];
  for (const [id, stacks] of Object.entries(r.upgrades)) {
    const def = getUpgrade(id);
    if (def && stacks > 0) out.push({ def, stacks });
  }
  return out;
}

// Saves the run as the current one and returns it.
function commitRun(r: RunState): RunState {
  run = r;
  exp = { ...exp, run: r };
  saveExpedition(exp);
  return r;
}

function openExpeditionStart(): void {
  map.hide();
  leaveBattlefield();
  runMapShown = false;
  const today = dailySeed(new Date());
  const r = run;
  screens.showStart({
    dailyDate: today.daily,
    dailyBest: exp.best.daily[today.daily],
    bestScore: exp.best.bestScore,
    runsPlayed: exp.best.runsPlayed,
    runsWon: exp.best.runsWon,
    resume: r ? { hp: r.hp, maxHp: r.maxHp, gold: r.gold, battlesWon: r.stats.battlesWon, daily: r.daily } : undefined,
    onNew: () => startRun(randomRunSeed()),
    onDaily: () => startRun(today.seed, today.daily),
    onResume: r ? () => showRunStep() : undefined,
    onBack: () => showMap(),
  });
}

// A new run replaces the current one, which counts as abandoned.
function startRun(seed: number, daily?: string): void {
  if (run) {
    exp = recordRunEnd(exp, abandonRun(run));
    run = undefined;
  }
  commitRun(newRun(seed, daily !== undefined ? { daily } : {}));
  showRunStep();
}

// Shows whatever the run's phase calls for (also how a saved run resumes).
function showRunStep(): void {
  const r = run;
  if (!r) return openExpeditionStart();
  runMapShown = false;
  switch (r.phase) {
    case 'map':
      return showRunMap(r);
    case 'battle':
      return startRunBattle(r);
    case 'pick':
      return showRunPick(r);
    case 'shop':
      return showRunShop(r);
    case 'rest':
      return showRunRest(r);
    case 'over':
      return endRun(r);
  }
}

function enterNode(r: RunState, nodeId: string): void {
  commitRun(chooseNode(r, nodeId));
  showRunStep();
}

function showRunMap(r: RunState): void {
  map.hide();
  leaveBattlefield();
  screens.showMap({
    run: r,
    available: availableNodes(r),
    upgrades: ownedUpgrades(r),
    onChoose: (id) => enterNode(r, id),
    onBack: () => showMap(),
    onAbandon: () => endRun(abandonRun(r)),
  });
  runMapShown = true;
}

function startRunBattle(r: RunState): void {
  const spec: RunBattleSpec = battleSpec(r);
  const def = applyUpgrades(generateRunBattle(spec), r.upgrades);
  mode = 'expedition';
  hud.setRun({
    hp: r.hp,
    maxHp: r.maxHp,
    gold: r.gold,
    kind: spec.kind,
    upgrades: ownedUpgrades(r).map(({ def: u, stacks }) => ({
      icon: upgradeIconSvg(u.icon, '100%'),
      label: u.name,
      stacks,
    })),
  });
  // Seeded per node, and per retry for the boss, so a resumed run replays the same battle.
  beginBattle(def, spec.seed + r.stats.battlesLost);
}

// The battle's outcome goes into the run; then the pick, lost-battle card or run result.
function finishRunBattle(b: Battle): void {
  const r = run;
  if (!r) return showMap();
  resultShown = true;
  input.setPaused(true);
  hud.setVisible(false);
  const victory = b.state.outcome === 'victory';
  const kind = battleSpec(r).kind;
  const next = commitRun(
    finishBattle(r, {
      victory,
      baseHpFraction: b.state.playerBaseMaxHp > 0 ? b.state.playerBaseHp / b.state.playerBaseMaxHp : 0,
      seconds: b.stats.endTime ?? outcomeAt,
    }),
  );
  if (next.phase === 'over') return endRun(next);
  if (next.phase === 'pick') return showRunPick(next);
  if (!victory) {
    const hpLost = next.lastBattle?.hpLost ?? 0;
    screens.showBattleLost({
      hpLost,
      hp: next.hp,
      maxHp: next.maxHp,
      boss: kind === 'boss',
      onContinue: () => showRunStep(),
    });
    return;
  }
  showRunStep(); // a win with nothing left to offer goes straight back to the map
}

function showRunPick(r: RunState): void {
  const node = r.map.nodes.find((n) => n.id === r.at);
  const offer = (r.offer ?? []).map((id) => getUpgrade(id)).filter((u) => u !== undefined);
  const after = (id: string | null): void => {
    commitRun(pickUpgrade(r, id));
    showRunStep();
  };
  screens.showPick({
    title: 'Victory!',
    elite: node?.kind === 'elite',
    offer,
    owned: r.upgrades,
    hp: r.hp,
    maxHp: r.maxHp,
    hpLost: r.lastBattle?.hpLost ?? 0,
    gold: r.gold,
    goldGained: r.lastBattle?.gold ?? 0,
    onPick: (id) => after(id),
    onSkip: () => after(null),
  });
}

function showRunShop(r: RunState): void {
  leaveBattlefield();
  const shop = r.shop;
  if (!shop) return showRunMap(commitRun(leaveShop(r)));
  screens.showShop({
    gold: r.gold,
    hp: r.hp,
    maxHp: r.maxHp,
    items: shop.items.flatMap((it) => {
      const def = getUpgrade(it.upgradeId);
      return def ? [{ def, price: it.price, sold: it.sold, owned: r.upgrades[def.id] ?? 0 }] : [];
    }),
    heal: { price: shop.healPrice, amount: shop.healAmount, done: shop.healed },
    onBuy: (i) => showRunShop(commitRun(buyItem(r, i))),
    onHeal: () => showRunShop(commitRun(buyHeal(r))),
    onLeave: () => {
      commitRun(leaveShop(r));
      showRunStep();
    },
  });
}

function showRunRest(r: RunState): void {
  leaveBattlefield();
  screens.showRest({
    hp: r.hp,
    maxHp: r.maxHp,
    heal: Math.min(r.maxHp - r.hp, Math.round(r.maxHp * RUN_RULES.restHealFraction)),
    onRest: () => {
      commitRun(restHeal(r));
      showRunStep();
    },
  });
}

// Records a finished run (won, lost or abandoned) and shows its result.
function endRun(r: RunState): void {
  const score = runScore(r);
  const prev = r.daily !== undefined ? exp.best.daily[r.daily] : exp.best.bestScore;
  exp = recordRunEnd(exp, r);
  saveExpedition(exp);
  run = undefined;
  runMapShown = false;
  if (!resultShown) leaveBattlefield();
  screens.showRunResult({
    outcome: r.outcome === 'won' ? 'won' : 'lost',
    score,
    best: r.daily !== undefined ? exp.best.daily[r.daily] : exp.best.bestScore,
    newBest: prev === undefined || score > prev,
    daily: r.daily,
    stats: r.stats,
    hp: r.hp,
    maxHp: r.maxHp,
    upgrades: ownedUpgrades(r),
    onNewRun: () => openExpeditionStart(),
    onMap: () => showMap(),
  });
}

// ?expedition=<seed>|daily: resumes the saved run when it has that seed, else starts one.
function bootExpedition(param: string): boolean {
  const daily = param === 'daily' ? dailySeed(new Date()) : undefined;
  const seed = daily ? daily.seed : Number(param);
  if (!Number.isInteger(seed) || seed <= 0) return false;
  if (run && run.seed === seed && run.daily === daily?.daily) showRunStep();
  else startRun(seed, daily?.daily);
  return true;
}

function pause(reason: 'user' | InterruptReason): void {
  if (!inBattle || input.paused || resultShown) return;
  input.setPaused(true);
  hud.setVisible(false);
  showPauseOverlay(reason);
}

function showPauseOverlay(reason: 'user' | InterruptReason): void {
  overlays.showPause({
    reason,
    onResume: () => {
      // Resuming while still in landscape on a phone swaps to the rotate prompt instead.
      if (isLandscapeTouch()) return showPauseOverlay('orientation');
      input.setPaused(false);
      hud.setVisible(true);
      wake();
    },
    // An Expedition battle restarts as it was entered; leaving keeps the run in its
    // battle phase, so Resume re-enters it.
    onRestart: () => (mode === 'expedition' ? showRunStep() : startLevel(level.id)),
    onMap: () => showMap(),
  });
}

function showResult(b: Battle): void {
  resultShown = true;
  input.setPaused(true);
  hud.setVisible(false);
  const victory = b.state.outcome === 'victory';
  const stars = evaluateStars(level, b.state, b.stats);
  const time = b.stats.endTime ?? outcomeAt;
  const r = recordResult(save, level.id, { victory, stars, time });
  save = r.save;
  writeSave(save);
  const next = nextLevelId(level.id);
  const id = level.id;
  overlays.showResult(victory ? 'victory' : 'defeat', {
    levelName: level.name,
    timeSeconds: time,
    hasNext: !!next,
    stars: victory ? stars : [false, false, false],
    goals: starGoalLabels(level),
    newBest: r.newBest,
    onRetry: () => startLevel(id),
    onNext: () => (next ? openLevelCard(next) : showMap()),
    onMap: () => showMap(),
  });
}

// One fixed sim step. Paused input makes battle.step a no-op, so pause needs no special case.
function simStep(): void {
  if (!battle) return;
  const before = events.length;
  battle.step(input.sample(), events);
  if (events.length > before) haptics.onEvents(events.slice(before));
  if (outcomeAt < 0 && battle.state.outcome !== 'playing') {
    outcomeAt = battle.state.time;
    haptics.result(battle.state.outcome === 'victory');
  }
}

let looping = false;
let contextLost = false; // the WebGL context is gone: draw nothing until it is restored
let woke = false; // the next frame is the first after a restart; its delta spans the menu time
let drawnFps = 0; // smoothed rate of frames actually drawn (rAF may tick faster than the cap)

// (Re)starts the render loop; a no-op while running or while no battlefield is on screen.
function wake(): void {
  if (looping || !inBattle || contextLost) return;
  looping = true;
  woke = true;
  loop.reset();
  frameCap.reset();
  engine.runRenderLoop(renderFrame);
}

function stopLoop(): void {
  looping = false;
  engine.stopRenderLoop(renderFrame);
}

function renderFrame(): void {
  if (!battle || !sim || !inBattle) {
    stopLoop();
    return;
  }
  // 60 fps cap: skip rAF callbacks that arrive sooner than one 60 Hz frame. Nothing is
  // drawn on a skipped callback, so the canvas keeps showing the last frame.
  const gap = frameCap.tick(performance.now());
  if (gap < 0) return;
  if (gap > 0) drawnFps = drawnFps > 0 ? drawnFps + (1 / gap - drawnFps) * 0.1 : 1 / gap;
  const dt = woke ? 0 : gap;
  woke = false;
  if (!input.paused && !stageLoading) loop.advance(dt, simStep);
  // After the outcome the crowd keeps settling (the sim keeps stepping) until the result screen.
  if (outcomeAt >= 0 && !resultShown && battle.state.time - outcomeAt >= RESULT_DELAY) {
    if (mode === 'expedition') finishRunBattle(battle);
    else showResult(battle);
  }
  renderer.frame({
    view: sim.view,
    battle: battle.state,
    cannonX: battle.cannonX,
    time: sim.time,
    dt,
    events,
    defenders: sim.defenders,
  });
  hud.update(battle.state, level.name, {
    bossName: level.boss?.name,
    bossPhases: level.boss?.phases.length,
  });
  events.length = 0;
  // Static menu up and this frame drawn under it: stop until resume, retry or next
  // (a loading battle keeps drawing so its shaders compile under the loading screen).
  if ((input.paused && !stageLoading) || resultShown) stopLoop();
}

input.onPauseKey(() => {
  if (resultShown) return;
  if (input.paused) return; // the overlay's Resume button handles unpausing
  pause('user');
});
watchInterruptions((r) => pause(r));

// A resize clears the canvas; redraw once even when the loop is stopped behind a menu.
engine.onResizeObservable.add(() => wake());

// GPU context loss (iOS drops WebGL contexts under memory pressure or after a long time
// in the background). Babylon's in-place restore proved unreliable there (a blank or
// half-rebuilt battlefield), so the page reloads back to where the player was as soon
// as it is visible (core/recovery.ts). Only when losses repeat right after a recovery
// does the game stay put: it pauses, stops drawing into the dead context, and if the
// context comes back the renderer recompiles and refits under the pause card.
engine.onContextLostObservable.add(() => {
  contextLost = true;
  stopLoop();
  const { plan, count } = planRecovery(readRecovery(), Date.now());
  const target: RecoveryTarget =
    inBattle && !resultShown
      ? mode === 'campaign'
        ? { kind: 'level', id: level.id }
        : { kind: 'expedition' }
      : runMapShown || screens.visible
        ? { kind: 'expedition' }
        : { kind: 'map' };
  if (plan !== 'give-up' && writeRecovery({ at: Date.now(), count, target })) {
    console.warn(`WebGL context lost: reloading (${plan})`);
    if (plan === 'reload-low') writeSavedRender({ quality: 'low', post: 'off' });
    reloadWhenVisible();
    return;
  }
  // Lost again right after two reloads: stop reloading and say so instead of a blank screen.
  window.__hordeFatal?.(
    "This phone keeps dropping the game's graphics (WebGL context lost). " +
      'Close the game and Safari completely, then open it again. If that does not help, restart the phone.',
  );
  pause('hidden');
});

function reloadWhenVisible(): void {
  if (document.visibilityState === 'visible') {
    location.reload();
    return;
  }
  const onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onVisible);
    location.reload();
  };
  document.addEventListener('visibilitychange', onVisible);
}
engine.onContextRestoredObservable.add(() => {
  contextLost = false;
  renderer.contextRestored();
  wake();
});

// Boot: ?level=<id> goes straight into that battle, ?expedition=<seed>|daily onto the
// run; after a context-loss reload, back to where the player was; otherwise the world map.
function boot(): void {
  const startId = params.get('level');
  const expParam = params.get('expedition');
  const recovered = takeRecoveryTarget();
  if (startId && getLevelById(startId)) return startLevel(startId);
  if (expParam && bootExpedition(expParam)) return;
  if (recovered?.kind === 'level' && getLevelById(recovered.id)) return startLevel(recovered.id);
  if (recovered?.kind === 'expedition' && run) return showRunStep();
  showMap();
}
boot();
// A battle lifts the loading screen itself once its scene is ready; a menu once the font is in.
if (!inBattle) void loading.hideWhen(fontsReady);
window.__hordeBooted = true; // the first screen is up: the index.html boot guard stands down

window.__horde = {
  state: () => (battle ? battle.state : ({} as BattleState)),
  fps: () => drawnFps,
  zoom: () => renderer.cameraZoom,
  level: () =>
    screens.visible && runMapShown ? 'expedition-map' : inBattle ? level.id : screens.visible ? 'expedition' : 'map',
  spawn: (n: number, champion = false) => {
    const count = Math.max(0, Math.floor(n));
    if (count > 0 && sim && battle) {
      const kind = champion ? UnitKind.Champion : UnitKind.Mob;
      // Spread over rows up the lane like a cannon stream (all on one z, separation
      // squeezes a big spawn into a single solid band across the rug).
      const spread = level.lane.width / 2 - 0.6;
      const perRow = Math.max(1, Math.floor(spread * 2.2));
      const rows = Math.ceil(count / perRow);
      const depth = Math.min(22, rows * 0.9);
      for (let r = 0, left = count; r < rows && left > 0; r++) {
        const k = r === rows - 1 ? left : Math.min(left, perRow);
        sim.spawn(
          Team.Player,
          kind,
          battle.cannonX,
          LAYOUT.cannonZ + 2 + (rows > 1 ? (r / (rows - 1)) * depth : 0),
          k,
          { spread },
        );
        left -= k;
      }
    }
  },
  units: () => (sim ? sim.view.count : 0),
  goto: (id: string) => {
    if (!getLevelById(id)) return false;
    startLevel(id);
    return true;
  },
  render: () => renderer.stats(),
  expedition: () => run ?? null,
  expeditionChoose: (id: string) => {
    if (!run || !availableNodes(run).includes(id)) return false;
    screens.hide();
    enterNode(run, id);
    return true;
  },
  win: () => {
    if (battle && battle.state.outcome === 'playing') battle.state.enemyBaseHp = 0;
  },
};

// ?debug exposes the Babylon scene for console inspection (draw-call and mesh audits).
if (params.has('debug')) (window as unknown as { __scene?: unknown }).__scene = renderer.scene;

if (import.meta.env.PROD) registerServiceWorker();
