// Placeholder art palette: flat colours shared by every render module.
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';

export const PALETTE = {
  clear: Color4.FromHexString('#1b2433ff'),
  lane: Color3.FromHexString('#4b5a70'),
  laneStripe: Color3.FromHexString('#5a6a82'),
  rail: Color3.FromHexString('#8b9bb4'),
  scenery: Color3.FromHexString('#141b27'),
  player: Color3.FromHexString('#3b82f6'),
  enemy: Color3.FromHexString('#ef4444'),
  playerDark: Color3.FromHexString('#1e40af'),
  enemyDark: Color3.FromHexString('#991b1b'),
  gateGood: Color3.FromHexString('#22c55e'),
  gateBad: Color3.FromHexString('#ef4444'),
  hpBack: Color3.FromHexString('#0b0f17'),
  hpPlayer: Color3.FromHexString('#60a5fa'),
  hpEnemy: Color3.FromHexString('#f87171'),
  dust: Color3.FromHexString('#c9b99a'),
  white: new Color3(1, 1, 1),
};
