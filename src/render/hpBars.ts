// Diegetic HP bars over the bases and defenders, in the toy-box sticker style of the HUD:
// a dark wood frame, an ink trough and a team-coloured fill (green for the player's fort,
// tan for the enemy's pieces) that shrinks toward its left end. Every bar in the scene is
// one thin-instanced rounded box (three instances per bar) on one unlit material: a single
// draw call, no shadows. Bars lean back by the camera pitch so they face the lane camera.
// begin(), bar(...) for each bar, commit() once per frame; nothing allocates.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { HEX, buildMesh, roundedBox, srgb } from './look/index.ts';
import { writeTRS } from './fxLogic.ts';

const CAPACITY = 3 * 24;
const HEIGHT = 0.26; // fill height (world units)
const FRAME = 0.09; // frame margin around the trough
const DEPTH = 0.08;

export type BarTeam = 'player' | 'enemy';

export class HpBars {
  private readonly mesh: Mesh;
  private readonly matrices = new Float32Array(CAPACITY * 16);
  private readonly colors = new Float32Array(CAPACITY * 4);
  private count = 0;
  private tilt = 1; // camera pitch: bars lean back to face it
  private readonly frame = srgb(HEX.uiWood);
  private readonly trough = srgb(HEX.uiInk).scale(0.8);
  private readonly fill: Record<BarTeam, Color3> = { player: srgb(HEX.greenLight), enemy: srgb(HEX.tanLight) };

  constructor(scene: Scene) {
    const m = new StandardMaterial('hpBarMat', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.emissiveColor = new Color3(1, 1, 1); // times the instance colour
    m.specularColor = Color3.Black();
    this.mesh = buildMesh(scene, 'hpBars', roundedBox(1, 1, 1, 0.16, 2), m);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.receiveShadows = false;
    for (let i = 0; i < CAPACITY; i++) this.matrices[i * 16 + 15] = 1;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    this.mesh.thinInstanceCount = 1;
    this.mesh.isVisible = false;
  }

  setTilt(pitch: number): void {
    this.tilt = pitch;
  }

  begin(): void {
    this.count = 0;
  }

  // A bar centred at (x, y, z), `width` long, frac 0..1 full.
  bar(x: number, y: number, z: number, width: number, frac: number, team: BarTeam): void {
    if (this.count + 3 > CAPACITY) return;
    const f = Math.max(0, Math.min(1, frac));
    const t = this.tilt;
    // Offsets along the tilted bar's normal keep the layers apart without z-fighting.
    const nz = -Math.cos(t);
    const ny = Math.sin(t);
    this.put(x, y, z, width + FRAME * 2, HEIGHT + FRAME * 2, DEPTH, this.frame);
    const d1 = DEPTH * 0.55;
    this.put(x, y + ny * d1, z + nz * d1, width, HEIGHT, DEPTH * 0.5, this.trough);
    if (f > 0) {
      const fw = width * f;
      const d2 = DEPTH * 0.8;
      this.put(x - (width - fw) / 2, y + ny * d2, z + nz * d2, fw, HEIGHT * 0.86, DEPTH * 0.5, this.fill[team]);
    }
  }

  private put(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: Color3): void {
    const i = this.count++;
    // Positive pitch tips local +Z down, so the bar's -Z face turns up toward the camera.
    writeTRS(this.matrices, i * 16, x, y, z, sx, sy, sz, 0, this.tilt, 0);
    const o = i * 4;
    this.colors[o] = c.r;
    this.colors[o + 1] = c.g;
    this.colors[o + 2] = c.b;
    this.colors[o + 3] = 1;
  }

  commit(): void {
    this.mesh.thinInstanceCount = Math.max(1, this.count);
    this.mesh.isVisible = this.count > 0;
    if (this.count > 0) {
      this.mesh.thinInstanceBufferUpdated('matrix');
      this.mesh.thinInstanceBufferUpdated('color');
    }
  }

  dispose(): void {
    const m = this.mesh.material;
    this.mesh.dispose();
    m?.dispose();
  }
}
