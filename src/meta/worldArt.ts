// Inline SVG stickers for the world map's World 2 and 3 art: the snowman and wind-up
// penguin of the freezer faction (title card); the workshop's wind-up robot, the
// Jack-in-the-Box (title card, boss node) and a brass gear (world tab, level badges). In
// the same two-pass die-cut style as src/ui/icons.ts (a wide ink pass, then the colour).
// Flat layers, no gradients, so several copies on one page never clash. All decorative.
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

// ---------- World 3: the Clockwork Workshop (colours from docs/art-direction.md section 9) ----------
const TIN_PLATE = '#c9ced4';
const TIN_SHADE = '#8e979f';
const LITHO_RED = '#b5372f';
const LITHO_BLUE = '#2e5aa8';
const LITHO_CREAM = '#efe3c6';
const LITHO_TEAL = '#2f7f86';
const NAVY = '#22355e';

// A toothed gear outline: `teeth` flat-topped teeth between radii ri and ro.
export function gearPath(cx: number, cy: number, ro: number, ri: number, teeth: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    for (const [da, r] of [
      [-0.3, ri],
      [-0.17, ro],
      [0.17, ro],
      [0.3, ri],
    ] as const) {
      const t = a + da * step * 1.6;
      pts.push(`${(cx + Math.cos(t) * r).toFixed(2)} ${(cy + Math.sin(t) * r).toFixed(2)}`);
    }
  }
  return `M${pts.join(' L')} Z`;
}

// Brass gear: ten chunky teeth, a sunk ring, a tin hub with an axle hole, a glint.
export function gearIcon(size: number | string, color: string = HEX.brass): string {
  return wrap(
    sticker([{ d: gearPath(32, 32, 27, 20.5, 10), w: 1.5 }], color, 2.6) +
      `<circle cx="32" cy="32" r="14.5" fill="none" stroke="${INK}" stroke-width="2" opacity=".35"/>` +
      sticker([{ d: circle(32, 32, 8.5), w: 1 }], TIN_PLATE, 2) +
      `<circle cx="32" cy="32" r="3.4" fill="${INK}"/>` +
      `<path d="M17 22 C19.5 17.5 23.5 14.5 28 13.5" fill="none" stroke="#fff3c4" stroke-width="2.6" stroke-linecap="round" opacity=".85"/>`,
    size,
  );
}

// Wind-up robot (the workshop's foot soldier): a red tin body with a tan chest plate and
// a dial, a bare-tin box head with round cream eyes and a grille mouth, an antenna with a
// red bead, pincer arms, navy feet and a brass key in its side.
export function robotIcon(size: number | string): string {
  return wrap(
    sticker(
      [
        { d: 'M44 37 L52 37', w: 3, open: true },
        { d: 'M52 31 C57.5 30 59.5 34.5 55.5 37 M52 43 C57.5 44 59.5 39.5 55.5 37', w: 3, open: true },
      ],
      HEX.brass,
      1.8,
    ) +
      sticker(
        [
          { d: 'M18 34 L10.5 43', w: 5, open: true },
          { d: 'M46 34 L53.5 43', w: 5, open: true },
          { d: 'M24.5 49 L24.5 55', w: 5.5, open: true },
          { d: 'M39.5 49 L39.5 55', w: 5.5, open: true },
          { d: 'M32 13 L32 6.5', w: 2.4, open: true },
          { d: 'M17.5 17.5 L21 17.5 L21 23.5 L17.5 23.5 Z', w: 1.2 },
          { d: 'M46.5 17.5 L43 17.5 L43 23.5 L46.5 23.5 Z', w: 1.2 },
        ],
        TIN_PLATE,
        2,
      ) +
      sticker(
        [
          { d: 'M7.5 45.5 L10.5 43 L13 46.5', w: 2.4, open: true },
          { d: 'M50.5 46.5 L53.5 43 L56 45.5', w: 2.4, open: true },
        ],
        TIN_SHADE,
        1.6,
      ) +
      sticker([{ d: 'M19 31 L45 31 L45 50 L19 50 Z', w: 2.5 }], LITHO_RED) +
      sticker([{ d: 'M24.5 35 L39.5 35 L39.5 46 L24.5 46 Z', w: 1.5 }], HEX.tan, 1.6) +
      sticker([{ d: circle(32, 40.5, 3.6), w: 1 }], LITHO_CREAM, 1.4) +
      `<path d="M32 40.5 L34.2 38.4" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>` +
      `<circle cx="21.5" cy="33.5" r="1.1" fill="${HEX.brass}"/><circle cx="42.5" cy="33.5" r="1.1" fill="${HEX.brass}"/>` +
      `<circle cx="21.5" cy="47.5" r="1.1" fill="${HEX.brass}"/><circle cx="42.5" cy="47.5" r="1.1" fill="${HEX.brass}"/>` +
      sticker([{ d: 'M21.5 12.5 L42.5 12.5 L42.5 28.5 L21.5 28.5 Z', w: 3 }], TIN_PLATE) +
      `<circle cx="27" cy="19" r="3.9" fill="${LITHO_CREAM}" stroke="${INK}" stroke-width="1.6"/><circle cx="37" cy="19" r="3.9" fill="${LITHO_CREAM}" stroke="${INK}" stroke-width="1.6"/>` +
      `<circle cx="27.6" cy="19.4" r="1.6" fill="${INK}"/><circle cx="36.4" cy="19.4" r="1.6" fill="${INK}"/>` +
      `<rect x="26" y="23.6" width="12" height="3" rx="1" fill="#3a3f49"/>` +
      `<path d="M29 23.6 L29 26.6 M32 23.6 L32 26.6 M35 23.6 L35 26.6" stroke="${TIN_PLATE}" stroke-width="1"/>` +
      sticker([{ d: circle(32, 5.2, 2.6), w: 1 }], LITHO_RED, 1.6) +
      sticker(
        [
          { d: 'M20 56.5 L29 56.5', w: 4, open: true },
          { d: 'M35 56.5 L44 56.5', w: 4, open: true },
        ],
        NAVY,
        1.8,
      ) +
      `<path d="M24 15 L24 20" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>`,
    size,
  );
}

// The jester of the Jack-in-the-Box: the cream ruff, the grinning face with a red nose,
// and a three-pointed cap (red, yellow, teal) with brass bells, head centred at (32, 19).
function jesterBody(): string {
  const bell = (x: number, y: number): string => sticker([{ d: circle(x, y, 2.4), w: 1 }], HEX.brass, 1.4);
  return (
    sticker(
      [
        {
          d: 'M20 27.5 C22 31.5 25 31.5 26 28.5 C27.5 31.5 30.5 31.5 32 28.5 C33.5 31.5 36.5 31.5 38 28.5 C39 31.5 42 31.5 44 27.5 Z',
          w: 1.5,
        },
      ],
      LITHO_CREAM,
      1.8,
    ) +
    sticker([{ d: 'M23.5 15 C20.5 12.5 17.5 11.5 13.5 11.5 C18 8 23.5 8.5 27.5 11 Z', w: 1.5 }], LITHO_RED, 2) +
    sticker([{ d: 'M40.5 15 C43.5 12.5 46.5 11.5 50.5 11.5 C46 8 40.5 8.5 36.5 11 Z', w: 1.5 }], LITHO_TEAL, 2) +
    sticker([{ d: 'M25 13 C27 8.5 29.5 5 32 2.5 C34.5 5 37 8.5 39 13 Z', w: 1.5 }], HEX.uiYellow, 2) +
    bell(13.5, 11.5) +
    bell(50.5, 11.5) +
    bell(32, 2.8) +
    sticker([{ d: circle(32, 19, 8.6), w: 1 }], '#f7ead2', 2.2) +
    `<circle cx="26.6" cy="21" r="1.9" fill="#f29a9a" opacity=".85"/><circle cx="37.4" cy="21" r="1.9" fill="#f29a9a" opacity=".85"/>` +
    `<circle cx="28.8" cy="16.8" r="1.3" fill="${INK}"/><circle cx="35.2" cy="16.8" r="1.3" fill="${INK}"/>` +
    `<path d="M27.6 22 C30 25.6 34 25.6 36.4 22" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>` +
    sticker([{ d: circle(32, 19.6, 2.1), w: 1 }], LITHO_RED, 1.2)
  );
}

// The Jack-in-the-Box: a royal-blue tin box with a red frame, cream polka dots and a star
// roundel, its red lid flung back, a steel spring and the jester popping out.
export function jackIcon(size: number | string): string {
  return wrap(
    sticker([{ d: 'M50 41 L60 32.5 L61.5 35 L52 43.5 Z', w: 2 }], LITHO_RED) +
      sticker([{ d: 'M27.5 41 L36.5 38 L27.5 35 L36.5 32 L28.5 29', w: 2.6, open: true }], TIN_PLATE, 1.8) +
      sticker([{ d: 'M13 41 L51 41 L51 60 L13 60 Z', w: 2.5 }], LITHO_BLUE) +
      `<path d="M16.5 44.5 L47.5 44.5 L47.5 56.5 L16.5 56.5 Z" fill="none" stroke="${LITHO_RED}" stroke-width="2.4"/>` +
      `<circle cx="21" cy="49" r="1.5" fill="${LITHO_CREAM}"/><circle cx="43" cy="49" r="1.5" fill="${LITHO_CREAM}"/>` +
      `<circle cx="21.5" cy="53.5" r="1.1" fill="${LITHO_CREAM}"/><circle cx="42.5" cy="53.5" r="1.1" fill="${LITHO_CREAM}"/>` +
      sticker([{ d: circle(32, 50.5, 5), w: 1 }], LITHO_CREAM, 1.4) +
      `<path d="M32 46.8 L33.1 49.4 L35.8 49.5 L33.7 51.2 L34.4 53.8 L32 52.3 L29.6 53.8 L30.3 51.2 L28.2 49.5 L30.9 49.4 Z" fill="${LITHO_RED}"/>` +
      jesterBody(),
    size,
  );
}

// Just the jester on a long steel spring (the boss node's box is drawn in CSS under it).
export function jesterIcon(size: number | string): string {
  return wrap(
    sticker(
      [{ d: 'M27.5 63 L36.5 59 L27.5 55 L36.5 51 L27.5 47 L36.5 43 L27.5 39 L36.5 35 L29 31', w: 2.6, open: true }],
      TIN_PLATE,
      1.8,
    ) + jesterBody(),
    size,
  );
}
