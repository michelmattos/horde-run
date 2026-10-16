// Fixed, low lane camera (see framing.ts). Framing comes from computeFraming on every
// resize and level load; per frame the only change is a gentle zoom-out (a slightly
// wider fov) as the player's crowd grows, eased smoothly so it never steps. The camera
// position never moves: no screen shake or jitter of any kind (Michel found camera
// motion unpleasant on the phone), so hit feedback lives on the units, gates, bases and
// defenders.
import type { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { LevelDef } from '../contracts.ts';
import { LAYOUT } from '../contracts.ts';
import { computeFraming, easeZoom, zoomedFov } from './framing.ts';
import type { Framing } from './framing.ts';

const RUG_MARGIN = 0.4; // the rug's border beyond each lane edge

export class CameraRig {
  readonly camera: FreeCamera;
  private framing: Framing = { pitch: 1, yaw: 0, fov: 1, x: 0, y: 30, z: -20 };
  private zoom = 0;

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
  // `farRow` optionally lowers the top of the playfield (NDC y) under the HUD; `top` (the
  // enemy fort's flag tip / the boss's plume) is kept at or under NDC row `topLimit`
  // (default: the far row).
  reframe(level: LevelDef, aspect: number, farRow?: number, top?: { y: number; z: number }, topLimit?: number): void {
    this.framing = computeFraming({
      aspect,
      laneWidth: level.lane.width,
      margin: RUG_MARGIN,
      nearZ: LAYOUT.playerBaseZ - LAYOUT.playerBaseDepth - 0.2,
      farZ: level.lane.length + LAYOUT.enemyBaseDepth,
      farNdcY: farRow,
      top,
      topNdcY: topLimit,
    });
    this.camera.rotation.set(this.framing.pitch, this.framing.yaw, 0);
    this.camera.position.set(this.framing.x, this.framing.y, this.framing.z);
    this.apply();
  }

  // A new battle starts fully zoomed in.
  resetZoom(): void {
    this.zoom = 0;
    this.apply();
  }

  // Per rendered frame: ease the zoom toward the current crowd size.
  update(dt: number, playerUnits: number): void {
    this.zoom = easeZoom(this.zoom, playerUnits, dt);
    this.apply();
  }

  get zoomAmount(): number {
    return this.zoom;
  }

  private apply(): void {
    this.camera.fov = zoomedFov(this.framing.fov, this.zoom);
  }
}
