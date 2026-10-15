// Inline SVG stickers for the 19 loadout items (cannons, mobs, champions, ultimates; the
// Snowball Launcher, the Giant and Blizzard came with World 2, the Gear Gun, the Archer
// and the Wind-up Robot with World 3),
// in the same two-pass sticker style as src/ui/icons.ts and src/ui/expedition/icons.ts:
// a wide ink pass for the die-cut outline, then the fill colour, on a plastic disc tinted
// by the item's slot (cannon tin grey, mob army green, champion orange, ultimate purple).
// Flat layers instead of gradients, so the same icon can appear many times on a page
// without SVG id collisions. Every icon is decorative (aria-hidden).
import { HEX } from '../render/look/palette.ts';
import { championIcon, soldierIcon } from '../ui/icons.ts';
import type { ItemSlot } from './types.ts';

const INK = HEX.uiInk;
const CREAM = HEX.uiCream;
const YELLOW = HEX.uiYellow;
const WOOD = '#b0743f';
const BRASS = HEX.brass;
const TIN = HEX.tin;
const RED = HEX.toyRed;
const RUBBER = '#4a4d55';
const SNOW = '#f4f9fc';
const SNOW_SHADE = '#b9dcef';
const STEEL = '#c9ced4';
const AMBER = '#ffb347';

export const SLOT_COLORS: Record<ItemSlot, { c1: string; c2: string; c3: string }> = {
  cannon: { c1: '#c3cbd2', c2: '#7b858e', c3: '#4a535b' },
  mob: { c1: HEX.greenLight, c2: HEX.green, c3: HEX.greenDark },
  champion: { c1: '#ffc27a', c2: '#f08a24', c3: '#b55a0c' },
  ultimate: { c1: '#c39af0', c2: '#8a4fd0', c3: '#5a2c96' },
};

interface Part {
  d: string;
  w: number; // stroke width of the colour pass
  open?: boolean; // a line (stroked only), not a filled shape
}

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

function detail(d: string, color: string, w = 0, opacity = 1): string {
  const o = opacity < 1 ? ` opacity="${opacity}"` : '';
  return w > 0
    ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${o}/>`
    : `<path d="${d}" fill="${color}"${o}/>`;
}

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

function starPath(cx: number, cy: number, ro: number, ri: number, n = 5): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

// One of the shared 64-unit figures, placed at x, y with uniform scale s.
function nested(svgMarkup: string, x: number, y: number, extra = ''): string {
  // Let the figure's ink outline spill past its own box instead of being clipped.
  return `<g transform="translate(${x} ${y})${extra}">${svgMarkup.replace('<svg ', '<svg overflow="visible" ')}</g>`;
}

function disc(slot: ItemSlot): string {
  const c = SLOT_COLORS[slot];
  return (
    `<circle cx="32" cy="33.5" r="29.5" fill="${INK}"/><circle cx="32" cy="32" r="29.5" fill="${INK}"/>` +
    `<circle cx="32" cy="32" r="26.5" fill="${c.c3}"/><circle cx="32" cy="30.5" r="25" fill="${c.c2}"/>` +
    `<circle cx="28" cy="25" r="16" fill="${c.c1}" opacity=".45"/>` +
    `<ellipse cx="23" cy="16.5" rx="10" ry="5" fill="#fff" opacity=".4" transform="rotate(-20 23 16.5)"/>`
  );
}

// A packed snowball: white with a cool shaded underside and a glint.
function snowball(cx: number, cy: number, r: number): string {
  return (
    sticker([{ d: circle(cx, cy, r), w: 1 }], SNOW, 2.2) +
    detail(
      `M${cx - r * 0.8} ${cy + r * 0.25} C${cx - r * 0.4} ${cy + r * 0.85} ${cx + r * 0.5} ${cy + r * 0.85} ${cx + r * 0.85} ${cy + r * 0.2}`,
      SNOW_SHADE,
      Math.max(1.6, r * 0.32),
    ) +
    detail(circle(cx - r * 0.35, cy - r * 0.35, r * 0.2), '#fff')
  );
}

// A six-armed snowflake.
function flake(cx: number, cy: number, r: number, color: string): string {
  let d = '';
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 2;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    d += `M${(cx - dx).toFixed(2)} ${(cy - dy).toFixed(2)} L${(cx + dx).toFixed(2)} ${(cy + dy).toFixed(2)} `;
  }
  return sticker([{ d, w: Math.max(1.6, r * 0.38), open: true }], color, 1.6);
}

// A flat brass gear: `teeth` square teeth around a ring, a dark hub.
function gear(cx: number, cy: number, ro: number, ri: number, teeth: number, color: string = BRASS): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    for (const [da, r] of [
      [-0.3, ri],
      [-0.17, ro],
      [0.17, ro],
      [0.3, ri],
    ] as const) {
      const t = i * step + da * step * 1.6;
      pts.push(`${(cx + Math.cos(t) * r).toFixed(2)} ${(cy + Math.sin(t) * r).toFixed(2)}`);
    }
  }
  return sticker([{ d: `M${pts.join(' L')} Z`, w: 1 }], color, 2) + detail(circle(cx, cy, ri * 0.38), INK, 0, 0.7);
}

// A spoked toy wheel (wood rim, brass hub).
function wheel(cx: number, cy: number, r: number): string {
  return (
    sticker([{ d: circle(cx, cy, r), w: 1.5 }], WOOD, 2.2) +
    detail(
      `M${cx - r * 0.7} ${cy} L${cx + r * 0.7} ${cy} M${cx} ${cy - r * 0.7} L${cx} ${cy + r * 0.7}`,
      INK,
      1.6,
      0.55,
    ) +
    detail(circle(cx, cy, r * 0.32), BRASS)
  );
}

const ART: Record<string, { slot: ItemSlot; body: () => string }> = {
  // ----- Cannons -----
  popgun: {
    slot: 'cannon',
    body: () =>
      sticker([{ d: 'M16 46 L30 40', w: 6, open: true }], HEX.greenDark) +
      sticker([{ d: 'M22 40 L44 29', w: 11, open: true }], HEX.green) +
      sticker([{ d: 'M43 29.5 L46 28', w: 14, open: true }], BRASS) +
      sticker([{ d: 'M50 22 L54 20 L56.5 25 L52.5 27 Z', w: 2 }], '#d9a46a', 2) +
      detail('M53 14 L55 10 M58 17 L62 15 M47 15 L46 11', CREAM, 2.4) +
      detail('M27 36.5 L40 30', '#fff', 2.2, 0.35) +
      wheel(26, 44, 8),
  },
  repeater: {
    slot: 'cannon',
    body: () =>
      sticker([{ d: 'M14 47 L28 41', w: 6, open: true }], HEX.greenDark) +
      sticker(
        [
          { d: 'M21 34 L49 22', w: 5, open: true },
          { d: 'M22 40 L50 28', w: 5, open: true },
          { d: 'M23 46 L51 34', w: 5, open: true },
        ],
        HEX.green,
        2,
      ) +
      sticker([{ d: 'M22 30 L30 26.5 L33.5 46 L25.5 49.5 Z', w: 2.5 }], BRASS, 2.2) +
      sticker([{ d: circle(25, 25, 5), w: 1.5 }], HEX.greenDark, 2) +
      detail('M54 22 L59 20 M55 28 L60 26.5 M56 34 L61 33', CREAM, 2.2) +
      wheel(27, 47, 7.5),
  },
  blunderbuss: {
    slot: 'cannon',
    body: () =>
      sticker([{ d: 'M14 47 L28 41', w: 6, open: true }], HEX.greenDark) +
      sticker([{ d: 'M20 43 L20 35 L40 27 L48 15 L57 33 L44 36 Z', w: 2.5 }], HEX.green) +
      sticker([{ d: 'M47.5 16 L56.5 33', w: 4, open: true }], BRASS, 2) +
      detail('M24 37 L39 31', '#fff', 2.4, 0.35) +
      detail(`${circle(59, 15, 2)} ${circle(61, 23, 1.6)} ${circle(55, 9, 1.6)}`, CREAM) +
      wheel(25, 45, 8.5),
  },
  // A stubby green mortar lobbing snowballs that grow as they roll.
  'snowball-launcher': {
    slot: 'cannon',
    body: () =>
      sticker([{ d: 'M14 48 L28 42', w: 6, open: true }], HEX.greenDark) +
      sticker([{ d: 'M19 44 L34 30', w: 13, open: true }], HEX.green) +
      sticker([{ d: 'M33.5 30.5 L36 28', w: 16, open: true }], BRASS) +
      detail('M22 39 L31 31', '#fff', 2.2, 0.35) +
      snowball(42, 19, 5) +
      snowball(51, 31, 7) +
      detail('M44 44 C47 46 51 46 54 44', SNOW, 2.2, 0.85) +
      wheel(24, 46, 8),
  },
  // The Gear Gun: a green clockwork gun with a big brass gear on its breech, toothed brass
  // collars on the barrel, and a shot ricocheting off a wall in a zigzag.
  'gear-gun': {
    slot: 'cannon',
    body: () =>
      sticker([{ d: 'M14 47 L28 41', w: 6, open: true }], HEX.greenDark) +
      sticker([{ d: 'M20 40 L44 27', w: 10, open: true }], HEX.green) +
      sticker(
        [
          { d: 'M30.5 34.5 L33 39', w: 3.6, open: true },
          { d: 'M37 31 L39.5 35.5', w: 3.6, open: true },
          { d: 'M43.5 27.5 L46 32', w: 4.6, open: true },
        ],
        BRASS,
        1.8,
      ) +
      detail('M24 35.5 L41 26.5', '#fff', 2.2, 0.35) +
      sticker([{ d: 'M50 22 L56 10 L60 19', w: 2.6, open: true }], CREAM, 1.6) +
      detail(circle(50.5, 22, 2.4), YELLOW) +
      gear(17.5, 33.5, 8.5, 6, 8) +
      wheel(29, 47, 7.5),
  },
  // ----- Mobs -----
  // Archer: a cream army man drawing a big wooden longbow, an arrow nocked, a quiver on his back.
  archer: {
    slot: 'mob',
    body: () =>
      sticker([{ d: 'M20 20 L15 34', w: 5, open: true }], WOOD, 2) +
      detail('M19 18 L21.5 14 M16.5 18 L17 13.5', CREAM, 2) +
      sticker(
        [
          { d: 'M22.5 18 C22 8 39 8 38.5 18 Z', w: 2 },
          { d: 'M19.5 18 L41.5 18', w: 3.2, open: true },
          { d: 'M30.5 22.5 L30.5 23.5', w: 8.5, open: true },
          { d: 'M30.5 28 L30.5 40', w: 11.5, open: true },
          { d: 'M28.5 41 L24.5 55 L19.5 55.5', w: 6.5, open: true },
          { d: 'M32.5 41 L37 55 L42 55', w: 6.5, open: true },
          { d: 'M32 29 L47 29.5', w: 4.6, open: true },
          { d: 'M28 30 L36 33.5 L38.5 30', w: 4.6, open: true },
        ],
        CREAM,
      ) +
      sticker([{ d: 'M45 8 C55 16 55 42 45 51', w: 3.4, open: true }], WOOD, 2) +
      detail('M45 8 L38 30 L45 51', INK, 1.2) +
      sticker([{ d: 'M38 30 L58 30', w: 2, open: true }], STEEL, 1.4) +
      detail('M58.5 30 L54 26.5 L54 33.5 Z', STEEL) +
      detail('M38 30 L35 27 M38 30 L35 33', RED, 2),
  },
  rifleman: {
    slot: 'mob',
    body: () => nested(soldierIcon(50, CREAM), 7, 6),
  },
  knight: {
    slot: 'mob',
    body: () =>
      sticker([{ d: 'M33 15 C37 6 48 6 51 12 C46 11 41 13 38 18', w: 3 }], RED, 2.2) +
      sticker([{ d: 'M17 46 L17 27 C17 13 41 13 41 27 L41 46 C35 49 23 49 17 46 Z', w: 2 }], TIN) +
      detail('M20 30 L38 30', INK, 3.2) +
      detail('M29 34 L29 44 M24 37 L24 41 M34 37 L34 41', INK, 1.6, 0.6) +
      detail('M21 22 C22 17.5 26 16 29 16', '#fff', 2.4, 0.6) +
      sticker([{ d: 'M34 33 L54 33 L54 42 C54 49.5 47 54.5 44 56 C41 54.5 34 49.5 34 42 Z', w: 2 }], RED) +
      detail('M44 36 L44 52 M37.5 42 L50.5 42', CREAM, 3.6),
  },
  sprinter: {
    slot: 'mob',
    body: () =>
      sticker(
        [
          { d: 'M8 27 L19 27', w: 3.2, open: true },
          { d: 'M5 35 L17 35', w: 3.2, open: true },
          { d: 'M9 43 L19 43', w: 3.2, open: true },
        ],
        CREAM,
        1.8,
      ) + nested(soldierIcon(46, CREAM), 14, 8, ' skewX(-12)'),
  },
  bomber: {
    slot: 'mob',
    body: () =>
      sticker([{ d: 'M40 21 C44 15 48 15 50 11', w: 3, open: true }], '#c9b48c', 2) +
      sticker([{ d: starPath(51.5, 10, 7, 3, 6), w: 1 }], YELLOW, 1.8) +
      detail(starPath(51.5, 10, 3.2, 1.4, 6), '#fff6c8') +
      sticker([{ d: 'M35 18 L44 22 L41 28 L32 24 Z', w: 2 }], TIN, 2.2) +
      sticker([{ d: circle(29, 38, 15), w: 1 }], '#3b4150') +
      detail('M19 33 C20 27 25 24 30 24', '#fff', 3, 0.45) +
      detail(circle(23, 31, 1.8), '#fff', 0, 0.7) +
      detail('M16 42 C21 49 33 52 41 47', CREAM, 3.4, 0.9),
  },
  // The Giant: a big soldier striding with two little riders on his shoulders.
  giant: {
    slot: 'mob',
    body: () =>
      nested(soldierIcon(48, CREAM), 8, 17) +
      nested(soldierIcon(22, CREAM), 10, 4) +
      nested(soldierIcon(22, CREAM), 27, 4, ' scale(-1 1) translate(-22 0)'),
  },
  // ----- Champions -----
  sarge: {
    slot: 'champion',
    body: () =>
      nested(championIcon(50, CREAM), 4, 12) +
      sticker(
        [
          { d: 'M41 9 L48 14 L55 9', w: 3.4, open: true },
          { d: 'M41 16 L48 21 L55 16', w: 3.4, open: true },
        ],
        YELLOW,
        2,
      ),
  },
  tank: {
    slot: 'champion',
    body: () =>
      sticker([{ d: 'M36 26 L56 21.5', w: 4.5, open: true }], HEX.greenDark, 2.2) +
      sticker([{ d: 'M22 32 C22 21 40 20 41 32 Z', w: 2 }], HEX.green) +
      sticker([{ d: 'M13 39 L18 32 L48 32 L53 39 Z', w: 2 }], HEX.green) +
      sticker([{ d: 'M13 46 L51 46', w: 11, open: true }], RUBBER) +
      detail(
        `${circle(18, 46, 3)} ${circle(26, 46, 3)} ${circle(34, 46, 3)} ${circle(42, 46, 3)} ${circle(50, 46, 2.6)}`,
        '#8b8f97',
      ) +
      detail('M27 26 C29 23.5 33 23 35 23.5', '#fff', 2, 0.45) +
      detail(starPath(32, 36, 3.2, 1.4), CREAM),
  },
  drummer: {
    slot: 'champion',
    body: () =>
      sticker(
        [
          { d: 'M13 13 L30 28', w: 3.4, open: true },
          { d: 'M52 12 L36 28', w: 3.4, open: true },
        ],
        WOOD,
        2,
      ) +
      detail(`${circle(13, 13, 3.6)} ${circle(52, 12, 3.6)}`, CREAM) +
      sticker([{ d: 'M14 32 L14 49 C14 55 50 55 50 49 L50 32 Z', w: 2 }], RED) +
      detail('M14 35 L20 50 L26 35 L32 50 L38 35 L44 50 L50 35', CREAM, 2.4) +
      detail('M14 49 C14 55 50 55 50 49', BRASS, 3) +
      sticker([{ d: 'M14 32 C14 26 50 26 50 32 C50 38 14 38 14 32 Z', w: 2 }], CREAM, 2.2) +
      detail('M20 31 C24 29 30 28.5 34 28.8', '#fff', 2, 0.8),
  },
  // The Wind-up Robot: a big army-green tin robot, a brass gear in its barrel chest, a dark
  // visor with amber lamp eyes, an antenna, mitt hands and a brass key over its shoulder.
  windup: {
    slot: 'champion',
    body: () =>
      sticker(
        [
          { d: 'M42 24 L49 17', w: 2.8, open: true },
          { d: 'M47 13 C51 9 56 12 53 16 C57 18 54 23 49 20', w: 2.8, open: true },
        ],
        BRASS,
        1.8,
      ) +
      sticker(
        [
          { d: 'M18 31 L11 42', w: 5.5, open: true },
          { d: 'M46 31 L53 42', w: 5.5, open: true },
          { d: 'M26 48 L26 54', w: 5.5, open: true },
          { d: 'M38 48 L38 54', w: 5.5, open: true },
          { d: 'M32 12 L32 6', w: 2.4, open: true },
        ],
        STEEL,
        2,
      ) +
      sticker([{ d: circle(10, 44.5, 3.8), w: 1 }], HEX.green, 1.8) +
      sticker([{ d: circle(54, 44.5, 3.8), w: 1 }], HEX.green, 1.8) +
      sticker(
        [
          { d: 'M20 56.5 L30 56.5', w: 4, open: true },
          { d: 'M34 56.5 L44 56.5', w: 4, open: true },
        ],
        RUBBER,
        1.8,
      ) +
      sticker([{ d: 'M18 28 L46 28 L46 44 C46 50 18 50 18 44 Z', w: 2.5 }], HEX.green) +
      gear(32, 38.5, 7.5, 5.5, 9) +
      `<circle cx="21.5" cy="31" r="1.1" fill="${BRASS}"/><circle cx="42.5" cy="31" r="1.1" fill="${BRASS}"/>` +
      sticker([{ d: 'M21 11 L43 11 L43 25 L21 25 Z', w: 3 }], HEX.green) +
      detail('M23.5 15 L40.5 15 L40.5 20.5 L23.5 20.5 Z', '#25292f') +
      detail(`${circle(27.5, 17.8, 2)} ${circle(36.5, 17.8, 2)}`, AMBER) +
      sticker([{ d: circle(32, 5, 2.5), w: 1 }], RED, 1.6) +
      detail('M21 31 C21 36 21.5 40 23 43', '#fff', 2, 0.35),
  },
  // ----- Ultimates -----
  barrage: {
    slot: 'ultimate',
    body: () => {
      const shell = (x: number, y: number): string =>
        sticker([{ d: `M${x} ${y} L${x + 7} ${y + 12}`, w: 7, open: true }], TIN, 2) +
        detail(`M${x + 4.6} ${y + 8} L${x + 7} ${y + 12}`, RED, 7) +
        detail(`M${x - 4} ${y - 3} L${x - 1} ${y + 2} M${x + 2} ${y - 5} L${x + 3} ${y}`, CREAM, 2);
      return (
        sticker([{ d: starPath(33, 48, 13, 6, 7), w: 1.5 }], YELLOW, 2) +
        detail(starPath(33, 48, 6, 3, 7), '#fff2b8') +
        shell(14, 18) +
        shell(29, 10) +
        shell(44, 20)
      );
    },
  },
  paratroopers: {
    slot: 'ultimate',
    body: () =>
      detail('M12 27 L29 45 M52 27 L35 45 M32 27 L32 42', INK, 1.8) +
      sticker([{ d: 'M11 27 C11 6 53 6 53 27 C47 23 39 23 32 27 C25 23 17 23 11 27 Z', w: 2 }], CREAM) +
      detail('M21.5 23.5 C22 15 26 10 32 8.5 C29 13 28 18 28 24.5 Z', RED, 0, 0.9) +
      detail('M42.5 23.5 C42 15 38 10 32 8.5 C35 13 36 18 36 24.5 Z', RED, 0, 0.9) +
      nested(soldierIcon(26, HEX.greenLight), 19, 36),
  },
  marble: {
    slot: 'ultimate',
    body: () =>
      sticker(
        [
          { d: 'M5 26 L13 26', w: 3, open: true },
          { d: 'M4 35 L11 35', w: 3, open: true },
          { d: 'M6 44 L13 44', w: 3, open: true },
        ],
        CREAM,
        1.8,
      ) +
      sticker([{ d: circle(36, 35, 19), w: 1 }], '#7fc3ea') +
      detail('M24 41 C27 30 37 28 44 31 C49 34 46 42 40 41 C35 40 37 34 41 35', HEX.toyOrange, 4.2) +
      detail('M27 46 C33 47 44 46 49 38', '#3f7fc0', 3, 0.7) +
      detail('M24 28 C26 22 32 19 37 19', '#fff', 3.4, 0.75) +
      detail(circle(28, 25, 2), '#fff'),
  },
  // Blizzard: a puffy snow cloud dropping snowflakes over an iced-up enemy.
  blizzard: {
    slot: 'ultimate',
    body: () =>
      sticker(
        [
          {
            d: 'M13 30 C8 30 7 22 13 21 C13 14 22 12 25 17 C28 9 41 9 43 17 C50 14 57 20 53 27 C56 31 52 34 48 33 L16 33 C14.5 33 13.5 31.5 13 30 Z',
            w: 2,
          },
        ],
        SNOW,
      ) +
      detail('M18 29 C26 31 40 31 49 29', SNOW_SHADE, 2.6) +
      detail('M20 19 C22 16 26 15 28 16.5', '#fff', 2.4) +
      flake(20, 43, 5, SNOW) +
      flake(34, 50, 6, SNOW) +
      flake(48, 42, 5, SNOW) +
      detail('M9 41 C12 39 14 41 12 44 M53 51 C56 49 58 51 56 54', '#d9f0fb', 2, 0.8),
  },
};

export const ITEM_ICON_IDS: readonly string[] = Object.keys(ART);

// Sticker for an item id at `size` px. Unknown ids get a plain disc with a '?'.
export function itemIcon(id: string, size: number): string {
  const art = ART[id];
  const body = art
    ? disc(art.slot) + art.body()
    : disc('cannon') +
      `<text x="32" y="43" text-anchor="middle" font-size="30" font-weight="700" fill="${CREAM}">?</text>`;
  return `<svg class="tb-ico hr-item-ico" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function itemSlotOf(id: string): ItemSlot | null {
  return ART[id]?.slot ?? null;
}
