// Pure geometry for the home base: piece bounding boxes (rotated like Babylon's
// yaw-pitch-roll), building bounds per tier, the fixed portrait camera framing, tap
// picking against the buildings, the soldiers' spots and their idle sway, and a cheap
// ambient-occlusion bake against piece boxes. No Babylon, no DOM: unit tested in Node.
import { BUILDING_IDS, PLOTS, piecesAt } from './villagePieces.ts';
import type { BuildingId, Piece } from './villagePieces.ts';

export type Vec3 = [number, number, number];

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

// Babylon's rotation order (Quaternion.RotationYawPitchRoll): roll about z, then pitch
// about x, then yaw about y, in its left-handed convention.
export function rotate(v: Vec3, rx = 0, ry = 0, rz = 0): Vec3 {
  let [x, y, z] = v;
  if (rz) {
    const c = Math.cos(rz);
    const s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  if (rx) {
    const c = Math.cos(rx);
    const s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (ry) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  return [x, y, z];
}

// Local extent of a piece's shape around its bottom-centre anchor (before rotation).
function localBox(q: Piece): Aabb {
  switch (q.shape) {
    case 'log':
      return { min: [-q.w / 2, 0, -q.h / 2], max: [q.w / 2, q.h, q.h / 2] };
    case 'flag':
      return { min: [0, 0, -0.08], max: [q.w, q.h, 0.08] };
    case 'star':
      return { min: [-q.w / 2, 0, -q.d / 2], max: [q.w / 2, q.h, q.d / 2] };
    default:
      return { min: [-q.w / 2, 0, -q.d / 2], max: [q.w / 2, q.h, q.d / 2] };
  }
}

// World-aligned box of a piece in its building's space.
export function pieceAabb(q: Piece): Aabb {
  const b = localBox(q);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) {
        const r = rotate([x, y, z], q.rx, q.ry, q.rz);
        for (let k = 0; k < 3; k++) {
          const v = r[k] + (k === 0 ? q.x : k === 1 ? q.y : q.z);
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
  return { min, max };
}

// Bounds of a building at a tier in village space (at least its plot, 0.3 tall).
export function buildingBounds(id: BuildingId, tier: number): Aabb {
  const plot = PLOTS[id];
  const min: Vec3 = [plot.x - plot.w / 2, 0, plot.z - plot.d / 2];
  const max: Vec3 = [plot.x + plot.w / 2, 0.3, plot.z + plot.d / 2];
  for (const q of piecesAt(id, tier)) {
    const b = pieceAabb(q);
    min[0] = Math.min(min[0], b.min[0] + plot.x);
    max[0] = Math.max(max[0], b.max[0] + plot.x);
    max[1] = Math.max(max[1], b.max[1]);
    min[2] = Math.min(min[2], b.min[2] + plot.z);
    max[2] = Math.max(max[2], b.max[2] + plot.z);
  }
  return { min, max };
}

// ---------- ray picking ----------
// Distance along the ray to the box, or null when it misses (slab test).
export function rayBox(o: Vec3, d: Vec3, b: Aabb): number | null {
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < b.min[k] || o[k] > b.max[k]) return null;
      continue;
    }
    let a = (b.min[k] - o[k]) / d[k];
    let c = (b.max[k] - o[k]) / d[k];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

// Which building a tap ray hits: the nearest building box (at its current tier), else the
// plot whose footprint (grown by `slack`) holds the point where the ray meets the floor.
export function pickBuilding(
  origin: Vec3,
  dir: Vec3,
  tiers: Partial<Record<BuildingId, number>>,
  slack = 0.5,
): BuildingId | null {
  let best: BuildingId | null = null;
  let bestT = Infinity;
  for (const id of BUILDING_IDS) {
    const t = rayBox(origin, dir, buildingBounds(id, tiers[id] ?? 0));
    if (t !== null && t < bestT) {
      bestT = t;
      best = id;
    }
  }
  if (best) return best;
  if (dir[1] >= -1e-9) return null;
  const t = -origin[1] / dir[1];
  const x = origin[0] + dir[0] * t;
  const z = origin[2] + dir[2] * t;
  for (const id of BUILDING_IDS) {
    const p = PLOTS[id];
    if (Math.abs(x - p.x) <= p.w / 2 + slack && Math.abs(z - p.z) <= p.d / 2 + slack) return id;
  }
  return null;
}

// ---------- camera ----------
export const CAMERA_PITCH = 0.8; // radians below the horizon (~46 degrees), a fixed 3/4 view
export const CAMERA_FOV = 0.62; // vertical field of view, radians (a calm, slightly long lens)

// What must stay in view: the village footprint at floor and roof height, the tallest
// flag and the corner towers.
export const VILLAGE_POINTS: readonly Vec3[] = (() => {
  const pts: Vec3[] = [];
  for (const x of [-6, 6]) for (const z of [-5.2, 9.1]) for (const y of [0, 1.8]) pts.push([x, y, z]);
  pts.push([0, 4.3, -0.4], [-5.4, 3.7, 8.3], [5.4, 3.7, 8.3], [-3.2, 3.2, 3.1], [3.2, 3.2, 3.1]);
  return pts;
})();

export interface CameraFrame {
  position: Vec3;
  target: Vec3;
  fov: number; // vertical
}

// Normalised screen position (x -1..1 left to right, y -1..1 bottom to top) of a point,
// for a camera at `pos` looking at `target` (no roll) with vertical fov and aspect w/h.
export function project(pt: Vec3, pos: Vec3, target: Vec3, fov: number, aspect: number): [number, number, number] {
  const f: Vec3 = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
  const fl = Math.hypot(f[0], f[1], f[2]);
  f[0] /= fl;
  f[1] /= fl;
  f[2] /= fl;
  // Left-handed: right = up x forward.
  let r: Vec3 = [f[2], 0, -f[0]];
  const rl = Math.hypot(r[0], r[2]) || 1;
  r = [r[0] / rl, 0, r[2] / rl];
  const u: Vec3 = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const v: Vec3 = [pt[0] - pos[0], pt[1] - pos[1], pt[2] - pos[2]];
  const z = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
  const ty = Math.tan(fov / 2);
  const x = (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / (z * ty * aspect);
  const y = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / (z * ty);
  return [x, y, z];
}

// Screen band the village must fit in, as fractions of the canvas height: `top` is
// covered by the header plank, `bottom` by the building sheet.
export interface FrameRegion {
  top: number;
  bottom: number;
  side?: number; // horizontal margin as a fraction of the width (default 0.03)
}

// Places the fixed camera so every VILLAGE_POINT lands inside the free band, as large as
// it fits. The view direction never changes (pitch and yaw are fixed); only how far back
// the camera stands and where it aims along the village's depth do.
export function frameVillage(aspect: number, region: FrameRegion): CameraFrame {
  const a = Math.max(0.2, Math.min(4, aspect || 1));
  const side = region.side ?? 0.03;
  const yTop = 1 - 2 * Math.max(0, Math.min(0.45, region.top)) - 0.03;
  const yBot = -1 + 2 * Math.max(0, Math.min(0.6, region.bottom)) + 0.03;
  const xMax = 1 - 2 * side;
  const dir: Vec3 = [0, -Math.sin(CAMERA_PITCH), Math.cos(CAMERA_PITCH)];
  const fits = (dist: number, aimZ: number): { ok: boolean; lo: number; hi: number } => {
    const target: Vec3 = [0, 0.6, aimZ];
    const pos: Vec3 = [target[0] - dir[0] * dist, target[1] - dir[1] * dist, target[2] - dir[2] * dist];
    let lo = Infinity;
    let hi = -Infinity;
    let ok = true;
    for (const pt of VILLAGE_POINTS) {
      const [x, y, z] = project(pt, pos, target, CAMERA_FOV, a);
      if (z <= 0.1 || Math.abs(x) > xMax) ok = false;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    return { ok: ok && hi - lo <= yTop - yBot, lo, hi };
  };
  const frame = (dist: number, aimZ: number): CameraFrame => {
    const target: Vec3 = [0, 0.6, aimZ];
    return { position: [0, target[1] - dir[1] * dist, target[2] - dir[2] * dist], target, fov: CAMERA_FOV };
  };
  const want = (yTop + yBot) / 2;
  // The aim along the depth that centres the village in the band at this distance (the
  // picture slides down the screen as the aim moves away, so bisect).
  const centredAim = (dist: number): number => {
    let lo = -20;
    let hi = 25;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      const f = fits(dist, mid);
      if ((f.lo + f.hi) / 2 > want) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  let lo = 6;
  let hi = 150;
  if (!fits(hi, centredAim(hi)).ok) return frame(hi, centredAim(hi));
  for (let k = 0; k < 28; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid, centredAim(mid)).ok) hi = mid;
    else lo = mid;
  }
  return frame(hi, centredAim(hi));
}

// ---------- soldiers ----------
export interface SoldierSpot {
  x: number;
  z: number;
  yaw: number; // 0 faces +Z (up the rug, away from the camera); PI faces the camera
}

// A dozen green army men about the village: door guards, a squad at the flag, a helper
// at the workbench, gate sentries, a gardener and a patrol in the front-right corner.
export const SOLDIER_SPOTS: readonly SoldierSpot[] = [
  { x: -3.75, z: 1.05, yaw: Math.PI - 0.35 },
  { x: -2.55, z: 1.0, yaw: Math.PI + 0.3 },
  { x: -0.85, z: -2.25, yaw: 0.35 },
  { x: 0.0, z: -2.5, yaw: 0 },
  { x: 0.85, z: -2.25, yaw: -0.35 },
  { x: 2.25, z: 1.15, yaw: Math.PI - 0.7 },
  { x: -1.75, z: 7.05, yaw: Math.PI },
  { x: 1.75, z: 7.05, yaw: Math.PI },
  { x: -1.35, z: -4.15, yaw: Math.PI + 0.9 },
  { x: 3.2, z: -2.7, yaw: Math.PI + 0.45 },
  { x: 4.15, z: -3.35, yaw: Math.PI + 0.2 },
  { x: 3.0, z: -4.0, yaw: Math.PI - 0.25 },
];

// Gentle idle while the scene settles: a small breath (y scale) and sway (yaw), fading to
// rest as `settle` (1 -> 0) runs out, so the last frame before rendering stops is still.
export function idlePose(i: number, time: number, settle: number): { sy: number; yaw: number; lean: number } {
  const k = Math.max(0, Math.min(1, settle));
  if (k === 0) return { sy: 1, yaw: 0, lean: 0 };
  const ph = i * 1.7;
  return {
    sy: 1 + 0.025 * k * Math.sin(time * 2.4 + ph),
    yaw: 0.07 * k * Math.sin(time * 1.1 + ph * 0.6),
    lean: 0.03 * k * Math.sin(time * 1.9 + ph),
  };
}

// ---------- build animation ----------
export const DROP_TIME = 0.32; // seconds a piece falls
export const SQUASH_TIME = 0.22; // seconds of squash and stretch after landing
export const DROP_HEIGHT = 2.6;

// Order and start delay of the pieces that drop in: lowest first, then front to back, a
// short stagger between pieces, the whole build under ~1.6 s however many pieces.
export function dropSchedule(pieces: readonly { y: number; z: number }[]): number[] {
  const order = pieces.map((q, i) => ({ i, k: q.y * 4 + q.z * 0.15 })).sort((a, b) => a.k - b.k);
  const step = Math.min(0.06, 1.1 / Math.max(1, pieces.length));
  const out: number[] = Array.from({ length: pieces.length }, () => 0);
  order.forEach((o, n) => (out[o.i] = n * step));
  return out;
}

// Height offset and squash of a dropping piece `t` seconds after its start (t < 0: not
// yet in; done after DROP_TIME + SQUASH_TIME). Squash keeps the volume roughly constant.
export function dropPose(t: number): { y: number; sy: number; sxz: number; visible: boolean; done: boolean } {
  if (t < 0) return { y: DROP_HEIGHT, sy: 1, sxz: 1, visible: false, done: false };
  if (t < DROP_TIME) {
    const u = t / DROP_TIME;
    return { y: DROP_HEIGHT * (1 - u * u), sy: 1.08, sxz: 0.96, visible: true, done: false };
  }
  const s = t - DROP_TIME;
  if (s < SQUASH_TIME) {
    const u = s / SQUASH_TIME;
    const sq = 0.22 * Math.exp(-4 * u) * Math.cos(u * Math.PI * 2.2);
    return { y: 0, sy: 1 - sq, sxz: 1 + sq * 0.5, visible: true, done: false };
  }
  return { y: 0, sy: 1, sxz: 1, visible: true, done: true };
}

// ---------- ambient occlusion against piece boxes ----------
export interface AoOptions {
  samples?: number; // rays per vertex (default 12)
  maxDist?: number; // occluders further away do not count (default 0.55)
  strength?: number; // how dark full occlusion gets (default 0.6)
}

// AO factor (1 = open, lower = occluded) per vertex. `owner[v]` is the index of the
// piece vertex v belongs to: a piece never occludes itself (boxes over-cover rounded
// shapes). The floor (y = 0) occludes too. Boxes are cheap to test, so this bakes a whole
// building in a few milliseconds where triangle ray casting would take far longer.
export function boxAO(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  owner: ArrayLike<number>,
  boxes: readonly Aabb[],
  o: AoOptions = {},
): Float32Array {
  const samples = o.samples ?? 12;
  const maxDist = o.maxDist ?? 0.55;
  const strength = o.strength ?? 0.6;
  const n = positions.length / 3;
  const out = new Float32Array(n);
  const dirs: number[] = [];
  for (let k = 0; k < samples; k++) {
    const u = (k + 0.5) / samples;
    const r = Math.sqrt(u);
    const a = k * 2.399963;
    dirs.push(r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u));
  }
  const o3: Vec3 = [0, 0, 0];
  const d3: Vec3 = [0, 0, 0];
  const near: Aabb[] = [];
  for (let v = 0; v < n; v++) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    const nx = normals[v * 3];
    const ny = normals[v * 3 + 1];
    const nz = normals[v * 3 + 2];
    const tx0 = Math.abs(nx) < 0.9 ? 1 : 0;
    const ty0 = tx0 ? 0 : 1;
    let tx = ty0 * nz;
    let ty = -tx0 * nz;
    let tz = tx0 * ny - ty0 * nx;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;
    o3[0] = px + nx * 0.004;
    o3[1] = py + ny * 0.004;
    o3[2] = pz + nz * 0.004;
    const self = owner[v];
    // Only boxes within reach can occlude: gather them once per vertex.
    near.length = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (i === self) continue;
      const b = boxes[i];
      const dx = Math.max(b.min[0] - px, 0, px - b.max[0]);
      const dy = Math.max(b.min[1] - py, 0, py - b.max[1]);
      const dz = Math.max(b.min[2] - pz, 0, pz - b.max[2]);
      if (dx * dx + dy * dy + dz * dz < maxDist * maxDist) near.push(b);
    }
    let hit = 0;
    for (let k = 0; k < samples; k++) {
      const a = dirs[k * 3];
      const b = dirs[k * 3 + 1];
      const c = dirs[k * 3 + 2];
      d3[0] = tx * a + bx * b + nx * c;
      d3[1] = ty * a + by * b + ny * c;
      d3[2] = tz * a + bz * b + nz * c;
      if (d3[1] < -1e-6 && o3[1] / -d3[1] < maxDist) {
        hit++;
        continue;
      }
      for (const b of near) {
        const t = rayBox(o3, d3, b);
        if (t !== null && t < maxDist) {
          hit++;
          break;
        }
      }
    }
    out[v] = 1 - strength * (hit / samples);
  }
  return out;
}

// Drop groups: details (panels, letters, stars, flags and other small bits) ride down
// with the solid piece they are stuck to, so a block lands with its letter on. Returns,
// per piece, the index of its group leader (itself for solid or free-standing pieces).
export function dropGroups(pieces: readonly Piece[]): number[] {
  const boxes = pieces.map(pieceAabb);
  const small = (q: Piece): boolean =>
    q.shape === 'plate' || q.shape === 'star' || q.shape === 'flag' || Math.max(q.w, q.h, q.d) < 0.3;
  const touch = (a: Aabb, b: Aabb, pad: number): boolean =>
    a.min[0] <= b.max[0] + pad &&
    a.max[0] >= b.min[0] - pad &&
    a.min[1] <= b.max[1] + pad &&
    a.max[1] >= b.min[1] - pad &&
    a.min[2] <= b.max[2] + pad &&
    a.max[2] >= b.min[2] - pad;
  return pieces.map((q, i) => {
    if (!small(q)) return i;
    for (let j = 0; j < pieces.length; j++) {
      if (j !== i && !small(pieces[j]) && touch(boxes[i], boxes[j], 0.03)) return j;
    }
    return i;
  });
}
