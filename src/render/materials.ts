// Cheap flat materials: diffuse + a little emissive so colours stay readable under one
// hemispheric light, no specular highlights.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

export function flatMaterial(scene: Scene, name: string, color: Color3, glow = 0.25): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color.clone();
  m.emissiveColor = color.scale(glow);
  m.specularColor = Color3.Black();
  return m;
}

// Unlit material for effects, labels and HP bars: colour comes only from emissive.
export function unlitMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = color.clone();
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  return m;
}
