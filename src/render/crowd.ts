// Thin-instance crowd renderer: classic green-vs-tan plastic toy army men. Each unit is
// a real low-poly soldier figure on a thin base plate (public/models/army-men.glb, see
// armyMen.ts): mobs are riflemen striding forward, the champion is a big kneeling
// bazooka man. One mesh per UnitKind, team colour via a per-instance 'color' buffer, a
// glossy single-colour plastic material, and matrices rewritten every frame from the
// SimView with a little "hop" (bounce, forward lean and waddle, phase-offset per unit)
// like a kid hopping the toys along. The whole crowd is two draw calls; buffers grow
// geometrically and nothing is allocated per frame in steady state. Until the model
// has loaded (or if it fails) simple procedural stand-in soldiers are drawn instead.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { SimView } from '../contracts.ts';
import { LAYOUT, Team, UnitKind } from '../contracts.ts';
import { PALETTE } from './palette.ts';
import { loadArmyMen } from './armyMen.ts';
import type { ArmyMenGeometry } from './armyMen.ts';

// Stand-in figure sizes (procedural fallback).
const MOB_HEIGHT = 0.9;
const CHAMPION_HEIGHT = 2.0;
// Model figure heights (base plate to helmet top) at the default unit radius. The
// rifleman is a touch taller than the old stand-in so the pose reads on a phone; the
// sim radius (LAYOUT) is unchanged, so crowd density stays the same.
const MODEL_MOB_HEIGHT = 1.3;
const MODEL_CHAMPION_HEIGHT = 2.6; // kneeling, so he is wider than he is tall
// Hop: |sin| bounce with a forward lean on each hop and a side-to-side waddle.
const HOP_HEIGHT = 0.11;
const HOP_SPEED = 10;
const HOP_LEAN = 0.16; // radians at the top of a hop
const WADDLE = 0.1; // radians of roll either side
const CHAMPION_BRIGHT = 1.12; // the champion is moulded a shade lighter so he pops
const INITIAL_CAPACITY = 1024;
// The figures stand three-quarter on to the lane camera rather than square: a profile
// shows the helmet, the rifle and the striding legs, the army-man silhouette, where a
// straight back view is just a green blob. Player toys face up the lane, the tan army
// faces down it (toward the camera).
const PLAYER_YAW = Math.PI - 0.7;
const ENEMY_YAW = 0.55;
// Moulded plastic colours: classic army green against the rival tan army (a shade
// deeper than PALETTE.enemy so the glossy highlight doesn't wash the tan out).
const PLAYER_PLASTIC = Color3.FromHexString('#3fa34d');
const ENEMY_PLASTIC = Color3.FromHexString('#d4b47c');

class InstanceBatch {
  readonly mesh: Mesh;
  private matrices: Float32Array;
  private colors: Float32Array;
  private capacity = 0;
  count = 0;

  constructor(mesh: Mesh) {
    this.mesh = mesh;
    this.matrices = new Float32Array(0);
    this.colors = new Float32Array(0);
    this.ensureCapacity(INITIAL_CAPACITY);
  }

  ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(this.capacity, INITIAL_CAPACITY);
    while (cap < n) cap *= 2;
    this.capacity = cap;
    this.matrices = new Float32Array(cap * 16);
    this.colors = new Float32Array(cap * 4);
    for (let i = 0; i < cap; i++) this.matrices[i * 16 + 15] = 1;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    this.mesh.thinInstanceCount = 0;
  }

  // Uniform scale s, then pitch (about X), roll (about Z) and yaw (about Y), then translate.
  write(x: number, y: number, z: number, s: number, pitch: number, roll: number, yaw: number, r: number, g: number, b: number): void {
    const m = this.matrices;
    const o = this.count * 16;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // Row-vector rotation Rx(pitch) * Rz(roll) * Ry(yaw), scaled.
    m[o] = cr * cy * s;
    m[o + 1] = sr * s;
    m[o + 2] = -cr * sy * s;
    m[o + 4] = (-cp * sr * cy + sp * sy) * s;
    m[o + 5] = cp * cr * s;
    m[o + 6] = (cp * sr * sy + sp * cy) * s;
    m[o + 8] = (sp * sr * cy + cp * sy) * s;
    m[o + 9] = -sp * cr * s;
    m[o + 10] = (-sp * sr * sy + cp * cy) * s;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    const c = this.colors;
    const p = this.count * 4;
    c[p] = r;
    c[p + 1] = g;
    c[p + 2] = b;
    c[p + 3] = 1;
    this.count++;
  }

  commit(): void {
    this.mesh.thinInstanceCount = this.count;
    this.mesh.isVisible = this.count > 0;
    if (this.count > 0) {
      this.mesh.thinInstanceBufferUpdated('matrix');
      this.mesh.thinInstanceBufferUpdated('color');
    }
  }
}

// Box part centred at (x, y, z).
function box(w: number, h: number, d: number, x: number, y: number, z: number): VertexData {
  const vd = CreateBoxVertexData({ width: w, height: h, depth: d });
  vd.transform(Matrix.Translation(x, y, z));
  return vd;
}

// Upright cylinder part centred at height y (diameterTop defaults to the diameter).
function cyl(diameter: number, h: number, y: number, tessellation: number, diameterTop = diameter): VertexData {
  const vd = CreateCylinderVertexData({ height: h, diameterBottom: diameter, diameterTop, tessellation });
  vd.transform(Matrix.Translation(0, y, 0));
  return vd;
}

function merge(scene: Scene, name: string, parts: VertexData[]): Mesh {
  const vd = parts[0];
  vd.merge(parts.slice(1));
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  return mesh;
}

export class CrowdRenderer {
  private mob: InstanceBatch;
  private champion: InstanceBatch;
  private championTrim: InstanceBatch | null;
  private readonly material: StandardMaterial;
  private readonly keyLight: DirectionalLight;
  private modelReady = false;
  private disposed = false;

  constructor(scene: Scene) {
    // Key light for the toys only: low from the camera's left, so the glossy highlight
    // lands on helmets, shoulders and rifles rather than flaring on the flat base plates.
    this.keyLight = new DirectionalLight('toyKey', new Vector3(0.8, -0.45, 0.4), scene);
    this.keyLight.intensity = 0.55;
    this.keyLight.diffuse = new Color3(1, 0.98, 0.94);
    this.keyLight.specular = new Color3(1, 1, 1);
    this.material = plasticMaterial(scene); // after the key light: the material is frozen
    this.mob = new InstanceBatch(this.buildMob(scene));
    this.champion = new InstanceBatch(this.buildChampion(scene));
    this.championTrim = new InstanceBatch(this.buildChampionTrim(scene));
    this.keyLight.includedOnlyMeshes = [this.mob.mesh, this.champion.mesh, this.championTrim.mesh];
    void loadArmyMen().then((geo) => {
      if (geo && !this.disposed) this.useModel(scene, geo);
    });
  }

  // Swap the stand-ins for the real army-men figures. New meshes get fresh batches (the
  // next update() refills them), and the stand-in meshes are disposed.
  private useModel(scene: Scene, geo: ArmyMenGeometry): void {
    const mob = new Mesh('armyManRifleman', scene);
    geo.rifleman.applyToMesh(mob);
    const champ = new Mesh('armyManBazooka', scene);
    geo.bazooka.applyToMesh(champ);
    this.mob.mesh.dispose();
    this.champion.mesh.dispose();
    this.championTrim?.mesh.dispose();
    this.championTrim = null;
    this.mob = new InstanceBatch(this.finish(mob));
    this.champion = new InstanceBatch(this.finish(champ));
    this.keyLight.includedOnlyMeshes = [mob, champ];
    this.modelReady = true;
  }

  private finish(mesh: Mesh): Mesh {
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true; // instances span the lane; never cull by the base mesh bounds
    mesh.doNotSyncBoundingInfo = true;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  // Stand-in mob (until the model loads): a toy soldier on its base plate on its base plate, feet at y = 0, radius LAYOUT.mobRadius.
  private buildMob(scene: Scene): Mesh {
    const h = MOB_HEIGHT;
    const r = LAYOUT.mobRadius;
    const parts = [
      cyl(r * 1.8, h * 0.07, h * 0.035, 8), // base plate
      box(r * 1.05, h * 0.36, r * 0.62, 0, h * 0.25, 0), // legs
      box(r * 1.3, h * 0.33, r * 0.72, 0, h * 0.595, 0), // torso
      box(r * 0.72, h * 0.2, r * 0.72, 0, h * 0.86, 0), // head
      cyl(r * 1.1, h * 0.1, h * 0.99, 8, r * 0.78), // helmet
      box(r * 0.24, h * 0.62, r * 0.24, r * 0.82, h * 0.6, 0), // rifle, held upright
    ];
    return this.finish(merge(scene, 'mob', parts));
  }

  // Stand-in champion (the Sergeant): a big toy soldier, radius LAYOUT.championRadius. Its gold
  // helmet, shoulder boards and belt live in a second batch (buildChampionTrim) drawn
  // with the same matrices, so team colour and gold stay separate at one extra draw call.
  private buildChampion(scene: Scene): Mesh {
    const r = LAYOUT.championRadius;
    const h = CHAMPION_HEIGHT;
    const parts = [
      cyl(r * 1.7, h * 0.05, h * 0.025, 10), // base plate
      box(r * 0.95, h * 0.34, r * 0.6, 0, h * 0.22, 0), // legs
      box(r * 1.25, h * 0.32, r * 0.75, 0, h * 0.55, 0), // torso
      box(r * 0.32, h * 0.32, r * 0.36, -r * 0.8, h * 0.55, 0), // arms
      box(r * 0.32, h * 0.32, r * 0.36, r * 0.8, h * 0.55, 0),
      box(r * 0.62, h * 0.18, r * 0.62, 0, h * 0.8, 0), // head
    ];
    return this.finish(merge(scene, 'champion', parts));
  }

  private buildChampionTrim(scene: Scene): Mesh {
    const r = LAYOUT.championRadius;
    const h = CHAMPION_HEIGHT;
    const parts = [
      cyl(r * 1.0, h * 0.09, h * 0.93, 10, r * 0.72), // helmet
      box(r * 0.42, h * 0.05, r * 0.5, -r * 0.8, h * 0.73, 0), // shoulder boards
      box(r * 0.42, h * 0.05, r * 0.5, r * 0.8, h * 0.73, 0),
      box(r * 1.3, h * 0.05, r * 0.8, 0, h * 0.42, 0), // belt
    ];
    return this.finish(merge(scene, 'championTrim', parts));
  }

  update(view: SimView, time: number): void {
    const n = view.count;
    const trim = this.championTrim;
    this.mob.ensureCapacity(n);
    this.champion.ensureCapacity(n);
    trim?.ensureCapacity(n);
    this.mob.count = 0;
    this.champion.count = 0;
    if (trim) trim.count = 0;
    const model = this.modelReady;
    const mobH = model ? MODEL_MOB_HEIGHT : 1;
    const champH = model ? MODEL_CHAMPION_HEIGHT : 1;
    const gr = PALETTE.gold.r;
    const gg = PALETTE.gold.g;
    const gb = PALETTE.gold.b;
    const { posX, posZ, team, kind, radius } = view;
    const pc = model ? PLAYER_PLASTIC : PALETTE.player;
    const ec = model ? ENEMY_PLASTIC : PALETTE.enemy;
    const pr = pc.r;
    const pg = pc.g;
    const pb = pc.b;
    const er = ec.r;
    const eg = ec.g;
    const eb = ec.b;
    const cb = CHAMPION_BRIGHT;
    for (let i = 0; i < n; i++) {
      const isChampion = kind[i] === UnitKind.Champion;
      const base = isChampion ? LAYOUT.championRadius : LAYOUT.mobRadius;
      const s = radius[i] > 0 ? radius[i] / base : 1;
      // Phase from time and position: stable per unit (the sim reorders its arrays) and
      // varied across the crowd, so the army hops along out of step.
      const x = posX[i];
      const z = posZ[i];
      const phase = time * HOP_SPEED + z * 1.9 + x * 3.7;
      const sn = Math.sin(phase);
      const hop = Math.abs(sn);
      const player = team[i] === Team.Player;
      // Figures face -Z: the player's army turns round to march up the lane (+Z).
      const yaw = player ? PLAYER_YAW : ENEMY_YAW;
      const lean = model ? -hop * HOP_LEAN * (isChampion ? 0.4 : 1) : 0;
      const roll = model ? sn * WADDLE * (isChampion ? 0.5 : 1) : 0;
      const y = hop * HOP_HEIGHT * s * (isChampion ? 0.6 : 1);
      if (isChampion) {
        const k = s * champH;
        if (player) this.champion.write(x, y, z, k, lean, roll, yaw, pr * cb, pg * cb, pb * cb);
        else this.champion.write(x, y, z, k, lean, roll, yaw, er * cb, eg * cb, eb * cb);
        trim?.write(x, y, z, k, 0, 0, 0, gr, gg, gb);
      } else {
        const k = s * mobH;
        if (player) this.mob.write(x, y, z, k, lean, roll, yaw, pr, pg, pb);
        else this.mob.write(x, y, z, k, lean, roll, yaw, er, eg, eb);
      }
    }
    this.mob.commit();
    this.champion.commit();
    trim?.commit();
  }

  dispose(): void {
    this.disposed = true;
    this.mob.mesh.dispose();
    this.champion.mesh.dispose();
    this.championTrim?.mesh.dispose();
    this.material.dispose();
    this.keyLight.dispose();
  }
}

// Glossy injection-moulded plastic: the instance colour drives diffuse and a little
// emissive (so shadowed sides stay the team colour, not black), a white specular
// highlight from the toy key light sits on top uncoloured (the sky light has none), and an emissive fresnel rim brightens the silhouette
// edges like light catching the curve of a plastic figure.
function plasticMaterial(scene: Scene): StandardMaterial {
  const m = new StandardMaterial('armyMenPlastic', scene);
  m.diffuseColor = new Color3(0.92, 0.92, 0.92);
  m.emissiveColor = new Color3(0.24, 0.24, 0.24);
  m.specularColor = new Color3(1, 1, 0.96);
  m.specularPower = 18;
  const rim = new FresnelParameters();
  rim.leftColor = new Color3(0.6, 0.6, 0.6); // edge-on
  rim.rightColor = new Color3(0.16, 0.16, 0.16); // facing the camera
  rim.power = 2.2;
  rim.bias = 0;
  m.emissiveFresnelParameters = rim;
  m.freeze();
  return m;
}
