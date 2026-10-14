// Fixed, tilted lane camera. Framing comes from computeFraming on every resize and
// level load; per frame the only change is a gentle zoom-out (a slightly wider fov) as
// the player's crowd grows, eased smoothly so it never steps. The camera position never
// moves: no screen shake or jitter of any kind (Michel found camera motion unpleasant
// on the phone), so hit feedback lives on the units, gates, bases and defenders.
import type { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { LevelDef } from '../contracts.ts';
import { LAYOUT } from '../contracts.ts';
import { computeFraming, easeZoom, zoomedFov } from './framing.ts';
import type { Framing } from './framing.ts';

const LANE_MARGIN = 0.6;

export class CameraRig {
  readonly camera: FreeCamera;
  private framing: Framing = { pitch: 1, fov: 1, y: 30, z: -20 };
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
    this.camera.position.set(0, this.framing.y, this.framing.z);
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
