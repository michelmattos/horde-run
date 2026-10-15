// Offline-baked vertex AO tables for procedural models: one byte per vertex as base64
// (ao = 0.4 + 0.6 * byte / 255) plus a position checksum of the unbaked geometry, so a
// stale table is never applied (the model then bakes at runtime once). Generate a table
// by running the model's *AOTable() tool function (e.g. through vite's ssrLoadModule).
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { bakeVertexAO, mergeParts } from './geometry.ts';
import type { AoOptions } from './geometry.ts';

export function aoChecksum(p: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += Math.abs(p[i]) * ((i % 7) + 1);
  return Math.round(s * 1000);
}

export function encodeAO(f: Float32Array): string {
  let bin = '';
  for (let v = 0; v < f.length; v++)
    bin += String.fromCharCode(Math.max(0, Math.min(255, Math.round(((f[v] - 0.4) / 0.6) * 255))));
  return btoa(bin);
}

// The AO factors for this geometry, or null when the table does not match it.
export function decodeAO(b64: string, check: number, positions: ArrayLike<number>): Float32Array | null {
  const nv = positions.length / 3;
  if (!b64 || typeof atob !== 'function') return null;
  if (Math.abs(aoChecksum(positions) - check) > 2) return null;
  const bin = atob(b64);
  if (bin.length !== nv) return null;
  const out = new Float32Array(nv);
  for (let i = 0; i < nv; i++) out[i] = 0.4 + (0.6 * bin.charCodeAt(i)) / 255;
  return out;
}

// Bakes AO over several parts together (each occludes the others) and returns one factor
// array per part. The parts' own colours are left alone.
export function bakeAOFactors(parts: VertexData[], o: AoOptions): Float32Array[] {
  const white = parts.map((vd) => {
    const w = new VertexData();
    w.positions = Float32Array.from(vd.positions as ArrayLike<number>);
    w.normals = Float32Array.from(vd.normals as ArrayLike<number>);
    w.indices = Uint32Array.from(vd.indices as ArrayLike<number>);
    w.colors = new Float32Array((w.positions.length / 3) * 4).fill(1);
    return w;
  });
  const merged = mergeParts(white);
  bakeVertexAO(merged, o);
  const c = merged.colors as ArrayLike<number>;
  const out: Float32Array[] = [];
  let off = 0;
  for (const vd of parts) {
    const n = (vd.positions as ArrayLike<number>).length / 3;
    const f = new Float32Array(n);
    for (let v = 0; v < n; v++) f[v] = c[(off + v) * 4];
    out.push(f);
    off += n;
  }
  return out;
}

export function applyAO(vd: VertexData, f: Float32Array): VertexData {
  const c = vd.colors as number[] | Float32Array;
  for (let v = 0; v < f.length; v++) {
    c[v * 4] *= f[v];
    c[v * 4 + 1] *= f[v];
    c[v * 4 + 2] *= f[v];
  }
  return vd;
}

// Typed-array copy (caches hand out copies so meshes never share arrays).
export function cloneVD(vd: VertexData): VertexData {
  const out = new VertexData();
  out.positions = Float32Array.from(vd.positions as ArrayLike<number>);
  out.normals = Float32Array.from(vd.normals as ArrayLike<number>);
  out.indices = Uint32Array.from(vd.indices as ArrayLike<number>);
  if (vd.colors) out.colors = Float32Array.from(vd.colors);
  if (vd.uvs) out.uvs = Float32Array.from(vd.uvs);
  return out;
}

// Looks up each part's table entry and falls back to a runtime bake when any is stale.
export function bakedParts(
  name: string,
  parts: VertexData[],
  tables: readonly { b64: string; check: number }[],
  o: AoOptions,
): VertexData[] {
  let f = parts.map((vd, i) =>
    decodeAO(tables[i]?.b64 ?? '', tables[i]?.check ?? 0, vd.positions as ArrayLike<number>),
  );
  if (f.some((x) => !x)) {
    console.warn(`${name}: AO table is stale; baking at runtime`);
    f = bakeAOFactors(parts, o);
  }
  return parts.map((vd, i) => applyAO(vd, f[i]!));
}
