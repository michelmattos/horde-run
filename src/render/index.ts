// Render entry point: owns the Babylon scene and draws a battle each frame from the
// sim view and battle state. Integration calls createRenderer once, loadLevel per
// battle (retry / next) and frame() every rendered frame.
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { BattleState, DefenderView, LevelDef, SimEvent, SimView } from '../contracts.ts';
import { DEFENDER_DEFAULTS } from '../contracts.ts';
import { PALETTE } from './palette.ts';
import { LevelVisuals } from './level.ts';
import { CrowdRenderer } from './crowd.ts';
import { Effects } from './effects.ts';
import { DefenderVisuals } from './defenders.ts';
import { Cannon } from './cannon.ts';
import { CameraRig } from './cameraRig.ts';
import { ResolutionScaler } from './resolution.ts';
import { screenRows } from './framing.ts';

export interface RenderFrame {
  view: SimView; // read live this frame, never retained
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
}

export interface RendererOptions {
  hudReserve?: () => HudReserve; // read on every reframe, so inset changes are picked up on resize
}

export interface GameRenderer {
  readonly scene: Scene; // the HUD (Babylon GUI) attaches to this scene
  loadLevel(level: LevelDef): void;
  frame(f: RenderFrame): void;
  dispose(): void;
}

let activeScaler: ResolutionScaler | null = null;

// Current render pixel ratio (render pixels per CSS pixel) of the live renderer; for debugging.
export function getRenderPixelRatio(): number {
  return activeScaler ? activeScaler.ratio : 1;
}

export function createRenderer(engine: Engine, canvas: HTMLCanvasElement, opts: RendererOptions = {}): GameRenderer {
  const scene = new Scene(engine);
  scene.clearColor = PALETTE.clear.clone();
  scene.autoClear = true; // scenery covers most of the view, but a clear is cheap and avoids smearing past the far plane
  scene.autoClearDepthAndStencil = true;
  scene.skipPointerMovePicking = true;

  const light = new HemisphericLight('sky', new Vector3(0.2, 1, -0.3), scene);
  light.intensity = 0.95;
  light.groundColor = new Color3(0.35, 0.38, 0.45);
  light.specular = Color3.Black();

  const rig = new CameraRig(scene);
  scene.activeCamera = rig.camera;
  const crowd = new CrowdRenderer(scene);
  const effects = new Effects(scene);
  const defenders = new DefenderVisuals(scene);
  const cannon = new Cannon(scene);

  const scaler = new ResolutionScaler(window.devicePixelRatio || 1);
  activeScaler = scaler;
  engine.setHardwareScalingLevel(scaler.scalingLevel);

  let level: LevelVisuals | null = null;

  const reframe = (): void => {
    if (!level) return;
    const h = engine.getRenderHeight();
    const aspect = h > 0 ? engine.getRenderWidth() / h : 0.46;
    const reserve = opts.hudReserve?.();
    const rows = reserve ? screenRows(canvas.clientHeight, reserve.top, reserve.bottom) : undefined;
    rig.reframe(level.level, aspect, rows);
    level.setLabelTilt(rig.pitch);
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
          effects.dust(e.x, e.z);
          break;
        case 'baseHit':
          level.flashBaseAt(e.z);
          break;
        case 'baseMiss':
          effects.missPuff(e.x, e.z);
          break;
        case 'defenderShot':
          effects.arrow(e.x, e.z, e.tx, e.tz);
          break;
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

  return {
    scene,

    loadLevel(def: LevelDef): void {
      level?.dispose();
      level = new LevelVisuals(scene, def);
      defenders.load(def.defenders);
      cannon.setFireRate(def.cannon.fireRate);
      effects.clear();
      scaler.warmUp(); // shader compiles and uploads after a load are not a steady frame time
      reframe();
    },

    frame(f: RenderFrame): void {
      const dt = Math.min(Math.max(f.dt, 0), 0.1);
      handleEvents(f.events);
      level?.update(f.time, dt, f.battle);
      defenders.update(f.defenders, dt);
      cannon.update(f.cannonX, f.time, f.battle.outcome === 'playing');
      crowd.update(f.view, f.time);
      effects.update(dt);
      if (scaler.sample(f.dt)) {
        engine.setHardwareScalingLevel(scaler.scalingLevel);
        reframe();
      }
      scene.render();
    },

    dispose(): void {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      observer?.disconnect();
      level?.dispose();
      level = null;
      if (activeScaler === scaler) activeScaler = null;
      scene.dispose(); // takes crowd, effects, defenders, cannon, light and camera with it
    },
  };
}

function defenderWidth(level: LevelDef, id: string): number {
  const d = level.defenders?.find((x) => x.id === id);
  if (!d) return DEFENDER_DEFAULTS.towerWidth;
  return d.width ?? (d.kind === 'wall' ? DEFENDER_DEFAULTS.wallWidth : DEFENDER_DEFAULTS.towerWidth);
}
