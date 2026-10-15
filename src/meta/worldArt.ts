// Inline SVG stickers for the world map's World 2 art: the snowman and wind-up penguin
// of the freezer faction (title card), in the same
// two-pass die-cut style as src/ui/icons.ts (a wide ink pass, then the colour). Flat
// layers, no gradients, so several copies on one page never clash. All decorative.
import { HEX } from '../render/look/palette.ts';

const INK = HEX.uiInk;
const SNOW = '#f4f9fc';
const SNOW_SHADE = '#c9e2f0';
const CARROT = HEX.toyOrange;

interface Part {
  d: string;
  w: number;
  open?: boolean;
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

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

function wrap(body: string, size: number | string): string {
  const s = typeof size === 'number' ? `${size}` : size;
  return `<svg class="tb-ico" viewBox="0 0 64 64" width="${s}" height="${s}" aria-hidden="true" focusable="false">${body}</svg>`;
}

// Snowman: two snowballs, a stovepipe hat, coal eyes and buttons, a carrot nose, a red scarf.
export function snowmanIcon(size: number | string): string {
  return wrap(
    sticker([{ d: circle(32, 44, 14), w: 1 }], SNOW) +
      `<path d="M21 51 C26 56 38 56 44 50" fill="none" stroke="${SNOW_SHADE}" stroke-width="3.2" stroke-linecap="round"/>` +
      sticker([{ d: circle(32, 23.5, 10), w: 1 }], SNOW) +
      sticker(
        [{ d: 'M22 30 C27 34 37 34 42 30 L43 35 L39 35 L40 42 L35.5 41 L35 35 C31 36 26 35 22 33 Z', w: 1.5 }],
        HEX.uiRed,
        2,
      ) +
      sticker(
        [
          { d: 'M19 15 L45 15', w: 3.6, open: true },
          { d: 'M24 14 L25 3.5 L39 3.5 L40 14 Z', w: 1.5 },
        ],
        '#3a3f49',
        2,
      ) +
      `<path d="M24.5 11 L39.5 11" stroke="${HEX.uiRed}" stroke-width="2.4"/>` +
      `<circle cx="28" cy="21.5" r="1.9" fill="${INK}"/><circle cx="36" cy="21.5" r="1.9" fill="${INK}"/>` +
      sticker([{ d: 'M32 24.5 L41.5 27 L32 27.6 Z', w: 0.8 }], CARROT, 1.4) +
      `<circle cx="32" cy="41" r="1.8" fill="${INK}"/><circle cx="32" cy="48" r="1.8" fill="${INK}"/>` +
      `<ellipse cx="25" cy="38" rx="4" ry="2.4" fill="#fff" opacity=".85" transform="rotate(-30 25 38)"/>`,
    size,
  );
}

// Wind-up penguin: a navy body with a white belly, orange beak and feet, a brass key.
export function penguinIcon(size: number | string): string {
  return wrap(
    sticker(
      [
        { d: 'M41 30 L50 26 L50.5 33 L42 34.5 Z', w: 1.2 },
        { d: 'M50 22 C55 21 57 25 54 27.5 M50 37 C55 38 57 34 54 31.5', w: 3, open: true },
      ],
      HEX.brass,
      1.8,
    ) +
      sticker(
        [{ d: 'M32 6 C44 6 46 22 46 36 C46 50 40 56 32 56 C24 56 18 50 18 36 C18 22 20 6 32 6 Z', w: 1.5 }],
        '#25324a',
      ) +
      sticker(
        [{ d: 'M32 20 C39 20 41 30 41 39 C41 48 37 52 32 52 C27 52 23 48 23 39 C23 30 25 20 32 20 Z', w: 1 }],
        SNOW,
        1.4,
      ) +
      sticker([{ d: 'M18 30 C11 36 11 44 15 47 C17 42 19 38 21 35 Z', w: 1 }], '#25324a', 2) +
      `<circle cx="27.5" cy="16" r="2.4" fill="#fff"/><circle cx="36.5" cy="16" r="2.4" fill="#fff"/>` +
      `<circle cx="28" cy="16.3" r="1.2" fill="${INK}"/><circle cx="36" cy="16.3" r="1.2" fill="${INK}"/>` +
      sticker([{ d: 'M27.5 20 L36.5 20 L32 25 Z', w: 1 }], CARROT, 1.6) +
      sticker(
        [
          { d: 'M22 56 L30 56', w: 4, open: true },
          { d: 'M34 56 L42 56', w: 4, open: true },
        ],
        CARROT,
        1.8,
      ) +
      `<ellipse cx="24" cy="15" rx="3.6" ry="2.2" fill="#fff" opacity=".35" transform="rotate(-35 24 15)"/>`,
    size,
  );
}
