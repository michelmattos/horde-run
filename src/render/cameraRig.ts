// Fixed, tilted lane camera. Framing comes from computeFraming on every resize; per
// frame we only add a smooth zoom-out as the player's crowd grows and a decaying
// screen shake on big hits.
import type { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { LevelDef } from '../contracts.ts';
import { LAYOUT } from '../contracts.ts';
import { computeFraming } from './framing.ts';
import type { Framing } from './framing.ts';

const ZOOM_MAX = 0.15; // up to +15% wider view
const ZOOM_FULL_UNITS = 900; // crowd size at which the zoom-out is complete
const ZOOM_RATE = 1.5; // 1/s, exponential smoothing
const SHAKE_DECAY = 9; // 1/s
const SHAKE_MAX = 0.45;
const LANE_MARGIN = 0.6;

export class CameraRig {
  readonly camera: FreeCamera;
  private framing: Framing = { pitch: 1, fov: 1, y: 30, z: -20 };
  private zoom = 0;
  private shake = 0;
  private shakeTime = 0;

  constructor(scene: Scene) {
    this.camera = new FreeCamera('laneCamera', new Vector3(0, 30, -20), scene);
    this.camera.minZ = 0.5;
    this.camera.maxZ = 600;
    this.camera.inputs.clear(); // fixed camera; input belongs to the game
  }

  get pitch(): number {
    return this.framing.pitch;
  }

  // Recompute framing for the current render aspect (call on resize and level load).
  // `rows` optionally moves the cannon row and the enemy base's far edge (NDC y) inward.
  reframe(level: LevelDef, aspect: number, rows?: { near: number; far: number }): void {
    this.framing = computeFraming({
      aspect,
      nearNdcY: rows?.near,
      farNdcY: rows?.far,
      laneWidth: level.lane.width,
      nearZ: LAYOUT.cannonZ,
      farZ: level.lane.length + LAYOUT.enemyBaseDepth,
      margin: LANE_MARGIN,
    });
    this.camera.rotation.set(this.framing.pitch, 0, 0);
    this.apply();
  }

  addShake(amount: number): void {
    this.shake = Math.min(SHAKE_MAX, this.shake + amount);
  }

  resetEffects(): void {
    this.zoom = 0;
    this.shake = 0;
  }

  update(dt: number, playerUnits: number): void {
    const target = ZOOM_MAX * smoothstep(Math.min(1, Math.max(0, playerUnits / ZOOM_FULL_UNITS)));
    this.zoom += (target - this.zoom) * (1 - Math.exp(-ZOOM_RATE * dt));
    this.shake *= Math.exp(-SHAKE_DECAY * dt);
    if (this.shake < 1e-3) this.shake = 0;
    this.shakeTime += dt;
    this.apply();
  }

  private apply(): void {
    const f = this.framing;
    this.camera.fov = 2 * Math.atan(Math.tan(f.fov / 2) * (1 + this.zoom));
    // Incommensurate sines give a cheap jitter without an RNG.
    const t = this.shakeTime;
    const sx = this.shake * Math.sin(t * 53.1);
    const sy = this.shake * 0.6 * Math.sin(t * 41.7 + 1.3);
    this.camera.position.set(sx, f.y + sy, f.z);
  }
}

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}
