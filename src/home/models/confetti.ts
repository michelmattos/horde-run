// A pooled paper-confetti puff for the home base (a building finishing its build). One
// thin-instanced mesh of small curled paper squares in the toy primaries, cream and
// brass yellow: one draw call, nothing allocated per burst, and nothing updated once the
// last piece has settled (update() then returns false).
// Pieces pop up and out, flutter down (drag plus a spin wobble), rest on the rug for a
// moment and shrink away. No light, no camera motion. At rest one zero-scale instance stays
// (see below), so the idle cost is a single 4-triangle draw.
//
// GAME API
//   const fx = createConfetti(scene, look);
//   fx.burst(x, y, z);     // ~36 pieces from that point
//   fx.update(dt)          // per frame while it returns true
//   fx.dispose()
import type { Scene } from '@babylonjs/core/scene';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Look } from '../../render/look/index.ts';
import { buildMesh, lin, paperMaterial, place, roundedBox } from '../../render/look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../../render/look/model.ts';

export const info: ModelInfo = {
  key: 'confetti',
  title: 'Home base confetti puff',
  instanced: true,
  teams: false,
  side: 'neutral',
  height: 3,
  triangleBudget: 24,
  gameZ: 0,
};

export interface Confetti {
  burst(x: number, y: number, z: number, count?: number): void;
  update(dt: number): boolean;
  dispose(): void;
}

const CAPACITY = 120;
const LIFE = 1.9;
const COLORS = ['#d93a2f', '#2f6fd6', '#f2b630', '#8e4fc4', '#f07a24', '#1fa3b0', '#fff0c8', '#ffc531'];

interface Bit {
  p: Vector3;
  v: Vector3;
  axis: Vector3;
  spin: number;
  angle: number;
  age: number;
  life: number;
  size: number;
}

export function createConfetti(scene: Scene, look: Look): Confetti {
  // A slightly curled paper square (two tilted halves) so it catches the light as it turns.
  const half = (s: number): ReturnType<typeof roundedBox> =>
    place(roundedBox(0.1, 0.008, 0.19, 0, 1), { x: s * 0.048, rz: s * 0.25 });
  const mesh: Mesh = buildMesh(
    scene,
    'homeConfetti',
    [half(-1), half(1)],
    look.material('home-confetti', () =>
      paperMaterial(scene, null, { name: 'home-confetti', instanceColor: true, backFaceCulling: false }),
    ),
  );
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  const matrices = new Float32Array(CAPACITY * 16);
  const colors = new Float32Array(CAPACITY * 4);
  mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
  mesh.thinInstanceSetBuffer('color', colors, 4, false);
  // Keep one zero-scale instance at rest: the material then compiles with per-instance
  // colour from the start (its defines are not re-read when the count later grows).
  mesh.thinInstanceCount = 1;
  const bits: Bit[] = [];
  let seed = 9;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const q = new Quaternion();
  const s = new Vector3();
  const m = new Matrix();

  return {
    burst(x, y, z, count = 36) {
      for (let i = 0; i < count; i++) {
        if (bits.length >= CAPACITY) bits.shift();
        const a = rnd() * Math.PI * 2;
        const out = 1.4 + rnd() * 2.2;
        bits.push({
          p: new Vector3(x + Math.cos(a) * 0.3, y, z + Math.sin(a) * 0.3),
          v: new Vector3(Math.cos(a) * out, 4.2 + rnd() * 2.6, Math.sin(a) * out),
          axis: new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
          spin: 7 + rnd() * 9,
          angle: rnd() * 6,
          age: 0,
          life: LIFE * (0.8 + rnd() * 0.4),
          size: 0.85 + rnd() * 0.5,
        });
      }
      const n = bits.length;
      for (let i = 0; i < n; i++) {
        const c = lin(COLORS[(i * 5 + Math.floor(rnd() * 3)) % COLORS.length]);
        colors.set([c.r, c.g, c.b, 1], i * 4);
      }
      mesh.thinInstanceBufferUpdated('color');
    },
    update(dt) {
      if (bits.length === 0) return false;
      const step = Math.min(dt, 0.05);
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.age += step;
        if (b.age >= b.life) {
          bits.splice(i, 1);
          continue;
        }
        if (b.p.y > 0.01) {
          b.v.y -= 9 * step;
          const drag = Math.exp(-2.4 * step);
          b.v.x *= drag;
          b.v.z *= drag;
          if (b.v.y < -1.6) b.v.y = -1.6; // paper flutters down slowly
          b.p.addInPlace(b.v.scale(step));
          b.p.x += Math.sin(b.age * 9 + b.spin) * 0.4 * step;
          b.angle += b.spin * step;
          if (b.p.y <= 0.01) b.p.y = 0.01;
        }
      }
      for (let i = 0; i < bits.length; i++) {
        const b = bits[i];
        const fade = Math.min(1, (b.life - b.age) / 0.35);
        Quaternion.RotationAxisToRef(b.axis, b.p.y > 0.011 ? b.angle : Math.round(b.angle / Math.PI) * Math.PI, q);
        s.setAll(b.size * fade);
        Matrix.ComposeToRef(s, q, b.p, m);
        m.copyToArray(matrices, i * 16);
      }
      if (bits.length === 0) matrices.fill(0, 0, 16);
      mesh.thinInstanceCount = Math.max(1, bits.length);
      mesh.thinInstanceBufferUpdated('matrix');
      if (bits.length === 0) return false;
      return true;
    },
    dispose() {
      mesh.dispose();
    },
  };
}

export function preview(scene: Scene, look: Look, _opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('confettiPreview', scene);
  const fx = createConfetti(scene, look);
  let t = 10;
  return {
    root,
    update(_time, dt) {
      t += dt;
      if (t > 2.2) {
        t = 0;
        fx.burst(0, 1, 0);
      }
      fx.update(dt);
    },
    dispose() {
      fx.dispose();
      root.dispose();
    },
  };
}
