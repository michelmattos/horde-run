// Enemy defenders on the lane, in the tan army's toy-block style: towers (two big
// alphabet blocks with a tan army man on top firing a foam-dart blaster, models/tower.ts)
// and walls (two staggered courses of alphabet blocks that crumble top-first as they take
// damage, models/wall.ts). Both kits are built once per scene and every piece is an
// InstancedMesh copy of a few hidden sources, so any number of defenders costs ~5 draw
// calls (+ their shadow pass). load() rebuilds the pieces per level; update() follows the
// live DefenderView list; hits flash the piece and pop its scale. The camera never moves.
import type { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { DefenderDef, DefenderKind, DefenderView } from '../contracts.ts';
import { DEFENDER_DEFAULTS } from '../contracts.ts';
import type { Look } from './look/index.ts';
import { createTowerKit } from './models/tower.ts';
import type { TowerKit, TowerModel } from './models/tower.ts';
import { createWallKit } from './models/wall.ts';
import type { WallKit, WallModel } from './models/wall.ts';
import type { HpBars } from './hpBars.ts';
import { showHpBar } from './fxLogic.ts';

const MAX_DEFENDERS = 16;
const FLASH_TIME = 0.12;
const FIRE_TIME = 0.28; // blaster kick: sharp rise, eased return
const ENEMY_YAW = Math.PI; // side 'enemy': the lettered fronts face the camera
const BAR_GAP_TOWER = 1.0; // clears the shooter's helmet
const BAR_GAP_WALL = 0.4;

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
  fire: number; // seconds left of the firing kick
  tower: TowerModel | null;
  wall: WallModel | null;
  lastHit: number;
  lastFire: number;
}

export interface DartLaunch {
  x: number;
  y: number;
  z: number;
}

export class DefenderVisuals {
  private readonly towers: TowerKit;
  private readonly walls: WallKit;
  private slots: Slot[] = [];
  private readonly byId = new Map<string, Slot>();
  private readonly launch: DartLaunch = { x: 0, y: 0, z: 0 };
  private readonly tmp = new Vector3();
  // Called with the world positions of wall blocks that just fell (for a dust puff each).
  onBlocksFell: ((points: readonly Vector3[]) => void) | null = null;

  constructor(scene: Scene, look: Look) {
    this.walls = createWallKit(scene, look);
    this.towers = createTowerKit(scene, look); // after the wall kit: shares its block atlas
  }

  load(defs: readonly DefenderDef[] | undefined): void {
    this.clear();
    if (!defs) return;
    for (const d of defs.slice(0, MAX_DEFENDERS)) {
      const tower = d.kind === 'tower';
      const width = d.width ?? (tower ? DEFENDER_DEFAULTS.towerWidth : DEFENDER_DEFAULTS.wallWidth);
      const depth = tower ? width : DEFENDER_DEFAULTS.wallDepth;
      const slot: Slot = {
        id: d.id,
        kind: d.kind,
        x: d.x,
        z: d.z,
        width,
        depth,
        hp: d.hp,
        maxHp: d.hp,
        flash: 0,
        fire: 0,
        tower: null,
        wall: null,
        lastHit: -1,
        lastFire: -1,
      };
      if (tower) {
        const t = this.towers.create(width);
        t.root.position.set(d.x, 0, d.z);
        t.root.rotation.y = ENEMY_YAW;
        t.setAim(0);
        slot.tower = t;
      } else {
        const w = this.walls.create(width, depth);
        w.root.position.set(d.x, 0, d.z);
        w.root.rotation.y = ENEMY_YAW;
        w.root.computeWorldMatrix(true);
        slot.wall = w;
      }
      this.slots.push(slot);
      this.byId.set(d.id, slot);
    }
  }

  private clear(): void {
    for (const s of this.slots) {
      s.tower?.dispose();
      s.wall?.dispose();
    }
    this.slots = [];
    this.byId.clear();
  }

  hit(id: string): void {
    const s = this.byId.get(id);
    if (s) s.flash = FLASH_TIME;
  }

  // Marks a defender down right away (its debris comes from Effects).
  destroyed(id: string): void {
    const s = this.byId.get(id);
    if (!s) return;
    s.hp = 0;
    this.hide(s);
  }

  // A tower fires at (tx, tz): it turns to the target and kicks. Returns the world point
  // the dart leaves from (reused object), or null when the id is not a live tower.
  shot(id: string, tx: number, tz: number): DartLaunch | null {
    const s = this.byId.get(id);
    const t = s?.tower;
    if (!s || !t || s.hp <= 0) return null;
    t.root.position.set(s.x, 0, s.z);
    t.setAim(Math.atan2(tx - s.x, tz - s.z) - ENEMY_YAW);
    s.fire = FIRE_TIME;
    t.setFiring(0);
    const wm = t.root.computeWorldMatrix(true);
    Vector3.TransformCoordinatesToRef(t.muzzle, wm, this.tmp);
    this.launch.x = this.tmp.x;
    this.launch.y = this.tmp.y;
    this.launch.z = this.tmp.z;
    return this.launch;
  }

  private hide(s: Slot): void {
    if (s.tower) s.tower.root.setEnabled(false);
    if (s.wall) {
      s.wall.setDamage(1);
      s.wall.root.setEnabled(false);
    }
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
        s.hp = v.hp;
        s.maxHp = v.maxHp;
      }
    }
    for (const s of this.slots) {
      if (s.hp <= 0) {
        if ((s.tower && s.tower.root.isEnabled()) || (s.wall && s.wall.root.isEnabled())) this.hide(s);
        continue;
      }
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);
      const k = s.flash / FLASH_TIME; // 1 -> 0
      if (s.tower) {
        const t = s.tower;
        t.root.position.set(s.x, 0, s.z);
        if (k !== s.lastHit) {
          t.setHit(k);
          s.lastHit = k;
        }
        if (s.fire > 0) s.fire = Math.max(0, s.fire - dt);
        // Sharp kick over the first 20% of the timer, eased return after.
        const p = 1 - s.fire / FIRE_TIME;
        const f = s.fire > 0 ? (p < 0.2 ? p / 0.2 : (1 - (p - 0.2) / 0.8) ** 2) : 0;
        if (f !== s.lastFire) {
          t.setFiring(f);
          s.lastFire = f;
        }
      } else if (s.wall) {
        const w = s.wall;
        if (w.root.position.x !== s.x || w.root.position.z !== s.z) {
          w.root.position.set(s.x, 0, s.z);
          w.root.computeWorldMatrix(true);
        }
        if (k !== s.lastHit) {
          w.setHit(k);
          s.lastHit = k;
        }
        const fell = w.setDamage(s.maxHp > 0 ? 1 - s.hp / s.maxHp : 0);
        if (fell.length > 0) this.onBlocksFell?.(fell);
      }
    }
  }

  // HP bars on the camera side of each damaged defender.
  drawBars(bars: HpBars): void {
    for (const s of this.slots) {
      if (s.hp <= 0 || !showHpBar(s.hp, s.maxHp)) continue;
      const y = s.tower ? s.tower.muzzleHeight + BAR_GAP_TOWER : (s.wall?.topY() ?? 1.3) + BAR_GAP_WALL;
      const bw = Math.max(1.4, Math.min(s.width, 2.8));
      bars.bar(s.x, y, s.z - s.depth / 2 - 0.15, bw, s.hp / s.maxHp, 'enemy');
    }
  }

  dispose(): void {
    this.clear();
    this.towers.dispose();
    this.walls.dispose();
  }
}
