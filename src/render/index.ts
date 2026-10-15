// Render entry point: owns the Babylon scene and draws a battle each frame from the
// sim view and battle state. Integration calls createRenderer once, setLoadout (optional)
// and loadLevel per battle (retry / next), frame() every rendered frame and cue() for
// each battle cue (shots, ultimates, bomber blasts).
//
// The picture comes from the shared look (look/index.ts: warm window sun with a fitted
// PCF shadow map, cool sky / warm floor-bounce fill, HDRI reflections, ACES grade, MSAA or
// FXAA, mild bloom and a warm vignette) and the procedural toy models in models/. Two
// governors keep a phone at 60 fps: the look's quality tier (shadow map size, crowd
// shadows vs blob shadows, post-processing) and the render resolution. They take turns:
// whenever one steps, the other ignores frame times for a moment, so a slow stretch
// costs one notch, not two.
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import type { BattleState, DefenderView, LevelDef, SimEvent, SimView } from '../contracts.ts';
import { DEFENDER_DEFAULTS, LAYOUT } from '../contracts.ts';
import { BlankWatch, createLook, isBlankSample, readSavedRender, writeSavedRender } from './look/index.ts';
import type { Look } from './look/index.ts';
import { LevelVisuals } from './level.ts';
import { CrowdRenderer } from './crowd.ts';
import { Effects } from './effects.ts';
import { DefenderVisuals } from './defenders.ts';
import { Cannon } from './cannon.ts';
import { HpBars } from './hpBars.ts';
import { createPropKit } from './models/props.ts';
import { CameraRig } from './cameraRig.ts';
import { ResolutionScaler } from './resolution.ts';
import { screenRows } from './framing.ts';
import { UltimateVisuals } from './ultimates.ts';
import { parseCannon, parseChampion } from './crowdLogic.ts';
import type { CannonId, ChampionId } from './crowdLogic.ts';
import type { VariantView } from './crowd.ts';

export type { VariantView } from './crowd.ts';
export type { CannonId, ChampionId } from './crowdLogic.ts';

// Battle cues the renderer draws (field for field the battle task's BattleCue).
export type FxCue =
  | {
      type: 'ultimate';
      id: 'barrage' | 'paratroopers' | 'marble';
      x: number;
      z: number;
      radius: number;
      duration: number;
    }
  | { type: 'blast'; x: number; z: number; radius: number }
  | { type: 'shot'; x: number; count: number };

// The battle visuals a loadout picks (default: popgun and sarge).
export interface RenderLoadout {
  cannon: CannonId;
  champion: ChampionId;
}

export interface RenderFrame {
  view: SimView | VariantView; // read live this frame, never retained (variant: Milestone 4)
  battle: BattleState;
  cannonX: number; // world x of the cannon (already clamped by the game)
  time: number; // battle/sim time in seconds
  dt: number; // real seconds since last rendered frame
  events: readonly SimEvent[]; // all sim events produced since the last frame
  // Live defender state (sim.defenders), read this frame only. Omitted: defenders stand at full HP.
  // The enemy base x comes from battle.enemyBaseX (falls back to level.enemyBase.x).
  defenders?: readonly DefenderView[];
}

// CSS px the HUD covers at the top and bottom of the canvas, safe-area insets included.
export interface HudReserve {
  top: number;
  bottom: number;
  topBar?: number; // bottom of the top HUD's first row; tall far-end models may rise to it
}

export interface RendererOptions {
  hudReserve?: () => HudReserve; // read on every reframe, so inset changes are picked up on resize
}

export interface RenderStats {
  drawCalls: number; // every pass of the last frame: shadow map, main, post
  activeMeshes: number;
  activeIndices: number; // indices drawn by the main pass (triangles x 3, thin instances included)
  totalVertices: number; // vertices held by all meshes in the scene
  quality: string; // look tier: high / medium / low
  pixelRatio: number; // render pixels per CSS pixel
}

export interface GameRenderer {
  readonly scene: Scene;
  loadLevel(level: LevelDef): void;
  frame(f: RenderFrame): void;
  dispose(): void;
  readonly cameraZoom: number; // current crowd zoom-out (0 = framed view, up to ZOOM_MAX); for debugging
  stats(): RenderStats; // last rendered frame's cost; for debugging and the smoke test
  contextRestored(): void; // the WebGL context came back: resize, refit, re-warm before drawing
  // Milestone 4. Call before loadLevel; swaps the cannon model and the champion meshes.
  setLoadout(l: RenderLoadout): void;
  // A battle cue (shot puffs, ultimates, bomber blasts); call as the battle produces them.
  cue(c: FxCue): void;
  crowdBatches(): number; // crowd thin-instance batches drawn last frame (main pass); for debugging
}

let activeScaler: ResolutionScaler | null = null;

// Current render pixel ratio (render pixels per CSS pixel) of the live renderer; for debugging.
export function getRenderPixelRatio(): number {
  return activeScaler ? activeScaler.ratio : 1;
}

// Lowest render pixel ratio allowed on each quality tier (see frame()).
const RATIO_FLOOR = { high: 1.25, medium: 1, low: 0.75 } as const;

// Shadow frustum margin beside the rug: the props the portrait camera can see there.
const SHADOW_SIDE_MARGIN = 7;

export function createRenderer(engine: Engine, canvas: HTMLCanvasElement, opts: RendererOptions = {}): GameRenderer {
  const scene = new Scene(engine);
  scene.autoClear = true; // the room covers most of the view, but a clear is cheap and avoids smearing past the far plane
  scene.autoClearDepthAndStencil = true;
  scene.skipPointerMovePicking = true;
  scene.skipPointerDownPicking = true;
  scene.skipPointerUpPicking = true;

  const rig = new CameraRig(scene);
  scene.activeCamera = rig.camera;
  const look: Look = createLook(scene, { camera: rig.camera, remember: true });
  const crowd = new CrowdRenderer(scene, look);
  const effects = new Effects(scene, look);
  const defenders = new DefenderVisuals(scene, look);
  const cannon = new Cannon(scene, look);
  const props = createPropKit(scene, look);
  const bars = new HpBars(scene);
  const ultimates = new UltimateVisuals(scene, look, effects);
  defenders.onBlocksFell = (points) => {
    for (const p of points) effects.dust(p.x, p.z);
  };

  // Start from the tier and ratio the last session settled on (a URL-forced tier starts
  // at the device ratio and remembers nothing).
  const scaler = new ResolutionScaler(window.devicePixelRatio || 1, look.locked ? undefined : readSavedRender().ratio);
  const rememberRatio = (): void => {
    if (!look.locked) writeSavedRender({ ratio: scaler.ratio });
  };
  activeScaler = scaler;
  engine.setHardwareScalingLevel(scaler.scalingLevel);

  let level: LevelVisuals | null = null;
  // Watches for a canvas the pipeline never draws into (look/blankWatch.ts).
  const blank = new BlankWatch();
  const probe = new Uint8Array(12);
  const lastStats: RenderStats = {
    drawCalls: 0,
    activeMeshes: 0,
    activeIndices: 0,
    totalVertices: 0,
    quality: look.quality,
    pixelRatio: scaler.ratio,
  };

  const reframe = (): void => {
    if (!level) return;
    const h = engine.getRenderHeight();
    const aspect = h > 0 ? engine.getRenderWidth() / h : 0.46;
    const reserve = opts.hudReserve?.();
    const rows = reserve ? screenRows(canvas.clientHeight, reserve.top, reserve.bottom) : undefined;
    // The enemy flag tip / boss plume ends at least 16 px under the HUD's top bar row
    // (the level-name row under it fades out early; its badges sit at the right edge).
    const ch = canvas.clientHeight;
    const limit = reserve && rows && ch > 0 ? 1 - (2 * ((reserve.topBar ?? reserve.top) + 16)) / ch : undefined;
    rig.reframe(level.level, aspect, rows, level.farTop(), limit);
    level.setLabelTilt(rig.pitch);
    bars.setTilt(rig.pitch);
  };

  const onResize = (): void => {
    engine.resize();
    reframe();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  // The canvas can change size without a window resize (100dvh toolbar collapse).
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  observer?.observe(canvas);

  // Sim events → flashes, pops and pooled particles. Nothing here may move the camera.
  const handleEvents = (events: readonly SimEvent[]): void => {
    if (!level) return;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'gate':
          level.pulseGate(e.gateId, e.added);
          if (e.usesLeft !== undefined) level.setGateUses(e.gateId, e.usesLeft);
          effects.gateBurst(e.x, e.z, level.gateWidth(e.gateId), e.added > 0);
          break;
        case 'gateBroken':
          effects.gateShards(e.x, e.z, level.gateWidth(e.gateId), level.breakGate(e.gateId));
          break;
        case 'unitsClash':
          effects.clash(e.x, e.z);
          break;
        case 'championLaunched':
          effects.championLaunched(e.x, LAYOUT.cannonZ + 0.6);
          break;
        case 'victory': {
          const d = level.level;
          effects.victory(level.enemyBaseX, d.lane.length + LAYOUT.enemyBaseDepth / 2, d.enemyBase.width);
          break;
        }
        case 'defeat':
          effects.defeat(0, LAYOUT.playerBaseZ - LAYOUT.playerBaseDepth / 2, level.level.lane.width * 0.8);
          break;
        case 'baseHit':
          level.flashBaseAt(e.z);
          effects.baseHit(e.x, e.z, e.team);
          break;
        case 'baseMiss':
          effects.missPuff(e.x, e.z);
          break;
        case 'defenderShot': {
          const from = defenders.shot(e.id, e.tx, e.tz);
          if (from) effects.dart(from.x, from.z, e.tx, e.tz, from.y);
          else effects.dart(e.x, e.z, e.tx, e.tz);
          break;
        }
        case 'defenderHit':
          defenders.hit(e.id);
          break;
        case 'defenderDestroyed':
          defenders.destroyed(e.id);
          effects.debris(e.x, e.z, e.kind === 'wall', defenderWidth(level.level, e.id));
          break;
        case 'bossPhase':
          level.bossPhase();
          effects.phaseRing(e.x, e.z + 1.5, level.level.enemyBase.width);
          break;
        default:
          break;
      }
    }
  };

  const cue = (c: FxCue): void => {
    switch (c.type) {
      case 'shot':
        effects.muzzlePuff(cannon.muzzleX(), cannon.muzzleY(), cannon.muzzleZ());
        break;
      case 'blast':
        effects.blast(c.x, c.z, c.radius);
        break;
      case 'ultimate':
        if (c.id === 'barrage') effects.barrage(cannon.muzzleX(), cannon.muzzleY(), cannon.muzzleZ(), c.z, c.radius);
        else if (c.id === 'paratroopers') ultimates.paratroopers(c.x, c.z, c.radius, c.duration);
        else ultimates.marbleRoll(c.x, c.z, c.duration);
        break;
      default:
        break;
    }
  };

  return {
    scene,
    get cameraZoom() {
      return rig.zoomAmount;
    },

    loadLevel(def: LevelDef): void {
      level?.dispose();
      level = new LevelVisuals(scene, look, def, props);
      defenders.load(def.defenders);
      cannon.setFireRate(def.cannon.fireRate);
      effects.clear();
      ultimates.clear();
      rig.resetZoom();
      // Sun shadows cover the lane, both bases, the flag and the props beside the rug.
      const half = def.lane.width / 2 + SHADOW_SIDE_MARGIN;
      look.fitShadows({
        minX: -half,
        maxX: half,
        minZ: LAYOUT.playerBaseZ - LAYOUT.playerBaseDepth - 1,
        maxZ: def.lane.length + LAYOUT.enemyBaseDepth * (def.boss ? 1.7 : 1.3) + 1.5,
        maxY: def.boss ? 7 : 5.2,
      });
      // A tier drop mid-battle left its shader-changing parts for now, behind the load.
      look.applyPending();
      // Shader compiles and uploads after a load are not a steady frame time.
      scaler.warmUp();
      look.warmUp();
      reframe();
      blank.start();
    },

    frame(f: RenderFrame): void {
      const dt = Math.min(Math.max(f.dt, 0), 0.1);
      handleEvents(f.events);
      level?.update(f.time, dt, f.battle);
      defenders.update(f.defenders, dt);
      cannon.update(f.cannonX, f.time, f.battle.outcome === 'playing', dt);
      crowd.update(f.view, f.time);
      ultimates.update(dt);
      effects.update(dt);
      bars.begin();
      level?.drawBars(bars);
      defenders.drawBars(bars);
      bars.commit();
      rig.update(dt, f.battle.playerUnits); // gentle crowd zoom-out; the camera never shakes
      // Degrade in alternating notches: ratio 1.5 -> 1.25, then the high -> medium tier,
      // ratio -> 1.0, medium -> low, ratio -> 0.75. The resolution may only drop to the
      // floor of the current tier; at the floor the tier governor takes the next notch.
      // Each step quiets the other governor for a moment.
      scaler.floor = RATIO_FLOOR[look.quality];
      const atFloor = scaler.ratio <= Math.min(scaler.floor, scaler.cap) + 1e-6;
      if (atFloor && look.sample(f.dt)) scaler.warmUp(1);
      else if (scaler.sample(f.dt)) {
        engine.setHardwareScalingLevel(scaler.scalingLevel);
        look.warmUp(1);
        rememberRatio();
        reframe();
      }
      const calls0 = engine._drawCalls.current; // the counter only ever accumulates
      scene.render();
      lastStats.drawCalls = engine._drawCalls.current - calls0;
      lastStats.activeMeshes = scene.getActiveMeshes().length;
      lastStats.activeIndices = scene.getActiveIndices();
      lastStats.totalVertices = scene.getTotalVertices();
      lastStats.quality = look.quality;
      lastStats.pixelRatio = scaler.ratio;
      if (blank.tick(f.dt) && blank.report(canvasBlank(engine, probe)) && look.degradePost()) {
        scaler.warmUp();
        look.warmUp();
        blank.start();
      }
    },

    stats(): RenderStats {
      return { ...lastStats };
    },

    setLoadout(l: RenderLoadout): void {
      cannon.setModel(parseCannon(l.cannon));
      crowd.setChampion(parseChampion(l.champion));
    },

    cue,

    crowdBatches(): number {
      return crowd.drawBatches;
    },

    contextRestored(): void {
      // Babylon has rebuilt the GPU resources by now; shaders recompile on the next
      // frames, so give both governors a warm-up and redraw the shadow map.
      engine.setHardwareScalingLevel(scaler.scalingLevel);
      engine.resize();
      look.contextRestored();
      scaler.warmUp();
      reframe();
      blank.start();
    },

    dispose(): void {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      observer?.disconnect();
      level?.dispose();
      level = null;
      crowd.dispose();
      ultimates.dispose();
      effects.dispose();
      defenders.dispose();
      cannon.dispose();
      props.dispose();
      bars.dispose();
      look.dispose();
      if (activeScaler === scaler) activeScaler = null;
      scene.dispose();
    },
  };
}

// Reads three canvas pixels (centre, upper and lower third) right after the frame was
// drawn, before the browser composites and clears it; blank when none has any alpha.
function canvasBlank(engine: Engine, out: Uint8Array): boolean {
  const gl = (engine as unknown as { _gl?: WebGLRenderingContext | null })._gl;
  if (!gl || gl.isContextLost()) return false;
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  if (w <= 0 || h <= 0) return false;
  engine.restoreDefaultFramebuffer();
  const x = w >> 1;
  const rows = [h >> 1, Math.floor(h / 3), Math.floor((2 * h) / 3)];
  for (let i = 0; i < rows.length; i++)
    gl.readPixels(x, rows[i], 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out.subarray(i * 4, i * 4 + 4));
  return isBlankSample(out);
}

function defenderWidth(level: LevelDef, id: string): number {
  const d = level.defenders?.find((x) => x.id === id);
  if (!d) return DEFENDER_DEFAULTS.towerWidth;
  return d.width ?? (d.kind === 'wall' ? DEFENDER_DEFAULTS.wallWidth : DEFENDER_DEFAULTS.towerWidth);
}
