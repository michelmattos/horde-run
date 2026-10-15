// Inline SVG icons for the sticker UI, returned as markup strings (decorative:
// every icon is aria-hidden; buttons carry their own text or aria-label).
// Figures are drawn as two passes of the same strokes: a wider ink pass for the
// die-cut outline, then the fill colour, so they read as chunky toy stickers.
import { HEX } from '../render/look/palette.ts';

const INK = HEX.uiInk;

interface Stroke {
  d: string;
  w: number; // stroke width of the fill pass (shapes are filled too)
}

function figure(parts: readonly Stroke[], color: string, outline: number, extra = ''): string {
  const pass = (c: string, grow: number): string =>
    parts
      .map(
        (p) =>
          `<path d="${p.d}" fill="${c}" stroke="${c}" stroke-width="${p.w + grow}" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
      .join('');
  return pass(INK, outline * 2) + pass(color, 0) + extra;
}

function svg(viewBox: string, body: string, size: number | string, cls = ''): string {
  const s = typeof size === 'number' ? `${size}` : size;
  return `<svg class="${cls}" viewBox="${viewBox}" width="${s}" height="${s}" aria-hidden="true" focusable="false">${body}</svg>`;
}

// Kneeling bazooka soldier, facing right (the champion).
const CHAMPION: Stroke[] = [
  { d: 'M5 23 L57 18', w: 8 }, // launcher tube on the shoulder
  { d: 'M53 12.5 L61 11.5 L62 23 L54.5 23.5 Z', w: 2 }, // flared muzzle
  { d: 'M3 18.5 L8 18 L8.8 27.5 L3.8 28 Z', w: 1.5 }, // rear end
  { d: 'M18 24 C17.5 12 37 11 37.5 22.5 Z', w: 2 }, // helmet
  { d: 'M28.5 26 L28.6 27', w: 9 }, // head
  { d: 'M27.5 31 L24 43', w: 12 }, // torso
  { d: 'M29 31 L39 33.5 L42.5 25', w: 5 }, // arm to the grip
  { d: 'M25 44 L38.5 43.5 L39.5 55.5 L46 55.5', w: 7.5 }, // front leg, knee up
  { d: 'M23 44 L20.5 55.5 L8 55.5', w: 7.5 }, // back leg kneeling
];

// Standing rifleman, facing right (army count, enemy badge).
const RIFLEMAN: Stroke[] = [
  { d: 'M21.5 15 C21 4 41 4 40.5 15 Z', w: 2 }, // helmet
  { d: 'M18.5 15 L43.5 15', w: 3.5 }, // brim
  { d: 'M31 20 L31 21', w: 9 }, // head
  { d: 'M31 26 L31 39', w: 12.5 }, // torso
  { d: 'M29 40 L25.5 56 L20.5 56.5', w: 7 }, // back leg
  { d: 'M33.5 40 L38 56 L43 56', w: 7 }, // front leg
  { d: 'M17 45 L49 15', w: 4.5 }, // rifle
  { d: 'M27 27 L27 34 L38 30', w: 5 }, // arms
];

// A little fort (the player's base).
const FORT: Stroke[] = [
  { d: 'M9 56 L9 27 L17 27 L17 32 L24 32 L24 27 L32 27 L32 32 L39 32 L39 27 L47 27 L47 32 L55 32 L55 56 Z', w: 2 },
  { d: 'M32 27 L32 8', w: 3 },
  { d: 'M32 8 L46 12.5 L32 17 Z', w: 2 },
];

export function championIcon(size: number | string, color: string = HEX.uiCream): string {
  return svg('0 0 64 64', figure(CHAMPION, color, 2.6), size, 'tb-ico');
}

export function soldierIcon(size: number | string, color: string = HEX.uiCream): string {
  return svg('0 0 64 64', figure(RIFLEMAN, color, 2.6), size, 'tb-ico');
}

export function fortIcon(size: number | string, color: string = HEX.uiCream, flag: string = HEX.uiYellow): string {
  const body =
    figure(FORT.slice(0, 2), color, 2.6) +
    figure(FORT.slice(2), flag, 2.6) +
    `<path d="M27 56 L27 46 C27 41 37 41 37 46 L37 56 Z" fill="${INK}" opacity=".55"/>`;
  return svg('0 0 64 64', body, size, 'tb-ico');
}

// Five-point star with an ink outline and a glint; colour classes in theme.ts (.tb-off, .tb-grey).
const STAR_D = (() => {
  const cx = 24;
  const cy = 25.5;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 20.5 : 9.8;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
})();

export function starIcon(size: number | string, cls = ''): string {
  const body =
    `<path d="${STAR_D}" fill="${INK}" stroke="${INK}" stroke-width="7" stroke-linejoin="round" transform="translate(0 1.6)"/>` +
    `<path class="tb-star-body" d="${STAR_D}" stroke="${INK}" stroke-width="3.6" stroke-linejoin="round"/>` +
    `<path class="tb-star-shine" d="M17.5 17.2 C19.5 14.2 22 11.2 23.2 9.6 C23.6 13 22 17.5 19.4 19.6 Z" opacity=".9"/>`;
  return svg('-2 -2 52 54', body, size, `tb-star ${cls}`.trim());
}

export function pauseIcon(size: number): string {
  const bar = (x: number): string =>
    `<rect x="${x}" y="14" width="10" height="36" rx="4" fill="${INK}"/><rect x="${x + 2}" y="15.5" width="6" height="30" rx="3" fill="${HEX.uiCream}"/>`;
  return svg('0 0 64 64', bar(17) + bar(37), size, 'tb-ico');
}

export function playIcon(size: number, color: string = HEX.uiInk): string {
  return svg(
    '0 0 32 32',
    `<path d="M10 6.5 L25 16 L10 25.5 Z" fill="${color}" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>`,
    size,
    'tb-ico',
  );
}

export function retryIcon(size: number, color: string = HEX.uiInk): string {
  return svg(
    '0 0 32 32',
    `<path d="M25 17.5 A9 9 0 1 1 20.5 9.2" fill="none" stroke="${color}" stroke-width="4.2" stroke-linecap="round"/>` +
      `<path d="M17.5 3.8 L25 8.6 L18 13.4 Z" fill="${color}" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>`,
    size,
    'tb-ico',
  );
}

export function nextIcon(size: number, color: string = HEX.uiInk): string {
  return svg(
    '0 0 32 32',
    `<path d="M6 16 L22 16" stroke="${color}" stroke-width="4.6" stroke-linecap="round"/>` +
      `<path d="M16 8.5 L25 16 L16 23.5" fill="none" stroke="${color}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    size,
    'tb-ico',
  );
}

export function mapIcon(size: number, color: string = HEX.uiInk): string {
  return svg(
    '0 0 32 32',
    `<path d="M4 8 L11 5 L21 8 L28 5 L28 24 L21 27 L11 24 L4 27 Z" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>` +
      `<path d="M11 5 L11 24 M21 8 L21 27" stroke="${color}" stroke-width="2.6"/>`,
    size,
    'tb-ico',
  );
}

export function lockIcon(size: number, color: string = HEX.uiCream): string {
  return svg(
    '0 0 32 32',
    `<path d="M10 15 V11 a6 6 0 0 1 12 0 V15" fill="none" stroke="${INK}" stroke-width="7"/>` +
      `<path d="M10 15 V11 a6 6 0 0 1 12 0 V15" fill="none" stroke="${color}" stroke-width="3"/>` +
      `<rect x="5" y="14" width="22" height="15" rx="4" fill="${color}" stroke="${INK}" stroke-width="3"/>` +
      `<circle cx="16" cy="21" r="2.4" fill="${INK}"/>`,
    size,
    'tb-ico',
  );
}

export function tickIcon(size: number): string {
  return svg(
    '0 0 32 32',
    `<circle cx="16" cy="16" r="13" fill="${HEX.uiGreen}" stroke="${INK}" stroke-width="3"/>` +
      `<path d="M9.5 16.5 L14 21 L22.5 11.5" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
    size,
    'tb-ico',
  );
}

export function crossIcon(size: number): string {
  return svg(
    '0 0 32 32',
    `<circle cx="16" cy="16" r="13" fill="${HEX.uiRed}" stroke="${INK}" stroke-width="3"/>` +
      `<path d="M11 11 L21 21 M21 11 L11 21" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
    size,
    'tb-ico',
  );
}

export function gearIcon(size: number, color: string = HEX.uiInk): string {
  return svg(
    '0 0 32 32',
    `<circle cx="16" cy="16" r="9" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="4.2 2.9"/>` +
      `<circle cx="16" cy="16" r="6.5" fill="none" stroke="${color}" stroke-width="3"/>`,
    size,
    'tb-ico',
  );
}

// Chunky red heart (the Expedition run's HP), ink outline and a glint.
const HEART_D =
  'M16 27.5 C10 23 4.5 18.5 4.5 12.2 C4.5 8.2 7.4 5.5 10.8 5.5 C13.1 5.5 15 6.9 16 8.9 C17 6.9 18.9 5.5 21.2 5.5 C24.6 5.5 27.5 8.2 27.5 12.2 C27.5 18.5 22 23 16 27.5 Z';
export function heartIcon(size: number | string): string {
  return svg(
    '0 0 32 32',
    `<path d="${HEART_D}" fill="${INK}" stroke="${INK}" stroke-width="6" stroke-linejoin="round" transform="translate(0 1.2)"/>` +
      `<path d="${HEART_D}" fill="${HEX.uiRed}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` +
      `<path d="M8.6 10.8 C8.8 9 10.2 8 11.6 8.1" fill="none" stroke="#ffd2cc" stroke-width="2.4" stroke-linecap="round"/>`,
    size,
    'tb-ico',
  );
}

// Gold coin: ink rim, raised inner ring, a star stamp and a glint.
export function coinIcon(size: number | string): string {
  return svg(
    '0 0 32 32',
    `<circle cx="16" cy="17.2" r="12.5" fill="${INK}"/>` +
      `<circle cx="16" cy="16" r="12" fill="#d99a12" stroke="${INK}" stroke-width="2.6"/>` +
      `<circle cx="16" cy="16" r="8.4" fill="${HEX.uiYellow}" stroke="#b27a00" stroke-width="1.6"/>` +
      `<path d="M16 10.6 L17.5 14.2 L21.2 14.4 L18.3 16.8 L19.3 20.4 L16 18.4 L12.7 20.4 L13.7 16.8 L10.8 14.4 L14.5 14.2 Z" fill="#e3a514" stroke="#b27a00" stroke-width=".8" stroke-linejoin="round"/>` +
      `<path d="M8.6 12.6 C9.4 10.4 11 8.8 13.2 8" fill="none" stroke="#fff3c4" stroke-width="2" stroke-linecap="round"/>`,
    size,
    'tb-ico',
  );
}

// Brass compass with a red and cream needle (the Expedition entry).
export function compassIcon(size: number | string): string {
  return svg(
    '0 0 32 32',
    `<circle cx="16" cy="17.4" r="13.4" fill="${INK}"/>` +
      `<circle cx="16" cy="16" r="12.8" fill="#d99a12" stroke="${INK}" stroke-width="2.6"/>` +
      `<circle cx="16" cy="16" r="9" fill="${HEX.uiCream}" stroke="${INK}" stroke-width="1.8"/>` +
      `<path d="M16 8.6 L19 16 L13 16 Z" fill="${HEX.uiRed}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<path d="M16 23.4 L13 16 L19 16 Z" fill="#c9b48e" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<circle cx="16" cy="16" r="1.8" fill="${INK}"/>` +
      `<path d="M8.4 11.8 C9.2 9.8 10.8 8.4 12.6 7.8" fill="none" stroke="#fff3c4" stroke-width="1.8" stroke-linecap="round"/>`,
    size,
    'tb-ico',
  );
}

// ---------- Milestone 4: champions and ultimates ----------

// Toy tank, facing right (the Tank champion). Tread line and road wheels in ink.
const TANK: Stroke[] = [
  { d: 'M13 44 L51 44 A6 6 0 0 1 51 56 L13 56 A6 6 0 0 1 13 44 Z', w: 2 }, // tread
  { d: 'M9 44 L14 34 L50 34 L56 44 Z', w: 2 }, // hull
  { d: 'M19 34 C19 21 42 21 42 34 Z', w: 2 }, // turret
  { d: 'M38 28 L60 25', w: 6 }, // barrel
  { d: 'M26 21.5 L34 21.5', w: 3.5 }, // hatch
];
const TANK_DETAIL =
  `<path d="M11 44.5 L54 44.5" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>` +
  [17, 26, 35, 44].map((x) => `<circle cx="${x}" cy="50" r="2.9" fill="${INK}"/>`).join('') +
  `<path d="M59.5 22.5 L60.5 28" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;

// Drummer: a soldier in a tall shako with a side drum and raised sticks, facing right.
const DRUMMER: Stroke[] = [
  { d: 'M23.5 16 L25 4.5 L37 4.5 L38.5 16 Z', w: 2 }, // shako
  { d: 'M20 16 L42 16', w: 3.5 }, // brim
  { d: 'M31 21 L31 22', w: 9 }, // head
  { d: 'M30 27 L30 39', w: 12.5 }, // torso
  { d: 'M28 40 L24.5 56 L19.5 56.5', w: 7 }, // back leg
  { d: 'M32.5 40 L37 56 L42 56', w: 7 }, // front leg
  { d: 'M34 36 L52 36 L52 47 L34 47 Z', w: 3 }, // drum
  { d: 'M27 28 L37 31.5', w: 5 }, // arm to the first stick
  { d: 'M37 31.5 L49 21', w: 2.6 }, // stick
  { d: 'M33 29 L44 34', w: 5 }, // second arm
  { d: 'M44 34 L55 27.5', w: 2.6 }, // second stick
];
const DRUMMER_DETAIL =
  `<path d="M36 38.5 L39.5 45 L43 38.5 L46.5 45 L50 38.5" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>` +
  `<path d="M34 36.5 L52 36.5 M34 46.5 L52 46.5" stroke="${INK}" stroke-width="2"/>`;

export type ChampionIconId = 'sarge' | 'tank' | 'drummer';

/** The champion's sticker figure: Sarge (bazooka), Tank or Drummer. */
export function championIconFor(id: ChampionIconId, size: number | string, color: string = HEX.uiCream): string {
  if (id === 'tank') return svg('0 0 64 64', figure(TANK, color, 2.6, TANK_DETAIL), size, 'tb-ico');
  if (id === 'drummer') return svg('0 0 64 64', figure(DRUMMER, color, 2.6, DRUMMER_DETAIL), size, 'tb-ico');
  return championIcon(size, color);
}

// Shared base for the round ultimate stickers: an ink extrusion under an ink-rimmed disc.
function disc(cx: number, cy: number, r: number, fill: string): string {
  return (
    `<circle cx="${cx}" cy="${cy + 2.2}" r="${r + 1.5}" fill="${INK}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="3"/>`
  );
}

// Barrage: an iron cannonball with a lit fuse.
function barrageBody(): string {
  return (
    `<path d="M41 23 C44 17 47 15 50 12" fill="none" stroke="${INK}" stroke-width="6.5" stroke-linecap="round"/>` +
    `<path d="M41 23 C44 17 47 15 50 12" fill="none" stroke="#d8b680" stroke-width="2.6" stroke-linecap="round"/>` +
    disc(30, 37, 18, '#3d3f4a') +
    `<path d="M18.5 32 C20 25.5 25 21.5 31 21" fill="none" stroke="#9aa0b0" stroke-width="3.2" stroke-linecap="round"/>` +
    `<circle cx="22" cy="27" r="2.2" fill="#e8ebf2"/>` +
    `<path d="M51 4.5 L53 9.5 L58.5 8.5 L54.5 12.5 L58 17 L52.5 15.5 L50.5 20.5 L49 15 L43.5 15.5 L47.5 11.5 L45 6.5 L49.5 9 Z" fill="${HEX.uiYellow}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="51" cy="12.5" r="2.4" fill="#ff8a3d"/>`
  );
}

// Paratroopers: a striped green canopy with strings down to a little soldier.
function paratroopersBody(): string {
  const canopy = 'M7 31 C7 11 57 11 57 31 C52 27 45 27 40 31 C36 27 28 27 24 31 C19 27 12 27 7 31 Z';
  const lines = [7, 24, 40, 57]
    .map((x) => `<path d="M${x} 30.5 L32 47" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`)
    .join('');
  return (
    `<path d="${canopy}" fill="${INK}" stroke="${INK}" stroke-width="6" stroke-linejoin="round" transform="translate(0 1.8)"/>` +
    `<path d="${canopy}" fill="${HEX.green}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M24 31 C24 21 28 14.5 32 13.6 C36 14.5 40 21 40 31 C36 27 28 27 24 31 Z" fill="${HEX.uiCream}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<path d="M13 21 C16 17 20 15 24 14.6" fill="none" stroke="#a5dc84" stroke-width="2.4" stroke-linecap="round"/>` +
    lines +
    `<path d="M32 50 L32 57" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>` +
    `<path d="M32 50 L32 57" stroke="${HEX.green}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="32" cy="45.5" r="4.6" fill="${HEX.uiCream}" stroke="${INK}" stroke-width="2.4"/>` +
    `<path d="M27.5 44.5 C27.5 39.5 36.5 39.5 36.5 44.5 Z" fill="${HEX.greenDark}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
  );
}

// Marble: a glass marble with a red and yellow swirl and two glints.
function marbleBody(): string {
  return (
    disc(32, 33, 22, '#6fc3ef') +
    `<path d="M14 38 C20 30 28 42 36 34 C42 28 48 30 52 26" fill="none" stroke="${HEX.uiRed}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M16 44 C24 38 32 48 40 42 C45 38 49 40 52 37" fill="none" stroke="${HEX.uiYellow}" stroke-width="3.6" stroke-linecap="round"/>` +
    `<circle cx="32" cy="33" r="20.2" fill="none" stroke="#c8ecff" stroke-width="1.6" opacity=".7"/>` +
    `<ellipse cx="24" cy="22" rx="7.5" ry="4.6" fill="#fff" opacity=".85" transform="rotate(-30 24 22)"/>` +
    `<circle cx="42.5" cy="45.5" r="2.4" fill="#fff" opacity=".7"/>`
  );
}

export type UltimateIconId = 'barrage' | 'paratroopers' | 'marble';

/** Colourful sticker for an ultimate (HUD button, loadout, collection). */
export function ultimateIcon(id: UltimateIconId, size: number | string): string {
  const body = id === 'paratroopers' ? paratroopersBody() : id === 'marble' ? marbleBody() : barrageBody();
  return svg('0 0 64 64', body, size, 'tb-ico');
}
