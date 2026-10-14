// Loads the plastic army-men figures (public/models/army-men.glb) without the glTF
// loader package: the file is a tiny hand-built GLB holding one static mesh per pose
// (POSITION, NORMAL, uint16 indices), so a ~50-line parser is enough. Meshes:
//   'rifleman' - a soldier striding forward with his rifle at the ready (mobs)
//   'bazooka'  - a soldier kneeling with a bazooka on his shoulder (champion)
// Each is normalised to height 1 with its base plate centred on the origin and the
// base's underside at y = 0. glTF is right-handed (+Z forward); Babylon is left-handed,
// so z is negated (positions and normals): in Babylon the figures face -Z. Mirroring
// also turns glTF's counter-clockwise front faces into Babylon's clockwise ones, so the
// index order is kept as is.
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

export type ArmyManPose = 'rifleman' | 'bazooka';
export type ArmyMenGeometry = Record<ArmyManPose, VertexData>;

export const ARMY_MEN_URL = `${import.meta.env.BASE_URL}models/army-men.glb`;

interface GltfAccessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  byteOffset?: number;
}
interface GltfJson {
  meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number }[] }[];
  accessors: GltfAccessor[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function parseArmyMenGlb(buf: ArrayBuffer): ArmyMenGeometry {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('army-men.glb: not a GLB file');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))) as GltfJson;
  const binStart = 20 + jsonLen + 8;

  const read = (index: number): Float32Array | Uint16Array => {
    const a = json.accessors[index];
    const view = json.bufferViews[a.bufferView];
    const offset = binStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const n = a.count * COMPONENTS[a.type];
    if (a.componentType === 5126) return new Float32Array(buf.slice(offset, offset + n * 4));
    if (a.componentType === 5123) return new Uint16Array(buf.slice(offset, offset + n * 2));
    throw new Error(`army-men.glb: unsupported component type ${a.componentType}`);
  };

  const out: Partial<ArmyMenGeometry> = {};
  for (const mesh of json.meshes) {
    const prim = mesh.primitives[0];
    const positions = read(prim.attributes.POSITION) as Float32Array;
    const normals = read(prim.attributes.NORMAL) as Float32Array;
    const src = read(prim.indices);
    for (let i = 2; i < positions.length; i += 3) {
      positions[i] = -positions[i];
      normals[i] = -normals[i];
    }
    const indices = Uint32Array.from(src);
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.indices = indices;
    out[mesh.name as ArmyManPose] = vd;
  }
  if (!out.rifleman || !out.bazooka) throw new Error('army-men.glb: missing a pose mesh');
  return out as ArmyMenGeometry;
}

// Fetches and parses the figures once. Resolves null on any failure so the caller keeps
// its procedural stand-in figures (offline before the first cache, a bad deploy, ...).
let pending: Promise<ArmyMenGeometry | null> | null = null;
export function loadArmyMen(): Promise<ArmyMenGeometry | null> {
  if (!pending) {
    pending = fetch(ARMY_MEN_URL)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(parseArmyMenGlb)
      .catch((e: unknown) => {
        console.warn('army men model not loaded, using stand-in figures:', e);
        return null;
      });
  }
  return pending;
}
