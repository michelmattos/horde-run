// Turntables (World 3, contracts TurntableDef): a big lithographed tin disc set flush into
// the cutting mat that carries units round its centre. The disc is printed like a vintage
// tin toy: a cream field with gold pinstripes, a deep red outer band, a teal inner ring and
// four navy curved arrows showing which way it turns (mirrored while the spin is
// reversed). A chunky brass toothed rim rings it, a domed brass hub caps the centre, and a
// brass drive gear meshes with the rim at the back right, turning the other way six times
// as fast. A dark gap ring in the mat shows it is a separate part.
//
// GAME API (level.ts):
//   const disc = createTurntable(scene, look, def);
//   disc.root.parent = levelRoot;
//   per frame: angle = turntableAngle(angle, def, t, dt); disc.setAngle(angle);
//              disc.setSpinSign(Math.sign(turntableSpin(def, t)));
//   disc.dispose();
// Draw calls: disc print, brass (rim + hub, one mesh), drive gear, gap ring. Materials:
// 'workshop-turntable-*' (the print is a 512 px canvas texture shared by every turntable).
import type { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { TurntableDef } from '../../contracts.ts';
import { turntableSpin } from '../../contracts.ts';
import type { Look } from '../look/index.ts';
import { brassMaterial, buildMesh, lin, mergeParts, paintedTinMaterial, plasticMaterial } from '../look/index.ts';
import type { ModelInfo, PreviewResult } from '../look/model.ts';
import { turntableAngle } from '../fxLogic.ts';
import { Geo } from './environment.ts';
import { gearData, latheOut, ringData } from './workshopProps.ts';

export const info: ModelInfo = {
  key: 'turntable',
  title: 'Turntable: brass-rimmed tin disc',
  instanced: false,
  teams: false,
  side: 'neutral',
  height: 0.3,
  triangleBudget: 8000,
  gameZ: 24,
};

const DISC_Y = 0.0105; // print top: over the mat, under the blob shadows
const RIM_W = 0.16; // brass rim inside the radius
const RIM_H = 0.035;
const TOOTH = 0.1; // rim teeth reach this far outside the radius
const PITCH = 0.42; // rim tooth pitch (world units)
const RATIO = 6; // rim teeth per drive-gear tooth: the drive gear turns six times as fast
const DRIVE_AT = 0.6; // drive gear direction from the centre (radians from +x toward +z)
const FONT = '"Arial Rounded MT Bold", ui-rounded, "Nunito", "Helvetica Neue", Arial, system-ui, sans-serif';

// Canvas y runs toward world -z (uv v = 0.5 + z / 2R), so a turn from +x toward +z is
// anticlockwise on the canvas.
function printTexture(scene: Scene): DynamicTexture {
  const S = 512;
  const c = S / 2;
  const tex = new DynamicTexture('workshop-turntable-print-tex', { width: S, height: S }, scene, true);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const disc = (r: number, fill: string): void => {
    ctx.beginPath();
    ctx.arc(c, c, r * c, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const ring = (r: number, w: number, stroke: string): void => {
    ctx.beginPath();
    ctx.arc(c, c, r * c, 0, Math.PI * 2);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = w;
    ctx.stroke();
  };
  ctx.fillStyle = '#b5372f';
  ctx.fillRect(0, 0, S, S);
  disc(1, '#b5372f');
  disc(0.84, '#efe3c6');
  ring(0.92, 3, '#efe3c6');
  ring(0.82, 4, '#c99a3a');
  ring(0.4, 26, '#2f7f86');
  ring(0.46, 3, '#c99a3a');
  ring(0.34, 3, '#c99a3a');
  // Little printed stars round the red band.
  ctx.fillStyle = '#f3d27a';
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * 0.885 * c, c + Math.sin(a) * 0.885 * c, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Four curved arrows, the way a positive spin turns.
  ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * Math.PI * 2;
    const a1 = a0 - 0.95;
    const r = 0.64 * c;
    ctx.beginPath();
    ctx.arc(c, c, r, a0, a1, true);
    ctx.strokeStyle = '#27406b';
    ctx.lineWidth = 22;
    ctx.stroke();
    const hx = c + Math.cos(a1) * r;
    const hy = c + Math.sin(a1) * r;
    const tx = Math.sin(a1); // tangent along the arrow's travel (anticlockwise on canvas)
    const ty = -Math.cos(a1);
    const nx = Math.cos(a1);
    const ny = Math.sin(a1);
    ctx.beginPath();
    ctx.moveTo(hx + tx * 30, hy + ty * 30);
    ctx.lineTo(hx + nx * 26, hy + ny * 26);
    ctx.lineTo(hx - nx * 26, hy - ny * 26);
    ctx.closePath();
    ctx.fillStyle = '#27406b';
    ctx.fill();
  }
  ctx.font = `900 26px ${FONT}`;
  ctx.fillStyle = '#9c2a22';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TURN', c, c - 0.2 * c);
  ctx.fillText('ABOUT', c, c + 0.2 * c);
  tex.update(true);
  return tex;
}

// The printed disc: a fan of rings, uv planar so the canvas lies flat on it.
function discGeometry(r: number): VertexData {
  const g = new Geo();
  const seg = 72;
  const rings = [0, 0.3, 0.6, 0.85, 1];
  const ids = rings.map((f) => {
    const row: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const x = Math.cos(a) * r * f;
      const z = Math.sin(a) * r * f;
      row.push(g.vert(x, DISC_Y, z, 0, 1, 0, 0.5 + x / (2 * r), 0.5 + z / (2 * r), [1, 1, 1]));
    }
    return row;
  });
  for (let j = 0; j < ids.length - 1; j++)
    for (let k = 0; k < seg; k++) g.quad(ids[j][k], ids[j][k + 1], ids[j + 1][k + 1], ids[j + 1][k]);
  return g.data();
}

// The dark gap round the disc where it sits in the mat.
function gapGeometry(r: number): VertexData {
  const g = new Geo();
  const seg = 72;
  const dark = lin('#1c2324');
  const edge = lin('#2a3637');
  const radii: [number, number, typeof dark][] = [
    [r + TOOTH - 0.02, 0.0072, dark],
    [r + TOOTH + 0.12, 0.0072, dark],
    [r + TOOTH + 0.18, 0.0068, edge],
  ];
  const rows = radii.map(([rr, y, col]) => {
    const row: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      row.push(g.vert(Math.cos(a) * rr, y, Math.sin(a) * rr, 0, 1, 0, 0, 0, col));
    }
    return row;
  });
  for (let j = 0; j < rows.length - 1; j++)
    for (let k = 0; k < seg; k++) g.quad(rows[j][k], rows[j][k + 1], rows[j + 1][k + 1], rows[j + 1][k]);
  return g.data();
}

// Brass toothed rim plus the domed hub with a wind-up key slot.
function brassGeometry(r: number, teeth: number): VertexData {
  const outline: [number, number][] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    outline.push([r, a], [r + TOOTH, a + step * 0.18], [r + TOOTH, a + step * 0.42], [r, a + step * 0.6]);
  }
  const rim = ringData(outline, RIM_H, r - RIM_W);
  const hub = latheOut(
    [
      [0, 0.1],
      [0.12, 0.095],
      [0.24, 0.07],
      [0.32, 0.035],
      [0.36, 0.012],
      [0.37, 0],
    ],
    24,
  );
  return mergeParts([rim, hub]);
}

export interface TurntableModel {
  root: TransformNode;
  setAngle(angle: number): void; // turntableAngle(...): radians from +x toward +z
  setSpinSign(sign: number): void; // sign of turntableSpin(def, t): mirrors the printed arrows
  dispose(): void;
}

export function createTurntable(scene: Scene, look: Look, def: TurntableDef): TurntableModel {
  const r = def.radius;
  const root = new TransformNode(`turntable-${def.id}`, scene);
  root.position.set(def.x, 0, def.z);
  const spin = new TransformNode(`turntable-${def.id}-spin`, scene);
  spin.parent = root;

  const printMat = look.material('workshop-turntable-print', () =>
    paintedTinMaterial(scene, null, {
      name: 'workshop-turntable-print',
      albedoTexture: printTexture(scene),
      roughness: 0.36,
    }),
  );
  const brass = look.material('workshop-turntable-brass', () =>
    brassMaterial(scene, { name: 'workshop-turntable-brass', roughness: 0.32 }),
  );
  const disc = buildMesh(scene, `turntable-${def.id}-disc`, discGeometry(r - RIM_W + 0.02), printMat);
  const pitchR = r + TOOTH * 0.5;
  const teeth = Math.max(RATIO * 4, Math.round((Math.PI * 2 * pitchR) / PITCH / RATIO) * RATIO);
  const rim = buildMesh(scene, `turntable-${def.id}-rim`, brassGeometry(r, teeth), brass);
  disc.parent = spin;
  rim.parent = spin;
  const gap = buildMesh(
    scene,
    `turntable-${def.id}-gap`,
    gapGeometry(r),
    look.material('workshop-turntable-gap', () =>
      plasticMaterial(scene, null, { name: 'workshop-turntable-gap', roughness: 0.9 }),
    ),
  );
  gap.parent = root;

  // Drive gear: meshes with the rim, so its pitch radius is the rim's over RATIO.
  const driveTeeth = teeth / RATIO;
  const driveR = pitchR / RATIO;
  const drive = buildMesh(
    scene,
    `turntable-${def.id}-drive`,
    gearData(driveR + TOOTH * 0.5, driveR - TOOTH * 0.5, driveTeeth, 0.06, 0.06),
    brass,
  );
  drive.parent = root;
  const dist = pitchR + driveR + 0.02;
  drive.position.set(Math.cos(DRIVE_AT) * dist, 0, Math.sin(DRIVE_AT) * dist);

  look.receiveShadows(disc);
  look.receiveShadows(gap);
  look.receiveShadows(rim);
  look.addShadowCaster(rim);
  look.addShadowCaster(drive);

  return {
    root,
    setAngle(angle: number): void {
      // Babylon's positive yaw turns +x toward -z; the contract's spin turns +x toward +z.
      spin.rotation.y = -angle;
      drive.rotation.y = angle * RATIO + Math.PI / driveTeeth;
    },
    setSpinSign(sign: number): void {
      disc.scaling.z = sign < 0 ? -1 : 1;
    },
    dispose(): void {
      root.dispose(false, false);
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look): PreviewResult {
  const root = new TransformNode('turntablePreview', scene);
  const old = look.theme;
  look.setTheme('workshop');
  const def: TurntableDef = { id: 'p', x: 0, z: 0, radius: 3.4, spin: 0.9, flip: 6 };
  const disc = createTurntable(scene, look, def);
  disc.root.parent = root;
  let angle = 0;
  return {
    root,
    update(time: number, dt: number): void {
      angle = turntableAngle(angle, def, time, dt);
      disc.setAngle(angle);
      disc.setSpinSign(Math.sign(turntableSpin(def, time)));
    },
    dispose(): void {
      disc.dispose();
      root.dispose();
      look.setTheme(old);
    },
  };
}
