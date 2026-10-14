// Colour pipeline and post-processing. Tone mapping (ACES), exposure, contrast and colour
// curves live on the scene's ImageProcessingConfiguration, so they apply on every tier:
// in the material shaders when there is no pipeline (low), in the pipeline's final pass
// otherwise. The DefaultRenderingPipeline adds MSAA or FXAA, a mild bloom for glints
// (sun on tin, clearcoat highlights) and a soft vignette. No depth of field, no grain, no
// chromatic aberration, and nothing that moves the image (no shake, ever).
// SSAO is not used: contact shadows (shadow map + blob shadows) and AO baked into vertex
// colours give the grounded look for a fraction of the cost on a phone.
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { QualitySettings } from './quality.ts';

export const GRADE = {
  exposure: 1.0,
  contrast: 1.12,
  saturation: 8, // ColorCurves global saturation (-100..100): toys are saturated
  highlightsHue: 40, // warm highlights (sunlight)
  highlightsDensity: 18,
  shadowsHue: 220, // slightly cool shadows (sky fill)
  shadowsDensity: 14,
  vignetteWeight: 1.4,
  vignetteColor: new Color4(0.16, 0.08, 0.02, 0), // warm brown, not black
  bloomThreshold: 0.92,
  bloomWeight: 0.18,
  bloomKernel: 48,
  bloomScale: 0.5,
};

// Grading shared by every tier (call once per scene).
export function applyGrade(scene: Scene): void {
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = GRADE.exposure;
  ip.contrast = GRADE.contrast;
  const curves = new ColorCurves();
  curves.globalSaturation = GRADE.saturation;
  curves.highlightsHue = GRADE.highlightsHue;
  curves.highlightsDensity = GRADE.highlightsDensity;
  curves.highlightsSaturation = 10;
  curves.shadowsHue = GRADE.shadowsHue;
  curves.shadowsDensity = GRADE.shadowsDensity;
  ip.colorCurves = curves;
  ip.colorCurvesEnabled = true;
  ip.vignetteColor = GRADE.vignetteColor;
  ip.vignetteWeight = GRADE.vignetteWeight;
  ip.vignetteStretch = 0.4;
  ip.vignetteCameraFov = 0.6;
  ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  ip.vignetteEnabled = false; // the pipeline tier turns it on (it is free there)
}

// Builds (or rebuilds) the pipeline for a quality tier; returns null when the tier has none.
export function createPipeline(scene: Scene, camera: Camera, q: QualitySettings): DefaultRenderingPipeline | null {
  scene.imageProcessingConfiguration.vignetteEnabled = q.postProcess && q.vignette;
  if (!q.postProcess) return null;
  const engine = scene.getEngine();
  const caps = engine.getCaps();
  const hdr = !!(caps.textureHalfFloatRender || caps.textureFloatRender);
  const p = new DefaultRenderingPipeline('lookPipeline', hdr, scene, [camera], true);
  p.samples = engine.version >= 2 ? q.msaa : 1;
  p.fxaaEnabled = q.fxaa || (q.msaa > 1 && engine.version < 2);
  p.bloomEnabled = q.bloom;
  if (q.bloom) {
    p.bloomThreshold = GRADE.bloomThreshold;
    p.bloomWeight = GRADE.bloomWeight;
    p.bloomKernel = GRADE.bloomKernel;
    p.bloomScale = GRADE.bloomScale;
  }
  p.imageProcessingEnabled = true; // uses scene.imageProcessingConfiguration (applyGrade)
  p.depthOfFieldEnabled = false;
  p.chromaticAberrationEnabled = false;
  p.grainEnabled = false;
  p.sharpenEnabled = false;
  p.glowLayerEnabled = false;
  return p;
}
