// Image-based lighting: a small CC0 interior HDRI ("Lebombo" by Greg Zaal, Poly Haven:
// a sunlit room with a window and wooden floor), downsampled to 256x128 (128 KB) and
// prefiltered on the GPU at load into a 128px cube. It gives every PBR material its
// reflections and ambient colour. It is never drawn as a skybox: the room's floor and
// back wall cover the view.
import type { Scene } from '@babylonjs/core/scene';
import { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';

export const ENV_URL = `${import.meta.env.BASE_URL}look/bedroom-env.hdr`;
export const ENV_INTENSITY = 0.75;
// Turns the HDRI so its bright window sits up and to the left of the lane, where the key
// light comes from (radians about +Y).
export const ENV_ROTATION = 2.2;

// Resolves with the texture once it is prefiltered, or null if it failed (offline before
// first cache, no float textures). The look still works without it: the hemispheric
// fill light carries the ambient term.
export function loadEnvironment(scene: Scene, url = ENV_URL): Promise<BaseTexture | null> {
  return new Promise((resolve) => {
    let tex: HDRCubeTexture | null = null;
    try {
      tex = new HDRCubeTexture(
        url,
        scene,
        128,
        false, // mipmaps (needed for roughness)
        true, // spherical harmonics for diffuse IBL
        false, // linear data
        true, // prefilter on load (GPU)
        () => {
          if (!tex) return resolve(null);
          tex.rotationY = ENV_ROTATION;
          scene.environmentTexture = tex;
          scene.environmentIntensity = ENV_INTENSITY;
          resolve(tex);
        },
        (msg) => {
          console.warn('look: environment not loaded:', msg);
          tex?.dispose();
          resolve(null);
        },
      );
    } catch (e) {
      console.warn('look: environment not loaded:', e);
      resolve(null);
    }
  });
}
