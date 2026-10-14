# Model credits

## army-men.glb

> **Retired** in the visual overhaul: the file is no longer shipped. The mob rifleman and
> the champion are now modelled procedurally (`src/render/models/soldier.ts`,
> `champion.ts`). The credit below is kept for the history of the project.

The plastic army-men figures (`rifleman` for the mobs, `bazooka` for the champion) are
derived from:

- **Low Poly Soldier with weapons** by **Casti_131**
- Source: https://opengameart.org/content/low-poly-soldier-with-weapons
  (file `low_poly_soldier.zip`, https://opengameart.org/sites/default/files/low_poly_soldier.zip)
- Licence: **CC0 1.0 Universal** (public domain dedication),
  https://creativecommons.org/publicdomain/zero/1.0/

Attribution is not required by CC0; it is given here as a courtesy.

### What was changed

The `Soldier_Male_Mesh` (a 479-triangle rigged soldier) was read from the original
`soldier.blend` and baked to static meshes with its armature:

- `rifleman`: the file's own saved pose (striding forward, weapon held at the ready).
- `bazooka`: re-posed to kneel (right knee up, left knee down) with the arms raised.

On both, the sci-fi helmet and visor were replaced with a low-poly head and a WW2-style
M1 helmet with a brim, the gun was replaced with a long rifle (rifleman) or a bazooka tube
(bazooka), and a thin flat base plate was added under the feet, giving the classic toy
army-man silhouette. Each figure is one merged mesh (rifleman 613 triangles, bazooka 673
triangles; positions, normals and indices only, no materials or textures), scaled to a
height of 1 with the base centred on the origin and facing +Z.

## look/bedroom-env.hdr (shared look: image-based lighting)

- **Lebombo** HDRI by **Greg Zaal**, Poly Haven
- Source: https://polyhaven.com/a/lebombo
  (file https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/lebombo_1k.hdr)
- Licence: **CC0 1.0 Universal**, https://creativecommons.org/publicdomain/zero/1.0/

Box-downsampled from 1024x512 to 256x128 and rewritten as uncompressed RGBE
(`public/look/bedroom-env.hdr`, 128 KB). Used only for reflections and ambient light.

## cannon (src/render/models/cannon.ts)

The player's toy field cannon is modelled procedurally in code (lathes and bevelled boxes,
vertex-baked ambient occlusion) on the shared look's materials and procedural textures. It
uses no downloaded assets, so there is nothing to credit.

## enemyFort (src/render/models/enemyFort.ts)

The tan enemy fort is modelled procedurally in code (bevelled boxes, extruded arch and
shield outlines, lathes, a waved cloth grid, vertex-baked ambient occlusion) on the shared
look's materials and procedural textures. It uses no downloaded assets, so there is
nothing to credit.

## wall (src/render/models/wall.ts)

No downloaded assets. The toy alphabet blocks (rounded cubes) and their letter atlas
(albedo plus an embossing normal map, drawn on a canvas at load) are generated in code.

## tinGeneral (boss: the Tin General on his wind-up tin tank)

No downloaded assets. `src/render/models/tinGeneral.ts` models everything procedurally
(lathes, bevelled extrusions, thin-instanced tread links) and paints its lithographed
livery, the General's face and the material map into a 512 px canvas atlas at load time.

## gate (src/render/models/gate.ts)

The toy gate arches (plastic posts, hazard bands, film panel, hinged sign card) are
modelled procedurally in code, and the sign art (paper, ink outline, hazard stripes, skull
stickers, operator symbols) is drawn on a canvas at load with system fonts. It uses no
downloaded assets, so there is nothing to credit.

## Bedroom props (src/render/models/props.ts)

Alphabet blocks, books, crayons, marbles, the toy car, the sock and the building bricks
are modelled procedurally in code (rounded boxes, lathes, a swept tube), with ambient
occlusion baked into vertex colours at load. Surface detail comes from the shared
procedural textures in `src/render/look/textures.ts`. No third-party assets are used,
so there is nothing to credit.

## environment (src/render/models/environment.ts)

The oak floorboards use one downloaded texture set; everything else (the boards' geometry,
the rug's wool, border binding and stitches, the wallpaper, the window light pool, the
dust motes, the baseboard and the bed skirt) is modelled and textured procedurally in code.

- **Wood 048** by **ambientCG** (Lennart Demes)
- Source: https://ambientcg.com/view?id=Wood048
  (file https://ambientcg.com/get?file=Wood048_1K-JPG.zip)
- Licence: **CC0 1.0 Universal**, https://creativecommons.org/publicdomain/zero/1.0/

What was changed: from the 1K JPG set, `Wood048_1K-JPG_Color.jpg` was normalised to a
near-neutral greyscale grain map, its contrast flattened by 45% (the oak tone comes from
per-board vertex colours), and saved as `environment-oak-albedo.jpg` (1024 px); `Wood048_1K-JPG_NormalGL.jpg`
was re-encoded as `environment-oak-normal.jpg` (1024 px); `Wood048_1K-JPG_Roughness.jpg`
was downsized to 512 px, remapped to a satin-varnish range and packed into the green
channel of `environment-oak-orm.jpg` (red = 1, blue = 0). Total 0.43 MB.

## Effects (src/render/effects.ts)

No downloaded assets. The foam darts, plastic shards, mini-blocks, confetti, fluff-puff
and ring sprite textures are all modelled and generated procedurally in code (the
spark sprite reuses the look's generated radial texture).

## ui (src/ui/**, public/ui/)

The HUD and menu font is **Fredoka** (SIL Open Font License 1.1), self-hosted as Latin
woff2 subsets in `public/ui/` with its licence file; see `public/ui/CREDITS.md` for sources.
Icons are inline SVG drawn in code and every other UI surface is CSS, so nothing else is credited.
