// Boot and per-frame wiring. One renderer, input, HUD, overlay set and world map live
// for the whole session; each battle (card Play, retry, next level) gets a fresh RNG,
// sim and battle. Flow: world map → level card → battle → result (stars saved via
// recordResult) → Next opens the next level's card / Map / Retry. `?level=1-1` skips
// the menus straight into a battle (used by the smoke test).
// Per rendered frame: loop.advance → input.sample → battle.step (which steps the sim)
// → renderer.frame → hud.update. The sim runs at a fixed SIM_HZ. While a menu covers
// the battlefield nothing moves, so the loop draws one frame under it and then stops
// (concept §8 "Heat and battery"); wake() restarts it. Drawing is capped at 60 fps even
// on a 120 Hz screen (iPhone 17 Pro Max): rAF callbacks that come too soon are skipped.
// The camera only zooms out gently as the crowd grows; it never shakes.
import { Engine } from '@babylonjs/core/Engines/engine';
import { LAYOUT, Team, UnitKind, starGoalLabels } from './contracts.ts';
import type { BattleState, LevelDef, SaveData, SimEvent, WorldDef } from './contracts.ts';
import { createSim } from './sim/index.ts';
import type { Sim } from './sim/index.ts';
import { createBattle } from './game/battle.ts';
import type { Battle } from './game/battle.ts';
import { getLevel, getLevelById, getWorld } from './game/levels.ts';
import { evaluateStars, goalStatus } from './game/stars.ts';
import { createRenderer } from './render/index.ts';
import { createRng } from './core/rng.ts';
import { createFixedStep, createFrameCap } from './core/loop.ts';
import { loadSettings } from './core/settings.ts';
import { createInput } from './core/input.ts';
import { isLandscapeTouch, watchInterruptions } from './core/lifecycle.ts';
import type { InterruptReason } from './core/lifecycle.ts';
import { createHaptics } from './core/haptics.ts';
import { registerServiceWorker } from './core/pwa.ts';
import { loadSave, recordResult, writeSave } from './core/save.ts';
import { createWorldMap } from './meta/worldMap.ts';
import { createHud, hudReserve } from './ui/hud.ts';
import { createOverlays } from './ui/overlays.ts';

// Seconds the battlefield keeps playing after the outcome before the result screen.
const RESULT_DELAY = 1.2;

declare global {
  interface Window {
    __horde?: {
      state(): BattleState;
      fps(): number; // frames actually drawn per second (capped at 60)
      zoom(): number; // current crowd zoom-out of the camera (0 = none)
      level(): string;
      spawn(n: number): void;
      units(): number; // live sim units (stacked units count once)
      goto(levelId: string): boolean; // start a battle on that level, skipping menus
    };
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const app = document.getElementById('app') as HTMLElement;

// MSAA is expensive at phone DPRs and barely visible there; keep it for low-DPR screens.
const antialias = window.devicePixelRatio < 2;
const engine = new Engine(
  canvas,
  antialias,
  { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', audioEngine: false },
  false, // the renderer owns hardware scaling (automatic resolution scaling)
);

const world: WorldDef = getWorld('w1') ?? { id: 'w1', name: 'Bedroom Floor', faction: 'Tan Army', levels: [getLevel(0).id] };
const levelDef = (id: string): LevelDef => getLevelById(id) ?? getLevel(0);

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
});

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

function showMap(): void {
  overlays.hide();
  inBattle = false;
  input.setPaused(true);
  hud.setVisible(false);
  map.show(save);
}

function startLevel(id: string): void {
  map.hide();
  overlays.hide();
  level = levelDef(id);
  const rng = createRng(seedCounter++);
  const rand = (): number => rng.next();
  const s = createSim(level, rand);
  sim = s;
  battle = createBattle(level, s, rand);
  inBattle = true;
  outcomeAt = -1;
  resultShown = false;
  events.length = 0;
  renderer.loadLevel(level);
  input.configure({ laneWidth: level.lane.width, aimLimit: level.cannon.aimLimit });
  input.setPaused(false);
  hud.setVisible(true);
  loop.reset();
  wake();
  // Every battle entry path (map, retry, next) honours the portrait-only rule.
  if (isLandscapeTouch()) pause('orientation');
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
    onRestart: () => startLevel(level.id),
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
let woke = false; // the next frame is the first after a restart; its delta spans the menu time
let drawnFps = 0; // smoothed rate of frames actually drawn (rAF may tick faster than the cap)

// (Re)starts the render loop; a no-op while running or while no battlefield is on screen.
function wake(): void {
  if (looping || !inBattle) return;
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
  if (!input.paused) loop.advance(dt, simStep);
  // After the outcome the crowd keeps settling (the sim keeps stepping) until the result screen.
  if (outcomeAt >= 0 && !resultShown && battle.state.time - outcomeAt >= RESULT_DELAY) showResult(battle);
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
    goals: goalStatus(level, battle.state, battle.stats),
  });
  events.length = 0;
  // Static menu up and this frame drawn under it: stop until resume, retry or next.
  if (input.paused || resultShown) stopLoop();
}

input.onPauseKey(() => {
  if (resultShown) return;
  if (input.paused) return; // the overlay's Resume button handles unpausing
  pause('user');
});
watchInterruptions((r) => pause(r));

// A resize clears the canvas; redraw once even when the loop is stopped behind a menu.
engine.onResizeObservable.add(() => wake());

// Boot: ?level=<id> goes straight into that battle, otherwise the world map.
const startId = params.get('level');
if (startId && getLevelById(startId)) startLevel(startId);
else showMap();

window.__horde = {
  state: () => (battle ? battle.state : ({} as BattleState)),
  fps: () => drawnFps,
  zoom: () => renderer.cameraZoom,
  level: () => (inBattle ? level.id : 'map'),
  spawn: (n: number) => {
    const count = Math.max(0, Math.floor(n));
    if (count > 0 && sim && battle) {
      sim.spawn(Team.Player, UnitKind.Mob, battle.cannonX, LAYOUT.cannonZ + 2, count, { spread: level.lane.width / 2 - 0.6 });
    }
  },
  units: () => (sim ? sim.view.count : 0),
  goto: (id: string) => {
    if (!getLevelById(id)) return false;
    startLevel(id);
    return true;
  },
};

if (import.meta.env.PROD) registerServiceWorker();
