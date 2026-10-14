// Fixed, tilted lane camera. Framing comes from computeFraming on every resize and
// level load; the camera never moves during play (no shake, no crowd zoom): Michel
// found camera motion unpleasant on the phone, so hit feedback lives on the units.
import type { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { LevelDef } from '../contracts.ts';
import { LAYOUT } from '../contracts.ts';
import { computeFraming } from './framing.ts';
import type { Framing } from './framing.ts';

const LANE_MARGIN = 0.6;

export class CameraRig {
  readonly camera: FreeCamera;
  private framing: Framing = { pitch: 1, fov: 1, y: 30, z: -20 };

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

  private apply(): void {
    const f = this.framing;
    this.camera.fov = f.fov;
    this.camera.position.set(0, f.y, f.z);
  }
}
