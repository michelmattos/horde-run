# Horde Run art direction: World 1 "Bedroom Floor"

The visual overhaul's single source of truth. Every model, effect and UI task follows
this; the shared implementation is `src/render/look/` (materials, palette, light,
shadows, post) and the model contract is `src/render/models/README.md`.

## 1. The picture we want

A child's bedroom floor at about five in the afternoon, shot like a premium mobile
toy-diorama game. Warm sun comes through a window up and to the left of the lane and
lays long, soft shadows across varnished oak boards. A worn indigo play rug with a
stitched cream border runs up the middle: that is the lane. On it, a horde of classic
**green plastic army men** pours from a toy cannon toward a **tan plastic army** and its
fort; past the fort, at the far end, the room's baseboard and the bed skirt close the
view. Alphabet blocks, books, crayons, marbles, a toy car and a sock lie around the rug.

What sells it:

- **Believable materials**: soft-gloss injection-moulded plastic with a wide highlight
  rolling over bevelled edges; bright tin with sharp reflections; satin varnished wood
  with visible grain; matte wool rug with a soft sheen; matte paper; waxy crayons.
- **Real light**: one warm key light with real, soft-edged shadows; cool sky fill in
  the shadows; image-based reflections from a real interior HDRI.
- **Grounding**: nothing floats. Every toy touches the floor with a contact shadow
  (shadow map plus, where needed, a blob) and darkens in its crevices (baked AO).
- **Toy scale**: chunky proportions, rounded edges, moulding seams, base plates, studs.
  Nothing realistic-human-scale: no grit, no blood, no smoke stacks; debris is plastic
  shards and foam, dust is a soft carpet puff.
- **Readability first**: at the in-game distance (camera ~25-60 units away on a 6.9"
  phone) the two armies, the gates' numbers and the defenders must read instantly.

## 2. Palette

All values sRGB; `src/render/look/palette.ts` (`HEX`, `srgb()`, `lin()`,
`teamColor()`). PBR albedo and thin-instance colours take **linear** values (`lin()`).

| Role | Hex | Notes |
|---|---|---|
| Player army green | `#4f8f3c` (dark `#2f5d27`, light `#7cbf5e`) | Classic army-man green. Never used for anything else except "good" gates' green family. |
| Enemy army tan | `#c8a46a` (dark `#8f6f3e`, light `#e2c896`) | Deeper than sand so highlights don't blow out. |
| Tin | `#b9c0c6`, dark `#5f6870` | Bare tin plate, metallic. |
| Tin paint | red `#b5302a`, navy `#1f2a44`, skin `#efc3a0` | Lithographed tin (Tin General). |
| Brass | `#d2a33f` | Wind-up key, buttons, medals, star rewards. |
| Rubber | `#2c2e33` | Treads, tyres. |
| Oak floor | `#b98656` (dark `#7c5333`, light `#d7a676`) | Varnished boards. |
| Rug (lane) | `#2f4670`, dark `#22365a`, border `#efe3c6` | Indigo wool, cream stitched border. Both armies read on it by hue *and* value. |
| Baseboard / wall | `#f1ebe0` / `#d9e3e8` | Far background only, low contrast. |
| Paper | `#f4eddc`, ink `#2b1d12` | Pages, sign cards, stickers. |
| Toy primaries (props) | red `#d93a2f`, blue `#2f6fd6`, yellow `#f2b630`, purple `#8e4fc4`, orange `#f07a24`, teal `#1fa3b0` | Props only; **never green or tan**, so a prop never reads as a unit. Desaturate props ~15% versus units and keep them off the lane. |
| Gates | good `#2fbf5b` (dark `#1d7d3a`), trap `#e5483d` (dark `#9c2a22`) | Saturated, the most saturated things on screen after the armies. |
| Light | sun `#ffdcb0`, sky `#c9dcf2`, floor bounce `#c79a6c` | Warm key, cool fill, warm bounce. |
| UI | cream `#fff6e3`, ink `#2b1d12`, wood `#4a2e1b` / `#7a4f2e`, yellow `#ffc531`, green `#3fa34d`, red `#e5483d`, blue `#2f6fd6` | See section 7. |

## 3. Material recipes

Functions in `src/render/look/materials.ts`. All PBR (metal/rough). Defaults below; tune
per model only with a reason.

| Recipe | Use | Roughness | Metallic | Clearcoat | Detail |
|---|---|---|---|---|---|
| `plasticMaterial` | army men, forts, toy blocks, gate frames, cannon | 0.42 | 0 | 0 (0.3-0.6 on hero pieces) | none; bevels make the highlights |
| `tinMaterial` | bare tin (tank hull edges, key shaft) | 0.30 | 0.95 | 0 | faint moulding noise |
| `paintedTinMaterial` | lithographed tin (General's coat, tank livery) | 0.38 | 0.25 | 0.7 | none |
| `brassMaterial` | wind-up key, medals | 0.28 | 1 | 0 | none |
| `woodMaterial` | alphabet blocks, floorboards, cannon wheels | 0.55 | 0 | 0.25 (varnish) | grain texture (runs along V) |
| `fabricMaterial` | rug, sock, bed skirt | 0.92 | 0 | 0 | weave normal, colour-tinted sheen |
| `paperMaterial` | book pages, sign cards | 0.85 | 0 | 0 | fibre noise |
| `waxMaterial` | crayons | 0.62 | 0 | 0 | faint noise |
| `rubberMaterial` | treads, tyres | 0.88 | 0 | 0 | faint noise |
| `glassMaterial` | marbles | 0.04 | 0 | 1 | opaque by default; inner swirl as a second mesh or vertex colour |

Rules:

- **Bevel everything.** Moulded toys have no knife edges: `roundedBox()` (radius
  ~5-10% of the smallest side), lathe profiles with rounded corners, chamfered extrusions.
  The bevel is where the highlight lives; without it plastic looks like flat-shaded paper.
- **AO in vertex colours** (`bakeVertexAO`) on every non-trivial model: armpits, under
  helmets, between battlements, where blocks stack. Greyscale multiplier, strength
  0.5-0.75. It is what makes 1,500 tiny soldiers look solid without SSAO.
- **Colour variation**: real plastic batches vary. Instanced units may vary brightness
  ±4% per instance (integration does it through the colour buffer); props vary hue.
- **No pure black, no pure white** albedo. Darkest ~`#202020`, brightest ~`#f4f0e8`.
- **Emissive only for light-emitting things**: gate signs may glow faintly (≤ 0.25) so
  numbers stay legible in shadow; nothing else glows. Hit flashes are handled by effects.
- **Textures** are optional; the procedural surfaces in `look/textures.ts` cover wood,
  fabric, paper and plastic. Downloaded textures: CC0, ≤ 1024 px, credited.

## 4. Lighting and atmosphere

Implemented by `createLook()` in `src/render/look/index.ts`.

- **Key (sun)**: directional, warm `#ffdcb0`, from up-left and slightly behind the camera
  (direction `(0.55, -0.7, 0.45)`, about 45° elevation). Faces turned to the camera are
  lit; shadows fall up and to the right of each toy, visible on the rug beside it. The
  only shadow-casting light.
- **Fill**: hemispheric, cool sky `#c9dcf2` from above, warm floor bounce from below,
  low intensity. Shadows stay readable and slightly cool, never black.
- **Environment**: CC0 interior HDRI (Poly Haven "Lebombo", a sunlit room with a window
  and wood floor), 256x128, prefiltered on load. Reflections and ambient for all PBR.
  Never shown as a skybox.
- **Shadows**: one 2048 (high) / 1024 (medium, low) map, PCF soft edges, frustum fitted
  to the lane and its near scenery by `look.fitShadows()` per level. Crowds **cast real
  shadows** on high and medium (thin instances render into the shadow map; one extra
  draw per crowd mesh). On low the crowd is removed from the shadow map and integration
  draws **blob shadows** (`createBlobShadowMesh`, thin-instanced, one draw) instead.
  Every big static piece (forts, tank, defenders) adds a faint blob too as a contact
  shadow. Decision recorded here: real shadows for crowds, blobs as the low-tier fallback.
- **A sunlit patch**: the environment task may add a soft, warm, window-shaped light
  pool on the floor (a large additive decal, not a light) and faint dust motes in the
  sunbeam far from the lane. Keep it subtle and static.
- **Mood**: warm, nostalgic, cosy. Highlights warm, shadows slightly cool.

## 5. Camera, colour grade and post

- Camera: unchanged fixed lane camera (pitch 45-60°, framed by `framing.ts`) with the
  gentle crowd zoom-out. **No screen shake, no camera jitter, no camera animation of any
  kind** (Michel's rule). Hit feedback lives on units, defenders, bases and effects.
- Tone mapping ACES, exposure 1.0, contrast 1.12, mild saturation lift, warm
  highlights and cool shadows (`GRADE` in `look/post.ts`, applied on every tier).
- Post (`DefaultRenderingPipeline`): MSAA x4 (high) or FXAA (medium); bloom threshold
  0.92, weight 0.18 (glints on tin, gate signs, confetti only); warm-brown vignette.
  No depth of field, grain, chromatic aberration, motion blur or lens flare.
- **Performance tiers** (`look/quality.ts`): high, medium, low as above. The governor
  steps down after ~2 s of frames over 19 ms (one retry up after 30 s of headroom);
  `?quality=low|medium|high` forces a tier. The existing resolution scaler stays.

## 6. Readability rules at camera distance

The 'game' preview view (`scripts/preview.mjs <key>`) shows the model on a 1170x2532
phone frame at its real distance. Judge every model there, not only in close-ups.

1. **Silhouette over detail.** A soldier is ~25-40 px tall on screen. The helmet, rifle
   and base plate must read as a shape; buttons and straps are AO and vertex shading,
   not geometry.
2. **Team by hue and value.** Green is darker than tan; both differ from the indigo rug.
   Never put green or tan on props, effects or UI elements that are not the armies.
3. **Gates read from the far half of the lane**: number height ≥ 1.2 units, cream sign
   card with a dark ink outline and the op in bold; frame colour (green good / red trap)
   visible from any angle; trap gates also get a distinct shape cue (hazard stripes,
   spikes) so they differ even for colour-blind players.
4. **Hierarchy**: armies > gates > defenders and bases > props > floor. Props are lower
   contrast and lower saturation; the floor is the calmest thing on screen.
5. **The lane stays clear**: nothing taller than 0.2 is placed on the rug except gates,
   defenders and bases; props stay ≥ 1.2 units outside the rug border.
6. **Light-facing**: the camera sees the front of enemy-side pieces and the back/top of
   player-side ones. Make tops and backs finished.

## 7. HUD and UI style

Toy-box sticker style, consistent with the world map (wooden board, road path, round
level badges):

- **Shapes**: chunky rounded rectangles (radius 14-20 px), 3-4 px dark ink outline
  (`#2b1d12`), a 4-6 px darker "extrusion" below (like a thick die-cut sticker or a
  plastic button) and a soft drop shadow. Pressed state moves the face down onto its
  extrusion.
- **Surfaces**: cream card `#fff6e3` for panels; wood `#4a2e1b` / `#7a4f2e` for bars and
  headers (optionally with a faint grain); army green / tan for team-coded elements;
  yellow `#ffc531` for rewards and the primary call to action.
- **Type**: rounded heavy sans (self-hosted, subset, ≤ 60 KB woff2, e.g. a CC0/OFL
  rounded font such as Fredoka or Baloo 2 under OFL with the licence file next to it), white or cream fill with a
  dark outline for text over the 3D scene; ink on cream for panels. Numbers tabular.
- **HUD**: pause alone in the top-left corner (level name beside it, then fading); enemy
  base HP as a vertical wood-framed bar with tan fill and a fortress badge on the left
  under the pause (top half); player base HP as a vertical bar with green fill on the
  right, above the CHAMP button (bottom half), lifted off the bottom edge so the bottom
  strip stays free for dragging. No soldier counts and no live stars (stars belong to
  the result screen). CHAMP: a big round plastic button (≥ 72 px) with a charge ring,
  the kneeling bazooka icon, glows yellow when ready. All targets ≥ 48 px, all within safe areas.
- **Overlays** (pause, result, level card, title card): cream cards on a dimmed,
  slightly warm backdrop; result shows 3 big stars that pop in one by one (scale bounce,
  no screen movement); buttons are the sticker buttons above.
- **Motion**: quick, springy, small (≤ 150 ms, overshoot ≤ 10%). Never move the whole
  screen; never animate the 3D camera from UI.

## 8. Per-model briefs (summary)

Full briefs with budgets are in the task plan; each model task owns
`src/render/models/<key>.ts` and `public/models/<key>*` only.

- **soldier**: classic army man, rifle at the ready, helmet with brim, webbing, boots
  on a thin oval base plate; 1.3 tall; one mesh, team colour per instance; ≤ 700 tris.
- **champion**: kneeling bazooka man, 2.6 tall, slightly lighter plastic, rank stripes
  moulded in; ≤ 2,000 tris; instanced.
- **cannon**: chunky toy field cannon in green plastic with wooden-look wheels, brass
  muzzle band, recoil part separate; seen from behind and above.
- **playerFort / enemyFort**: moulded plastic toy forts (green / tan), crenellated
  walls, corner towers, gate, flag; HP bar mount; the enemy fort faces the camera.
- **tower / wall**: toy-block defenders (wooden alphabet-block look in tan/cream
  plastic), a tan soldier on the tower firing foam darts; wall crumbles in stages.
- **tinGeneral**: lithographed tin general (red coat, navy shako, moustache, sabre) on a
  wind-up tin tank with rubber treads and a big brass key.
- **gate**: toy arch frames with a big readable sign card; good green, trap red with
  hazard stripes; one-use gates show remaining uses.
- **props**: alphabet blocks, books, crayons, marbles, toy car, sock, building bricks;
  thin-instanced per kind.
- **environment**: oak floorboards (PBR), the rug lane with weave and stitched border,
  baseboard/bed skirt far back, sunlit patch.
- **effects**: foam darts, confetti gate bursts, plastic shards, carpet dust puffs, hit
  flashes; pooled, thin-instanced, cheap; no camera motion.
- **ui**: section 7.
