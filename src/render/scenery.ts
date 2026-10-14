// Bedroom Floor scenery: toy building blocks (stacked 1-3 high), books and crayons
// scattered on the floorboards on both sides of the rug, all static. Three thin-instance
// batches (boxes, crayon rods, crayon tips), so the whole room is three draw calls,
// written once per level. Props never enter the lane, so wider screens simply see more
// floor while the framing keeps the same lane.
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { LevelDef } from '../contracts.ts';
import { LAYOUT } from '../contracts.ts';
import { PALETTE } from './palette.ts';
import { PropBatch, instanceLitMaterial, unitMesh } from './instances.ts';
import { scatterScenery } from './fxLogic.ts';
import type { SceneryProp } from './fxLogic.ts';

const PROPS_PER_UNIT_LENGTH = 0.9; // density along the lane (both sides together)
const MAX_PROPS = 120;
const BOX_PARTS = 5; // most boxes one prop writes (a stack of two books: 2 x (cover + pages) + spare)
const BLOCK = 1.0; // cube edge at scale 1
const BOOK_W = 2.4;
const BOOK_D = 1.8;
const BOOK_H = 0.36;
const CRAYON_LEN = 2.2;
const CRAYON_D = 0.34;
const TIP_LEN = 0.45;
const PAGES = { r: 0.96, g: 0.93, b: 0.84 };

export class BedroomScenery {
  private readonly boxes: PropBatch;
  private readonly rods: PropBatch;
  private readonly tips: PropBatch;
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
    this.boxes = new PropBatch(unitMesh(scene, 'sceneryBoxes', 'box'), this.material, count * BOX_PARTS);
    this.rods = new PropBatch(unitMesh(scene, 'sceneryRods', 'rod'), this.material, count * 2);
    this.tips = new PropBatch(unitMesh(scene, 'sceneryTips', 'tip'), this.material, count);
    this.boxes.begin();
    this.rods.begin();
    this.tips.begin();
    for (const p of props) {
      if (p.kind === 'block') this.block(p);
      else if (p.kind === 'book') this.book(p);
      else this.crayon(p);
    }
    this.boxes.commit();
    this.rods.commit();
    this.tips.commit();
  }

  // A stack of toy cubes in different colours, each a little twisted on the one below.
  private block(p: SceneryProp): void {
    const e = BLOCK * p.scale;
    for (let i = 0; i < p.stack; i++) {
      const c = toy(p.shade + i * 0.37);
      this.boxes.write(p.x, e * (i + 0.5), p.z, e, e, e, p.yaw + i * 0.35, c.r, c.g, c.b);
    }
  }

  // A closed book lying flat (coloured cover, cream page block on three sides); sometimes two.
  private book(p: SceneryProp): void {
    const s = p.scale;
    const w = BOOK_W * s;
    const d = BOOK_D * s;
    const h = BOOK_H * s;
    const c = Math.cos(p.yaw);
    const sn = Math.sin(p.yaw);
    for (let i = 0; i < p.stack; i++) {
      const col = toy(p.shade + i * 0.5);
      const yaw = p.yaw + i * 0.4;
      const y0 = i * h;
      // Cover: a full-size box; pages: a slightly taller, inset block whose spine side is hidden.
      this.boxes.write(p.x, y0 + h / 2, p.z, w, h, d, yaw, col.r, col.g, col.b);
      const off = 0.07 * s; // pages sit toward the open edge (+x local)
      this.boxes.write(
        p.x + c * off,
        y0 + h / 2,
        p.z - sn * off,
        w - 0.06 * s,
        h * 0.72,
        d + 0.02 * s,
        yaw,
        PAGES.r,
        PAGES.g,
        PAGES.b,
      );
    }
  }

  // A crayon lying on the floor: a coloured rod with a paper wrapper and a pointed tip.
  private crayon(p: SceneryProp): void {
    const s = p.scale;
    const len = CRAYON_LEN * s;
    const dia = CRAYON_D * s;
    const col = toy(p.shade);
    const fx = Math.sin(p.yaw); // local +Z in world space
    const fz = Math.cos(p.yaw);
    const y = dia / 2;
    this.rods.write(p.x, y, p.z, dia, dia, len, p.yaw, col.r, col.g, col.b);
    // Wrapper: a slightly fatter, darker band over the back two thirds.
    const wrapLen = len * 0.6;
    const back = -(len - wrapLen) / 2;
    this.rods.write(
      p.x + fx * back,
      y,
      p.z + fz * back,
      dia * 1.06,
      dia * 1.06,
      wrapLen,
      p.yaw,
      col.r * 0.7,
      col.g * 0.7,
      col.b * 0.7,
    );
    const tip = len / 2 + (TIP_LEN * s) / 2;
    this.tips.write(p.x + fx * tip, y, p.z + fz * tip, dia, dia, TIP_LEN * s, p.yaw, col.r, col.g, col.b);
  }

  dispose(): void {
    this.boxes.dispose();
    this.rods.dispose();
    this.tips.dispose();
    this.material.dispose();
  }
}

function toy(shade: number): { r: number; g: number; b: number } {
  const list = PALETTE.toyColors;
  const k = Math.floor((((shade % 1) + 1) % 1) * list.length) % list.length;
  return list[k];
}
