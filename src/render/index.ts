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
//
// World 2: loadLevel picks the room by LevelDef.theme (absent = the bedroom). Only the
// current theme's room assets live on the GPU: a theme change disposes the old prop kit
// and releases the old room's cached materials and their textures (RoomSlot), then the
// look switches its lights and grade (look.setTheme). Gusts, boss snowball lobs, frozen
// gates, ice walls and igloos come in through handleEvents / cue like every other effect.
//
// World 3 (theme 'workshop'): the Clockwork Workshop room and props, conveyors,
// turntables and saws (level.ts), toggling and gliding gates, shield walls, and the
// Jack-in-the-Box's shuffle cues. Unit-level World 3 effects (arrows, ricochets, the
// Wind-up Robot's gate walk) belong to UnitFx (unitFx.ts), fed the same events.
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import type { BattleState, DefenderView, LevelDef, SimEvent, SimView } from '../contracts.ts';
import { DEFENDER_DEFAULTS, LAYOUT, SHIELD_DEFAULTS, Team } from '../contracts.ts';
import { BlankWatch, createLook, isBlankSample, readSavedRender, writeSavedRender } from './look/index.ts';
import type { Look } from './look/index.ts';
import { LevelVisuals } from './level.ts';
import type { RoomKit } from './level.ts';
import { CrowdRenderer } from './crowd.ts';
import { Effects } from './effects.ts';
import { DefenderVisuals } from './defenders.ts';
import { Cannon } from './cannon.ts';
import { HpBars } from './hpBars.ts';
import { createPropKit } from './models/props.ts';
import { createFreezerPropKit } from './models/freezerProps.ts';
import { createWorkshopPropKit } from './models/workshopProps.ts';
import { UnitFx } from './unitFx.ts';
import { CameraRig } from './cameraRig.ts';
import { ResolutionScaler } from './resolution.ts';
import { screenRows } from './framing.ts';
import { UltimateVisuals } from './ultimates.ts';
import type { UltimateCue } from './ultimates.ts';
import { parseCannon, parseChampion, teamBounds } from './crowdLogic.ts';
import { RoomSlot, gustStrength, roomThemeOf } from './fxLogic.ts';
import type { RoomTheme } from './fxLogic.ts';
import type { CannonId, ChampionId, CrowdBounds } from './crowdLogic.ts';
import type { VariantView } from './crowd.ts';

export type { VariantView } from './crowd.ts';
export type { CannonId, ChampionId } from './crowdLogic.ts';

// Battle cues the renderer draws (field for field the battle task's BattleCue).
export type FxCue =
  | {
      type: 'ultimate';
      id: 'barrage' | 'paratroopers' | 'marble' | 'blizzard';
      x: number;
      z: number;
      radius: number;
      duration: number;
    }
  | { type: 'blast'; x: number; z: number; radius: number }
  | { type: 'shot'; x: number; count: number }
  // Milestone 5 (World 2)
  | { type: 'lob'; x: number; z: number; radius: number; flight: number }
  | { type: 'lobHit'; x: number; z: number; radius: number }
  | { type: 'gustWarn'; dir: -1 | 1; seconds: number }
  | { type: 'gust'; dir: -1 | 1; duration: number }
  | { type: 'iglooRelease'; id: string; x: number; z: number; count: number }
  // Milestone 6 (World 3): the Jack-in-the-Box winds up, then the gates glide.
  | { type: 'shuffleWarn'; seconds: number }
  | { type: 'shuffle'; glide: number };

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
  textures: number; // textures held by the scene
  textureMB: number; // their approximate GPU memory (RGBA8 with mipmaps), MB
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
  // Resolves once the loaded level can draw its finished picture: environment and floor
  // textures in, every material and the shadow map compiled. Frames must keep rendering
  // meanwhile (shaders compile as they are drawn).
  whenReady(): Promise<void>;
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
// Where a boss snowball leaves from: above the enemy base, a little in front of it.
const LOB_FROM_Y = 4.2;
const LOB_FROM_DZ = -1.2;

// Cached material keys (look.material) each room owns; released when the room goes.
const ROOM_MATERIALS: Record<RoomTheme, readonly string[]> = {
  bedroom: ['env-', 'props-'],
  freezer: ['freezer-', 'ice-', 'igloo-'],
  workshop: ['workshop-'],
};

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
  const bars = new HpBars(scene);
  const ultimates = new UltimateVisuals(scene, look, effects);
  const unitFx = new UnitFx(scene, look);
  // The Blizzard's frost sheet covers the enemy crowd's footprint, which only frame()
  // can read (the view is never retained), so its cue waits there for one frame.
  const enemyArea: CrowdBounds = { count: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  let blizzard: UltimateCue | null = null;
  // The current room's prop kit; built on the first loadLevel of a theme.
  const rooms = new RoomSlot<RoomKit>(
    (theme) => {
      look.setTheme(theme);
      if (theme === 'freezer') return { theme, props: createFreezerPropKit(scene, look) };
      if (theme === 'workshop') return { theme, props: createWorkshopPropKit(scene, look) };
      return { theme, props: createPropKit(scene, look) };
    },
    (theme, kit) => {
      kit.props.dispose();
      for (const prefix of ROOM_MATERIALS[theme]) look.releaseMaterials(prefix);
    },
  );
  let room: RoomKit | null = null;
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
    textures: 0,
    textureMB: 0,
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
  // The canvas can change size without a window resize (toolbar collapse; --app-h in index.html).
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
          if (e.kind === 'igloo') effects.snowDebris(e.x, e.z, defenderWidth(level.level, e.id));
          else if (e.kind === 'shield') effects.tinShards(e.x, e.z, defenderWidth(level.level, e.id));
          else effects.debris(e.x, e.z, e.kind === 'wall', defenderWidth(level.level, e.id));
          break;
        // ---- World 2 ----
        case 'gateFrozen':
          level.freezeGate(e.gateId);
          effects.gateFrozen(e.x, e.z, level.gateWidth(e.gateId));
          break;
        case 'gateChipped':
          level.chipGate(e.gateId, e.hp, e.maxHp);
          effects.iceWallHit(e.gateId, e.x, e.z); // a few chips, throttled per gate
          break;
        case 'gateThawed':
          level.thawGate(e.gateId, e.chipped);
          if (e.chipped) effects.iceShatter(e.x, e.z, level.gateWidth(e.gateId));
          else effects.meltDrips(e.x, e.z, level.gateWidth(e.gateId));
          break;
        case 'iceWallHit':
          effects.iceWallHit(e.id, e.x, e.z);
          break;
        case 'giantFell':
          effects.giantFell(e.x, e.z);
          break;
        case 'snowballBurst':
          effects.snowballBurst(e.x, e.z, e.count);
          break;
        case 'unitsFrozen':
          effects.frostRing(e.x, e.z, e.radius);
          break;
        case 'bossPhase':
          level.bossPhase(e.phase);
          effects.phaseRing(e.x, e.z + 1.5, level.level.enemyBase.width);
          break;
        // ---- World 3 ----
        case 'gateToggled':
          effects.gateToggle(e.x, e.z, level.gateWidth(e.gateId), e.on, level.gateHasShutter(e.gateId));
          break;
        case 'gateMoved':
          level.moveGate(e.gateId, e.fromX, e.fromZ, e.x, e.z, e.seconds);
          break;
        case 'sawHit':
          effects.sawHit(e.id, e.x, e.z, e.weight, level.sawRadius(e.id));
          break;
        case 'shieldBlock':
          if (defenders.clang(e.id)) effects.shieldClang(e.id, e.x, e.z);
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
        else if (c.id === 'marble') ultimates.marbleRoll(c.x, c.z, c.duration);
        else if (c.id === 'blizzard') blizzard = c;
        else ultimates.cue(c);
        break;
      case 'lob':
        if (level) {
          effects.lob(c.x, c.z, c.radius, c.flight, level.enemyBaseX, LOB_FROM_Y, level.enemyCenterZ + LOB_FROM_DZ);
          level.bossLob();
        }
        break;
      case 'lobHit':
        effects.lobHit(c.x, c.z, c.radius);
        break;
      case 'gustWarn':
        effects.gustWarn(c.dir, c.seconds);
        level?.bossGustWarn(c.dir, c.seconds);
        break;
      case 'gust':
        effects.gust(c.dir, c.duration);
        level?.bossGust(c.dir, c.duration);
        break;
      case 'iglooRelease': {
        const door = defenders.iglooRelease(c.id);
        effects.iglooRelease(door ? door.x : c.x, door ? door.z : c.z);
        break;
      }
      case 'shuffleWarn':
        level?.bossShuffleWarn(c.seconds);
        break;
      case 'shuffle':
        level?.bossShuffle(c.glide);
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
      level = null;
      const theme = roomThemeOf(def);
      // Drop the old room's defender kits before its materials go (igloos are freezer-only).
      if (rooms.theme !== theme) defenders.load(undefined);
      room = rooms.use(theme);
      level = new LevelVisuals(scene, look, def, room);
      level.onGateLanded = (x, z, width) => effects.gateLanded(x, z, width);
      defenders.load(def.defenders);
      effects.setGustArea(def.lane.width / 2);
      cannon.setFireRate(def.cannon.fireRate);
      effects.clear();
      ultimates.clear();
      unitFx.clear();
      blizzard = null;
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
      unitFx.handleEvents(f.events);
      const gust = f.battle.gust;
      if (gust) effects.setGust(gust.dir, gust.warn, gust.active);
      if (room?.theme === 'freezer')
        room.props.setGust(gust ? gustStrength(gust.warn, gust.active) : 0, gust?.dir ?? 0, f.time);
      level?.update(f.time, dt, f.battle);
      defenders.update(f.defenders, dt);
      cannon.update(f.cannonX, f.time, f.battle.outcome === 'playing', dt);
      if (blizzard) {
        ultimates.cue(blizzard, teamBounds(f.view, Team.Enemy, enemyArea));
        blizzard = null;
      }
      crowd.update(f.view, f.time, f.battle.enemyFrozen ?? 0);
      ultimates.update(dt);
      effects.update(dt);
      unitFx.update(dt);
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
      countTextures(scene, lastStats);
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

    async whenReady(): Promise<void> {
      await Promise.all([look.ready, level?.ready]);
      await scene.whenReadyAsync(true);
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
      unitFx.dispose();
      effects.dispose();
      defenders.dispose();
      cannon.dispose();
      rooms.clear();
      room = null;
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
  return (
    d.width ??
    (d.kind === 'wall'
      ? DEFENDER_DEFAULTS.wallWidth
      : d.kind === 'igloo'
        ? DEFENDER_DEFAULTS.wallWidth * 0.75
        : d.kind === 'shield'
          ? SHIELD_DEFAULTS.width
          : DEFENDER_DEFAULTS.towerWidth)
  );
}

// Texture count and approximate GPU memory (RGBA8, x 4/3 for mipmaps) for stats().
function countTextures(scene: Scene, out: RenderStats): void {
  let bytes = 0;
  const list = scene.textures;
  for (let i = 0; i < list.length; i++) {
    const s = list[i].getSize();
    bytes += s.width * s.height * 4 * (list[i].noMipmap ? 1 : 4 / 3);
  }
  out.textures = list.length;
  out.textureMB = Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
