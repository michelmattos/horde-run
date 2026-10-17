// Model preview harness (dev only; preview.html is not part of the production build).
// Every module in src/render/models/ is listed automatically (import.meta.glob), the
// Milestone 4 ones included: soldierVariants, championTank, championDrummer,
// cannonVariants and ultimates (their ?variant= values appear as links).
// Renders one model module from src/render/models/<key>.ts under the shared look, standing
// on a strip of play rug over varnished floorboards, so its materials, shadows and
// readability can be judged on their own.
//
//   http://localhost:5173/preview.html?model=soldier&team=player
//   params: model, team=player|enemy, variant, view=orbit|front|side|top|game,
//           quality=high|medium|low, spin=1 (turntable), bare=1 (hide the UI), floor=wood
// Keys: 1 front, 2 side, 3 top, 4 game, 0 orbit, t turntable. Drag to orbit.
// scripts/preview.mjs drives it headless through window.__preview.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { createLook, fabricMaterial, woodMaterial, parseQuality } from './render/look/index.ts';
import type { Look } from './render/look/index.ts';
import type { ModelModule, PreviewResult } from './render/look/model.ts';
import { computeFraming } from './render/framing.ts';
import { LAYOUT } from './contracts.ts';

type View = 'orbit' | 'front' | 'side' | 'top' | 'game';
const VIEWS: readonly View[] = ['orbit', 'front', 'side', 'top', 'game'];

interface PreviewApi {
  ready: boolean;
  error: string | null;
  models: string[];
  setView(v: View): Promise<void>;
  stats(): PreviewStats;
}
interface PreviewStats {
  model: string;
  quality: string;
  drawCalls: number;
  meshes: { name: string; triangles: number; instances: number; material: string }[];
  trianglesPerModel: number; // sum of every mesh's triangles, counted once (not per instance)
  trianglesDrawn: number; // with instances multiplied
  materials: number;
  textures: number;
  bounds: { min: number[]; max: number[] };
}
declare global {
  interface Window {
    __preview?: PreviewApi;
  }
}

// The home base's village and confetti follow the same model contract.
const modules = import.meta.glob<ModelModule>([
  './render/models/*.ts',
  './home/models/village.ts',
  './home/models/confetti.ts',
]);
const keyOf = (path: string): string => path.replace(/^.*\/(.+)\.ts$/, '$1');
const keys = Object.keys(modules).map(keyOf).sort();

const params = new URLSearchParams(location.search);
const key = params.get('model') ?? keys.find((k) => !k.startsWith('_')) ?? keys[0];
const team = params.get('team') === 'enemy' ? 'enemy' : 'player';
const variant = params.get('variant');
let view: View = (VIEWS as readonly string[]).includes(params.get('view') ?? '')
  ? (params.get('view') as View)
  : 'orbit';
let spin = params.get('spin') === '1';
if (params.get('bare') === '1') document.body.classList.add('bare');

const api: PreviewApi = { ready: false, error: null, models: keys, setView: async () => {}, stats: () => emptyStats() };
window.__preview = api;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, audioEngine: false }, true);
const scene = new Scene(engine);
scene.skipPointerMovePicking = true;
const look: Look = createLook(scene, { quality: parseQuality(params.get('quality')) ?? 'high', autoQuality: false });
const instrumentation = new SceneInstrumentation(scene);

// ---------- stage: floorboards and a strip of play rug like the lane ----------
const floor = CreateGround('previewFloor', { width: 80, height: 80 }, scene);
floor.material = woodMaterial(scene, 'oak', { textureScale: 14 });
floor.position.y = -0.02;
look.receiveShadows(floor);
if (params.get('floor') !== 'wood') {
  const rug = CreateGround('previewRug', { width: 10, height: 80 }, scene);
  rug.material = fabricMaterial(scene, 'rug', { texture: false }); // plain: the weave belongs to the environment task
  look.receiveShadows(rug);
}

// ---------- cameras ----------
const orbit = new ArcRotateCamera('orbit', Math.PI / 2 - 0.6, 1.1, 6, Vector3.Zero(), scene);
orbit.minZ = 0.05;
orbit.maxZ = 400;
orbit.wheelPrecision = 40;
orbit.lowerRadiusLimit = 0.3;
orbit.attachControl(canvas, true);
const game = new FreeCamera('game', new Vector3(0, 20, -20), scene);
game.minZ = 0.5;
game.maxZ = 600;
scene.activeCamera = orbit;
look.setCamera(orbit);

let result: PreviewResult | null = null;
let center = Vector3.Zero();
let radius = 3;
let height = 1;
let gameZ = 20;
let gameYaw = 0;

function setActive(cam: Camera): void {
  if (scene.activeCamera === cam) return;
  scene.activeCamera = cam;
  look.setCamera(cam);
}

function frameBounds(): void {
  if (!result) return;
  for (const m of result.root.getChildMeshes(false)) {
    if (m instanceof Mesh && m.thinInstanceCount > 0) m.thinInstanceRefreshBoundingInfo(false);
    m.computeWorldMatrix(true);
  }
  const { min, max } = result.root.getHierarchyBoundingVectors(true);
  center = min.add(max).scale(0.5);
  const size = max.subtract(min);
  radius = Math.max(size.length() * 0.95, 1.2);
  height = size.y;
  const pad = Math.max(2, radius);
  look.fitShadows({ minX: min.x - pad, maxX: max.x + pad, minZ: min.z - pad, maxZ: max.z + pad, maxY: max.y + 0.5 });
}

function applyView(v: View): void {
  view = v;
  if (!result) return;
  result.root.rotation.y = v === 'game' ? gameYaw : 0;
  frameBounds();
  if (v === 'game') {
    // Same angles, fov and position as the lane camera on a 390x844 phone, with the model
    // standing at lane z = gameZ.
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const f = computeFraming({
      aspect,
      laneWidth: 10,
      nearZ: LAYOUT.playerBaseZ - LAYOUT.playerBaseDepth - 0.2,
      farZ: 55 + LAYOUT.enemyBaseDepth,
      margin: 0.4,
    });
    game.position.set(f.x, f.y, f.z - gameZ);
    game.rotation.set(f.pitch, f.yaw, 0);
    game.fov = f.fov;
    look.fitShadows({ minX: -10, maxX: 10, minZ: -gameZ - 6, maxZ: 60 - gameZ, maxY: 6 });
    setActive(game);
    return;
  }
  setActive(orbit);
  orbit.target.copyFrom(center);
  orbit.radius = radius * 1.25;
  if (v === 'front') {
    orbit.alpha = Math.PI / 2; // camera on +Z, looking at the model's front
    orbit.beta = 1.35;
  } else if (v === 'side') {
    orbit.alpha = 0; // camera on +X
    orbit.beta = 1.4;
  } else if (v === 'top') {
    orbit.alpha = Math.PI / 2;
    orbit.beta = 0.12;
  } else {
    orbit.alpha = Math.PI / 2 - 0.65;
    orbit.beta = 1.05;
  }
}

function emptyStats(): PreviewStats {
  return {
    model: key,
    quality: look.quality,
    drawCalls: 0,
    meshes: [],
    trianglesPerModel: 0,
    trianglesDrawn: 0,
    materials: 0,
    textures: 0,
    bounds: { min: [], max: [] },
  };
}

function stats(): PreviewStats {
  const s = emptyStats();
  s.drawCalls = instrumentation.drawCallsCounter.current;
  if (!result) return s;
  const mats = new Set<string>();
  for (const m of result.root.getChildMeshes(false)) {
    if (!(m instanceof Mesh) || !m.isEnabled()) continue;
    const tris = (m.getTotalIndices() || 0) / 3;
    const inst = m.thinInstanceCount > 0 ? m.thinInstanceCount : 1;
    s.meshes.push({ name: m.name, triangles: tris, instances: inst, material: m.material?.name ?? '-' });
    s.trianglesPerModel += tris;
    s.trianglesDrawn += tris * inst;
    if (m.material) mats.add(m.material.uniqueId + '');
  }
  s.materials = mats.size;
  s.textures = scene.textures.length;
  const { min, max } = result.root.getHierarchyBoundingVectors(true);
  s.bounds = {
    min: [min.x, min.y, min.z].map((n) => +n.toFixed(3)),
    max: [max.x, max.y, max.z].map((n) => +n.toFixed(3)),
  };
  return s;
}

// Named variants of the loaded model (e.g. soldierVariants: knight / sprinter / bomber,
// cannonVariants: repeater / blunderbuss), shown as links once the module has loaded.
let variantKeys: readonly string[] = [];

function drawUi(): void {
  const ui = document.getElementById('ui');
  if (!ui) return;
  const link = (p: Record<string, string>, label: string, on: boolean): string => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(p)) q.set(k, v);
    return `<a class="${on ? 'on' : ''}" href="?${q.toString()}">${label}</a>`;
  };
  ui.innerHTML =
    `<div>${keys.map((k) => link({ model: k }, k, k === key)).join('')}</div>` +
    `<div class="row">${link({ team: 'player' }, 'player', team === 'player')}${link({ team: 'enemy' }, 'enemy', team === 'enemy')} | ` +
    `${VIEWS.map((v) => link({ view: v }, v, v === view)).join('')} | ` +
    `${['high', 'medium', 'low'].map((q) => link({ quality: q }, q, q === look.quality)).join('')}</div>` +
    (variantKeys.length
      ? `<div class="row">${variantKeys.map((v, i) => link({ variant: v }, v, v === (variant ?? (i === 0 ? v : '')))).join('')}</div>`
      : '') +
    `<div id="stats"></div>`;
}

async function boot(): Promise<void> {
  drawUi();
  const path = Object.keys(modules).find((p) => keyOf(p) === key);
  if (!path) throw new Error(`no model module src/render/models/${key}.ts (have: ${keys.join(', ')})`);
  const mod = await modules[path]();
  if (!mod.info || typeof mod.preview !== 'function') throw new Error(`${key}.ts does not export info and preview()`);
  variantKeys = mod.info.variants ?? [];
  if (variantKeys.length) drawUi();
  const side = mod.info.side;
  gameYaw = side === 'enemy' || side === 'neutral' || (side === 'team' && team === 'enemy') ? Math.PI : 0;
  gameZ = mod.info.gameZ ?? 20;
  height = mod.info.height;
  result = await mod.preview(scene, look, { team, variant: variant ?? mod.info.variants?.[0] ?? null });
  await look.ready;
  applyView(view);
  await new Promise<void>((r) => scene.executeWhenReady(() => r()));
  // A few frames so shadow maps, env prefiltering and thin-instance buffers settle.
  await frames(4);
  api.ready = true;
}

function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let left = n;
    const obs = scene.onAfterRenderObservable.add(() => {
      if (--left <= 0) {
        scene.onAfterRenderObservable.remove(obs);
        resolve();
      }
    });
  });
}

api.setView = async (v: View) => {
  engine.resize();
  applyView(v);
  await new Promise<void>((r) => scene.executeWhenReady(() => r()));
  await frames(3);
};
api.stats = stats;

let time = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  time += dt;
  result?.update?.(time, dt);
  if (spin && view === 'orbit') orbit.alpha += dt * 0.5;
  scene.render();
  const el = document.getElementById('stats');
  if (el && result && Math.floor(time * 2) !== Math.floor((time - dt) * 2)) {
    const s = stats();
    el.textContent = `${s.trianglesPerModel} tris/model, ${s.trianglesDrawn} drawn, ${s.drawCalls} draw calls, ${s.materials} materials, h ${height.toFixed(2)}`;
  }
});
window.addEventListener('resize', () => {
  engine.resize();
  if (view === 'game') applyView('game');
});
window.addEventListener('keydown', (e) => {
  const map: Record<string, View> = { '0': 'orbit', '1': 'front', '2': 'side', '3': 'top', '4': 'game' };
  if (map[e.key]) {
    applyView(map[e.key]);
    drawUi();
  } else if (e.key === 't') spin = !spin;
});

boot().catch((e: unknown) => {
  api.error = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  console.error('preview failed:', e);
  const ui = document.getElementById('ui');
  if (ui)
    ui.insertAdjacentHTML(
      'beforeend',
      `<div class="row" style="color:#ff8a80">${String(api.error).split('\n')[0]}</div>`,
    );
});
