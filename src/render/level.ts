// Per-level static visuals: lane, rails, scenery, gates with labels, both bases with
// diegetic HP bars. Everything here is rebuilt by loadLevel and disposed as a unit,
// so retries never leak meshes, materials or textures.
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
import { flatMaterial, unlitMaterial } from './materials.ts';

const GATE_HEIGHT = 1.6;
const LABEL_HEIGHT = 1.4; // world units; readable at arm's length on a 6-inch phone
const GATE_PULSE_TIME = 0.15;
const BASE_FLASH_TIME = 0.1;
const BASE_HEIGHT = 1.4;
const HP_BAR_HEIGHT = 0.25;

interface GateVisual {
  def: GateDef;
  root: TransformNode;
  panel: Mesh;
  label: Mesh;
  baseMaterial: StandardMaterial;
  pulse: number; // seconds left
  pulseStrong: boolean;
}

interface BaseVisual {
  block: Mesh;
  material: StandardMaterial;
  hpFill: Mesh;
  hpWidth: number;
  hpLeft: number; // world x of the bar's left edge
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

  constructor(scene: Scene, level: LevelDef) {
    this.level = level;
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

    // Scenery: a large dark ground under everything so wide screens see scenery, not lane.
    const scenery = CreateGround('scenery', { width: 600, height: 800 }, scene);
    scenery.position.set(0, -0.03, (zMin + zMax) / 2);
    scenery.material = mat('sceneryMat', PALETTE.scenery, 0.6);
    this.addStatic(scenery);

    const lane = CreateGround('lane', { width: w, height: zMax - zMin }, scene);
    lane.position.set(0, 0, (zMin + zMax) / 2);
    lane.material = mat('laneMat', PALETTE.lane, 0.35);
    this.addStatic(lane);

    // Cross stripes every few units give the eye a sense of depth and speed.
    const stripeMat = mat('stripeMat', PALETTE.laneStripe, 0.35);
    for (let z = 5; z < length - 1; z += 5) {
      const s = CreateGround('stripe', { width: w, height: 0.25 }, scene);
      s.position.set(0, 0.005, z);
      s.material = stripeMat;
      this.addStatic(s);
    }

    const railMat = mat('railMat', PALETTE.rail, 0.3);
    for (const side of [-1, 1]) {
      const rail = CreateBox('rail', { width: 0.18, height: 0.3, depth: zMax - zMin }, scene);
      rail.position.set(side * (w / 2 + 0.09), 0.15, (zMin + zMax) / 2);
      rail.material = railMat;
      this.addStatic(rail);
    }

    this.playerBase = this.buildBase(scene, 'playerBase', PALETTE.player, 0, w + 0.36, zMin, LAYOUT.playerBaseZ, PALETTE.hpPlayer);
    this.enemyBase = this.buildBase(
      scene,
      'enemyBase',
      PALETTE.enemy,
      level.enemyBase.x,
      level.enemyBase.width,
      length,
      zMax,
      PALETTE.hpEnemy,
    );

    for (const g of level.gates) this.buildGate(scene, g);

    for (const m of this.materials) m.freeze();
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
    x: number,
    width: number,
    z0: number,
    z1: number,
    hpColor: Color3,
  ): BaseVisual {
    const material = flatMaterial(scene, `${name}Mat`, color, 0.35);
    this.materials.push(material);
    const block = CreateBox(name, { width, height: BASE_HEIGHT, depth: z1 - z0 }, scene);
    block.position.set(x, BASE_HEIGHT / 2, (z0 + z1) / 2);
    block.material = material;
    this.addStatic(block);

    // HP bar floats above the base's lane-facing edge.
    const hpWidth = Math.min(width * 0.8, 6);
    const barZ = name === 'playerBase' ? z0 + 0.6 : z0 + 0.4;
    const barY = BASE_HEIGHT + 0.5;
    const back = CreateBox(`${name}HpBack`, { width: hpWidth + 0.12, height: HP_BAR_HEIGHT + 0.12, depth: 0.08 }, scene);
    back.position.set(x, barY, barZ + 0.05);
    back.material = unlitTracked(this.materials, scene, `${name}HpBackMat`, PALETTE.hpBack);
    this.addStatic(back);
    const fill = CreateBox(`${name}HpFill`, { width: hpWidth, height: HP_BAR_HEIGHT, depth: 0.1 }, scene);
    fill.position.set(x, barY, barZ);
    fill.material = unlitTracked(this.materials, scene, `${name}HpFillMat`, hpColor);
    fill.parent = this.root;
    fill.isPickable = false;
    return { block, material, hpFill: fill, hpWidth, hpLeft: x - hpWidth / 2, flash: 0 };
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
    for (const side of [-1, 1]) {
      const post = CreateBox('gatePost', { width: 0.16, height: GATE_HEIGHT + 0.1, depth: 0.16 }, scene);
      post.position.set((side * g.width) / 2, (GATE_HEIGHT + 0.1) / 2, 0);
      post.material = postMat;
      post.parent = root;
      post.isPickable = false;
    }

    const label = this.buildLabel(scene, g);
    label.parent = root;
    label.position.y = GATE_HEIGHT + LABEL_HEIGHT * 0.55;

    const visual: GateVisual = { def: g, root, panel, label, baseMaterial: panelMat, pulse: 0, pulseStrong: false };
    this.gates.push(visual);
    this.gateById.set(g.id, visual);
  }

  // Draws gateLabel(g) once: bold white with a dark outline on a transparent texture.
  private buildLabel(scene: Scene, g: GateDef): Mesh {
    const texW = 256;
    const texH = 128;
    const tex = new DynamicTexture(`gateLabelTex-${g.id}`, { width: texW, height: texH }, scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const text = gateLabel(g);
    ctx.clearRect(0, 0, texW, texH);
    ctx.font = 'bold 96px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#0b0f17';
    ctx.strokeText(text, texW / 2, texH / 2 + 4, texW - 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, texW / 2, texH / 2 + 4, texW - 16);
    tex.update();

    const m = new StandardMaterial(`gateLabelMat-${g.id}`, scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.specularColor = Color3.Black();
    this.materials.push(m);

    const plane = CreatePlane(`gateLabel-${g.id}`, { width: LABEL_HEIGHT * (texW / texH), height: LABEL_HEIGHT }, scene);
    plane.material = m;
    plane.isPickable = false;
    return plane;
  }

  // Labels lean back to face the camera so they read as flat signs from above.
  setLabelTilt(pitch: number): void {
    for (const g of this.gates) g.label.rotation.x = pitch;
  }

  pulseGate(id: string, added: number): void {
    const g = this.gateById.get(id);
    if (!g) return;
    g.pulse = GATE_PULSE_TIME;
    g.pulseStrong = added > 0;
  }

  // Flashes the base nearest the event z (robust to either reading of the event's team).
  flashBaseAt(z: number): 'player' | 'enemy' {
    const enemy = z > this.level.lane.length / 2;
    (enemy ? this.enemyBase : this.playerBase).flash = BASE_FLASH_TIME;
    return enemy ? 'enemy' : 'player';
  }

  update(time: number, dt: number, battle: BattleState): void {
    for (const g of this.gates) {
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
    this.updateBase(this.playerBase, battle.playerBaseHp, battle.playerBaseMaxHp, dt);
    this.updateBase(this.enemyBase, battle.enemyBaseHp, battle.enemyBaseMaxHp, dt);
  }

  private updateBase(b: BaseVisual, hp: number, maxHp: number, dt: number): void {
    const frac = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    b.hpFill.isVisible = frac > 0;
    b.hpFill.scaling.x = Math.max(frac, 1e-3);
    b.hpFill.position.x = b.hpLeft + (b.hpWidth * frac) / 2;
    if (b.flash > 0) {
      b.flash = Math.max(0, b.flash - dt);
      b.block.material = b.flash > 0 ? this.flashWhite : b.material;
    }
  }

  dispose(): void {
    // Disposing the root takes all child meshes and transform nodes; then the
    // materials (and their dynamic textures) we created.
    this.root.dispose(false, false);
    for (const m of this.materials) m.dispose(true, true);
    this.materials.length = 0;
    this.gates.length = 0;
    this.gateById.clear();
  }
}

function unlitTracked(list: StandardMaterial[], scene: Scene, name: string, c: Color3): StandardMaterial {
  const m = unlitMaterial(scene, name, c);
  list.push(m);
  return m;
}
