// Placeholder art palette: flat colours shared by every render module.
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';

export const PALETTE = {
  // World 1 'Bedroom Floor': a navy play rug laid down the middle of wooden floorboards,
  // toy building blocks, books and crayons around it. Green plastic soldiers (the player)
  // against a rival tan plastic army: dark green vs light tan reads by brightness as well
  // as hue, and both stand out on the navy rug.
  clear: Color4.FromHexString('#d7e4ecff'), // pale wallpaper beyond the far end of the floor
  floor: Color3.FromHexString('#b07a45'),
  floorDark: Color3.FromHexString('#8f5f33'),
  floorLight: Color3.FromHexString('#c48d55'),
  lane: Color3.FromHexString('#2b3d63'), // the rug
  laneStripe: Color3.FromHexString('#3a5080'),
  rail: Color3.FromHexString('#efe3c6'), // the rug's cream border
  gold: Color3.FromHexString('#f5c542'),
  player: Color3.FromHexString('#3f9a3a'),
  enemy: Color3.FromHexString('#e3c48a'),
  playerDark: Color3.FromHexString('#25632a'),
  enemyDark: Color3.FromHexString('#a8844c'),
  tin: Color3.FromHexString('#a9b4bf'), // the Tin General and his wind-up tank
  tinDark: Color3.FromHexString('#5d6670'),
  tread: Color3.FromHexString('#2f3238'),
  generalCoat: Color3.FromHexString('#c0392b'), // a classic red tin-soldier coat
  shako: Color3.FromHexString('#1f2a44'),
  skin: Color3.FromHexString('#f2c7a5'),
  gateGood: Color3.FromHexString('#22c55e'),
  gateBad: Color3.FromHexString('#ef4444'),
  hpBack: Color3.FromHexString('#0b0f17'),
  hpPlayer: Color3.FromHexString('#eaffdf'), // pale, so it reads on the green fort
  hpEnemy: Color3.FromHexString('#f0c878'),
  dust: Color3.FromHexString('#e6dccb'),
  white: new Color3(1, 1, 1),
  // Bedroom props: bright primary toy colours, never green or tan, so they never read as units.
  toyColors: ['#e03131', '#1c7ed6', '#f59f00', '#ae3ec9', '#f76707', '#15aabf'].map((h) => Color3.FromHexString(h)),
};
