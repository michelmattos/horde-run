// Boot and per-frame wiring. One renderer, input, HUD and overlay set live for the
// whole session; each battle (first load, retry, next level) gets a fresh RNG, sim
// and battle. Per rendered frame: loop.advance → input.sample → battle.step (which
// steps the sim) → renderer.frame → hud.update. The sim runs at a fixed SIM_HZ.
// While the pause or result overlay is up nothing moves, so the loop draws one frame
// under it and then stops (concept §8 "Heat and battery"); wake() restarts it.
import { Engine } from '@babylonjs/core/Engines/engine';
import { LAYOUT, Team, UnitKind } from './contracts.ts';
import type { BattleState, LevelDef, SimEvent } from './contracts.ts';
import { createSim } from './sim/index.ts';
import type { Sim } from './sim/index.ts';
import { createBattle } from './game/battle.ts';
import type { Battle } from './game/battle.ts';
import { getLevel, levelCount } from './game/levels.ts';
import { createRenderer } from './render/index.ts';
import { createRng } from './core/rng.ts';
import { createFixedStep } from './core/loop.ts';
import { loadSettings } from './core/settings.ts';
import { createInput } from './core/input.ts';
import { watchInterruptions } from './core/lifecycle.ts';
import type { InterruptReason } from './core/lifecycle.ts';
import { createHaptics } from './core/haptics.ts';
import { registerServiceWorker } from './core/pwa.ts';
import { createHud, hudReserve } from './ui/hud.ts';
import { createOverlays } from './ui/overlays.ts';

// Seconds the battlefield keeps playing after the outcome before the result screen.
const RESULT_DELAY = 1.2;

declare global {
  interface Window {
    __horde?: {
      state(): BattleState;
      fps(): number;
      level(): string;
      spawn(n: number): void;
      units(): number; // live sim units (stacked units count once)
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

const settings = loadSettings();
const renderer = createRenderer(engine, canvas, { hudReserve });
const input = createInput(canvas, settings);
const haptics = createHaptics(settings);
const overlays = createOverlays(app, settings);
const loop = createFixedStep();
const hud = createHud(renderer.scene, input, { onPause: () => pause('user') });

// Optional ?seed=N makes a session reproducible; otherwise every battle differs.
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
let seedCounter = Number.isFinite(seedParam) && seedParam !== 0 ? seedParam : Date.now();

let levelIndex = 0;
let level: LevelDef = getLevel(0);
let sim: Sim;
let battle: Battle;
let outcomeAt = -1; // sim time the outcome was reached, -1 while playing
let resultShown = false;
const events: SimEvent[] = []; // battle events since the last rendered frame

function startLevel(index: number): void {
  levelIndex = ((index % levelCount()) + levelCount()) % levelCount();
  level = getLevel(levelIndex);
  const rng = createRng(seedCounter++);
  const rand = (): number => rng.next();
  sim = createSim(level, rand);
  battle = createBattle(level, sim, rand);
  outcomeAt = -1;
  resultShown = false;
  events.length = 0;
  renderer.loadLevel(level);
  input.configure({ laneWidth: level.lane.width, aimLimit: level.cannon.aimLimit });
  input.setPaused(false);
  hud.setVisible(true);
  loop.reset();
  wake();
}

function pause(reason: 'user' | InterruptReason): void {
  if (input.paused || resultShown) return;
  input.setPaused(true);
  hud.setVisible(false);
  overlays.showPause({
    reason,
    onResume: () => {
      input.setPaused(false);
      hud.setVisible(true);
      wake();
    },
    onRestart: () => startLevel(levelIndex),
  });
}

function showResult(): void {
  resultShown = true;
  input.setPaused(true);
  hud.setVisible(false);
  const outcome = battle.state.outcome === 'victory' ? 'victory' : 'defeat';
  overlays.showResult(outcome, {
    levelName: level.name,
    timeSeconds: outcomeAt,
    hasNext: levelIndex + 1 < levelCount(),
    onRetry: () => startLevel(levelIndex),
    onNext: () => startLevel(levelIndex + 1),
  });
}

// One fixed sim step. Paused input makes battle.step a no-op, so pause needs no special case.
function simStep(): void {
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

// (Re)starts the render loop; a no-op while it is running.
function wake(): void {
  if (looping) return;
  looping = true;
  woke = true;
  loop.reset();
  engine.runRenderLoop(renderFrame);
}

startLevel(0);

input.onPauseKey(() => {
  if (resultShown) return;
  if (input.paused) return; // the overlay's Resume button handles unpausing
  pause('user');
});
watchInterruptions((r) => pause(r));

function renderFrame(): void {
  const dt = woke ? 0 : engine.getDeltaTime() / 1000;
  woke = false;
  if (!input.paused) loop.advance(dt, simStep);
  // After the outcome the crowd keeps settling (the sim keeps stepping) until the result screen.
  if (outcomeAt >= 0 && !resultShown && battle.state.time - outcomeAt >= RESULT_DELAY) showResult();
  renderer.frame({
    view: sim.view,
    battle: battle.state,
    cannonX: battle.cannonX,
    time: sim.time,
    dt,
    events,
  });
  hud.update(battle.state, level.name);
  events.length = 0;
  // Static menu up and this frame drawn under it: stop until resume, retry or next.
  if (input.paused || resultShown) {
    looping = false;
    engine.stopRenderLoop(renderFrame);
  }
}

// A resize clears the canvas; redraw once even when the loop is stopped behind a menu.
engine.onResizeObservable.add(() => wake());

window.__horde = {
  state: () => battle.state,
  fps: () => engine.getFps(),
  level: () => level.id,
  spawn: (n: number) => {
    const count = Math.max(0, Math.floor(n));
    if (count > 0) sim.spawn(Team.Player, UnitKind.Mob, battle.cannonX, LAYOUT.cannonZ + 2, count, { spread: level.lane.width / 2 - 0.6 });
  },
  units: () => sim.view.count,
};

if (import.meta.env.PROD) registerServiceWorker();
