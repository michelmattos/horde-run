// Render entry point: owns the Babylon scene and draws a battle each frame from the
// sim view and battle state. Integration calls createRenderer once, loadLevel per
// battle (retry / next) and frame() every rendered frame.
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { BattleState, LevelDef, SimEvent, SimView } from '../contracts.ts';
import { PALETTE } from './palette.ts';
import { LevelVisuals } from './level.ts';
import { CrowdRenderer } from './crowd.ts';
import { Effects } from './effects.ts';
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

const SHAKE_BASE_HIT = 0.12;
const SHAKE_CHAMPION = 0.25;

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

  const handleEvents = (events: readonly SimEvent[]): void => {
    if (!level) return;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'gate': {
          level.pulseGate(e.gateId, e.added);
          const width = gateWidth(level.level, e.gateId);
          effects.gateBurst(e.x, e.z, width, e.added > 0);
          break;
        }
        case 'unitsClash':
          effects.dust(e.x, e.z);
          break;
        case 'baseHit':
          if (level.flashBaseAt(e.z) === 'enemy') rig.addShake(SHAKE_BASE_HIT);
          break;
        case 'championLaunched':
          rig.addShake(SHAKE_CHAMPION);
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
      cannon.setFireRate(def.cannon.fireRate);
      effects.clear();
      rig.resetEffects();
      scaler.warmUp(); // shader compiles and uploads after a load are not a steady frame time
      reframe();
    },

    frame(f: RenderFrame): void {
      const dt = Math.min(Math.max(f.dt, 0), 0.1);
      handleEvents(f.events);
      level?.update(f.time, dt, f.battle);
      cannon.update(f.cannonX, f.time, f.battle.outcome === 'playing');
      crowd.update(f.view, f.time);
      effects.update(dt);
      rig.update(dt, f.battle.playerUnits);
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
      scene.dispose(); // takes crowd, effects, cannon, light and camera with it
    },
  };
}

function gateWidth(level: LevelDef, id: string): number {
  for (const g of level.gates) if (g.id === id) return g.width;
  return 2;
}
