// Conveyor belts (World 3, contracts ConveyorDef): a strip of the cutting-mat lane that
// carries units. A charcoal rubber belt lies flush with the mat (its top just under the
// blob shadows, so units keep their contact shadows), printed with worn mustard chevron
// cleats over fine cross ribs (a 128 x 256 procedural texture and normal map, one chevron
// per BELT_REPEAT units). Blued-steel side rails with steel bolts run along both edges, a
// steel comb plate with a mustard edge closes each end, and four brass drive gears stand
// outside the rails at the ends. The belt scrolls (texture offset) and the gears turn
// with it, seamlessly; the whole conveyor is turned (setYaw) so its chevrons point the way
// it runs and simply flips when the belt reverses.
//
// GAME API (level.ts):
//   const belt = createConveyor(scene, look, def, slot);  // slot: index of the belt in the level
//   belt.root.parent = levelRoot;
//   per frame: belt.setYaw(beltYaw(def, conveyorDir(def, t)));
//              offset = beltScroll(offset, def, dt); belt.setScroll(offset);
//   belt.dispose();
// Built around its centre (def.x, def.z + def.length / 2), axis-aligned. Draw calls: belt,
// frame, gears (4 instances). Materials: 'workshop-belt-<slot>' (each belt scrolls its own
// texture copy), 'workshop-belt-frame', 'workshop-belt-gear'.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { ConveyorDef } from '../../contracts.ts';
import type { Look } from '../look/index.ts';
import {
  brassMaterial,
  buildMesh,
  lin,
  paint,
  paintedTinMaterial,
  place,
  plasticMaterial,
  roundedBox,
} from '../look/index.ts';
import type { ModelInfo, PreviewResult } from '../look/model.ts';
import { BELT_REPEAT, beltScroll, beltYaw } from '../fxLogic.ts';
import { conveyorDir } from '../../contracts.ts';
import { Geo, heightToNormal, rawTex, tfbm } from './environment.ts';
import { gearData, latheOut } from './workshopProps.ts';

export const info: ModelInfo = {
  key: 'conveyor',
  title: 'Conveyor belt',
  instanced: false,
  teams: false,
  side: 'neutral',
  height: 0.5,
  triangleBudget: 6000,
  gameZ: 12,
  variants: ['lateral', 'along'],
};

export const BELT_Y = 0.0105; // belt top: over the mat (0.006), under the blob shadows (0.012)
const RAIL_W = 0.2;
const RAIL_H = 0.13;
const COMB_D = 0.16;
const CHEVRON_W = 2.5; // world units across per chevron
const GEAR_R = 0.2;
const GEAR_TEETH = 12;
const RUBBER = '#2f3336';
const RAIL = '#3d5170'; // blued steel
const STEEL = '#b9bec4';
const MUSTARD = '#e2ad37';

// ---------- belt texture ----------
interface BeltData {
  albedo: Uint8Array;
  normal: Uint8Array;
}
const TW = 128;
const TH = 256;
let beltData: BeltData | null = null;

// Rubber with fine cross ribs and a raised chevron cleat pointing +v (the belt's +z),
// painted mustard and worn off in patches. Computed once; each belt uploads its own copy.
function beltTextureData(): BeltData {
  if (beltData) return beltData;
  const h = new Float32Array(TW * TH);
  const albedo = new Uint8Array(TW * TH * 4);
  const rubber = lin(RUBBER).toGammaSpace();
  const paintC = lin(MUSTARD).toGammaSpace();
  for (let y = 0; y < TH; y++) {
    const v = y / TH;
    for (let x = 0; x < TW; x++) {
      const u = x / TW;
      const i = y * TW + x;
      // Chevron cleat: tip at u = 0.5, arms falling back, ends short of the next one.
      const du = Math.abs(u - 0.5);
      const centre = 0.6 - 0.62 * du;
      let d = v - (centre - 0.14);
      d -= Math.floor(d);
      const across = Math.min(1, Math.max(0, (0.4 - du) * TW * 0.5));
      const band = d < 0.14 ? Math.min(1, Math.min(d, 0.14 - d) * TH * 0.5) * across : 0;
      const rib = 0.5 + 0.5 * Math.cos(v * Math.PI * 2 * 16);
      const n = tfbm(u, v, 8, 16, 3, 911);
      const grit = tfbm(u, v, 32, 64, 2, 37);
      h[i] = band * 1.4 + rib * 0.18 + grit * 0.12;
      // Paint scuffed thin in places by boots (tileable noise, so the belt has no seam).
      const wear = tfbm(u, v, 16, 32, 2, 5);
      const p = band * (wear > 0.62 ? 0.55 : 1);
      const shade = 0.88 + 0.22 * (n - 0.5) - 0.05 * rib;
      const o = i * 4;
      albedo[o] = Math.round(255 * Math.min(1, (rubber.r * (1 - p) + paintC.r * p) * shade));
      albedo[o + 1] = Math.round(255 * Math.min(1, (rubber.g * (1 - p) + paintC.g * p) * shade));
      albedo[o + 2] = Math.round(255 * Math.min(1, (rubber.b * (1 - p) + paintC.b * p) * shade));
      albedo[o + 3] = 255;
    }
  }
  beltData = { albedo, normal: heightToNormal(h, TW, TH, 2.2) };
  return beltData;
}

function beltMaterial(scene: Scene, look: Look, slot: number): PBRMaterial {
  const key = `workshop-belt-${slot}`;
  return look.material(key, () => {
    const d = beltTextureData();
    return plasticMaterial(scene, null, {
      name: key,
      albedoTexture: rawTex(scene, `${key}-albedo`, d.albedo, TW, TH, true),
      normalTexture: rawTex(scene, `${key}-normal`, d.normal, TW, TH, false),
      normalStrength: 0.8,
      roughness: 0.82,
      envIntensity: 0.5,
    });
  });
}

// ---------- geometry ----------
// The belt surface (local frame: runs along +z), its edges and ends a little darker
// where it meets the rails and the comb plates.
function beltGeometry(w: number, l: number): VertexData {
  const g = new Geo();
  const uRep = Math.max(1, Math.round(w / CHEVRON_W));
  const xs = [-w / 2, -w / 2 + 0.12, -w / 2 + 0.4, 0, w / 2 - 0.4, w / 2 - 0.12, w / 2];
  const zs = [-l / 2, -l / 2 + 0.15, l / 2 - 0.15, l / 2];
  const rows = zs.map((z, j) =>
    xs.map((x, i) => {
      const edge = i === 0 || i === xs.length - 1 ? 0.55 : i === 1 || i === xs.length - 2 ? 0.85 : 1;
      const end = j === 0 || j === zs.length - 1 ? 0.7 : 1;
      const k = edge * end;
      return g.vert(x, BELT_Y, z, 0, 1, 0, ((x + w / 2) / w) * uRep, z / BELT_REPEAT, [k, k, k]);
    }),
  );
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) g.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
  return g.data();
}

function bolt(x: number, y: number, z: number): VertexData {
  const b = latheOut(
    [
      [0, 0.035],
      [0.03, 0.03],
      [0.042, 0.012],
      [0.042, 0],
    ],
    8,
  );
  return paint(place(b, { x, y, z }), lin(STEEL));
}

// Rails, bolts and the end comb plates, vertex coloured on one painted-tin material.
function frameGeometry(w: number, l: number): VertexData[] {
  const parts: VertexData[] = [];
  const rail = lin(RAIL);
  const steel = lin(STEEL);
  for (const s of [-1, 1]) {
    const x = s * (w / 2 + RAIL_W / 2 - 0.02);
    parts.push(paint(place(roundedBox(RAIL_W, RAIL_H, l + 0.34, 0.035, 2), { x, y: RAIL_H / 2 - 0.01, z: 0 }), rail));
    // A bright steel lip along the inner top edge.
    parts.push(
      paint(
        place(roundedBox(0.05, 0.03, l + 0.3, 0.012, 1), { x: x - s * (RAIL_W / 2 - 0.02), y: RAIL_H, z: 0 }),
        steel,
      ),
    );
    const n = Math.max(2, Math.round(l / 1.1));
    for (let k = 0; k <= n; k++) parts.push(bolt(x + s * 0.03, RAIL_H - 0.005, -l / 2 + (k / n) * l));
  }
  for (const e of [-1, 1]) {
    const z = e * (l / 2 + COMB_D / 2 - 0.02);
    parts.push(paint(place(roundedBox(w + 0.06, 0.022, COMB_D, 0.008, 1), { x: 0, y: 0.004, z }), steel));
    // Comb teeth reaching over the belt, and the mustard warning edge on the outside.
    const teeth = Math.round(w / 0.22);
    for (let k = 0; k < teeth; k++)
      parts.push(
        paint(
          place(roundedBox(0.1, 0.014, 0.12, 0.005, 1), {
            x: -w / 2 + ((k + 0.5) / teeth) * w,
            y: 0.006,
            z: z - e * (COMB_D / 2 + 0.04),
          }),
          steel,
        ),
      );
    parts.push(
      paint(place(roundedBox(w + 0.06, 0.012, 0.045, 0.006, 1), { x: 0, y: 0.017, z: z + e * 0.055 }), lin(MUSTARD)),
    );
  }
  return parts;
}

// A brass drive gear standing upright, its axle along x, with a short steel axle stub.
function gearGeometry(): VertexData {
  const g = gearData(GEAR_R, GEAR_R * 0.82, GEAR_TEETH, 0.06, 0.045);
  place(g, { y: -0.03 });
  return place(g, { rz: Math.PI / 2 });
}

export interface ConveyorModel {
  root: TransformNode;
  setYaw(yaw: number): void; // beltYaw(def, conveyorDir(def, t))
  setScroll(offset: number): void; // beltScroll(...), 0..1
  dispose(): void;
}

export function createConveyor(scene: Scene, look: Look, def: ConveyorDef, slot: number): ConveyorModel {
  const root = new TransformNode(`conveyor-${def.id}`, scene);
  root.position.set(def.x, 0, def.z + def.length / 2);
  const turn = new TransformNode(`conveyor-${def.id}-turn`, scene);
  turn.parent = root;
  // Local frame: the belt runs along +z; a lateral belt (|vx| > |vz|) is turned a quarter
  // by its yaw, so its local length spans the def's width.
  const lateral = Math.abs(def.vx) > Math.abs(def.vz);
  const w = lateral ? def.length : def.width;
  const l = lateral ? def.width : def.length;

  const beltMat = beltMaterial(scene, look, slot);
  const belt = buildMesh(scene, `conveyor-${def.id}-belt`, beltGeometry(w, l), beltMat);
  const frame = buildMesh(
    scene,
    `conveyor-${def.id}-frame`,
    frameGeometry(w, l),
    look.material('workshop-belt-frame', () =>
      paintedTinMaterial(scene, null, { name: 'workshop-belt-frame', roughness: 0.34 }),
    ),
  );
  belt.parent = turn;
  frame.parent = turn;
  look.receiveShadows(belt);
  look.receiveShadows(frame);
  look.addShadowCaster(frame);

  const gearSrc = buildMesh(
    scene,
    `conveyor-${def.id}-gear`,
    gearGeometry(),
    look.material('workshop-belt-gear', () => brassMaterial(scene, { name: 'workshop-belt-gear' })),
  );
  const gears: (Mesh | InstancedMesh)[] = [gearSrc];
  for (let i = 1; i < 4; i++) gears.push(gearSrc.createInstance(`conveyor-${def.id}-gear${i}`));
  gears.forEach((m, i) => {
    const sx = i % 2 === 0 ? -1 : 1;
    const sz = i < 2 ? -1 : 1;
    m.parent = turn;
    m.position.set(sx * (w / 2 + RAIL_W + 0.04), GEAR_R - 0.02, sz * (l / 2 - 0.3));
    look.addShadowCaster(m);
  });

  // The gears turn with the belt; whole multiples of a tooth per texture repeat, so the
  // turn stays seamless when the scroll offset wraps.
  const tooth = (Math.PI * 2) / GEAR_TEETH;
  const teethPerRepeat = Math.max(1, Math.round(BELT_REPEAT / GEAR_R / tooth));
  const albedo = beltMat.albedoTexture as Texture;
  const normal = beltMat.bumpTexture as Texture;

  return {
    root,
    setYaw(yaw: number): void {
      turn.rotation.y = yaw;
    },
    setScroll(offset: number): void {
      albedo.vOffset = offset;
      normal.vOffset = offset;
      const roll = -offset * teethPerRepeat * tooth;
      for (const m of gears) m.rotation.x = roll;
    },
    dispose(): void {
      root.dispose(false, false);
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look, opts: { variant: string | null }): PreviewResult {
  const root = new TransformNode('conveyorPreview', scene);
  const old = look.theme;
  look.setTheme('workshop');
  const def: ConveyorDef =
    opts.variant === 'along'
      ? { id: 'p', x: 0, z: -3.5, width: 4, length: 7, vx: 0, vz: 3 }
      : { id: 'p', x: 0, z: -3, width: 10, length: 6, vx: 2.4, vz: 0, flip: 4 };
  const belt = createConveyor(scene, look, def, 0);
  belt.root.parent = root;
  belt.root.position.set(0, 0, 0);
  let offset = 0;
  return {
    root,
    update(time: number, dt: number): void {
      belt.setYaw(beltYaw(def, conveyorDir(def, time)));
      offset = beltScroll(offset, def, dt);
      belt.setScroll(offset);
    },
    dispose(): void {
      belt.dispose();
      root.dispose();
      look.setTheme(old);
    },
  };
}
