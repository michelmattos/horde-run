// Enemy defenders built from toy blocks in the tan army's colours, drawn as thin
// instances: one lit box batch and one unlit box batch for the HP bars, so up to 16
// defenders cost two draw calls. A tower is two stacked blocks with a tan soldier on
// top firing foam darts; a wall is a row of blocks with a second, staggered row on top.
// load() rebuilds the slot list per level; update() rewrites the instance buffers from
// the live DefenderView list each frame. Hits flash the defender towards white and pop
// its scale; the camera never moves.
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { DefenderDef, DefenderKind, DefenderView } from '../contracts.ts';
import { DEFENDER_DEFAULTS } from '../contracts.ts';
import { PALETTE } from './palette.ts';
import { PropBatch, instanceLitMaterial, instanceUnlitMaterial, unitMesh } from './instances.ts';
import { hpFraction, popScale, showHpBar } from './fxLogic.ts';

const MAX_DEFENDERS = 16;
const FLASH_TIME = 0.12;
const POP_AMOUNT = 0.14;
const TOWER_BLOCK = 0.72; // tower block edge as a fraction of its footprint width
const SOLDIER_H = 0.62;
const WALL_H = 1.3; // two rows of blocks
const HP_BAR_H = 0.22;
const HP_BAR_GAP = 0.45;

interface Slot {
  id: string;
  kind: DefenderKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  hp: number;
  maxHp: number;
  flash: number; // seconds left
}

export class DefenderVisuals {
  private readonly boxes: PropBatch;
  private readonly bars: PropBatch;
  private readonly materials: StandardMaterial[];
  private slots: Slot[] = [];
  private readonly byId = new Map<string, Slot>();

  constructor(scene: Scene) {
    const lit = instanceLitMaterial(scene, 'defenderLit');
    const unlit = instanceUnlitMaterial(scene, 'defenderBars');
    this.materials = [lit, unlit];
    this.boxes = new PropBatch(unitMesh(scene, 'defenderBox', 'box'), lit, MAX_DEFENDERS * 16);
    this.bars = new PropBatch(unitMesh(scene, 'defenderBar', 'box'), unlit, MAX_DEFENDERS * 2);
  }

  load(defs: readonly DefenderDef[] | undefined): void {
    this.slots = [];
    this.byId.clear();
    if (defs) {
      for (const d of defs.slice(0, MAX_DEFENDERS)) {
        const tower = d.kind === 'tower';
        const width = d.width ?? (tower ? DEFENDER_DEFAULTS.towerWidth : DEFENDER_DEFAULTS.wallWidth);
        const slot: Slot = {
          id: d.id,
          kind: d.kind,
          x: d.x,
          z: d.z,
          width,
          depth: tower ? width : DEFENDER_DEFAULTS.wallDepth,
          hp: d.hp,
          maxHp: d.hp,
          flash: 0,
        };
        this.slots.push(slot);
        this.byId.set(d.id, slot);
      }
    }
    this.draw();
  }

  hit(id: string): void {
    const s = this.byId.get(id);
    if (s) s.flash = FLASH_TIME;
  }

  // Marks a defender down right away (its debris comes from Effects).
  destroyed(id: string): void {
    const s = this.byId.get(id);
    if (s) s.hp = 0;
  }

  // `views` is the sim's live list (read this frame only); without it the defs stand at full HP.
  update(views: readonly DefenderView[] | undefined, dt: number): void {
    if (views) {
      for (let i = 0; i < views.length; i++) {
        const v = views[i];
        const s = this.byId.get(v.id);
        if (!s) continue;
        s.x = v.x;
        s.z = v.z;
        s.width = v.width;
        s.depth = v.depth;
        s.hp = v.hp;
        s.maxHp = v.maxHp;
      }
    }
    for (const s of this.slots) if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);
    this.draw();
  }

  private draw(): void {
    this.boxes.begin();
    this.bars.begin();
    for (const s of this.slots) {
      if (s.hp <= 0) continue;
      const k = s.flash / FLASH_TIME; // 1 → 0
      const sc = popScale(k, POP_AMOUNT);
      const glow = 1 + 2.4 * k; // >1 instance colours push the flat red towards white
      const top = s.kind === 'tower' ? this.drawTower(s, sc, glow) : this.drawWall(s, sc, glow);
      if (showHpBar(s.hp, s.maxHp)) this.drawBar(s, top + HP_BAR_GAP);
    }
    this.boxes.commit();
    this.bars.commit();
  }

  // Two stacked toy blocks (light and dark tan, the top one a little twisted) with a tan
  // soldier standing on top. Returns the top y.
  private drawTower(s: Slot, sc: number, glow: number): number {
    const e = PALETTE.enemy;
    const d = PALETTE.enemyDark;
    const b = s.width * TOWER_BLOCK * sc;
    this.boxes.write(s.x, b / 2, s.z, b, b, b, 0, d.r * glow, d.g * glow, d.b * glow);
    this.boxes.write(s.x, b * 1.5, s.z, b * 0.92, b, b * 0.92, 0.3, e.r * glow, e.g * glow, e.b * glow);
    // The rifleman: legs/torso and a head, in the army's tan.
    const h = SOLDIER_H * sc;
    const top = b * 2;
    this.boxes.write(
      s.x,
      top + h * 0.35,
      s.z,
      0.34 * sc,
      h * 0.7,
      0.24 * sc,
      0,
      e.r * 0.92 * glow,
      e.g * 0.92 * glow,
      e.b * 0.92 * glow,
    );
    this.boxes.write(s.x, top + h * 0.85, s.z, 0.24 * sc, h * 0.3, 0.24 * sc, 0, e.r * glow, e.g * glow, e.b * glow);
    return top + h;
  }

  // A toy-block wall: a bottom row of blocks in alternating tans, a staggered top row. Returns the top y.
  private drawWall(s: Slot, sc: number, glow: number): number {
    const e = PALETTE.enemy;
    const d = PALETTE.enemyDark;
    const w = s.width * sc;
    const rowH = (WALL_H / 2) * sc;
    const depth = s.depth * sc;
    const n = Math.max(2, Math.min(7, Math.round(s.width / 0.9)));
    const step = w / n;
    for (let i = 0; i < n; i++) {
      const c = i % 2 === 0 ? e : d;
      const x = s.x - w / 2 + step * (i + 0.5);
      this.boxes.write(x, rowH / 2, s.z, step * 0.96, rowH, depth, 0, c.r * glow, c.g * glow, c.b * glow);
    }
    for (let i = 0; i < n - 1; i++) {
      const c = i % 2 === 0 ? d : e;
      const x = s.x - w / 2 + step * (i + 1);
      this.boxes.write(x, rowH * 1.5, s.z, step * 0.96, rowH, depth * 0.9, 0, c.r * glow, c.g * glow, c.b * glow);
    }
    return rowH * 2;
  }

  // Same style as the base bars: dark back, enemy-tan fill growing from the left edge.
  private drawBar(s: Slot, y: number): void {
    const frac = hpFraction(s.hp, s.maxHp);
    const bw = Math.max(1.6, Math.min(s.width, 3));
    const z = s.z - s.depth / 2 - 0.1; // camera side of the defender
    const b = PALETTE.hpBack;
    const f = PALETTE.hpEnemy;
    this.bars.write(s.x, y, z + 0.04, bw + 0.12, HP_BAR_H + 0.12, 0.06, 0, b.r, b.g, b.b);
    const fw = bw * frac;
    this.bars.write(s.x - bw / 2 + fw / 2, y, z, fw, HP_BAR_H, 0.08, 0, f.r, f.g, f.b);
  }

  dispose(): void {
    this.boxes.dispose();
    this.bars.dispose();
    for (const m of this.materials) m.dispose();
  }
}
