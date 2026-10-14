# Model credits

## army-men.glb

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
