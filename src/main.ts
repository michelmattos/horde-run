// Placeholder boot; the build workflow replaces this with the real game.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { stencil: false }, false);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.1, 0.14, 0.2, 1);
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
