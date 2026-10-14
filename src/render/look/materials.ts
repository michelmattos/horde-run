// PBR material recipes for the toy world (docs/art-direction.md, "Material recipes").
// Every function returns a fresh PBRMaterial the caller owns (dispose it with the model),
// or use look.material(key, () => recipe(...)) to share one per scene.
//
// Colour input: a palette key ('green'), an sRGB hex ('#4f8f3c'), or a linear Color3.
// Per-instance colour: pass instanceColor: true (albedo is white) and write LINEAR colours
// into the thin-instance 'color' buffer (teamColor() in palette.ts). Vertex colours on the
// mesh multiply in as well, so a model can bake AO or paint parts in vertex colours and
// still take the team colour per instance.
import type { Scene } from '@babylonjs/core/scene';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { lin } from './palette.ts';
import { surfaceTextures } from './textures.ts';
import type { SurfaceKind } from './textures.ts';

export type ColorInput = string | Color3;

export interface MaterialOptions {
  name?: string;
  roughness?: number;
  metallic?: number;
  clearcoat?: number; // 0 = off; 0..1 intensity of a glossy top coat
  clearcoatRoughness?: number;
  instanceColor?: boolean; // white albedo; colour comes from thin-instance 'color' (linear)
  emissive?: ColorInput; // self-light (linear once converted); keep it subtle
  emissiveIntensity?: number;
  alpha?: number; // < 1 turns on alpha blending
  texture?: SurfaceKind | false; // procedural surface detail (albedo + normal); false = none
  albedoTexture?: Texture; // a downloaded texture instead of the procedural one
  normalTexture?: Texture;
  textureScale?: number; // uv repeats of the surface texture (default 1)
  normalStrength?: number; // bump level (default per recipe)
  backFaceCulling?: boolean;
  envIntensity?: number; // reflection strength multiplier (default 1)
}

export function toLinear(c: ColorInput): Color3 {
  return typeof c === 'string' ? lin(c) : c.clone();
}

interface Recipe {
  roughness: number;
  metallic: number;
  clearcoat: number;
  clearcoatRoughness: number;
  texture: SurfaceKind | false;
  normalStrength: number;
}

let counter = 0;

function build(scene: Scene, base: string, color: ColorInput | null, r: Recipe, o: MaterialOptions): PBRMaterial {
  const m = new PBRMaterial(o.name ?? `${base}-${++counter}`, scene);
  m.albedoColor = o.instanceColor || color === null ? Color3.White() : toLinear(color);
  m.metallic = o.metallic ?? r.metallic;
  m.roughness = o.roughness ?? r.roughness;
  m.environmentIntensity = o.envIntensity ?? 1;
  const cc = o.clearcoat ?? r.clearcoat;
  if (cc > 0) {
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = cc;
    m.clearCoat.roughness = o.clearcoatRoughness ?? r.clearcoatRoughness;
  }
  const kind = o.texture ?? r.texture;
  const scale = o.textureScale ?? 1;
  const albedo = o.albedoTexture ?? (kind ? surfaceTextures(scene, kind).albedo : null);
  const normal = o.normalTexture ?? (kind ? surfaceTextures(scene, kind).normal : null);
  if (albedo) m.albedoTexture = scaled(albedo, scale);
  if (normal) {
    m.bumpTexture = scaled(normal, scale);
    m.bumpTexture.level = o.normalStrength ?? r.normalStrength;
    m.invertNormalMapY = false;
  }
  if (o.emissive) {
    m.emissiveColor = toLinear(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  if (o.alpha !== undefined && o.alpha < 1) {
    m.alpha = o.alpha;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  }
  if (o.backFaceCulling !== undefined) m.backFaceCulling = o.backFaceCulling;
  m.useRadianceOverAlpha = true;
  return m;
}

// Shared textures keep scale 1; a different repeat needs its own (cheap) clone.
function scaled(t: Texture, s: number): Texture {
  if (s === 1) return t;
  const c = t.clone();
  c.uScale = s;
  c.vScale = s;
  return c;
}

// Injection-moulded toy plastic (army men, forts, toy blocks, gate frames): smooth,
// dielectric, a soft wide highlight. Big hero pieces may add clearcoat: 0.3-0.6.
export function plasticMaterial(scene: Scene, color: ColorInput | null, o: MaterialOptions = {}): PBRMaterial {
  return build(scene, 'plastic', color, { roughness: 0.42, metallic: 0, clearcoat: 0, clearcoatRoughness: 0.15, texture: false, normalStrength: 0.15 }, o);
}

// The crowd's shared plastic (mob riflemen and the champion body): white albedo, team
// colour per instance. A shade rougher than prop plastic and with specular anti-aliasing,
// so hundreds of tiny figures read as matte moulded men instead of a band of glitter.
export function armyPlasticMaterial(scene: Scene): PBRMaterial {
  const m = plasticMaterial(scene, null, { name: 'army-plastic', instanceColor: true, roughness: 0.5 });
  m.enableSpecularAntiAliasing = true;
  return m;
}

// Bare tin plate (the Tin General's tank, wind-up key shaft): bright metal, fairly glossy.
// For lithographed (painted) tin use paintedTinMaterial.
export function tinMaterial(scene: Scene, color: ColorInput | null = 'tin', o: MaterialOptions = {}): PBRMaterial {
  return build(scene, 'tin', color, { roughness: 0.3, metallic: 0.95, clearcoat: 0, clearcoatRoughness: 0.1, texture: 'plastic', normalStrength: 0.1 }, o);
}

// Lithographed / enamelled tin: printed colour under a glossy varnish, a hint of metal.
export function paintedTinMaterial(scene: Scene, color: ColorInput | null, o: MaterialOptions = {}): PBRMaterial {
  return build(scene, 'paintedTin', color, { roughness: 0.38, metallic: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.12, texture: false, normalStrength: 0 }, o);
}

// Brass (wind-up key, buttons, medals).
export function brassMaterial(scene: Scene, o: MaterialOptions = {}): PBRMaterial {
  return build(scene, 'brass', 'brass', { roughness: 0.28, metallic: 1, clearcoat: 0, clearcoatRoughness: 0.1, texture: false, normalStrength: 0 }, o);
}

// Wood (alphabet blocks, cannon wheels, furniture, floorboards): grain texture, satin
// varnish. Texture grain runs along V; rotate UVs on the mesh to orient it.
export function woodMaterial(scene: Scene, color: ColorInput | null = 'oak', o: MaterialOptions = {}): PBRMaterial {
  return build(scene, 'wood', color, { roughness: 0.55, metallic: 0, clearcoat: 0.25, clearcoatRoughness: 0.35, texture: 'wood', normalStrength: 0.35 }, o);
}

// Fabric (the rug, the sock, the bed skirt): matte, weave normal, a sheen at grazing angles.
export function fabricMaterial(scene: Scene, color: ColorInput | null, o: MaterialOptions = {}): PBRMaterial {
  const m = build(scene, 'fabric', color, { roughness: 0.92, metallic: 0, clearcoat: 0, clearcoatRoughness: 0, texture: 'fabric', normalStrength: 0.6 }, o);
  m.sheen.isEnabled = true;
  // Sheen tinted by the cloth colour (white sheen washes dark wool out to grey).
  m.sheen.intensity = 0.35;
  m.sheen.color = Color3.Lerp(m.albedoColor, Color3.White(), 0.35);
  m.sheen.roughness = 0.6;
  return m;
}

// Paper and card (book pages, gate signs, sticker labels): matte, faint fibre.
export function paperMaterial(scene: Scene, color: ColorInput | null = 'paper', o: MaterialOptions = {}): PBRMaterial {
  return build(scene, 'paper', color, { roughness: 0.85, metallic: 0, clearcoat: 0, clearcoatRoughness: 0, texture: 'paper', normalStrength: 0.2 }, o);
}

// Crayon wax: waxy, semi-matte, rich colour.
export function waxMaterial(scene: Scene, color: ColorInput | null, o: MaterialOptions = {}): PBRMaterial {
  return build(scene, 'wax', color, { roughness: 0.62, metallic: 0, clearcoat: 0, clearcoatRoughness: 0, texture: 'plastic', normalStrength: 0.2 }, o);
}

// Rubber (tank treads, toy car tyres, eraser): dark, matte.
export function rubberMaterial(scene: Scene, color: ColorInput | null = 'tread', o: MaterialOptions = {}): PBRMaterial {
  return build(scene, 'rubber', color, { roughness: 0.88, metallic: 0, clearcoat: 0, clearcoatRoughness: 0, texture: 'plastic', normalStrength: 0.3 }, o);
}

// Glass (marbles, windows): opaque by default (a marble reads as coloured glass from its
// sharp reflections); alpha < 1 for see-through panes.
export function glassMaterial(scene: Scene, color: ColorInput | null, o: MaterialOptions = {}): PBRMaterial {
  const m = build(scene, 'glass', color, { roughness: 0.04, metallic: 0, clearcoat: 1, clearcoatRoughness: 0.02, texture: false, normalStrength: 0 }, o);
  m.indexOfRefraction = 1.5;
  return m;
}
