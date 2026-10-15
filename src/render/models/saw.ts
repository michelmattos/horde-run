// Saw blades (World 3, contracts SawDef): a spinning circular saw standing up out of a
// slot in the cutting mat, hurting both armies. The blade is bright steel with hooked,
// dark-tipped teeth and a red enamelled face ring round a brass arbor nut; it stands in
// the plane of its path (facing the camera by default) and spins about its axle. The slot
// is a steel plate with a dark channel, banded on both sides by bright yellow-and-black
// hazard stripes, long enough for the whole glide; a soft red danger glow lies on the
// mat under the blade while it is up. A cycled saw sinks into its slot while it is off
// (the glow fades with it).
//
// GAME API (level.ts):
//   const saw = createSaw(scene, look, def);
//   saw.root.parent = levelRoot;
//   per frame: sawPos(def, t, p); saw.setPos(p.x, p.z);
//              saw.setRaise(sawRaiseAt(def.cycle, t)); saw.setSpin(angle);  // angle += SAW_SPIN * dt
//   saw.dispose();
// Draw calls: slot, blade, enamel + nut, glow. Materials 'workshop-saw-*'.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { SawDef } from '../../contracts.ts';
import { sawPos } from '../../contracts.ts';
import type { Look } from '../look/index.ts';
import {
  buildMesh,
  lin,
  mergeParts,
  paint,
  paintedTinMaterial,
  place,
  radialTexture,
  tinMaterial,
} from '../look/index.ts';
import type { ModelInfo, PreviewResult } from '../look/model.ts';
import { sawRaiseAt } from '../fxLogic.ts';
import { Geo } from './environment.ts';
import { latheOut, ringData } from './workshopProps.ts';

export const info: ModelInfo = {
  key: 'saw',
  title: 'Saw blade in its slot',
  instanced: false,
  teams: false,
  side: 'neutral',
  height: 1.4,
  triangleBudget: 5000,
  gameZ: 26,
  variants: ['slide', 'static'],
};

export const SAW_SPIN = 14; // blade spin (rad/s) while it is up
const PLATE_Y = 0.0105;
const BLADE_T = 0.05;
const SLOT_W = 0.14; // the dark channel
const STRIPE_W = 0.13; // hazard band on each side
const RIM = 0.05; // steel border outside the bands
const STRIPE_LEN = 0.17;

// ---------- geometry ----------
// The blade, flat (y from 0 to BLADE_T, centred), then stood up facing +z.
function bladeGeometry(r: number): VertexData {
  const teeth = Math.max(16, Math.round((Math.PI * 2 * r) / 0.17));
  const step = (Math.PI * 2) / teeth;
  const outline: [number, number][] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    outline.push([r * 0.88, a], [r, a + step * 0.55], [r * 0.965, a + step * 0.66], [r * 0.9, a + step * 0.92]);
  }
  const body = ringData(outline, BLADE_T, 0.07);
  // Steel, the teeth tips dark (carbide), a faint polished ring.
  const p = body.positions!;
  const c = new Float32Array((p.length / 3) * 4);
  const steel = lin('#d6dbe0');
  const tip = lin('#4a4d52');
  const polish = lin('#eef2f5');
  for (let i = 0; i < p.length / 3; i++) {
    const d = Math.hypot(p[i * 3], p[i * 3 + 2]) / r;
    const col = d > 0.95 ? tip : d > 0.6 && d < 0.66 ? polish : steel;
    c.set([col.r, col.g, col.b, 1], i * 4);
  }
  body.colors = c;
  place(body, { y: -BLADE_T / 2 });
  return place(body, { rx: Math.PI / 2 });
}

// Red enamel face rings on both sides and the brass arbor nut and washer.
function faceGeometry(r: number): VertexData {
  const parts: VertexData[] = [];
  for (const s of [-1, 1]) {
    const ring = latheOut(
      [
        [r * 0.2, 0.004],
        [r * 0.56, 0.004],
        [r * 0.57, 0],
      ],
      40,
    );
    paint(ring, lin('#b8322b'));
    const washer = latheOut(
      [
        [0, 0.016],
        [r * 0.17, 0.016],
        [r * 0.18, 0],
      ],
      24,
    );
    paint(washer, lin('#c9cdd2'));
    const nut = latheOut(
      [
        [0, 0.05],
        [0.06, 0.05],
        [0.08, 0.03],
        [0.08, 0],
      ],
      6,
    );
    paint(nut, lin('#c9a24a'));
    place(nut, { y: 0.012 });
    for (const part of [ring, washer, nut]) {
      place(part, { y: BLADE_T / 2 });
      place(part, { rx: s * (Math.PI / 2) });
      parts.push(part);
    }
  }
  return mergeParts(parts);
}

// The slot plate along local +x from x0 to x1: steel border, hazard bands, dark channel.
function slotGeometry(x0: number, x1: number): VertexData {
  const g = new Geo();
  const steel = lin('#9aa1a8');
  const dark = lin('#141516');
  const yellow = lin('#f2c230');
  const black = lin('#1d1d1f');
  const strip = (za: number, zb: number, xa: number, xb: number, col: Color3, y = PLATE_Y, skew = 0): void => {
    const a = g.vert(xa, y, za, 0, 1, 0, 0, 0, col);
    const b = g.vert(xb, y, za, 0, 1, 0, 0, 0, col);
    const c = g.vert(xb + skew, y, zb, 0, 1, 0, 0, 0, col);
    const d = g.vert(xa + skew, y, zb, 0, 1, 0, 0, 0, col);
    g.quad(a, b, c, d);
  };
  const half = SLOT_W / 2 + STRIPE_W + RIM;
  const e = RIM;
  // Steel border all round (the bands and channel lie a hair above it).
  strip(-half, half, x0 - e, x1 + e, steel, PLATE_Y - 0.0015);
  strip(-SLOT_W / 2, SLOT_W / 2, x0, x1, dark, PLATE_Y + 0.0004);
  // Diagonal hazard stripes on both bands.
  for (const s of [-1, 1]) {
    const za = s < 0 ? -SLOT_W / 2 - STRIPE_W : SLOT_W / 2;
    const zb = za + STRIPE_W;
    const skew = STRIPE_W * 0.7;
    const n = Math.max(2, Math.floor((x1 - x0 - skew) / STRIPE_LEN));
    const len = (x1 - x0 - skew) / n;
    for (let k = 0; k < n; k++) {
      const xa = x0 + k * len;
      strip(za, zb, xa, xa + len, k % 2 === 0 ? yellow : black, PLATE_Y + 0.0004, skew);
    }
  }
  return g.data();
}

function glowGeometry(r: number): VertexData {
  const vd = new VertexData();
  const s = r * 1.5;
  vd.positions = [-s, 0.013, -s, s, 0.013, -s, s, 0.013, s, -s, 0.013, s];
  vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vd.indices = [0, 2, 1, 0, 3, 2];
  return vd;
}

function glowMaterial(scene: Scene, look: Look): StandardMaterial {
  return look.material('workshop-saw-glow', () => {
    const m = new StandardMaterial('workshop-saw-glow', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(1, 0.16, 0.08);
    m.opacityTexture = radialTexture(scene);
    m.alpha = 0.55;
    m.disableDepthWrite = true;
    m.zOffset = -2;
    return m;
  });
}

export interface SawModel {
  root: TransformNode;
  radius: number;
  setPos(x: number, z: number): void; // sawPos(def, t, out)
  setRaise(k: number): void; // sawRaiseAt(def.cycle, t): 0 sunk .. 1 up
  setSpin(angle: number): void; // blade angle about its axle
  dispose(): void;
}

export function createSaw(scene: Scene, look: Look, def: SawDef): SawModel {
  const r = def.radius;
  const dx = def.path?.dx ?? 0;
  const dz = def.path?.dz ?? 0;
  const pathLen = Math.hypot(dx, dz);
  // Local +x along the path: Babylon yaw turns +x to (cos y, 0, -sin y).
  const yaw = pathLen > 0 ? Math.atan2(-dz, dx) : 0;
  const root = new TransformNode(`saw-${def.id}`, scene);

  const slot = buildMesh(
    scene,
    `saw-${def.id}-slot`,
    slotGeometry(-r - 0.25, pathLen + r + 0.25),
    look.material('workshop-saw-plate', () =>
      paintedTinMaterial(scene, null, { name: 'workshop-saw-plate', roughness: 0.45 }),
    ),
  );
  slot.parent = root;
  slot.position.set(def.x, 0, def.z);
  slot.rotation.y = yaw;
  look.receiveShadows(slot);

  const blade = new TransformNode(`saw-${def.id}-blade`, scene);
  blade.parent = root;
  blade.rotation.y = yaw;
  const spin = new TransformNode(`saw-${def.id}-spin`, scene);
  spin.parent = blade;
  const steel: Mesh = buildMesh(
    scene,
    `saw-${def.id}-steel`,
    bladeGeometry(r),
    look.material('workshop-saw-steel', () =>
      tinMaterial(scene, null, { name: 'workshop-saw-steel', roughness: 0.22, texture: false }),
    ),
  );
  const face = buildMesh(
    scene,
    `saw-${def.id}-face`,
    faceGeometry(r),
    look.material('workshop-saw-face', () =>
      paintedTinMaterial(scene, null, { name: 'workshop-saw-face', roughness: 0.3 }),
    ),
  );
  steel.parent = spin;
  face.parent = spin;
  look.addShadowCaster(steel);
  look.addShadowCaster(face);

  const glow = buildMesh(scene, `saw-${def.id}-glow`, glowGeometry(r), glowMaterial(scene, look));
  glow.parent = root;
  glow.alphaIndex = 1;

  const sunk = -r * 1.05;
  const up = r * 0.3;
  const model: SawModel = {
    root,
    radius: r,
    setPos(x: number, z: number): void {
      blade.position.x = x;
      blade.position.z = z;
      glow.position.set(x, 0, z);
    },
    setRaise(k: number): void {
      blade.position.y = sunk + (up - sunk) * k;
      blade.setEnabled(k > 0.001);
      glow.visibility = k;
      glow.setEnabled(k > 0.01);
    },
    setSpin(angle: number): void {
      spin.rotation.z = angle;
    },
    dispose(): void {
      root.dispose(false, false);
    },
  };
  model.setPos(def.x, def.z);
  model.setRaise(1);
  return model;
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look, opts: { variant: string | null }): PreviewResult {
  const root = new TransformNode('sawPreview', scene);
  const old = look.theme;
  look.setTheme('workshop');
  const def: SawDef =
    opts.variant === 'static'
      ? { id: 'p', x: 0, z: 0, radius: 1.1, cycle: { on: 2.5, off: 2.5 } }
      : { id: 'p', x: -3, z: 0, radius: 1, path: { dx: 6, dz: 0, period: 7 } };
  const saw = createSaw(scene, look, def);
  saw.root.parent = root;
  const p = { x: 0, z: 0 };
  let angle = 0;
  return {
    root,
    update(time: number, dt: number): void {
      sawPos(def, time, p);
      saw.setPos(p.x, p.z);
      const k = sawRaiseAt(def.cycle, time);
      saw.setRaise(k);
      angle += SAW_SPIN * k * dt;
      saw.setSpin(angle);
    },
    dispose(): void {
      saw.dispose();
      root.dispose();
      look.setTheme(old);
    },
  };
}
