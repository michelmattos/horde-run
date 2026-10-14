// Cheap flat materials: diffuse + a little emissive so colours stay readable under one
// hemispheric light, no specular highlights.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';

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

// Wooden floorboards for the Bedroom Floor ground: a small canvas texture (four planks
// with seams, staggered end joints and a little grain) tiled across the ground plane.
// Drawn once per level; the caller disposes it with its material.
export function woodFloorMaterial(scene: Scene, name: string, plankWidth: number, groundW: number, groundH: number): StandardMaterial {
  const size = 256;
  const planks = 4;
  const tex = new DynamicTexture(`${name}Tex`, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const pw = size / planks;
  const tones = ['#b98450', '#a9743f', '#c08b55', '#ad7845'];
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = tones[i];
    ctx.fillRect(i * pw, 0, pw, size);
    // Grain: a few faint lines along the plank.
    ctx.strokeStyle = 'rgba(90,50,20,0.18)';
    ctx.lineWidth = 1;
    for (let g = 1; g < 4; g++) {
      ctx.beginPath();
      ctx.moveTo(i * pw + (g * pw) / 4 + ((i * 7 + g * 3) % 5) - 2, 0);
      ctx.lineTo(i * pw + (g * pw) / 4 - ((i * 5 + g) % 5) + 2, size);
      ctx.stroke();
    }
    // Seam down the plank edge and one end joint, staggered per plank.
    ctx.fillStyle = 'rgba(55,30,12,0.75)';
    ctx.fillRect(i * pw, 0, 2, size);
    ctx.fillRect(i * pw, ((i * 97 + 40) % size), pw, 2);
  }
  tex.update();
  tex.wrapU = DynamicTexture.WRAP_ADDRESSMODE;
  tex.wrapV = DynamicTexture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 4;
  const tile = plankWidth * planks; // world units covered by one texture repeat
  tex.uScale = groundW / tile;
  tex.vScale = groundH / tile;

  const m = new StandardMaterial(name, scene);
  m.diffuseTexture = tex;
  m.emissiveColor = new Color3(0.3, 0.3, 0.3);
  m.specularColor = Color3.Black();
  return m;
}
