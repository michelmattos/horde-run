// Per-level visuals: the Bedroom Floor (wooden floorboards with toy props), the lane as
// a navy play rug with a cream border, gates with labels (one-use gates show a count line
// and break apart), both bases as toy forts with diegetic HP bars, and on boss levels
// the Tin General on his wind-up tank. The enemy base sits on its own node so it can
// strafe; its HP bar and the tank move with it. Everything here is rebuilt by loadLevel
// and disposed as a unit, so retries never leak meshes, materials or textures.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { BattleState, GateDef, LevelDef } from '../contracts.ts';
import { LAYOUT, gateLabel, gateX } from '../contracts.ts';
import { PALETTE } from './palette.ts';
import { flatMaterial, unlitMaterial, woodFloorMaterial } from './materials.ts';
import { BedroomScenery } from './scenery.ts';
import { TinGeneral } from './boss.ts';
import { gateBreakAt, hpFraction, usesLeftText } from './fxLogic.ts';

const GATE_HEIGHT = 1.6;
const LABEL_HEIGHT = 1.4; // world units; readable at arm's length on a 6-inch phone
const LABEL_TEX_W = 256;
const LABEL_TEX_H = 128;
const GATE_PULSE_TIME = 0.15;
const BASE_FLASH_TIME = 0.1;
const PHASE_FLASH_TIME = 0.3;
const BASE_HEIGHT = 1.4;
const HP_BAR_HEIGHT = 0.25;

interface GateVisual {
  def: GateDef;
  good: boolean;
  root: TransformNode;
  panel: Mesh;
  label: Mesh;
  labelTex: DynamicTexture;
  posts: Mesh[];
  baseMaterial: StandardMaterial;
  pulse: number; // seconds left
  pulseStrong: boolean;
  usesLeft: number; // -1 = unlimited gate
  breakTime: number; // seconds since it broke; -1 = intact
}

interface BaseVisual {
  node: TransformNode; // base centre on the ground; children use local coordinates
  block: Mesh;
  material: StandardMaterial;
  hpFill: Mesh;
  hpWidth: number;
  flash: number;
}

export class LevelVisuals {
  readonly level: LevelDef;
  private readonly root: TransformNode;
  private readonly gates: GateVisual[] = [];
  private readonly gateById = new Map<string, GateVisual>();
  private readonly playerBase: BaseVisual;
  private readonly enemyBase: BaseVisual;
  private readonly flashWhite: StandardMaterial;
  private readonly gateFlashGood: StandardMaterial;
  private readonly gateFlashBad: StandardMaterial;
  private readonly materials: StandardMaterial[] = [];
  private readonly scenery: BedroomScenery;
  private readonly boss: TinGeneral | null;
  private readonly breakOut = { scale: 1, alpha: 1, done: false };
  private baseX: number;

  constructor(scene: Scene, level: LevelDef) {
    this.level = level;
    this.baseX = level.enemyBase.x;
    this.root = new TransformNode('level', scene);
    const { width: w, length } = level.lane;
    const zMin = LAYOUT.playerBaseZ - LAYOUT.playerBaseDepth;
    const zMax = length + LAYOUT.enemyBaseDepth;

    const mat = (name: string, c: Color3, glow?: number): StandardMaterial => {
      const m = flatMaterial(scene, name, c, glow);
      this.materials.push(m);
      return m;
    };
    // Flashes swap materials instead of mutating them, so every material can stay frozen.
    this.flashWhite = unlitTracked(this.materials, scene, 'flashWhite', PALETTE.white);
    this.gateFlashGood = unlitTracked(this.materials, scene, 'gateFlashGood', new Color3(0.75, 1, 0.8));
    this.gateFlashBad = unlitTracked(this.materials, scene, 'gateFlashBad', new Color3(1, 0.7, 0.7));

    // Bedroom floor: large wooden floorboards under everything so wide screens see the room, not lane.
    const groundW = 600;
    const groundH = 800;
    const ground = CreateGround('floor', { width: groundW, height: groundH }, scene);
    ground.position.set(0, -0.03, (zMin + zMax) / 2);
    const floorMat = woodFloorMaterial(scene, 'floorMat', 1.4, groundW, groundH);
    this.materials.push(floorMat);
    ground.material = floorMat;
    this.addStatic(ground);
    this.scenery = new BedroomScenery(scene, level);

    // The lane is a navy play rug, slightly longer than the battlefield.
    const rugMin = zMin - 1.5;
    const rugMax = zMax + 1.5;
    const lane = CreateGround('rug', { width: w, height: rugMax - rugMin }, scene);
    lane.position.set(0, 0, (rugMin + rugMax) / 2);
    lane.material = mat('rugMat', PALETTE.lane, 0.35);
    this.addStatic(lane);

    // Woven cross stripes every few units give the eye a sense of depth and speed.
    const stripeMat = mat('rugStripeMat', PALETTE.laneStripe, 0.35);
    for (let z = 5; z < length - 1; z += 5) {
      const s = CreateGround('rugStripe', { width: w, height: 0.3 }, scene);
      s.position.set(0, 0.005, z);
      s.material = stripeMat;
      this.addStatic(s);
    }

    // Cream rug border down both sides (flat, so it never hides units at the lane edge).
    const borderMat = mat('rugBorderMat', PALETTE.rail, 0.3);
    for (const side of [-1, 1]) {
      const border = CreateBox('rugBorder', { width: 0.4, height: 0.04, depth: rugMax - rugMin }, scene);
      border.position.set(side * (w / 2 + 0.2), 0.02, (rugMin + rugMax) / 2);
      border.material = borderMat;
      this.addStatic(border);
    }

    this.playerBase = this.buildBase(scene, 'playerBase', PALETTE.player, PALETTE.playerDark, 0, w + 0.36, zMin, LAYOUT.playerBaseZ, PALETTE.hpPlayer);
    // On a boss level the enemy base is the Tin General's wind-up tank: a tin hull.
    const hull = level.boss ? PALETTE.tin : PALETTE.enemy;
    const trim = level.boss ? PALETTE.tinDark : PALETTE.enemyDark;
    this.enemyBase = this.buildBase(scene, 'enemyBase', hull, trim, this.baseX, level.enemyBase.width, length, zMax, PALETTE.hpEnemy);
    this.playerBase.node.freezeWorldMatrix();
    this.boss = level.boss ? new TinGeneral(scene, level.enemyBase.width, LAYOUT.enemyBaseDepth, BASE_HEIGHT) : null;

    for (const g of level.gates) this.buildGate(scene, g);

    for (const m of this.materials) m.freeze();
  }

  // Current enemy base centre x (follows BattleState.enemyBaseX on boss levels).
  get enemyBaseX(): number {
    return this.baseX;
  }

  private addStatic(m: Mesh): void {
    m.parent = this.root;
    m.isPickable = false;
    m.freezeWorldMatrix();
  }

  private buildBase(
    scene: Scene,
    name: string,
    color: Color3,
    trim: Color3,
    x: number,
    width: number,
    z0: number,
    z1: number,
    hpColor: Color3,
  ): BaseVisual {
    const node = new TransformNode(name, scene);
    node.parent = this.root;
    node.position.set(x, 0, z0);
    const local = (m: Mesh): void => {
      m.parent = node;
      m.isPickable = false;
    };

    const material = flatMaterial(scene, `${name}Mat`, color, 0.35);
    this.materials.push(material);
    const block = CreateBox(`${name}Block`, { width, height: BASE_HEIGHT, depth: z1 - z0 }, scene);
    block.position.set(0, BASE_HEIGHT / 2, (z1 - z0) / 2);
    block.material = material;
    local(block);

    // Toy-fort battlements: a row of blocks along the top's far edge (seen from the
    // camera), clear of the HP bar. The boss's tank has its turret instead.
    const trimMat = flatMaterial(scene, `${name}TrimMat`, trim, 0.35);
    this.materials.push(trimMat);
    const n = Math.max(3, Math.round(width / 1.2) | 1);
    const step = width / n;
    const edgeZ = z1 - z0 - 0.35;
    const fort = !(name === 'enemyBase' && this.level.boss);
    for (let i = 0; fort && i < n; i += 2) {
      const m = CreateBox(`${name}Merlon`, { width: step * 0.9, height: 0.4, depth: 0.6 }, scene);
      m.position.set(-width / 2 + step * (i + 0.5), BASE_HEIGHT + 0.2, edgeZ);
      m.material = trimMat;
      local(m);
    }

    // HP bar floats above the base's lane-facing edge.
    const hpWidth = Math.min(width * 0.8, 6);
    const barZ = name === 'playerBase' ? 0.6 : 0.4;
    const barY = BASE_HEIGHT + 0.5;
    const back = CreateBox(`${name}HpBack`, { width: hpWidth + 0.12, height: HP_BAR_HEIGHT + 0.12, depth: 0.08 }, scene);
    back.position.set(0, barY, barZ + 0.05);
    back.material = unlitTracked(this.materials, scene, `${name}HpBackMat`, PALETTE.hpBack);
    local(back);
    const fill = CreateBox(`${name}HpFill`, { width: hpWidth, height: HP_BAR_HEIGHT, depth: 0.1 }, scene);
    fill.position.set(0, barY, barZ);
    fill.material = unlitTracked(this.materials, scene, `${name}HpFillMat`, hpColor);
    local(fill);
    return { node, block, material, hpFill: fill, hpWidth, flash: 0 };
  }

  private buildGate(scene: Scene, g: GateDef): void {
    const good = g.op === 'mul' || g.op === 'add';
    const color = good ? PALETTE.gateGood : PALETTE.gateBad;
    const root = new TransformNode(`gate-${g.id}`, scene);
    root.parent = this.root;
    root.position.set(gateX(g, 0), 0, g.z);

    const panelMat = unlitTracked(this.materials, scene, `gatePanel-${g.id}`, color.scale(0.9));
    panelMat.alpha = 0.42;
    panelMat.backFaceCulling = false;
    const panel = CreatePlane(`gatePanel-${g.id}`, { width: g.width, height: GATE_HEIGHT }, scene);
    panel.position.y = GATE_HEIGHT / 2;
    panel.material = panelMat;
    panel.parent = root;
    panel.isPickable = false;

    const postMat = flatMaterial(scene, `gatePost-${g.id}`, color, 0.45);
    this.materials.push(postMat);
    const posts: Mesh[] = [];
    for (const side of [-1, 1]) {
      const post = CreateBox('gatePost', { width: 0.16, height: GATE_HEIGHT + 0.1, depth: 0.16 }, scene);
      post.position.set((side * g.width) / 2, (GATE_HEIGHT + 0.1) / 2, 0);
      post.material = postMat;
      post.parent = root;
      post.isPickable = false;
      posts.push(post);
    }

    const usesLeft = g.uses !== undefined && g.uses > 0 ? g.uses : -1;
    const { plane: label, tex: labelTex } = this.buildLabel(scene, g);
    label.parent = root;
    label.position.y = GATE_HEIGHT + LABEL_HEIGHT * 0.55;
    drawGateLabel(labelTex, g, usesLeft);

    const visual: GateVisual = {
      def: g,
      good,
      root,
      panel,
      label,
      labelTex,
      posts,
      baseMaterial: panelMat,
      pulse: 0,
      pulseStrong: false,
      usesLeft,
      breakTime: -1,
    };
    this.gates.push(visual);
    this.gateById.set(g.id, visual);
  }

  // Transparent label plane; its texture is drawn by drawGateLabel.
  private buildLabel(scene: Scene, g: GateDef): { plane: Mesh; tex: DynamicTexture } {
    const tex = new DynamicTexture(`gateLabelTex-${g.id}`, { width: LABEL_TEX_W, height: LABEL_TEX_H }, scene, true);
    tex.hasAlpha = true;
    const m = new StandardMaterial(`gateLabelMat-${g.id}`, scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.specularColor = Color3.Black();
    this.materials.push(m);

    const plane = CreatePlane(`gateLabel-${g.id}`, { width: LABEL_HEIGHT * (LABEL_TEX_W / LABEL_TEX_H), height: LABEL_HEIGHT }, scene);
    plane.material = m;
    plane.isPickable = false;
    return { plane, tex };
  }

  // Labels lean back to face the camera so they read as flat signs from above.
  setLabelTilt(pitch: number): void {
    for (const g of this.gates) g.label.rotation.x = pitch;
  }

  pulseGate(id: string, added: number): void {
    const g = this.gateById.get(id);
    if (!g || g.breakTime >= 0) return;
    g.pulse = GATE_PULSE_TIME;
    g.pulseStrong = added > 0;
  }

  // One-use gates: redraw the count line only when the number changes.
  setGateUses(id: string, usesLeft: number): void {
    const g = this.gateById.get(id);
    if (!g || g.usesLeft < 0 || g.breakTime >= 0) return;
    const n = Math.max(0, Math.floor(usesLeft));
    if (n === g.usesLeft) return;
    g.usesLeft = n;
    drawGateLabel(g.labelTex, g.def, n);
  }

  // Starts the pop-shrink-fade; the gate stays hidden afterwards. Returns whether the gate's op is good.
  breakGate(id: string): boolean {
    const g = this.gateById.get(id);
    if (!g) return true;
    if (g.breakTime < 0) {
      g.breakTime = 0;
      g.panel.material = g.pulseStrong ? this.gateFlashGood : this.gateFlashBad;
    }
    return g.good;
  }

  gateWidth(id: string): number {
    return this.gateById.get(id)?.def.width ?? 2;
  }

  // Flashes the base nearest the event z (robust to either reading of the event's team).
  flashBaseAt(z: number): 'player' | 'enemy' {
    const enemy = z > this.level.lane.length / 2;
    const b = enemy ? this.enemyBase : this.playerBase;
    b.flash = Math.max(b.flash, BASE_FLASH_TIME);
    if (enemy) this.boss?.hit();
    return enemy ? 'enemy' : 'player';
  }

  // Boss phase change: a long white flash on the tank and a pop on the Tin General.
  bossPhase(): void {
    this.enemyBase.flash = PHASE_FLASH_TIME;
    this.boss?.phase();
  }

  update(time: number, dt: number, battle: BattleState): void {
    for (const g of this.gates) {
      if (g.breakTime >= 0) {
        this.updateBreak(g, dt);
        continue;
      }
      if (g.def.move) g.root.position.x = gateX(g.def, time);
      if (g.pulse > 0) {
        g.pulse = Math.max(0, g.pulse - dt);
        const k = g.pulse / GATE_PULSE_TIME; // 1 → 0
        const s = 1 + (g.pulseStrong ? 0.18 : 0.08) * k;
        g.panel.scaling.set(s, s, 1);
        g.panel.material = k > 0 ? (g.pulseStrong ? this.gateFlashGood : this.gateFlashBad) : g.baseMaterial;
        g.panel.visibility = k > 0 ? 0.35 + 0.4 * k : 1;
      }
    }

    this.baseX = battle.enemyBaseX ?? this.level.enemyBase.x;
    this.enemyBase.node.position.x = this.baseX;
    this.updateBase(this.playerBase, battle.playerBaseHp, battle.playerBaseMaxHp, dt);
    this.updateBase(this.enemyBase, battle.enemyBaseHp, battle.enemyBaseMaxHp, dt);
    this.boss?.update(this.baseX, this.level.lane.length + LAYOUT.enemyBaseDepth / 2, time, dt, battle.enemyBaseHp > 0);
  }

  private updateBreak(g: GateVisual, dt: number): void {
    if (!g.root.isEnabled()) return;
    g.breakTime += dt;
    const o = this.breakOut;
    gateBreakAt(g.breakTime, o);
    if (o.done) {
      g.root.setEnabled(false);
      return;
    }
    g.root.scaling.set(o.scale, o.scale, o.scale);
    g.panel.visibility = 0.75 * o.alpha;
    g.label.visibility = o.alpha;
    for (const p of g.posts) p.visibility = o.alpha;
  }

  private updateBase(b: BaseVisual, hp: number, maxHp: number, dt: number): void {
    const frac = hpFraction(hp, maxHp);
    b.hpFill.isVisible = frac > 0;
    b.hpFill.scaling.x = Math.max(frac, 1e-3);
    b.hpFill.position.x = (b.hpWidth * (frac - 1)) / 2; // shrink towards the left edge
    if (b.flash > 0) {
      b.flash = Math.max(0, b.flash - dt);
      b.block.material = b.flash > 0 ? this.flashWhite : b.material;
    }
  }

  dispose(): void {
    // Disposing the root takes all child meshes and transform nodes; then the
    // materials (and their dynamic textures) we created.
    this.root.dispose(false, false);
    this.scenery.dispose();
    this.boss?.dispose();
    for (const m of this.materials) m.dispose(true, true);
    this.materials.length = 0;
    this.gates.length = 0;
    this.gateById.clear();
  }
}

// Bold white op with a dark outline; one-use gates add a smaller gold '12 left' line.
function drawGateLabel(tex: DynamicTexture, g: GateDef, usesLeft: number): void {
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const w = LABEL_TEX_W;
  const h = LABEL_TEX_H;
  const text = gateLabel(g);
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0b0f17';
  ctx.fillStyle = '#ffffff';
  if (usesLeft < 0) {
    ctx.font = `bold 96px ${font}`;
    ctx.lineWidth = 14;
    ctx.strokeText(text, w / 2, h / 2 + 4, w - 16);
    ctx.fillText(text, w / 2, h / 2 + 4, w - 16);
  } else {
    ctx.font = `bold 72px ${font}`;
    ctx.lineWidth = 12;
    ctx.strokeText(text, w / 2, 40, w - 16);
    ctx.fillText(text, w / 2, 40, w - 16);
    const line = usesLeftText(usesLeft);
    ctx.font = `bold 46px ${font}`;
    ctx.lineWidth = 10;
    ctx.strokeText(line, w / 2, 100, w - 16);
    ctx.fillStyle = '#ffe08a';
    ctx.fillText(line, w / 2, 100, w - 16);
  }
  tex.update();
}

function unlitTracked(list: StandardMaterial[], scene: Scene, name: string, c: Color3): StandardMaterial {
  const m = unlitMaterial(scene, name, c);
  list.push(m);
  return m;
}
