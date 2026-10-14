// Green Valley scenery: low-poly trees and bushes scattered on both sides of the lane,
// all static. Foliage cones and trunks are two thin-instance batches (two draw calls),
// written once per level. Props never enter the lane, so wider screens simply see
// more valley while the framing keeps the same lane.
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { LevelDef } from '../contracts.ts';
import { LAYOUT } from '../contracts.ts';
import { PALETTE } from './palette.ts';
import { PropBatch, instanceLitMaterial, unitMesh } from './instances.ts';
import { scatterScenery } from './fxLogic.ts';

const PROPS_PER_UNIT_LENGTH = 1.3; // density along the lane (both sides together)
const MAX_PROPS = 160;

export class ValleyScenery {
  private readonly leaves: PropBatch;
  private readonly trunks: PropBatch;
  private readonly material: StandardMaterial;

  constructor(scene: Scene, level: LevelDef) {
    const zMin = LAYOUT.playerBaseZ - LAYOUT.playerBaseDepth - 8;
    const zMax = level.lane.length + LAYOUT.enemyBaseDepth + 14;
    const count = Math.min(MAX_PROPS, Math.round((zMax - zMin) * PROPS_PER_UNIT_LENGTH));
    // Seed from the level id so each level has its own, stable, layout.
    let seed = 17;
    for (let i = 0; i < level.id.length; i++) seed = (seed * 31 + level.id.charCodeAt(i)) >>> 0;
    const props = scatterScenery(seed, level.lane.width, zMin, zMax, count);

    this.material = instanceLitMaterial(scene, 'sceneryMat');
    this.leaves = new PropBatch(unitMesh(scene, 'sceneryLeaves', 'cone'), this.material, count * 2);
    this.trunks = new PropBatch(unitMesh(scene, 'sceneryTrunks', 'box'), this.material, count);
    const dark = PALETTE.leafDark;
    const light = PALETTE.leafLight;
    const t = PALETTE.treeTrunk;
    this.leaves.begin();
    this.trunks.begin();
    for (const p of props) {
      const k = p.shade;
      const r = dark.r + (light.r - dark.r) * k;
      const g = dark.g + (light.g - dark.g) * k;
      const b = dark.b + (light.b - dark.b) * k;
      const s = p.scale;
      if (p.kind === 'tree') {
        this.trunks.write(p.x, 0.35 * s, p.z, 0.25 * s, 0.7 * s, 0.25 * s, 0, t.r, t.g, t.b);
        this.leaves.write(p.x, 1.25 * s, p.z, 1.4 * s, 1.4 * s, 1.4 * s, k * 3, r, g, b);
        this.leaves.write(p.x, 1.95 * s, p.z, 1.0 * s, 1.0 * s, 1.0 * s, k * 5, r * 1.1, g * 1.1, b * 1.1);
      } else {
        this.leaves.write(p.x, 0.3 * s, p.z, 1.3 * s, 0.6 * s, 1.3 * s, k * 4, r * 0.95, g * 1.05, b * 0.95);
      }
    }
    this.leaves.commit();
    this.trunks.commit();
  }

  dispose(): void {
    this.leaves.dispose();
    this.trunks.dispose();
    this.material.dispose();
  }
}
