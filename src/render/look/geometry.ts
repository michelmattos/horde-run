// Modelling helpers for procedural toy models: rounded (bevelled) boxes, part placement,
// vertex painting, merging into one mesh, a brute-force vertex AO bake, and a lazy glTF
// loader. Moulded toys have no sharp edges: bevel everything a little (roundedBox, or
// Babylon's lathe/extrude builders with rounded profiles) so highlights roll over edges.
//
// Conventions (src/render/models/README.md): 1 unit = 1 lane unit, +Y up, the model faces
// +Z, pivot at ground centre (y = 0 is the floor).
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AssetContainer } from '@babylonjs/core/assetContainer';

// ---------- winding ----------
// Babylon's builders emit triangles in a fixed winding relative to their normals. Detect it
// once from a builder box so generated geometry matches (then backface culling just works).
let windingSign = 0;
function builderWinding(): number {
  if (windingSign) return windingSign;
  const vd = CreateBoxVertexData({ size: 1 });
  const p = vd.positions!;
  const n = vd.normals!;
  const i = vd.indices!;
  const a = i[0] * 3;
  const b = i[1] * 3;
  const c = i[2] * 3;
  const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
  const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
  const cx = e1[1] * e2[2] - e1[2] * e2[1];
  const cy = e1[2] * e2[0] - e1[0] * e2[2];
  const cz = e1[0] * e2[1] - e1[1] * e2[0];
  windingSign = cx * n[a] + cy * n[a + 1] + cz * n[a + 2] > 0 ? 1 : -1;
  return windingSign;
}

// Reorders each triangle so its geometric normal agrees with its vertex normals in
// Babylon's winding. Use after hand-building indices.
export function fixWinding(vd: VertexData): VertexData {
  const p = vd.positions!;
  const n = vd.normals!;
  const idx = vd.indices!;
  const want = builderWinding();
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const nx = n[a] + n[b] + n[c], ny = n[a + 1] + n[b + 1] + n[c + 1], nz = n[a + 2] + n[b + 2] + n[c + 2];
    const s = cx * nx + cy * ny + cz * nz > 0 ? 1 : -1;
    if (s !== want) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }
  return vd;
}

// ---------- rounded box ----------
// A box of size w x h x d (centred on the origin) whose edges and corners are rounded
// with radius r, `seg` segments per rounded edge (2 is plenty at game distance; 3-4 for
// hero pieces). Smooth normals, per-face planar UVs (0..1 on each face).
export function roundedBox(w: number, h: number, d: number, r: number, seg = 2): VertexData {
  const half = [w / 2, h / 2, d / 2];
  const rr = Math.max(0, Math.min(r, half[0], half[1], half[2]));
  const inner = [half[0] - rr, half[1] - rr, half[2] - rr];
  const coords = (hs: number, ins: number): number[] => {
    const out: number[] = [];
    if (rr <= 0 || seg < 1) return [-hs, hs];
    for (let k = 0; k <= seg; k++) out.push(-ins - rr * Math.cos((k / seg) * (Math.PI / 2)));
    for (let k = 0; k <= seg; k++) out.push(ins + rr * Math.sin((k / seg) * (Math.PI / 2)));
    return out;
  };
  const axes = [coords(half[0], inner[0]), coords(half[1], inner[1]), coords(half[2], inner[2])];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // Each face: fixed axis f at sign s, spanning axes u and v.
  const faces: [number, number, number, number][] = [
    [0, 1, 1, 2], [0, -1, 1, 2], [1, 1, 0, 2], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 0, 1],
  ];
  const p = [0, 0, 0];
  for (const [f, s, u, v] of faces) {
    const base = positions.length / 3;
    const cu = axes[u];
    const cv = axes[v];
    for (let j = 0; j < cv.length; j++) {
      for (let i = 0; i < cu.length; i++) {
        p[f] = s * half[f];
        p[u] = cu[i];
        p[v] = cv[j];
        // Push the point out from the inner box by the radius.
        const q = [Math.max(-inner[0], Math.min(inner[0], p[0])), Math.max(-inner[1], Math.min(inner[1], p[1])), Math.max(-inner[2], Math.min(inner[2], p[2]))];
        let dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
        let len = Math.hypot(dx, dy, dz);
        if (len < 1e-9) {
          dx = f === 0 ? s : 0; dy = f === 1 ? s : 0; dz = f === 2 ? s : 0; len = 1;
        }
        dx /= len; dy /= len; dz /= len;
        positions.push(q[0] + dx * rr, q[1] + dy * rr, q[2] + dz * rr);
        normals.push(dx, dy, dz);
        uvs.push((cu[i] + half[u]) / (2 * half[u]), (cv[j] + half[v]) / (2 * half[v]));
      }
    }
    const nu = cu.length;
    for (let j = 0; j < cv.length - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = base + j * nu + i;
        indices.push(a, a + 1, a + nu + 1, a, a + nu + 1, a + nu);
      }
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  // Drop degenerate triangles (zero-width rows when a radius equals a half size).
  return fixWinding(dropDegenerate(vd));
}

function dropDegenerate(vd: VertexData): VertexData {
  const p = vd.positions!;
  const src = vd.indices!;
  const out: number[] = [];
  for (let t = 0; t < src.length; t += 3) {
    const a = src[t] * 3, b = src[t + 1] * 3, c = src[t + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const area = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
    if (area > 1e-10) out.push(src[t], src[t + 1], src[t + 2]);
  }
  vd.indices = out;
  return vd;
}

// ---------- lathe ----------
// Revolves a profile of [radius, y] points (bottom to top) around +Y. Smooth normals come
// from the profile's neighbours; repeat a point to get a hard crease there. Start or end
// the profile at radius 0 to close it. UV: u around, v along the profile.
export function lathe(profile: readonly (readonly [number, number])[], tessellation = 16): VertexData {
  const n = profile.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const nrm2: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = profile[Math.max(0, i - 1)];
    const b = profile[Math.min(n - 1, i + 1)];
    // A repeated point: use the one-sided tangent toward the side it is not repeated on.
    let pa = a, pb = b;
    if (i > 0 && profile[i - 1][0] === profile[i][0] && profile[i - 1][1] === profile[i][1]) pa = profile[i];
    if (i < n - 1 && profile[i + 1][0] === profile[i][0] && profile[i + 1][1] === profile[i][1]) pb = profile[i];
    let dr = pb[0] - pa[0];
    let dy = pb[1] - pa[1];
    if (Math.abs(dr) + Math.abs(dy) < 1e-9) { dr = 0; dy = 1; }
    const l = Math.hypot(dr, dy);
    nrm2.push([dy / l, -dr / l]);
  }
  let total = 0;
  const along = [0];
  for (let i = 1; i < n; i++) {
    total += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    along.push(total);
  }
  for (let s = 0; s <= tessellation; s++) {
    const th = (s / tessellation) * Math.PI * 2;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    for (let i = 0; i < n; i++) {
      const [r, y] = profile[i];
      positions.push(r * c, y, r * sn);
      normals.push(nrm2[i][0] * c, nrm2[i][1], nrm2[i][0] * sn);
      uvs.push(s / tessellation, total > 0 ? along[i] / total : 0);
    }
  }
  for (let s = 0; s < tessellation; s++) {
    for (let i = 0; i < n - 1; i++) {
      const a = s * n + i;
      const b = (s + 1) * n + i;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  return fixWinding(dropDegenerate(vd));
}

// ---------- placing, painting, merging ----------
export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  rx?: number; // radians, applied as yaw (ry), pitch (rx), roll (rz) like Babylon rotation
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  s?: number; // uniform scale (multiplies sx/sy/sz)
}

// Transforms vd in place (scale, rotate, translate) and returns it.
export function place(vd: VertexData, t: Placement): VertexData {
  const s = t.s ?? 1;
  const m = Matrix.Compose(
    new Vector3((t.sx ?? 1) * s, (t.sy ?? 1) * s, (t.sz ?? 1) * s),
    Quaternion.RotationYawPitchRoll(t.ry ?? 0, t.rx ?? 0, t.rz ?? 0),
    new Vector3(t.x ?? 0, t.y ?? 0, t.z ?? 0),
  );
  vd.transform(m);
  return vd;
}

// Sets a solid vertex colour (linear rgb, for PBR) over the whole part.
export function paint(vd: VertexData, c: Color3 | readonly [number, number, number], alpha = 1): VertexData {
  const n = (vd.positions?.length ?? 0) / 3;
  const r = Array.isArray(c) ? c[0] : (c as Color3).r;
  const g = Array.isArray(c) ? c[1] : (c as Color3).g;
  const b = Array.isArray(c) ? c[2] : (c as Color3).b;
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    colors[i * 4] = r;
    colors[i * 4 + 1] = g;
    colors[i * 4 + 2] = b;
    colors[i * 4 + 3] = alpha;
  }
  vd.colors = colors;
  return vd;
}

// Merges parts into one VertexData. Parts without colours get white; parts without UVs
// get zeros, so VertexData.merge never drops an attribute.
export function mergeParts(parts: VertexData[]): VertexData {
  const anyColor = parts.some((p) => p.colors);
  const anyUv = parts.some((p) => p.uvs);
  for (const p of parts) {
    if (anyColor && !p.colors) paint(p, [1, 1, 1]);
    if (anyUv && !p.uvs) p.uvs = new Float32Array(((p.positions?.length ?? 0) / 3) * 2);
  }
  const out = new VertexData();
  out.positions = [];
  out.indices = [];
  out.normals = [];
  if (anyColor) out.colors = [];
  if (anyUv) out.uvs = [];
  out.merge(parts, true);
  return out;
}

// Builds a static mesh from parts with one material: the usual "one draw call" model.
export function buildMesh(scene: Scene, name: string, parts: VertexData[] | VertexData, material: Material | null): Mesh {
  const vd = Array.isArray(parts) ? mergeParts(parts) : parts;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

// ---------- vertex ambient occlusion ----------
export interface AoOptions {
  samples?: number; // hemisphere rays per vertex (default 24)
  maxDist?: number; // occluders further than this do not count (default 0.6 x model height)
  ground?: boolean; // the floor at y = 0 occludes too (default true)
  strength?: number; // 0..1 how dark full occlusion gets (default 0.75)
  maxTriangles?: number; // refuse above this to keep load times sane (default 6000)
}

// Bakes ambient occlusion into the vertex colours (multiplying any existing colours).
// Brute force: rays against every triangle, so run it once per model at load (a 1,000
// triangle model with 24 rays takes ~50 ms) or bake offline into a .glb.
export function bakeVertexAO(vd: VertexData, o: AoOptions = {}): VertexData {
  const p = vd.positions!;
  const nrm = vd.normals!;
  const idx = vd.indices!;
  const nv = p.length / 3;
  const nt = idx.length / 3;
  if (nt > (o.maxTriangles ?? 6000)) {
    console.warn(`bakeVertexAO: ${nt} triangles is above the limit; skipped`);
    return vd;
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < p.length; i += 3) {
    minY = Math.min(minY, p[i]);
    maxY = Math.max(maxY, p[i]);
  }
  const maxDist = o.maxDist ?? Math.max(0.05, (maxY - minY) * 0.6);
  const samples = o.samples ?? 24;
  const strength = o.strength ?? 0.75;
  const ground = o.ground ?? true;
  const colors = vd.colors ? Float32Array.from(vd.colors) : new Float32Array(nv * 4).fill(1);
  // Fixed, well-spread directions (cosine-weighted hemisphere around +Z, Fibonacci).
  const dirs: number[] = [];
  for (let k = 0; k < samples; k++) {
    const u = (k + 0.5) / samples;
    const r = Math.sqrt(u);
    const a = k * 2.399963;
    dirs.push(r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u));
  }
  for (let v = 0; v < nv; v++) {
    const ox = p[v * 3], oy = p[v * 3 + 1], oz = p[v * 3 + 2];
    const nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
    // Tangent frame around the normal.
    const tx0 = Math.abs(nx) < 0.9 ? 1 : 0;
    const ty0 = tx0 ? 0 : 1;
    let tx = ty0 * nz - 0 * ny, ty = 0 * nx - tx0 * nz, tz = tx0 * ny - ty0 * nx;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const sx = ox + nx * 1e-3, sy = oy + ny * 1e-3, sz = oz + nz * 1e-3;
    let hit = 0;
    for (let k = 0; k < samples; k++) {
      const a = dirs[k * 3], b = dirs[k * 3 + 1], c = dirs[k * 3 + 2];
      const dx = tx * a + bx * b + nx * c, dy = ty * a + by * b + ny * c, dz = tz * a + bz * b + nz * c;
      if (ground && dy < -1e-6 && (sy - minY) / -dy < maxDist) {
        hit++;
        continue;
      }
      if (rayHits(p, idx, sx, sy, sz, dx, dy, dz, maxDist)) hit++;
    }
    const ao = 1 - strength * (hit / samples);
    colors[v * 4] *= ao;
    colors[v * 4 + 1] *= ao;
    colors[v * 4 + 2] *= ao;
  }
  vd.colors = colors;
  return vd;
}

function rayHits(p: ArrayLike<number>, idx: ArrayLike<number>, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): boolean {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-9 && det < 1e-9) continue;
    const inv = 1 / det;
    const sx = ox - p[a], sy = oy - p[a + 1], sz = oz - p[a + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (d > 1e-4 && d < maxT) return true;
  }
  return false;
}

// ---------- glTF ----------
// Loads a .glb into an AssetContainer (not yet added to the scene). The glTF loader is
// imported on first use, so models that do not need it keep it out of the main chunk.
// Note: glTF is right-handed; Babylon's loader adds a '__root__' node that flips it, so
// a glTF model facing +Z faces +Z here too. Bake or re-parent as you need.
export async function loadGlb(scene: Scene, url: string): Promise<AssetContainer> {
  await import('@babylonjs/loaders/glTF/2.0/glTFLoader');
  const { LoadAssetContainerAsync } = await import('@babylonjs/core/Loading/sceneLoader');
  return LoadAssetContainerAsync(url, scene);
}

// Absolute URL of a file under public/ (works under the /horde-run/ base on Pages).
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
