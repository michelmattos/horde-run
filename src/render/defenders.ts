// Enemy defenders (arrow towers and walls) drawn as thin instances: one lit cylinder
// batch, one lit box batch and one unlit box batch for the HP bars, so up to 16
// defenders cost three draw calls. load() rebuilds the slot list per level; update()
// rewrites the instance buffers from the live DefenderView list each frame.
// Hits flash the defender towards white and pop its scale; the camera never moves.
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
const TOWER_BODY_H = 1.8;
const TOWER_CAP_H = 0.35;
const WALL_H = 1.2;
const MERLON_H = 0.35;
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
  private readonly cylinders: PropBatch;
  private readonly boxes: PropBatch;
  private readonly bars: PropBatch;
  private readonly materials: StandardMaterial[];
  private slots: Slot[] = [];
  private readonly byId = new Map<string, Slot>();

  constructor(scene: Scene) {
    const lit = instanceLitMaterial(scene, 'defenderLit');
    const unlit = instanceUnlitMaterial(scene, 'defenderBars');
    this.materials = [lit, unlit];
    this.cylinders = new PropBatch(unitMesh(scene, 'defenderCyl', 'cylinder'), lit, MAX_DEFENDERS * 2);
    this.boxes = new PropBatch(unitMesh(scene, 'defenderBox', 'box'), lit, MAX_DEFENDERS * 10);
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
    this.cylinders.begin();
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
    this.cylinders.commit();
    this.boxes.commit();
    this.bars.commit();
  }

  // Red cylinder, darker cap with four merlons, and a small archer between them. Returns the top y.
  private drawTower(s: Slot, sc: number, glow: number): number {
    const w = s.width * sc;
    const e = PALETTE.enemy;
    const d = PALETTE.enemyDark;
    const bodyH = TOWER_BODY_H * sc;
    const capH = TOWER_CAP_H * sc;
    this.cylinders.write(s.x, bodyH / 2, s.z, w * 0.75, bodyH, w * 0.75, 0, e.r * glow, e.g * glow, e.b * glow);
    this.cylinders.write(s.x, bodyH + capH / 2, s.z, w, capH, w, 0, d.r * glow, d.g * glow, d.b * glow);
    const my = bodyH + capH + (MERLON_H * sc) / 2;
    const r = w * 0.36;
    const m = w * 0.2;
    const mh = MERLON_H * sc;
    this.boxes.write(s.x - r, my, s.z, m, mh, m, 0, d.r * glow, d.g * glow, d.b * glow);
    this.boxes.write(s.x + r, my, s.z, m, mh, m, 0, d.r * glow, d.g * glow, d.b * glow);
    this.boxes.write(s.x, my, s.z - r, m, mh, m, 0, d.r * glow, d.g * glow, d.b * glow);
    this.boxes.write(s.x, my, s.z + r, m, mh, m, 0, d.r * glow, d.g * glow, d.b * glow);
    // Archer nub: a goblin head peeking over the battlement.
    const ah = 0.5 * sc;
    this.boxes.write(s.x, bodyH + capH + ah / 2, s.z, 0.32 * sc, ah, 0.32 * sc, 0, e.r * 1.15 * glow, e.g * 1.3 * glow, e.b * glow);
    return bodyH + capH + ah;
  }

  // Red box with crenellation blocks along the top. Returns the top y.
  private drawWall(s: Slot, sc: number, glow: number): number {
    const e = PALETTE.enemy;
    const d = PALETTE.enemyDark;
    const w = s.width * sc;
    const h = WALL_H * sc;
    this.boxes.write(s.x, h / 2, s.z, w, h, s.depth * sc, 0, e.r * 0.85 * glow, e.g * 0.85 * glow, e.b * 0.85 * glow);
    const n = Math.max(2, Math.min(7, Math.round(s.width / 0.8)));
    const step = w / n;
    const mh = MERLON_H * sc;
    for (let i = 0; i < n; i++) {
      const x = s.x - w / 2 + step * (i + 0.5);
      this.boxes.write(x, h + mh / 2, s.z, step * 0.55, mh, s.depth * sc * 0.9, 0, d.r * glow, d.g * glow, d.b * glow);
    }
    return h + mh;
  }

  // Same style as the base bars: dark back, enemy-red fill growing from the left edge.
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
    this.cylinders.dispose();
    this.boxes.dispose();
    this.bars.dispose();
    for (const m of this.materials) m.dispose();
  }
}
