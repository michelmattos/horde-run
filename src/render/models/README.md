# Model modules

Every 3D model of the visual overhaul lives in its own module, `src/render/models/<key>.ts`,
plus optional assets `public/models/<key>*` (`.glb`, textures). Models are built on the
shared look in `src/render/look/` (materials, palette, lighting, shadows, modelling
helpers) and follow `docs/art-direction.md`. Integration wires them into the renderer
(`crowd.ts`, `level.ts`, `defenders.ts`, `boss.ts`, `cannon.ts`, `scenery.ts`); model
tasks never edit those files.

## What a module exports

```ts
import type { Scene } from '@babylonjs/core/scene';
import type { Look } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';

// 1. Metadata for the preview harness and reviewers.
export const info: ModelInfo = {
  key: 'tower',            // = file name
  title: 'Block tower',
  instanced: false,        // true when the game thin-instances it
  teams: false,            // true when it has player (green) and enemy (tan) versions
  side: 'enemy',           // 'player' | 'enemy' | 'team' | 'neutral' (see Facing)
  height: 2.6,             // rough height in lane units
  triangleBudget: 3000,    // from your task brief
  gameZ: 40,               // lane z where it usually stands (preview 'game' view)
  variants: ['intact', 'damaged'], // optional, first is the default
};

// 2. The game API: what integration calls. Typed, documented in the module header.
//    Name it createX / buildX. Examples:
export async function createTowerModel(scene: Scene, look: Look): Promise<TowerModel> { ... }

// 3. A preview: builds a representative scene under one TransformNode root.
export async function preview(scene: Scene, look: Look, opts: PreviewOptions): Promise<PreviewResult> {
  // opts.team: 'player' | 'enemy'; opts.variant: string | null
  return { root, update(time, dt) { ... }, dispose() { root.dispose(); } };
}
```

Rules for the game API:

- **Pure construction.** No per-frame logic that belongs to the sim or the renderer:
  return meshes, nodes and small helpers (`setDamage(0..1)`, `setRecoil(0..1)`,
  `setKeyAngle(rad)`, `flash(k)`); integration drives them from the existing code paths.
- **No globals, no side effects at import.** Everything is created from `(scene, look)`.
- **Dispose cleanly.** Either return a `dispose()` or make every mesh a child of the
  returned root and every material come from `look.material(...)` (shared, disposed by the
  look) so `root.dispose()` is enough. Textures you load are yours to dispose.
- **Async is fine** (loading a `.glb`), but also offer a synchronous fallback or resolve
  quickly; the game must never wait on the network to start a battle. Assets are served
  from `public/`, so use `assetUrl('models/<key>.glb')` from the look (handles the
  `/horde-run/` base path).
- **Shadows.** Call `look.addShadowCaster(mesh)` for everything that should cast (use
  `look.addShadowCaster(mesh, 'crowd')` for thin-instanced crowds: dropped on the 'low'
  tier) and `look.receiveShadows(mesh)` for surfaces that should catch shadows. Small
  props may skip receiving. Do it in the game API, not just in `preview()`, or document
  that integration must.
- **No camera access**, no screen shake, no post-process changes. Lighting is the look's.

## Units, pivot, facing

- 1 world unit = 1 lane unit. The lane is 10 wide and 55-64 long; `LAYOUT` in
  `src/contracts.ts` has the rest (mob radius 0.28, champion radius 1.0, enemy base
  depth 4, player base depth 3).
- Mob soldier: about **1.3 tall** on its base plate (base ~0.55 across). Champion: about
  **2.6 tall** kneeling (radius 1.0 footprint). Size everything else relative to these.
- **Pivot at ground centre**: y = 0 is the floor, x/z = 0 is the footprint centre. For
  instanced meshes the geometry itself sits on y = 0 (no parent offset).
- **+Y up, front faces +Z.** Author every model with its front (face, muzzle, sign, gate
  label) toward +Z. In the game:
  - `side: 'player'` (cannon, player fort) stands at yaw 0: front up the lane, the
    camera sees its back and top. Make the back and top look finished.
  - `side: 'enemy'` (enemy fort, tower, wall, Tin General) is turned by PI: front faces
    the camera.
  - `side: 'team'` (soldier, champion): player units yaw 0, enemy units yaw PI.
    (Integration may add a three-quarter turn so the silhouette reads.)
  - `side: 'neutral'` (gates, props): turned by PI so the front faces the camera.
- glTF is right-handed with +Z forward; Babylon's loader keeps a +Z-forward model
  facing +Z (via its `__root__` node). If you bake vertices out of a glTF yourself,
  negate z and check the result in the preview.

## Team colour

- Thin-instanced team models (soldier, champion) use **one mesh and one material for
  both teams**: `plasticMaterial(scene, null, { instanceColor: true })` and a per-instance
  `color` buffer filled with **linear** colours: `teamColor('player' | 'enemy')` from
  `look/palette.ts`. Vertex colours on the mesh multiply in, so bake AO (`bakeVertexAO`)
  or paint secondary parts (darker straps, lighter face) as greyscale multipliers.
- Non-instanced team pieces take `team` as a parameter and pick from `HEX.green*` /
  `HEX.tan*` via `lin()`.
- Never hard-code other greens or tans: the two armies must read the same everywhere.

## Budgets (per the briefs)

- Thin-instanced crowd meshes: 1 draw call per mesh per pass; keep **≤ 2 meshes** per
  model (e.g. body + optional detail) and the triangle count in your brief (soldier
  ≤ 700, champion ≤ 2,000). Up to ~1,500 soldiers are on screen.
- Static pieces: ≤ 4 draw calls per model, triangles per brief.
- Textures: prefer the look's procedural surfaces (`texture: 'wood' | 'fabric' |
  'paper' | 'plastic'`) or vertex colours. Downloaded textures ≤ 1024 px (512 px for
  anything smaller than a fort), JPEG/PNG/WebP, and count them against the ~8 MB total
  asset budget. Record every download in `public/models/CREDITS.md` (CC0, or CC-BY with
  attribution).

## Preview harness

```
node scripts/preview.mjs <key> <port> [--team=enemy] [--variant=name] [--quality=low]
```

Starts `vite` on the port, renders the model under the shared look on a strip of play
rug over floorboards, and writes `preview-<key>-{front,side,top,game}.png` (gitignored)
and a JSON summary (triangles per model, triangles drawn, draw calls, materials,
bounds). `front` looks at the model's +Z face; `game` is the phone lane camera at the
model's `gameZ` with the in-game yaw. Read the PNGs to judge the result. Fails on any
console error.

Interactive: `npx vite --port <port>` and open
`http://localhost:<port>/preview.html?model=<key>&team=player` (keys 1-4 switch views,
0 orbit, t turntable; `&quality=low` shows the low tier with blob shadows only).

`soldier.ts` (instanced, team colour, baked AO) and `cannon.ts` (static pieces, shared
materials through `look.material`) are good modules to copy the shape of.
