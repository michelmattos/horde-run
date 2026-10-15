// Blob (contact) shadows: a soft dark ellipse on the floor under a toy, drawn as a flat
// quad with a radial alpha texture. Used for crowds on the 'low' tier (the shadow map
// then holds only static casters) and, on every tier, as a faint contact darkening under
// big pieces so they never look like they float. Thin-instance the mesh: one draw call
// for every blob in the lane. Scale x/z by the footprint; y is ignored.
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { radialTexture } from './textures.ts';

export const BLOB_Y = 0.012; // just above the rug, below any base plate

// One material per scene and opacity, so reloading a level or switching rooms never
// adds materials.
let shared: WeakMap<Scene, Map<number, StandardMaterial>> | null = null;

// Unit (1 x 1) quad in the XZ plane at y = BLOB_Y. opacity: darkness at the centre.
export function createBlobShadowMesh(scene: Scene, name = 'blobShadow', opacity = 0.55): Mesh {
  const vd = new VertexData();
  vd.positions = [-0.5, BLOB_Y, -0.5, 0.5, BLOB_Y, -0.5, 0.5, BLOB_Y, 0.5, -0.5, BLOB_Y, 0.5];
  vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vd.indices = [0, 2, 1, 0, 3, 2];
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = blobMaterial(scene, opacity);
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  return mesh;
}

function blobMaterial(scene: Scene, opacity: number): StandardMaterial {
  shared ??= new WeakMap();
  let byOpacity = shared.get(scene);
  if (!byOpacity) shared.set(scene, (byOpacity = new Map()));
  const key = Math.round(opacity * 1000);
  const cached = byOpacity.get(key);
  if (cached && scene.materials.includes(cached)) return cached; // unless a room disposed it
  const m = new StandardMaterial(`blobShadowMat`, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.emissiveColor = new Color3(0.06, 0.035, 0.02); // warm, not pure black
  m.specularColor = Color3.Black();
  m.opacityTexture = radialTexture(scene);
  m.alpha = opacity;
  m.disableDepthWrite = true;
  m.zOffset = -2; // win against the rug without z-fighting
  m.backFaceCulling = true;
  byOpacity.set(key, m);
  return m;
}
