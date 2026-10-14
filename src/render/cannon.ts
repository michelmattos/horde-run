// The player's cannon: a blue cylinder turret with a box barrel pointing up the lane.
// It follows the game's clamped cannonX and bobs/recoils while the battle is running.
import type { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { LAYOUT } from '../contracts.ts';
import { PALETTE } from './palette.ts';
import { flatMaterial } from './materials.ts';

const RECOIL = 0.18;

export class Cannon {
  private readonly root: TransformNode;
  private readonly barrel: Mesh;
  private readonly materials: StandardMaterial[];
  private fireRate = 4; // shots per second, from the level

  constructor(scene: Scene) {
    this.root = new TransformNode('cannon', scene);
    this.root.position.set(0, 0, LAYOUT.cannonZ);
    const bodyMat = flatMaterial(scene, 'cannonBody', PALETTE.player, 0.35);
    const darkMat = flatMaterial(scene, 'cannonDark', PALETTE.playerDark, 0.35);
    this.materials = [bodyMat, darkMat];
    for (const m of this.materials) m.freeze();

    const base = CreateCylinder('cannonBase', { height: 0.5, diameterTop: 1.0, diameterBottom: 1.3, tessellation: 12 }, scene);
    base.position.y = 0.25;
    base.material = darkMat;
    const turret = CreateCylinder('cannonTurret', { height: 0.45, diameter: 0.9, tessellation: 12 }, scene);
    turret.position.y = 0.72;
    turret.material = bodyMat;
    this.barrel = CreateBox('cannonBarrel', { width: 0.36, height: 0.36, depth: 1.2 }, scene);
    this.barrel.position.set(0, 0.8, 0.55);
    this.barrel.material = darkMat;
    for (const m of [base, turret, this.barrel]) {
      m.parent = this.root;
      m.isPickable = false;
    }
  }

  setFireRate(rate: number): void {
    this.fireRate = rate > 0 ? rate : 4;
  }

  update(x: number, time: number, active: boolean): void {
    this.root.position.x = x;
    // Saw-tooth recoil at the fire rate: snap back, ease forward.
    const phase = active ? (time * this.fireRate) % 1 : 1;
    this.barrel.position.z = 0.55 - RECOIL * (1 - phase) * (1 - phase);
    this.root.position.y = active ? 0.03 * (1 - phase) : 0;
  }

  dispose(): void {
    this.root.dispose(false, false);
    for (const m of this.materials) m.dispose();
  }
}
