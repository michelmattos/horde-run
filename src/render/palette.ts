// Placeholder art palette: flat colours shared by every render module.
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';

export const PALETTE = {
  // World 1 'Green Valley': a slate road through grassy hills, wooden rails.
  clear: Color4.FromHexString('#9fc7d9ff'),
  lane: Color3.FromHexString('#56606e'),
  laneStripe: Color3.FromHexString('#66717f'),
  rail: Color3.FromHexString('#8a6a46'),
  scenery: Color3.FromHexString('#3f7a3a'),
  treeTrunk: Color3.FromHexString('#6b4a2e'),
  leafDark: Color3.FromHexString('#2f6b34'),
  leafLight: Color3.FromHexString('#4f9a46'),
  gold: Color3.FromHexString('#f5c542'),
  goblinSkin: Color3.FromHexString('#b9524a'),
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
