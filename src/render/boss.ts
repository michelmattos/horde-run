// The Tin General (World 1 boss): a tin toy soldier in a red coat and tall shako,
// standing in the turret of his wind-up tank. The enemy base block is the tank's hull;
// this adds the treads, wheels, turret and barrel (one mesh), the General himself (one
// mesh) and the wind-up key on the back, which turns while the tank strafes (one mesh).
// All vertex-coloured, so the boss costs three draw calls. Hits flicker the General,
// a phase change flashes him bright and pops his scale. Nothing here moves the camera.
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PALETTE } from './palette.ts';
import { popScale } from './fxLogic.ts';

const GENERAL_SCALE = 1.7; // big enough to read at the far end of the lane
const TURRET_D = 2.2;
const TURRET_H = 0.55;
const TURRET_Z = 0.5; // turret sits a little behind the hull centre, away from the HP bar
const BOB_SPEED = 3;
const BOB_HEIGHT = 0.06;
const KEY_SPEED = 2.2; // radians per second while the tank is running
const PHASE_FLASH_TIME = 0.35;
const HIT_FLASH_TIME = 0.08;

type Axis = 'y' | 'x' | 'z';

// Part builder: a box or cylinder, optionally tilted about Z, painted one colour.
function part(vd: VertexData, x: number, y: number, z: number, c: Color3, tiltZ = 0): VertexData {
  const m = tiltZ ? Matrix.RotationZ(tiltZ).multiply(Matrix.Translation(x, y, z)) : Matrix.Translation(x, y, z);
  vd.transform(m);
  paint(vd, c);
  return vd;
}
function box(w: number, h: number, d: number): VertexData {
  return CreateBoxVertexData({ width: w, height: h, depth: d });
}
function cyl(
  diameter: number,
  length: number,
  axis: Axis = 'y',
  diameterTop = diameter,
  tessellation = 12,
): VertexData {
  const vd = CreateCylinderVertexData({ height: length, diameterBottom: diameter, diameterTop, tessellation });
  if (axis === 'x') vd.transform(Matrix.RotationZ(Math.PI / 2));
  else if (axis === 'z') vd.transform(Matrix.RotationX(Math.PI / 2));
  return vd;
}
function build(scene: Scene, name: string, parts: VertexData[], material: StandardMaterial): Mesh {
  const vd = parts[0];
  vd.merge(parts.slice(1));
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.material = material;
  return mesh;
}

export class TinGeneral {
  private readonly tank: Mesh;
  private readonly general: Mesh;
  private readonly key: Mesh;
  private readonly material: StandardMaterial;
  private readonly flashMaterial: StandardMaterial;
  private readonly turretTop: number;
  private readonly keyY: number;
  private readonly keyZ: number;
  private flash = 0;
  private pop = 0;
  private keyAngle = 0;

  // width/depth/height: the enemy base block (the tank's hull) this dresses up.
  constructor(scene: Scene, width: number, depth: number, height: number) {
    this.material = new StandardMaterial('tinGeneralMat', scene);
    this.material.diffuseColor = new Color3(1, 1, 1);
    this.material.emissiveColor = new Color3(0.25, 0.25, 0.25);
    this.material.specularColor = Color3.Black();
    this.material.freeze();
    this.flashMaterial = new StandardMaterial('tinGeneralFlash', scene);
    this.flashMaterial.diffuseColor = new Color3(1, 1, 1);
    this.flashMaterial.emissiveColor = new Color3(0.9, 0.85, 0.7);
    this.flashMaterial.specularColor = Color3.Black();
    this.flashMaterial.freeze();

    // ----- Tank: treads with wheels on both sides, turret and a short barrel -----
    const P = PALETTE;
    const t: VertexData[] = [];
    for (const side of [-1, 1]) {
      t.push(part(box(0.6, 1.0, depth + 0.6), side * (width / 2 + 0.3), 0.5, 0, P.tread));
      for (let k = 0; k < 4; k++) {
        const z = -depth / 2 + 0.5 + (k * (depth - 1)) / 3;
        t.push(part(cyl(0.72, 0.12, 'x'), side * (width / 2 + 0.64), 0.45, z, P.tinDark));
      }
    }
    t.push(part(cyl(TURRET_D, TURRET_H, 'y', TURRET_D * 0.9, 14), 0, height + TURRET_H / 2, TURRET_Z, P.tin));
    t.push(part(cyl(0.26, 1.6, 'z'), 0, height + 0.18, TURRET_Z - TURRET_D / 2 - 0.5, P.tinDark));
    this.tank = build(scene, 'tinTank', t, this.material);
    this.turretTop = height + TURRET_H;

    // ----- The General, built around his feet at the turret hatch (origin) -----
    const G = GENERAL_SCALE;
    const g: VertexData[] = [];
    const at = (vd: VertexData, x: number, y: number, z: number, c: Color3, tilt = 0): void => {
      vd.transform(Matrix.Scaling(G, G, G));
      g.push(part(vd, x * G, y * G, z * G, c, tilt));
    };
    at(cyl(0.85, 0.95, 'y', 0.7, 10), 0, 0.475, 0, P.generalCoat); // coat
    at(cyl(0.86, 0.1, 'y', 0.8, 10), 0, 0.35, 0, P.white); // belt
    at(box(0.32, 0.1, 0.36), -0.42, 0.92, 0, P.gold); // epaulettes
    at(box(0.32, 0.1, 0.36), 0.42, 0.92, 0, P.gold);
    at(box(0.2, 0.6, 0.22), -0.5, 0.62, 0, P.generalCoat); // left arm, down
    at(box(0.2, 0.6, 0.22), 0.6, 1.08, 0, P.generalCoat, -0.6); // right arm, raised
    at(box(0.07, 1.1, 0.05), 0.92, 1.72, 0, P.tin, -0.3); // sword
    at(box(0.5, 0.48, 0.48), 0, 1.24, 0, P.skin); // head
    at(box(0.08, 0.08, 0.04), -0.11, 1.3, -0.25, P.shako); // eyes
    at(box(0.08, 0.08, 0.04), 0.11, 1.3, -0.25, P.shako);
    at(box(0.3, 0.07, 0.05), 0, 1.15, -0.25, P.shako); // moustache
    at(cyl(0.5, 0.55, 'y', 0.58, 10), 0, 1.75, 0, P.shako); // shako
    at(cyl(0.53, 0.08, 'y', 0.53, 10), 0, 1.53, 0, P.gold); // shako band
    at(box(0.5, 0.05, 0.25), 0, 1.5, -0.3, P.shako); // visor
    at(box(0.12, 0.32, 0.12), 0, 2.18, 0, P.gateBad); // plume
    this.general = build(scene, 'tinGeneral', g, this.material);

    // ----- Wind-up key on the back: a shaft and two bows, turning about local Z -----
    const k: VertexData[] = [];
    k.push(part(cyl(0.2, 0.8, 'z'), 0, 0, 0.4, P.gold));
    k.push(part(box(1.0, 0.24, 0.12), 0, 0, 0.8, P.gold));
    for (const side of [-1, 1]) k.push(part(cyl(0.7, 0.12, 'z'), side * 0.62, 0, 0.8, P.gold));
    this.key = build(scene, 'tinTankKey', k, this.material);
    this.keyY = height * 0.6;
    this.keyZ = depth / 2;
  }

  // Strong flash and scale pop when the boss enters a new phase.
  phase(): void {
    this.flash = PHASE_FLASH_TIME;
    this.pop = PHASE_FLASH_TIME;
  }

  // Brief flicker when the tank takes a hit (no pop, so phase changes stand out).
  hit(): void {
    if (this.flash > HIT_FLASH_TIME) return;
    this.flash = HIT_FLASH_TIME;
  }

  // (x, zCenter): the hull's centre on the ground; it follows the strafing base.
  update(x: number, zCenter: number, time: number, dt: number, alive: boolean): void {
    this.tank.isVisible = this.general.isVisible = this.key.isVisible = alive;
    if (!alive) return;
    this.flash = Math.max(0, this.flash - dt);
    this.pop = Math.max(0, this.pop - dt);
    this.tank.position.set(x, 0, zCenter);

    const sc = popScale(this.pop / PHASE_FLASH_TIME, 0.35);
    this.general.scaling.set(sc, sc, sc);
    this.general.position.set(
      x,
      this.turretTop - 0.15 + Math.abs(Math.sin(time * BOB_SPEED)) * BOB_HEIGHT,
      zCenter + TURRET_Z,
    );
    this.general.rotation.y = Math.sin(time * 1.3) * 0.15; // looks around a little
    this.general.material = this.flash > 0 ? this.flashMaterial : this.material;

    this.keyAngle += KEY_SPEED * dt;
    this.key.position.set(x, this.keyY, zCenter + this.keyZ);
    this.key.rotation.z = this.keyAngle;
  }

  dispose(): void {
    this.tank.dispose();
    this.general.dispose();
    this.key.dispose();
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
