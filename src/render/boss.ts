// The Goblin King: a red-tinted goblin with a gold crown standing on the enemy base.
// One vertex-coloured mesh (one draw call). It follows the strafing base, bobs a little,
// and on a phase change flashes bright and pops in scale. The camera never moves.
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PALETTE } from './palette.ts';
import { popScale } from './fxLogic.ts';

const SIZE = 1.15; // relative to a champion (2 units tall)
const BOB_SPEED = 3;
const BOB_HEIGHT = 0.08;
const PHASE_FLASH_TIME = 0.35;
const HIT_FLASH_TIME = 0.08;

export class GoblinKing {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly flashMaterial: StandardMaterial;
  private flash = 0;
  private pop = 0;

  constructor(scene: Scene) {
    const s = SIZE;
    const parts: VertexData[] = [];
    const add = (vd: VertexData, x: number, y: number, z: number, c: Color3): void => {
      vd.transform(Matrix.Translation(x * s, y * s, z * s));
      paint(vd, c);
      parts.push(vd);
    };
    const tunic = PALETTE.enemyDark;
    const skin = PALETTE.goblinSkin;
    const gold = PALETTE.gold;
    add(CreateCylinderVertexData({ height: 1.0 * s, diameterTop: 0.9 * s, diameterBottom: 1.4 * s, tessellation: 8 }), 0, 0.5, 0, tunic);
    add(CreateBoxVertexData({ width: 0.9 * s, height: 0.7 * s, depth: 0.8 * s }), 0, 1.35, 0, skin);
    add(CreateBoxVertexData({ width: 0.5 * s, height: 0.18 * s, depth: 0.12 * s }), -0.6, 1.45, 0, skin); // ears
    add(CreateBoxVertexData({ width: 0.5 * s, height: 0.18 * s, depth: 0.12 * s }), 0.6, 1.45, 0, skin);
    add(CreateBoxVertexData({ width: 0.22 * s, height: 0.16 * s, depth: 0.2 * s }), 0, 1.3, -0.48, skin); // nose
    add(CreateCylinderVertexData({ height: 0.22 * s, diameter: 0.95 * s, tessellation: 8 }), 0, 1.8, 0, gold); // crown band
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      add(CreateBoxVertexData({ width: 0.14 * s, height: 0.28 * s, depth: 0.14 * s }), Math.cos(a) * 0.36, 2.02, Math.sin(a) * 0.36, gold);
    }
    add(CreateBoxVertexData({ width: 0.12 * s, height: 1.4 * s, depth: 0.12 * s }), 0.85, 0.9, -0.1, gold); // sceptre
    const merged = parts[0];
    merged.merge(parts.slice(1));
    this.mesh = new Mesh('goblinKing', scene);
    merged.applyToMesh(this.mesh);
    this.mesh.isPickable = false;

    this.material = new StandardMaterial('goblinKingMat', scene);
    this.material.diffuseColor = new Color3(1, 1, 1);
    this.material.emissiveColor = new Color3(0.25, 0.25, 0.25);
    this.material.specularColor = Color3.Black();
    this.material.freeze();
    this.flashMaterial = new StandardMaterial('goblinKingFlash', scene);
    this.flashMaterial.diffuseColor = new Color3(1, 1, 1);
    this.flashMaterial.emissiveColor = new Color3(0.9, 0.85, 0.7);
    this.flashMaterial.specularColor = Color3.Black();
    this.flashMaterial.freeze();
    this.mesh.material = this.material;
  }

  // Strong flash and scale pop when the boss enters a new phase.
  phase(): void {
    this.flash = PHASE_FLASH_TIME;
    this.pop = PHASE_FLASH_TIME;
  }

  // Brief flicker when the base takes a hit (no pop, so phase changes stand out).
  hit(): void {
    if (this.flash > HIT_FLASH_TIME) return;
    this.flash = HIT_FLASH_TIME;
  }

  // (x, y, z): the spot on top of the base where his feet stand.
  update(x: number, y: number, z: number, time: number, dt: number, alive: boolean): void {
    this.mesh.isVisible = alive;
    if (!alive) return;
    this.flash = Math.max(0, this.flash - dt);
    this.pop = Math.max(0, this.pop - dt);
    const sc = popScale(this.pop / PHASE_FLASH_TIME, 0.35);
    this.mesh.scaling.set(sc, sc, sc);
    this.mesh.position.set(x, y + Math.abs(Math.sin(time * BOB_SPEED)) * BOB_HEIGHT, z);
    this.mesh.rotation.y = Math.sin(time * 1.3) * 0.15; // looks around a little
    this.mesh.material = this.flash > 0 ? this.flashMaterial : this.material;
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.flashMaterial.dispose();
  }
}

function paint(vd: VertexData, c: Color3): void {
  const n = (vd.positions?.length ?? 0) / 3;
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = 1;
  }
  vd.colors = colors;
}
