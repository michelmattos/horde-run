// The shared colour palette of the visual overhaul (docs/art-direction.md, "Palette").
// Values are sRGB hex, as a designer would pick them. Babylon's PBR albedo colours and
// thin-instance colours are linear, so use lin() (or LIN.*) for those; srgb() is for
// StandardMaterial, GUI and canvas work.
import { Color3 } from '@babylonjs/core/Maths/math.color';

export const HEX = {
  // Armies: injection-moulded plastic.
  green: '#4f8f3c', // player army green (lit side reads ~#6fae55 under the warm key)
  greenDark: '#2f5d27',
  greenLight: '#7cbf5e',
  tan: '#c8a46a', // enemy army tan (deeper than sand so highlights do not wash it out)
  tanDark: '#8f6f3e',
  tanLight: '#e2c896',
  // Tin toys (World 1 boss): bare tin plate, lithographed paint, brass key.
  tin: '#b9c0c6',
  tinDark: '#5f6870',
  tinRed: '#b5302a', // painted coat
  tinNavy: '#1f2a44', // painted shako / trim
  brass: '#d2a33f',
  tread: '#2c2e33', // black rubber treads
  skin: '#efc3a0', // painted face
  // The room.
  oak: '#b98656', // floorboards, varnished oak
  oakDark: '#7c5333',
  oakLight: '#d7a676',
  rug: '#2f4670', // the play rug (lane): indigo wool
  rugDark: '#22365a',
  rugBorder: '#efe3c6', // cream stitched border
  baseboard: '#f1ebe0', // painted skirting board
  wall: '#d9e3e8', // pale wallpaper far behind the floor
  paper: '#f4eddc',
  ink: '#2b1d12',
  // Bright primary toy colours for props: never green or tan, so props never read as units.
  toyRed: '#d93a2f',
  toyBlue: '#2f6fd6',
  toyYellow: '#f2b630',
  toyPurple: '#8e4fc4',
  toyOrange: '#f07a24',
  toyTeal: '#1fa3b0',
  // Gates.
  gateGood: '#2fbf5b',
  gateGoodDark: '#1d7d3a',
  gateTrap: '#e5483d',
  gateTrapDark: '#9c2a22',
  // Light.
  sun: '#ffdcb0', // warm late-afternoon key through the window
  sky: '#c9dcf2', // cool fill from the room / window sky
  bounce: '#c79a6c', // warm bounce off the wooden floor
  // UI (HUD, overlays, world map): toy-box / sticker style.
  uiCream: '#fff6e3',
  uiInk: '#2b1d12',
  uiWood: '#4a2e1b',
  uiWoodLight: '#7a4f2e',
  uiYellow: '#ffc531',
  uiGreen: '#3fa34d',
  uiRed: '#e5483d',
  uiBlue: '#2f6fd6',
} as const;

export type PaletteKey = keyof typeof HEX;

export const TOY_COLORS: readonly PaletteKey[] = ['toyRed', 'toyBlue', 'toyYellow', 'toyPurple', 'toyOrange', 'toyTeal'];

// Gamma-space colour (StandardMaterial, GUI, canvas).
export function srgb(hexOrKey: string): Color3 {
  const hex = hexOrKey.startsWith('#') ? hexOrKey : HEX[hexOrKey as PaletteKey];
  return Color3.FromHexString(hex);
}

// Linear-space colour (PBR albedo, thin-instance 'color' buffers feeding PBR).
export function lin(hexOrKey: string): Color3 {
  return srgb(hexOrKey).toLinearSpace();
}

// Team plastic colours, linear, for thin-instance colour buffers.
export type TeamName = 'player' | 'enemy';
export function teamColor(team: TeamName): Color3 {
  return lin(team === 'player' ? HEX.green : HEX.tan);
}
export function teamColorDark(team: TeamName): Color3 {
  return lin(team === 'player' ? HEX.greenDark : HEX.tanDark);
}
