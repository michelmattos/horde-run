// Thin-instance batch for small props (defenders, HP bars, particles, tracers, scenery):
// one draw call per batch, per-instance scale, yaw, translation and colour. Buffers are
// preallocated at a fixed capacity; writes beyond it are dropped, so nothing allocates
// per frame. Call begin(), write(...) for each instance, then commit().
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

export class PropBatch {
  readonly mesh: Mesh;
  readonly capacity: number;
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array;
  count = 0;

  constructor(mesh: Mesh, material: StandardMaterial, capacity: number) {
    this.mesh = mesh;
    this.capacity = capacity;
    this.matrices = new Float32Array(capacity * 16);
    this.colors = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) this.matrices[i * 16 + 15] = 1;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true; // instances spread over the lane; skip culling by the base mesh
    mesh.doNotSyncBoundingInfo = true;
    mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
    mesh.freezeWorldMatrix();
  }

  begin(): void {
    this.count = 0;
  }

  // Scale (sx, sy, sz), then yaw about +Y (0 = local +Z points up the lane), then translate.
  write(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    yaw: number,
    r: number,
    g: number,
    b: number,
  ): void {
    if (this.count >= this.capacity) return;
    const m = this.matrices;
    const o = this.count * 16;
    const c = yaw === 0 ? 1 : Math.cos(yaw);
    const s = yaw === 0 ? 0 : Math.sin(yaw);
    m[o] = c * sx;
    m[o + 1] = 0;
    m[o + 2] = -s * sx;
    m[o + 4] = 0;
    m[o + 5] = sy;
    m[o + 6] = 0;
    m[o + 8] = s * sz;
    m[o + 9] = 0;
    m[o + 10] = c * sz;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    const p = this.count * 4;
    const col = this.colors;
    col[p] = r;
    col[p + 1] = g;
    col[p + 2] = b;
    col[p + 3] = 1;
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

  dispose(): void {
    this.mesh.dispose();
  }
}

// Lit material whose colour comes entirely from the instance colour.
export function instanceLitMaterial(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(1, 1, 1);
  m.emissiveColor = new Color3(0.22, 0.22, 0.22);
  m.specularColor = Color3.Black();
  m.freeze();
  return m;
}

// Unlit material: output = instance colour (HP bars, tracers, particles).
export function instanceUnlitMaterial(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.emissiveColor = new Color3(1, 1, 1); // the shader multiplies this by the instance colour
  m.specularColor = Color3.Black();
  m.freeze();
  return m;
}

// Unit-sized base mesh for a batch (1 x 1 x 1, centred on the origin); instances scale it.
// 'rod' and 'tip' lie along local +Z (a cylinder and a cone pointing +Z), so yaw alone
// turns them on the floor: crayons are a rod plus a tip.
export function unitMesh(scene: Scene, name: string, shape: 'box' | 'cylinder' | 'rod' | 'tip'): Mesh {
  let vd: VertexData;
  if (shape === 'box') vd = CreateBoxVertexData({ size: 1 });
  else if (shape === 'cylinder') vd = CreateCylinderVertexData({ height: 1, diameter: 1, tessellation: 10 });
  else {
    vd = CreateCylinderVertexData({
      height: 1,
      diameterTop: shape === 'tip' ? 0 : 1,
      diameterBottom: 1,
      tessellation: 8,
    });
    vd.transform(Matrix.RotationX(Math.PI / 2)); // +Y axis → +Z
  }
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  return mesh;
}
