// Toy-box sticker theme shared by the HUD, overlays, world map and save sheet
// (docs/art-direction.md section 7). One <style> is injected once: the self-hosted
// rounded font (Fredoka, OFL, public/ui/), colour tokens as CSS variables, and the
// shared building blocks:
//   .tb-btn         die-cut plastic sticker button: cream/green/yellow/red/wood faces,
//                   ink outline, a darker extrusion under it; pressed = the face sinks
//                   onto the extrusion (transform only, nothing else moves).
//   .tb-card        cream sticker panel with an ink outline and a thick cardboard edge.
//   .tb-plank       wood-board bar/header with a faint CSS grain.
//   .tb-outline     white/cream text with a dark outline for text over the 3D scene.
//   .tb-backdrop    dimmed warm backdrop for overlays.
// Motion is quick and small (<= 150 ms, overshoot <= 10%) and never moves the screen.
import { HEX } from '../render/look/palette.ts';

export const UI = {
  ink: HEX.uiInk,
  cream: HEX.uiCream,
  wood: HEX.uiWood,
  woodLight: HEX.uiWoodLight,
  yellow: HEX.uiYellow,
  green: HEX.uiGreen,
  red: HEX.uiRed,
  blue: HEX.uiBlue,
  army: HEX.green,
  armyDark: HEX.greenDark,
  armyLight: HEX.greenLight,
  tan: HEX.tan,
  tanDark: HEX.tanDark,
  tanLight: HEX.tanLight,
  tin: HEX.tin,
  tinDark: HEX.tinDark,
} as const;

// Fredoka first; system rounded faces as the fallback while it loads (or if it fails).
export const UI_FONT = `'Horde Fredoka', ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

function base(): string {
  try {
    return import.meta.env?.BASE_URL ?? '/';
  } catch {
    return '/';
  }
}

// 8-way outline + a soft drop, for cream/white text over the battlefield or wood.
export function outlineShadow(px: number, color: string = HEX.uiInk, drop = 2): string {
  const o: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    o.push(`${(Math.cos(a) * px).toFixed(2)}px ${(Math.sin(a) * px).toFixed(2)}px 0 ${color}`);
  }
  o.push(`0 ${px + drop}px 0 ${color}`);
  return o.join(',');
}

// Faint wood grain: thin streaks over a two-tone board gradient.
export const WOOD_BG =
  `repeating-linear-gradient(176deg, rgba(255,220,170,.07) 0 2px, transparent 2px 9px, rgba(30,14,4,.10) 9px 10px, transparent 10px 17px),` +
  `repeating-linear-gradient(183deg, transparent 0 23px, rgba(30,14,4,.12) 23px 25px, transparent 25px 41px),` +
  `linear-gradient(180deg, ${HEX.uiWoodLight} 0%, #6a4327 48%, ${HEX.uiWood} 100%)`;

const CSS = `
@font-face{font-family:'Horde Fredoka';font-style:normal;font-weight:600;font-display:swap;
  src:url('${base()}ui/fredoka-600.woff2') format('woff2')}
@font-face{font-family:'Horde Fredoka';font-style:normal;font-weight:700 900;font-display:swap;
  src:url('${base()}ui/fredoka-700.woff2') format('woff2')}
:root{--tb-ink:${UI.ink};--tb-cream:${UI.cream};--tb-wood:${UI.wood};--tb-wood-l:${UI.woodLight};--tb-yellow:${UI.yellow};
  --tb-green:${UI.green};--tb-red:${UI.red};--tb-blue:${UI.blue};--tb-tan:${UI.tan};--tb-font:${UI_FONT}}
.tb-font{font-family:var(--tb-font);font-variant-numeric:tabular-nums}
.tb-outline{color:#fff;text-shadow:${outlineShadow(2.2)}}
.tb-outline-cream{color:${UI.cream};text-shadow:${outlineShadow(2.2)}}

/* ----- Sticker button ----- */
.tb-btn{--face:${UI.cream};--face2:#f1e2c0;--edge:#c9a978;--txt:${UI.ink};--glow:rgba(255,255,255,.75);
  position:relative;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:10px;
  min-height:58px;width:100%;margin:0 0 6px;padding:0 20px;border:3.5px solid ${UI.ink};border-radius:18px;
  font-family:var(--tb-font);font-size:22px;font-weight:700;letter-spacing:.01em;line-height:1;color:var(--txt);
  background:radial-gradient(120% 90% at 30% 0%, var(--glow) 0 18%, transparent 46%),linear-gradient(180deg,var(--face) 0%,var(--face2) 100%);
  box-shadow:inset 0 -4px 0 rgba(0,0,0,.10),0 6px 0 -0.5px var(--edge),0 6px 0 3px ${UI.ink},0 12px 14px rgba(30,14,4,.28);
  transform:translateY(0);transition:transform 90ms cubic-bezier(.3,1.6,.6,1),box-shadow 90ms;
  cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
.tb-btn:active,.tb-btn.tb-down{transform:translateY(5px);
  box-shadow:inset 0 -3px 0 rgba(0,0,0,.10),0 1px 0 -0.5px var(--edge),0 1px 0 3px ${UI.ink},0 3px 5px rgba(30,14,4,.25)}
.tb-btn:focus-visible{outline:3px solid ${UI.yellow};outline-offset:5px}
.tb-btn svg{flex:none}
.tb-btn.tb-green{--face:#5cbf5f;--face2:${UI.green};--edge:#23692e;--txt:#fff;--glow:rgba(255,255,255,.55);text-shadow:${outlineShadow(2)}}
.tb-btn.tb-yellow{--face:#ffd862;--face2:${UI.yellow};--edge:#b27a00;--txt:${UI.ink};--glow:rgba(255,255,255,.75)}
.tb-btn.tb-red{--face:#f26a5f;--face2:${UI.red};--edge:#8f231b;--txt:#fff;--glow:rgba(255,255,255,.5);text-shadow:${outlineShadow(2)}}
.tb-btn.tb-wood{--edge:#26160b;--txt:${UI.cream};text-shadow:${outlineShadow(2)};background:radial-gradient(120% 90% at 30% 0%,rgba(255,230,190,.28) 0 18%,transparent 46%),${WOOD_BG}}
.tb-btn.tb-big{min-height:68px;font-size:28px;border-radius:22px}
.tb-btn.tb-small{min-height:50px;font-size:18px;border-radius:16px;padding:0 14px}

/* ----- Cream sticker panel ----- */
.tb-card{position:relative;box-sizing:border-box;background:
    radial-gradient(140% 80% at 50% 0%,rgba(255,255,255,.7),transparent 60%),
    repeating-linear-gradient(45deg,rgba(120,80,30,.025) 0 3px,transparent 3px 7px),${UI.cream};
  border:4px solid ${UI.ink};border-radius:26px;color:${UI.ink};
  box-shadow:0 8px 0 -1px #d8bf8f,0 8px 0 3px ${UI.ink},0 22px 30px rgba(20,10,2,.45)}

/* ----- Wood plank ----- */
.tb-plank{position:relative;box-sizing:border-box;background:${WOOD_BG};border:3.5px solid ${UI.ink};border-radius:16px;
  color:${UI.cream};box-shadow:inset 0 2px 0 rgba(255,225,180,.28),inset 0 -3px 0 rgba(0,0,0,.25),0 4px 0 ${UI.ink}}

/* ----- Overlay backdrop ----- */
.tb-backdrop{background:radial-gradient(120% 80% at 50% 40%,rgba(58,36,18,.42),rgba(26,14,6,.78))}

/* ----- Stars (inline SVG): gold, hollow, grey ----- */
.tb-star{display:block}
.tb-star .tb-star-body{fill:${UI.yellow}}
.tb-star .tb-star-shine{fill:#fff3c4}
.tb-star.tb-off .tb-star-body{fill:#e9dcc0}
.tb-star.tb-off .tb-star-shine{fill:#fbf3e2}
.tb-star.tb-grey .tb-star-body{fill:#9a948a}
.tb-star.tb-grey .tb-star-shine{fill:#b9b3a8}

@media (prefers-reduced-motion: reduce){.tb-btn{transition:none}}
`;

let injected = false;
export function injectUiTheme(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.dataset.tb = 'theme';
  style.textContent = CSS;
  document.head.appendChild(style);
  // Ask for the faces early so the first menu does not flash the fallback for long.
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.load) {
    fonts.load(`700 20px 'Horde Fredoka'`).catch(() => undefined);
    fonts.load(`600 20px 'Horde Fredoka'`).catch(() => undefined);
  }
}
