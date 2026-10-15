// Inline SVG stickers for the Expedition screens: 30 upgrade icons (one per UpgradeIcon,
// UpgradeIconW2 and UpgradeIconW3 key, each a figure on a disc tinted by its category; an
// upgrade with an iconW3 or iconW2 is drawn with it, see upgradeIconOf) and 5 run-map node
// icons (figure only; the node badge is the disc). Same two-pass style as
// src/ui/icons.ts: a wide ink pass for the die-cut outline, then the fill colour.
// Shapes are chunky so they read at 28 px. Every icon is decorative (aria-hidden).
import type {
  RunNodeKind,
  UpgradeCategory,
  UpgradeDef,
  UpgradeIcon,
  UpgradeIconW2,
  UpgradeIconW3,
  UpgradeRarity,
} from '../../contracts.ts';
import { HEX } from '../../render/look/palette.ts';
import { championIcon, fortIcon, soldierIcon } from '../icons.ts';

const INK = HEX.uiInk;
const CREAM = HEX.uiCream;
const YELLOW = HEX.uiYellow;
const PALE_YELLOW = '#fff0a0';
const WOOD = '#9a6236';
const WOOD_L = '#c08250';
const GOLD_D = '#d08f00';
const ICE = '#dff3fc';
const ICE_D = '#8fcbea';
const SNOW = '#f6fbfe';
// World 3 workshop colours (docs/art-direction.md section 9).
const BRASS = HEX.brass;
const STEEL = '#c9ced4';
const STEEL_D = '#8e979f';
const HAZARD = '#f2c230';
const LITHO_BLUE = '#2e5aa8';

// Ribbon / card tint per rarity: common cream-blue, rare green, epic purple.
export const RARITY_COLORS: Record<UpgradeRarity, { face: string; edge: string; label: string }> = {
  common: { face: '#e4eefa', edge: '#3f78c8', label: 'Common' },
  rare: { face: '#dcf2d6', edge: '#2f8f3a', label: 'Rare' },
  epic: { face: '#efe0fb', edge: '#7c3fc6', label: 'Epic' },
};

// Disc colour of each category (light centre, base, dark rim) and its tag label.
export const CATEGORY_COLORS: Record<UpgradeCategory, { c1: string; c2: string; c3: string; label: string }> = {
  gate: { c1: '#8cb8f5', c2: '#3d7fe0', c3: '#2556a8', label: 'Gate' },
  mob: { c1: HEX.greenLight, c2: HEX.green, c3: HEX.greenDark, label: 'Mob' },
  cannon: { c1: '#aeb7bf', c2: '#6b757e', c3: '#454d55', label: 'Cannon' },
  champion: { c1: '#ffc27a', c2: '#f08a24', c3: '#b55a0c', label: 'Champion' },
  relic: { c1: '#c39af0', c2: '#8a4fd0', c3: '#5a2c96', label: 'Relic' },
};

interface Part {
  d: string;
  w: number; // stroke width of the colour pass
  open?: boolean; // a line (stroked only), not a filled shape
}

// Two passes of the same strokes: ink grown by `outline` on each side, then colour.
function sticker(parts: readonly Part[], color: string, outline = 2.4): string {
  const pass = (c: string, grow: number): string =>
    parts
      .map(
        (p) =>
          `<path d="${p.d}" fill="${p.open ? 'none' : c}" stroke="${c}" stroke-width="${p.w + grow}" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
      .join('');
  return pass(INK, outline * 2) + pass(color, 0);
}

// Plain (no outline) detail strokes or fills drawn over a sticker.
function detail(d: string, color: string, w = 0): string {
  return w > 0
    ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${d}" fill="${color}"/>`;
}

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

function starPath(cx: number, cy: number, ro: number, ri: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function gearPath(cx: number, cy: number, ro: number, ri: number, teeth: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [da, r] of [
      [-0.3, ri],
      [-0.18, ro],
      [0.18, ro],
      [0.3, ri],
    ] as const) {
      const t = a + da * step * 1.6;
      pts.push(`${(cx + Math.cos(t) * r).toFixed(2)} ${(cy + Math.sin(t) * r).toFixed(2)}`);
    }
  }
  return `M${pts.join(' L')} Z`;
}

function wrap(body: string, size: number | string, cls: string): string {
  const s = typeof size === 'number' ? `${size}` : size;
  return `<svg class="${cls}" viewBox="0 0 64 64" width="${s}" height="${s}" aria-hidden="true" focusable="false">${body}</svg>`;
}

// Embeds one of the shared ui/icons.ts figures (a 64-unit svg) at x, y with size s.
function nested(svgMarkup: string, x: number, y: number, flip = false): string {
  const t = flip ? `translate(${64 - x} ${y}) scale(-1 1)` : `translate(${x} ${y})`;
  return `<g transform="${t}">${svgMarkup}</g>`;
}

// Category disc: ink rim and drop, a darker plastic edge, the face, a soft light and a
// glint. Flat layers rather than gradients: inline-SVG gradient ids would collide when
// the same icon appears several times on a page (and break inside hidden screens).
function disc(cat: UpgradeCategory): string {
  const c = CATEGORY_COLORS[cat];
  return (
    `<circle cx="32" cy="33.5" r="29.5" fill="${INK}"/><circle cx="32" cy="32" r="29.5" fill="${INK}"/>` +
    `<circle cx="32" cy="32" r="26.5" fill="${c.c3}"/><circle cx="32" cy="30.5" r="25" fill="${c.c2}"/>` +
    `<circle cx="28" cy="25" r="16" fill="${c.c1}" opacity=".45"/>` +
    `<ellipse cx="23" cy="16.5" rx="10" ry="5" fill="#fff" opacity=".4" transform="rotate(-20 23 16.5)"/>`
  );
}

const X_GLYPH = 'M13 26 L25 42 M25 26 L13 42';

// Six-armed snowflake.
function flakePath(cx: number, cy: number, r: number): string {
  let d = '';
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 2;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    d += `M${(cx - dx).toFixed(2)} ${(cy - dy).toFixed(2)} L${(cx + dx).toFixed(2)} ${(cy + dy).toFixed(2)} `;
  }
  return d;
}

export type UpgradeArt = UpgradeIcon | UpgradeIconW2 | UpgradeIconW3;

const UPGRADE_ART: Record<UpgradeArt, { cat: UpgradeCategory; body: () => string }> = {
  // ----- Gate -----
  'gate-x2': {
    cat: 'gate',
    body: () =>
      sticker(
        [
          { d: X_GLYPH, w: 5.5, open: true },
          { d: 'M31 23 C31 14 49 14 49 23 C49 30 38 34 31 44 L50 44', w: 5.5, open: true },
        ],
        CREAM,
      ),
  },
  'gate-plus': {
    cat: 'gate',
    body: () => sticker([{ d: 'M32 15 L32 49 M15 32 L49 32', w: 8.5, open: true }], CREAM),
  },
  'gate-fork': {
    cat: 'gate',
    body: () =>
      sticker(
        [
          { d: 'M14 46 L14 23 L29 23 L29 46', w: 5, open: true },
          { d: 'M35 46 L35 23 L50 23 L50 46', w: 5, open: true },
        ],
        CREAM,
      ) +
      sticker(
        [{ d: 'M21.5 31 L21.5 39 M17.5 35 L25.5 35 M38.5 31 L46.5 39 M46.5 31 L38.5 39', w: 3, open: true }],
        YELLOW,
        1.6,
      ),
  },
  'gate-x3': {
    cat: 'gate',
    body: () =>
      sticker(
        [
          { d: X_GLYPH, w: 5.5, open: true },
          { d: 'M31 17 L47 17 L39 27 C50 26 52 45 40 45.5 C35 45.8 32 43.5 31 41', w: 5.5, open: true },
        ],
        YELLOW,
      ) + sticker([{ d: starPath(52, 12, 6, 2.6), w: 1 }], PALE_YELLOW, 1.8),
  },
  // ----- Mob -----
  'mob-tough': {
    cat: 'mob',
    body: () =>
      sticker([{ d: 'M32 11 L48 17 L47 33 C46 42 39 48.5 32 52 C25 48.5 18 42 17 33 L16 17 Z', w: 2 }], CREAM) +
      detail('M32 22 L32 41 M22.5 31.5 L41.5 31.5', HEX.green, 6),
  },
  'mob-sharp': {
    cat: 'mob',
    body: () =>
      sticker([{ d: 'M50 11 L53 14 L31 41 L23 33 Z', w: 2 }], '#e8eef2') +
      sticker([{ d: 'M19 31 L33 45', w: 5 }], YELLOW) +
      sticker([{ d: 'M24 40 L14 50', w: 7 }], WOOD_L),
  },
  'mob-knight': {
    cat: 'mob',
    body: () =>
      sticker([{ d: 'M33 17 C36 8 47 7 52 12 C45 12.5 40 14 36 19 Z', w: 2 }], HEX.uiRed) +
      sticker([{ d: 'M19 50 L19 31 C19 14 45 14 45 31 L45 50 Z', w: 2 }], '#d5dce2') +
      detail('M23.5 32 L40.5 32', INK, 4) +
      detail('M32 37 L32 46', INK, 3),
  },
  'mob-reinforce': {
    cat: 'mob',
    body: () =>
      sticker([{ d: 'M32 12 L32 25 M25.5 18.5 L38.5 18.5', w: 4, open: true }], YELLOW, 2) +
      sticker(
        [
          { d: 'M11 34 C11 21 28 21 28 34 Z', w: 2 },
          { d: 'M9 34 L30 34', w: 3.5, open: true },
        ],
        CREAM,
      ) +
      sticker(
        [
          { d: 'M36 34 C36 21 53 21 53 34 Z', w: 2 },
          { d: 'M34 34 L55 34', w: 3.5, open: true },
        ],
        CREAM,
      ) +
      sticker(
        [
          { d: 'M21 48 C21 33 43 33 43 48 Z', w: 2 },
          { d: 'M18 48 L46 48', w: 4, open: true },
        ],
        CREAM,
      ),
  },
  // ----- Cannon -----
  'cannon-rapid': {
    cat: 'cannon',
    body: () =>
      sticker([{ d: gearPath(32, 32, 20, 14.5, 8), w: 1.5 }], CREAM) +
      `<circle cx="32" cy="32" r="6.5" fill="${INK}"/>` +
      sticker(
        [{ d: 'M46 44 C49 48 51 50 51 52.5 C51 55 49 56 47.5 56 C46 56 44 55 44 52.5 C44 50 45 48 46 44 Z', w: 1 }],
        YELLOW,
        1.8,
      ),
  },
  'cannon-scatter': {
    cat: 'cannon',
    body: () =>
      sticker([{ d: 'M14 48 L30 32', w: 12, open: true }], CREAM) +
      sticker([{ d: 'M26 27 L35 36', w: 4, open: true }], CREAM) +
      sticker([{ d: circle(39, 16, 4.5), w: 1 }], YELLOW, 2) +
      sticker([{ d: circle(48, 26, 4.5), w: 1 }], YELLOW, 2) +
      sticker([{ d: circle(48, 40, 4.5), w: 1 }], YELLOW, 2),
  },
  'cannon-burst': {
    cat: 'cannon',
    body: () =>
      detail('M9 24 L16 24 M7 32 L13 32 M9 40 L16 40', CREAM, 3.5) +
      sticker([{ d: circle(23, 32, 5), w: 1 }], CREAM, 2) +
      sticker([{ d: circle(35, 32, 6), w: 1 }], CREAM, 2) +
      sticker([{ d: circle(48, 32, 7), w: 1 }], CREAM, 2),
  },
  'cannon-swivel': {
    cat: 'cannon',
    body: () =>
      sticker([{ d: 'M19 37 L46 29', w: 11, open: true }], CREAM) +
      sticker([{ d: circle(27, 43, 7.5), w: 1 }], WOOD_L, 2.2) +
      `<circle cx="27" cy="43" r="2.2" fill="${INK}"/>` +
      sticker(
        [
          { d: 'M17 18 C24 11 40 11 47 18', w: 3.6, open: true },
          { d: 'M12 14 L20 12.5 L18.5 21 Z', w: 1 },
          { d: 'M52 14 L44 12.5 L45.5 21 Z', w: 1 },
        ],
        YELLOW,
        1.8,
      ),
  },
  // ----- Champion -----
  'champ-charge': {
    cat: 'champion',
    body: () => sticker([{ d: 'M37 9 L18 36 L30 36 L26 55 L46 26 L34 26 Z', w: 2 }], PALE_YELLOW),
  },
  'champ-rally': {
    cat: 'champion',
    body: () =>
      sticker([{ d: 'M21 15 L21 53', w: 4.5, open: true }], WOOD_L) +
      sticker([{ d: 'M23 15 C31 11 39 19 48 15 L48 33 C39 37 31 29 23 33 Z', w: 2 }], CREAM) +
      sticker([{ d: starPath(35.5, 24, 5.5, 2.4), w: 0.5 }], HEX.uiRed, 1) +
      sticker([{ d: circle(21, 12, 3.5), w: 1 }], YELLOW, 1.8),
  },
  'champ-big': {
    cat: 'champion',
    body: () =>
      nested(championIcon(42, CREAM), 8, 16) +
      sticker([{ d: 'M49 23 L49 9 M43.5 14.5 L49 9 L54.5 14.5', w: 4, open: true }], PALE_YELLOW, 2),
  },
  // ----- Relic -----
  'relic-overcharge': {
    cat: 'relic',
    body: () =>
      sticker([{ d: 'M15 50 L15 21 L49 21 L49 50', w: 5.5, open: true }], CREAM) +
      sticker([{ d: 'M35 24 L24 39 L31 39 L28 51 L41 34 L34 34 Z', w: 1.5 }], YELLOW, 2),
  },
  'relic-glass': {
    cat: 'relic',
    body: () =>
      sticker([{ d: 'M15 44 L46 23', w: 12, open: true }], '#cdeeff') +
      detail('M14 40 L44 20', '#ffffff', 2.5) +
      detail('M29 28 L32.5 33.5 L29.5 36 L34 40', INK, 2.2) +
      sticker([{ d: circle(24, 45, 7), w: 1 }], WOOD_L, 2.2) +
      `<circle cx="24" cy="45" r="2" fill="${INK}"/>`,
  },
  'relic-chest': {
    cat: 'relic',
    body: () =>
      sticker([{ d: circle(23, 14, 4.5), w: 1 }], YELLOW, 2) +
      sticker([{ d: circle(40, 12, 4.5), w: 1 }], YELLOW, 2) +
      sticker([{ d: 'M13 30 C13 18 51 18 51 30 Z', w: 2 }], WOOD_L) +
      sticker([{ d: 'M13 31 L51 31 L51 50 L13 50 Z', w: 2 }], WOOD) +
      detail('M13 31 L51 31', YELLOW, 3) +
      sticker([{ d: 'M28.5 29 L35.5 29 L35.5 38 L28.5 38 Z', w: 1 }], YELLOW, 1.8),
  },
  'relic-sapper': {
    cat: 'relic',
    body: () =>
      sticker([{ d: 'M42 17 C45 12 48 12 50 9', w: 2.5, open: true }], WOOD_L, 1.6) +
      sticker([{ d: 'M35 24 L41 18', w: 7, open: true }], '#aeb7bf') +
      sticker([{ d: circle(29, 38, 14), w: 1 }], '#3a3f45', 2.2) +
      `<ellipse cx="24" cy="32" rx="4.5" ry="3" fill="#fff" opacity=".45" transform="rotate(-35 24 32)"/>` +
      sticker([{ d: starPath(51.5, 8.5, 6, 2.5), w: 0.5 }], YELLOW, 1.6),
  },
  'relic-fort': {
    cat: 'relic',
    body: () => nested(fortIcon(44, CREAM, YELLOW), 10, 9),
  },
  // ----- World 2 -----
  // An icy x3 with icicles hanging off it and a snowflake.
  'gate-frost': {
    cat: 'gate',
    body: () =>
      sticker(
        [
          { d: X_GLYPH, w: 5.5, open: true },
          { d: 'M31 17 L47 17 L39 27 C50 26 52 45 40 45.5 C35 45.8 32 43.5 31 41', w: 5.5, open: true },
        ],
        ICE,
      ) +
      sticker(
        [
          { d: 'M14 46 L15.5 52 L17 46 Z', w: 1 },
          { d: 'M22 46 L23.5 54 L25 46 Z', w: 1 },
          { d: 'M36 48 L37.5 54 L39 48 Z', w: 1 },
        ],
        SNOW,
        1.5,
      ) +
      sticker([{ d: flakePath(52, 12, 6), w: 2.2, open: true }], SNOW, 1.6),
  },
  // A little ice rink: soldiers' tracks fanning out from the bottom.
  'gate-rink': {
    cat: 'gate',
    body: () =>
      sticker([{ d: 'M8 38 C8 26 56 26 56 38 C56 50 8 50 8 38 Z', w: 2 }], ICE) +
      detail('M12 37.5 C12 30 52 30 52 37.5', '#ffffff', 2.4) +
      detail('M20 44 C24 40 28 40 32 42 M36 41 C41 38 45 39 47 42', ICE_D, 2) +
      sticker(
        [
          { d: 'M32 30 L32 12 M27 17 L32 12 L37 17', w: 3.6, open: true },
          { d: 'M28 31 L16 17 M16 23.5 L16 17 L22.5 17', w: 3.6, open: true },
          { d: 'M36 31 L48 17 M48 23.5 L48 17 L41.5 17', w: 3.6, open: true },
        ],
        CREAM,
        1.8,
      ),
  },
  // An ice skate: cream boot, laces, a tin blade.
  'mob-skates': {
    cat: 'mob',
    body: () =>
      sticker([{ d: 'M13 49 L52 49 C55 49 56 46 54 44', w: 3.4, open: true }], '#e8eef2') +
      sticker([{ d: 'M20 44 L20 45 M44 44 L44 45', w: 4, open: true }], '#aeb7bf', 1.6) +
      sticker([{ d: 'M18 12 L33 12 L34 29 C42 30 50 33 50 38 L50 43 L16 43 C16 34 17 22 18 12 Z', w: 2 }], CREAM) +
      detail('M16.5 39 L50 39', HEX.uiRed, 3) +
      detail('M23 17 L30 20 M23 22 L30 25 M23 27 L30 30', INK, 1.8) +
      `<ellipse cx="22" cy="18" rx="2.6" ry="5" fill="#fff" opacity=".6"/>`,
  },
  // A red mug of hot cocoa, a marshmallow, curls of steam.
  'relic-cocoa': {
    cat: 'relic',
    body: () =>
      sticker(
        [
          { d: 'M24 6 C21 10 27 12 24 16', w: 2.6, open: true },
          { d: 'M34 4 C31 8 37 10 34 15', w: 2.6, open: true },
        ],
        CREAM,
        1.5,
      ) +
      sticker([{ d: 'M45 28 C55 27 55 43 44 42', w: 4.6, open: true }], HEX.uiRed) +
      sticker([{ d: 'M14 22 L48 22 L45 48 C44.5 52 41 54 37 54 L25 54 C21 54 17.5 52 17 48 Z', w: 2 }], HEX.uiRed) +
      sticker([{ d: 'M15.5 23.5 C22 27 40 27 46.5 23.5 C40 20 22 20 15.5 23.5 Z', w: 1.2 }], '#7a4a2a', 1.4) +
      sticker([{ d: 'M30 19 L38 19 L38 25 L30 25 Z', w: 1.4 }], SNOW, 1.6) +
      detail('M21 31 C21.5 40 23 46 26 49', '#fff', 2.6) +
      sticker([{ d: flakePath(31, 38, 5), w: 2, open: true }], SNOW, 1.4),
  },
  // Avalanche: a curling wave of snow carrying tumbling snowballs.
  'champ-avalanche': {
    cat: 'champion',
    body: () =>
      sticker(
        [
          {
            d: 'M8 50 C10 34 20 18 36 14 C47 11 55 17 54 25 C53 32 44 33 42 27 C41 23 45 21 47 23 C42 30 30 34 26 50 Z',
            w: 2,
          },
        ],
        SNOW,
      ) +
      detail('M14 47 C17 36 24 26 34 21', ICE_D, 2.6) +
      sticker([{ d: circle(39, 44, 6.5), w: 1 }], SNOW, 2.2) +
      sticker([{ d: circle(52, 47, 4.5), w: 1 }], SNOW, 2) +
      detail('M35 46 C37 48.5 41 48.5 43.5 46', ICE_D, 1.8) +
      sticker([{ d: flakePath(52, 9, 5), w: 2, open: true }], ICE, 1.4),
  },
  // ----- World 3: the workshop -----
  // Clockwork Gate: a brass alarm clock (cream face, hands at ten past ten, two bells).
  'gate-clock': {
    cat: 'gate',
    body: () =>
      sticker(
        [
          { d: 'M19 21 C14 17 16 9 23 10', w: 4.5, open: true },
          { d: 'M45 21 C50 17 48 9 41 10', w: 4.5, open: true },
          { d: 'M21 51 L17 56 M43 51 L47 56', w: 4, open: true },
        ],
        BRASS,
        2,
      ) +
      sticker([{ d: circle(32, 35, 19), w: 1.5 }], BRASS) +
      sticker([{ d: circle(32, 35, 14.5), w: 1 }], CREAM, 1.6) +
      detail('M32 22.5 L32 25.5 M32 44.5 L32 47.5 M19.5 35 L22.5 35 M41.5 35 L44.5 35', INK, 2) +
      detail('M32 35 L25 30 M32 35 L39.5 29', INK, 2.8) +
      `<circle cx="32" cy="35" r="2.4" fill="${HEX.uiRed}" stroke="${INK}" stroke-width="1.2"/>` +
      detail('M20 28 C21.5 24 24.5 21.5 28 20.5', '#fff', 2.4),
  },
  // Rubber Boots: a red wellington with a chunky tread and a cream band.
  'mob-boots': {
    cat: 'mob',
    body: () =>
      sticker(
        [{ d: 'M21 10 L37 10 L37 34 C45 35 52 39 52 45 L52 50 L19 50 L19 40 C19 30 21 20 21 10 Z', w: 2 }],
        HEX.uiRed,
      ) +
      sticker([{ d: 'M17.5 50 L53.5 50 L53.5 55 L17.5 55 Z', w: 1.5 }], '#3a3f49', 2) +
      detail('M22 52.5 L25 52.5 M29 52.5 L32 52.5 M36 52.5 L39 52.5 M43 52.5 L46 52.5', '#8b8f97', 1.8) +
      detail('M20.6 15 L37 15', CREAM, 3) +
      detail('M25 20 C24.5 27 24 33 23.5 41', '#ff9a90', 2.6),
  },
  // Saw Guards: a steel saw blade with a red enamel ring, half under a hazard-striped guard.
  'relic-sawguard': {
    cat: 'relic',
    body: () => {
      let teeth = '';
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const p = (r: number, da: number): string =>
          `${(32 + Math.cos(a + da) * r).toFixed(2)} ${(35 + Math.sin(a + da) * r).toFixed(2)}`;
        teeth += `${i === 0 ? 'M' : 'L'}${p(17, 0)} L${p(23, 0.12)} L${p(17, 0.45)} `;
      }
      return (
        sticker([{ d: `${teeth}Z`, w: 1.2 }], STEEL) +
        `<circle cx="32" cy="35" r="11" fill="none" stroke="${HEX.uiRed}" stroke-width="3.2"/>` +
        sticker([{ d: circle(32, 35, 4), w: 1 }], STEEL_D, 1.4) +
        sticker([{ d: 'M7 33 C7 14 57 14 57 33 L50 33 C50 21 14 21 14 33 Z', w: 2 }], HAZARD) +
        detail('M13 25.5 L18 20 M21 21 L26 16.5 M30 19 L34.5 15.5 M38.5 19.5 L42 16 M46 22 L49.5 19.5', INK, 3) +
        detail('M40 45 C43 42 45 39 46 36', '#fff', 2.2)
      );
    },
  },
  // Crowbar: a red crowbar prying at a dented blue tin shield, a spark where it bites.
  'champ-crowbar': {
    cat: 'champion',
    body: () =>
      sticker([{ d: 'M30 30 L54 30 L54 54 L30 54 Z', w: 2 }], LITHO_BLUE) +
      detail('M30 39 C35 37 38 42 43 40 C47 38.5 50 41 54 40', '#6f97dc', 2.2) +
      `<circle cx="34" cy="34" r="1.5" fill="${BRASS}"/><circle cx="50" cy="34" r="1.5" fill="${BRASS}"/>` +
      `<circle cx="34" cy="50" r="1.5" fill="${BRASS}"/><circle cx="50" cy="50" r="1.5" fill="${BRASS}"/>` +
      sticker([{ d: 'M10 54 L36 22 C39 18 44 17 47 20 L44 23', w: 5.5, open: true }], HEX.uiRed) +
      detail('M13 49 L33 24.5', '#ff9a90', 1.6) +
      sticker([{ d: starPath(39, 30, 6, 2.6), w: 1 }], PALE_YELLOW, 1.6),
  },
  // Bank Shot: a brass ball bouncing off a steel lane wall, its zigzag path dashed behind it.
  'cannon-bank': {
    cat: 'cannon',
    body: () =>
      sticker([{ d: 'M50 8 L50 56', w: 6, open: true }], STEEL) +
      detail('M50 14 L50 18 M50 26 L50 30 M50 38 L50 42 M50 50 L50 54', STEEL_D, 6) +
      sticker([{ d: 'M14 52 L44 32 L18 14', w: 3.4, open: true }], CREAM, 1.6) +
      detail('M44 32 L41 29.5 M44 32 L41 34.5', YELLOW, 2.2) +
      sticker([{ d: 'M18 14 L26 13.5 M18 14 L21.5 21', w: 3.4, open: true }], CREAM, 1.6) +
      sticker([{ d: circle(14, 51, 6.5), w: 1 }], BRASS, 2) +
      detail(circle(12, 49, 1.8), '#fff3c4'),
  },
};

// The art an upgrade card draws: the World 3 or World 2 sticker when the upgrade has one.
export function upgradeIconOf(def: Pick<UpgradeDef, 'icon' | 'iconW2' | 'iconW3'>): UpgradeArt {
  return def.iconW3 ?? def.iconW2 ?? def.icon;
}

export function upgradeIconSvg(icon: UpgradeArt, size: number | string): string {
  const art = UPGRADE_ART[icon];
  return wrap(disc(art.cat) + art.body(), size, `hx-ico hx-ico-${icon}`);
}

export function upgradeCategoryOf(icon: UpgradeArt): UpgradeCategory {
  return UPGRADE_ART[icon].cat;
}

const NODE_ART: Record<RunNodeKind, () => string> = {
  // Two soldiers facing off, rifles crossed: ours (cream) and theirs (tan).
  battle: () => nested(soldierIcon(46, HEX.tanLight), -4, 9, true) + nested(soldierIcon(46, CREAM), -4, 9),
  // Skull (the badge supplies the red rim).
  elite: () =>
    sticker(
      [{ d: 'M14 30 C14 8 50 8 50 30 C50 37 47 40.5 44 42 L44 51 L20 51 L20 42 C17 40.5 14 37 14 30 Z', w: 2 }],
      CREAM,
    ) +
    `<circle cx="24.5" cy="30" r="5.6" fill="${INK}"/><circle cx="39.5" cy="30" r="5.6" fill="${INK}"/>` +
    detail('M32 36 L28.8 41.5 L35.2 41.5 Z', INK) +
    detail('M26.5 45 L26.5 51 M32 45 L32 51 M37.5 45 L37.5 51', INK, 2.2),
  // A gold coin in front of another.
  shop: () =>
    sticker([{ d: circle(41, 24, 13), w: 1 }], YELLOW, 2.4) +
    detail('M41 15 L41 33', GOLD_D, 3) +
    sticker([{ d: circle(27, 38, 16), w: 1 }], YELLOW, 2.4) +
    `<circle cx="27" cy="38" r="11.5" fill="none" stroke="${GOLD_D}" stroke-width="2.6"/>` +
    detail(starPath(27, 38.6, 7.5, 3.3), GOLD_D),
  // Campfire: crossed logs under a two-tone flame.
  rest: () =>
    sticker([{ d: 'M13 51 L51 41', w: 8, open: true }], WOOD) +
    sticker([{ d: 'M13 41 L51 51', w: 8, open: true }], WOOD_L) +
    sticker(
      [
        {
          d: 'M32 7 C40 17 48 23 46 34 C45 42 38 46 32 46 C26 46 19 42 18 34 C17 25 26 21 32 7 Z',
          w: 1.5,
        },
      ],
      '#ff8a2a',
    ) +
    detail('M32 21 C36 28 40 31 39.5 37 C39 42 35.5 44 32 44 C28.5 44 25 42 24.5 37 C24 31 29 28 32 21 Z', YELLOW),
  // The Tin General's crown.
  boss: () =>
    sticker([{ d: 'M13 46 L10 20 L22 32 L32 13 L42 32 L54 20 L51 46 Z', w: 2 }], YELLOW) +
    sticker([{ d: 'M12 46 L52 46 L52 53 L12 53 Z', w: 2 }], GOLD_D) +
    sticker([{ d: circle(10, 19, 3.6), w: 1 }], PALE_YELLOW, 1.6) +
    sticker([{ d: circle(32, 12, 3.6), w: 1 }], PALE_YELLOW, 1.6) +
    sticker([{ d: circle(54, 19, 3.6), w: 1 }], PALE_YELLOW, 1.6) +
    sticker([{ d: circle(32, 38, 4), w: 1 }], HEX.uiRed, 1.6) +
    `<circle cx="20" cy="49.5" r="2.4" fill="${HEX.uiBlue}"/><circle cx="44" cy="49.5" r="2.4" fill="${HEX.uiBlue}"/>`,
};

export function nodeIconSvg(kind: RunNodeKind, size: number | string): string {
  return wrap(NODE_ART[kind](), size, `hx-ico hx-node-ico-${kind}`);
}

// Small chips: a red heart (run HP) and a gold coin (gold).
export function heartSvg(size: number | string): string {
  return wrap(
    sticker(
      [{ d: 'M32 54 C11 41 6 29 10 20 C14 11 27 10 32 21 C37 10 50 11 54 20 C58 29 53 41 32 54 Z', w: 2 }],
      HEX.uiRed,
      3,
    ) + `<ellipse cx="20" cy="22" rx="5" ry="3.4" fill="#fff" opacity=".55" transform="rotate(-35 20 22)"/>`,
    size,
    'hx-ico',
  );
}

export function coinSvg(size: number | string): string {
  return wrap(
    sticker([{ d: circle(32, 32, 22), w: 1 }], YELLOW, 3) +
      `<circle cx="32" cy="32" r="15.5" fill="none" stroke="${GOLD_D}" stroke-width="3.5"/>` +
      detail(starPath(32, 33, 10, 4.4), GOLD_D),
    size,
    'hx-ico',
  );
}

// A three-dot overflow glyph for the map's menu button.
export function moreSvg(size: number | string): string {
  const dot = (x: number): string =>
    `<circle cx="${x}" cy="32" r="6.5" fill="${CREAM}" stroke="${INK}" stroke-width="3"/>`;
  return wrap(dot(14) + dot(32) + dot(50), size, 'hx-ico');
}

// Left arrow for Back buttons.
export function backSvg(size: number | string): string {
  return wrap(sticker([{ d: 'M40 14 L22 32 L40 50', w: 8, open: true }], CREAM, 2.6), size, 'hx-ico');
}
