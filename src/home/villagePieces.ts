// The home base village as data: where each building's plot is, and which toy pieces it
// is made of at each of its four tiers. Tier 0 is a taped-off empty plot with a few loose
// pieces; tiers 1-3 are progressively built and decorated. Pure (no Babylon, no DOM) so
// the tables are unit tested; src/home/models/ turns pieces into merged meshes.
//
// Coordinates: 1 unit = 1 lane unit (a soldier is 1.3 tall). Pieces are given in their
// building's local space: y = 0 is the floor, x/z = 0 the plot centre, the front faces the
// camera (-Z). Each piece is anchored at its bottom centre: rotations (Babylon order:
// roll z, then pitch x, then yaw y) turn it about that point before it moves to x, y, z.
// A piece appears at `tier` and is cleared away at `until` (the tier-0 tape, scattered
// blocks, a pole replaced by a taller one).

export type BuildingId = 'barracks' | 'walls' | 'workshop' | 'garden' | 'flagpole';
export const BUILDING_IDS: readonly BuildingId[] = ['barracks', 'walls', 'workshop', 'garden', 'flagpole'];
export const MAX_BUILD_TIER = 3;

// Material groups: one shared material (and one merged mesh) each for the whole village.
export type PieceMat = 'plastic' | 'wood' | 'felt' | 'paper' | 'tin' | 'brass';
export const PIECE_MATS: readonly PieceMat[] = ['plastic', 'wood', 'felt', 'paper', 'tin', 'brass'];

//   box    bevelled block w x h x d
//   plate  thin flat panel without bevel (paint, panels, tape)
//   log    round log along local x: length w, diameter h (d ignored)
//   cyl    upright cylinder: diameter w, height h
//   cone   upright cone: base diameter w, height h
//   ball   ellipsoid w x h x d resting on its bottom
//   gable  triangular prism: base d along z, apex height h, thickness w along x
//   flag   waving cloth panel w (out along +x) x h, thickness d
//   star   five-point star prism: outer diameter w, thickness d, standing in the x-y plane
export type PieceShape = 'box' | 'plate' | 'log' | 'cyl' | 'cone' | 'ball' | 'gable' | 'flag' | 'star';

export interface Piece {
  shape: PieceShape;
  mat: PieceMat;
  color: string; // sRGB hex
  x: number;
  y: number; // bottom of the piece
  z: number;
  w: number;
  h: number;
  d: number;
  rx?: number;
  ry?: number;
  rz?: number;
  tier: number; // first tier that shows it
  until?: number; // first tier that no longer shows it
}

export interface Plot {
  id: BuildingId;
  x: number; // plot centre in village space
  z: number;
  w: number; // footprint along x
  d: number; // footprint along z
}

// Village layout (village space = the rug of the home scene): walls along the back, the
// barracks and the workshop either side of a parade ground with the flagpole, the garden
// front left, and the soldiers' corner front right.
export const PLOTS: Record<BuildingId, Plot> = {
  walls: { id: 'walls', x: 0, z: 8.3, w: 11.6, d: 1.4 },
  barracks: { id: 'barracks', x: -3.2, z: 3.1, w: 3.6, d: 3.0 },
  workshop: { id: 'workshop', x: 3.2, z: 3.1, w: 3.6, d: 3.0 },
  flagpole: { id: 'flagpole', x: 0, z: -0.4, w: 2.4, d: 2.4 },
  garden: { id: 'garden', x: -3.3, z: -3.5, w: 3.6, d: 2.8 },
};

// ---------- colours (sRGB; toy primaries for props, never the armies' green or tan) ----------
const C = {
  log: '#a8743f',
  log2: '#9a6634',
  logEnd: '#c79a62',
  slab: '#8a5a33',
  roof: '#c8463a',
  roofDark: '#a8382e',
  door: '#6e4426',
  cream: '#efe5cf',
  ink: '#3a2a1c',
  brick: '#b5473a',
  blue: '#2f6fd6',
  red: '#d93a2f',
  yellow: '#f2b630',
  purple: '#8e4fc4',
  orange: '#f07a24',
  teal: '#1fa3b0',
  tapeY: '#f2c13a',
  tapeK: '#33302c',
  bench: '#c08a55',
  board: '#d9b98a',
  tin: '#b9c0c6',
  tinDark: '#7d868e',
  felt: '#2e8a6e', // garden felt: a blue-green well away from the army green
  feltLight: '#4aa585',
  feltDark: '#226650',
  soil: '#6b4a32',
  sand: '#efdcaa',
  stone: '#d8d2c6',
  stone2: '#c6bfb2',
  armyGreen: '#4f8f3c', // the army's own flag
  canvas: '#ddd3bd',
};

const BLOCK_COLORS = [C.red, C.blue, C.yellow, C.purple, C.orange, C.teal];

type Extra = Partial<Pick<Piece, 'rx' | 'ry' | 'rz' | 'until'>>;

function p(
  shape: PieceShape,
  mat: PieceMat,
  color: string,
  tier: number,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  extra: Extra = {},
): Piece {
  return { shape, mat, color, x, y, z, w, h, d, tier, ...extra };
}

// Yellow-and-black hazard tape around a w x d plot with corner pegs (tier 0 only).
function tapedPlot(w: number, d: number): Piece[] {
  const out: Piece[] = [];
  const seg = 0.36;
  const side = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / seg));
    const ry = Math.atan2(-(z1 - z0), x1 - x0); // Babylon yaw turns +x toward -z for positive angles
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      out.push(
        p(
          'plate',
          'paper',
          i % 2 ? C.tapeK : C.tapeY,
          0,
          x0 + (x1 - x0) * t,
          0.004,
          z0 + (z1 - z0) * t,
          len / n,
          0.012,
          0.13,
          {
            ry,
            until: 1,
          },
        ),
      );
    }
  };
  const hw = w / 2 - 0.12;
  const hd = d / 2 - 0.12;
  side(-hw, -hd, hw, -hd);
  side(hw, -hd, hw, hd);
  side(hw, hd, -hw, hd);
  side(-hw, hd, -hw, -hd);
  for (const [x, z] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ] as const) {
    out.push(p('cyl', 'wood', C.log, 0, x, 0, z, 0.09, 0.4, 0.09, { until: 1 }));
    out.push(p('ball', 'plastic', C.red, 0, x, 0.38, z, 0.15, 0.15, 0.15, { until: 1 }));
  }
  return out;
}

// ---------- barracks: a Lincoln-log cabin ----------
const LOG = 0.24; // log diameter
const COURSE = LOG * 0.85; // logs notch into each other

function barracks(): Piece[] {
  const out: Piece[] = tapedPlot(3.6, 3.0);
  // Tier 0: a few logs and a block left on the plot.
  out.push(
    p('log', 'wood', C.log, 0, -0.5, 0, -0.3, 1.5, LOG, LOG, { ry: 0.35, until: 1 }),
    p('log', 'wood', C.log2, 0, 0.4, 0, 0.35, 1.3, LOG, LOG, { ry: -0.6, until: 1 }),
    p('log', 'wood', C.log, 0, 0.3, LOG * 0.9, 0.3, 1.1, LOG, LOG, { ry: -0.45, until: 1 }),
    p('box', 'wood', C.blue, 0, 0.9, 0, -0.7, 0.5, 0.5, 0.5, { ry: 0.4, until: 1 }),
  );
  const W = 3.0;
  const D = 2.4;
  const base = 0.14;
  out.push(p('box', 'wood', C.slab, 1, 0, 0, 0, W + 0.4, base, D + 0.4));
  // Seven courses: four at tier 1 (a half-built cabin), the rest and the roof at tier 2.
  const door = 0.42; // half width of the door gap
  for (let c = 0; c < 7; c++) {
    const tier = c < 4 ? 1 : 2;
    const yFB = base + c * COURSE; // front/back logs
    const ySide = yFB + COURSE / 2; // side logs sit half a course up (interleaved)
    const col = c % 2 ? C.log2 : C.log;
    if (c < 5) {
      const len = W / 2 + 0.14 - door;
      out.push(p('log', 'wood', col, tier, -(door + len / 2), yFB, -D / 2, len, LOG, LOG));
      out.push(p('log', 'wood', col, tier, door + len / 2, yFB, -D / 2, len, LOG, LOG));
    } else {
      out.push(p('log', 'wood', col, tier, 0, yFB, -D / 2, W + 0.28, LOG, LOG));
    }
    out.push(p('log', 'wood', col, tier, 0, yFB, D / 2, W + 0.28, LOG, LOG));
    if (c < 6) {
      out.push(p('log', 'wood', col, tier, -W / 2, ySide, 0, D + 0.28, LOG, LOG, { ry: Math.PI / 2 }));
      out.push(p('log', 'wood', col, tier, W / 2, ySide, 0, D + 0.28, LOG, LOG, { ry: Math.PI / 2 }));
    }
  }
  // Tier 1 extras: a stack of spare logs waiting by the wall.
  out.push(
    p('log', 'wood', C.log2, 1, 1.0, 0, -1.65, 1.2, LOG, LOG, { until: 2 }),
    p('log', 'wood', C.log, 1, 1.0, 0, -1.4, 1.2, LOG, LOG, { until: 2 }),
    p('log', 'wood', C.log2, 1, 1.0, COURSE, -1.52, 1.2, LOG, LOG, { until: 2 }),
  );
  // Tier 2: gables, red slat roof, ridge log and a door.
  const top = base + 7 * COURSE - 0.02;
  const rise = 0.8;
  const eave = D / 2 + 0.3;
  const theta = Math.atan2(rise, eave);
  const slope = Math.hypot(eave, rise) + 0.06;
  for (const s of [-1, 1]) {
    out.push(p('gable', 'wood', C.log2, 2, s * (W / 2), top - 0.04, 0, LOG, rise, D + 0.1));
    out.push(
      p(
        'box',
        'plastic',
        s < 0 ? C.roof : C.roofDark,
        2,
        0,
        top + rise / 2 - 0.02,
        (s * eave) / 2,
        W + 0.6,
        0.1,
        slope,
        {
          rx: s < 0 ? -theta : theta,
        },
      ),
    );
  }
  out.push(p('log', 'wood', C.log, 2, 0, top + rise - 0.1, 0, W + 0.7, 0.2, 0.2));
  out.push(p('box', 'wood', C.door, 2, 0, base, -D / 2 - 0.04, 0.78, 1.0, 0.08));
  out.push(p('ball', 'brass', '#d2a33f', 2, 0.24, base + 0.48, -D / 2 - 0.1, 0.08, 0.08, 0.08));
  // Tier 3: windows with blue shutters, a brick chimney, a sign, sandbags, a pennant, a bench.
  for (const s of [-1, 1]) {
    const x = s * 1.0;
    const y = base + 2.3 * COURSE;
    out.push(p('plate', 'plastic', C.cream, 3, x, y, -D / 2 - 0.14, 0.5, 0.46, 0.04));
    out.push(p('plate', 'plastic', '#2d3a52', 3, x, y + 0.06, -D / 2 - 0.16, 0.36, 0.34, 0.04));
    out.push(p('plate', 'plastic', C.blue, 3, x - 0.36, y - 0.02, -D / 2 - 0.15, 0.18, 0.5, 0.04));
    out.push(p('plate', 'plastic', C.blue, 3, x + 0.36, y - 0.02, -D / 2 - 0.15, 0.18, 0.5, 0.04));
  }
  out.push(p('box', 'plastic', C.brick, 3, 0.85, top + 0.15, 0.55, 0.42, 1.1, 0.42));
  out.push(p('box', 'plastic', C.roofDark, 3, 0.85, top + 1.22, 0.55, 0.52, 0.12, 0.52));
  out.push(p('plate', 'paper', C.cream, 3, 0, base + 1.08, -D / 2 - 0.16, 0.96, 0.26, 0.04));
  out.push(p('plate', 'paper', C.ink, 3, 0, base + 1.17, -D / 2 - 0.18, 0.7, 0.07, 0.02));
  for (const [x, y, z] of [
    [-1.25, 0, -1.55],
    [-0.85, 0, -1.55],
    [-1.05, 0.2, -1.55],
  ] as const) {
    out.push(p('ball', 'felt', C.canvas, 3, x, y, z, 0.44, 0.24, 0.3));
  }
  out.push(p('cyl', 'tin', C.tinDark, 3, -1.62, top + rise - 0.3, 0, 0.05, 0.9, 0.05));
  out.push(p('flag', 'paper', C.red, 3, -1.6, top + rise + 0.25, 0, 0.42, 0.26, 0.02));
  out.push(p('box', 'wood', C.bench, 3, 1.05, 0.26, -1.62, 0.9, 0.08, 0.3));
  out.push(p('box', 'wood', C.slab, 3, 0.72, 0, -1.62, 0.08, 0.26, 0.24));
  out.push(p('box', 'wood', C.slab, 3, 1.38, 0, -1.62, 0.08, 0.26, 0.24));
  return out;
}

// ---------- walls: alphabet-block ramparts with a gate ----------
const BLOCK = 0.72;
const GATE_HALF = 0.96; // half the gate opening

// The x of block k (0 at the gate post) on side s.
function blockX(s: number, k: number): number {
  return s * (GATE_HALF + BLOCK / 2 + k * (BLOCK + 0.02));
}

// An alphabet block: painted body, a cream panel on the front and a letter in bars.
function alphabetBlock(
  tier: number,
  x: number,
  y: number,
  z: number,
  n: number,
  size = BLOCK,
  until?: number,
): Piece[] {
  const col = BLOCK_COLORS[n % BLOCK_COLORS.length];
  const u = until === undefined ? {} : { until };
  const f = z - size / 2 - 0.006; // front face
  const out = [
    p('box', 'wood', col, tier, x, y, z, size, size, size, u),
    p('plate', 'paper', C.cream, tier, x, y + size * 0.14, f - 0.004, size * 0.74, size * 0.72, 0.02, u),
  ];
  // Letters H, I, L, T, E, A as bars over the panel (in the block's colour).
  const s = size * 0.5;
  const bar = (bx: number, by: number, bw: number, bh: number): void => {
    out.push(p('plate', 'paper', col, tier, x + bx * s, y + size * 0.22 + by * s, f - 0.018, bw * s, bh * s, 0.02, u));
  };
  switch (n % 6) {
    case 0: // H
      bar(-0.32, 0, 0.18, 0.9);
      bar(0.32, 0, 0.18, 0.9);
      bar(0, 0.36, 0.5, 0.16);
      break;
    case 1: // I
      bar(0, 0, 0.2, 0.9);
      bar(0, 0, 0.6, 0.16);
      bar(0, 0.74, 0.6, 0.16);
      break;
    case 2: // L
      bar(-0.2, 0, 0.2, 0.9);
      bar(0.05, 0, 0.6, 0.16);
      break;
    case 3: // T
      bar(0, 0, 0.2, 0.9);
      bar(0, 0.74, 0.76, 0.16);
      break;
    case 4: // E
      bar(-0.26, 0, 0.18, 0.9);
      bar(0.02, 0, 0.5, 0.15);
      bar(0.02, 0.38, 0.42, 0.15);
      bar(0.02, 0.75, 0.5, 0.15);
      break;
    default: // A (a little roof with a bar)
      bar(-0.2, 0, 0.18, 0.84);
      bar(0.2, 0, 0.18, 0.84);
      bar(0, 0.4, 0.4, 0.14);
      bar(0, 0.76, 0.5, 0.15);
  }
  return out;
}

function walls(): Piece[] {
  const out: Piece[] = [];
  // Tier 0: a tape line along the front and loose blocks tumbled about.
  out.push(...tapedPlot(11.6, 1.4));
  out.push(
    ...alphabetBlock(0, -3.2, 0, 0.1, 0, BLOCK, 1),
    ...alphabetBlock(0, 2.5, 0, -0.1, 3, BLOCK, 1),
    ...alphabetBlock(0, 2.5, BLOCK, -0.1, 1, BLOCK, 1),
    ...alphabetBlock(0, 4.4, 0, 0.15, 4, BLOCK, 1),
  );
  let n = 0;
  // Tier 1: one course; tier 2: a second course and the gate posts; tier 3: battlements,
  // corner towers with red roofs, a gate arch and pennants.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) out.push(...alphabetBlock(1, blockX(s, k), 0, 0, n++));
    for (let k = 0; k < 6; k++) out.push(...alphabetBlock(2, blockX(s, k), BLOCK, 0, n++ + 2));
    out.push(...alphabetBlock(2, blockX(s, 0), BLOCK * 2, 0, n++ + 1));
    for (const k of [2, 4]) out.push(...alphabetBlock(3, blockX(s, k), BLOCK * 2, 0, n++ + 3, BLOCK * 0.8));
    out.push(...alphabetBlock(3, blockX(s, 5), BLOCK * 2, 0, n++ + 4));
    out.push(...alphabetBlock(3, blockX(s, 5), BLOCK * 3, 0, n++ + 5));
    out.push(p('cone', 'plastic', C.roof, 3, blockX(s, 5), BLOCK * 4, 0, BLOCK * 1.25, 0.8, BLOCK * 1.25));
    out.push(p('cyl', 'tin', C.tinDark, 3, blockX(s, 5), BLOCK * 4 + 0.7, 0, 0.04, 0.55, 0.04));
    out.push(
      p('flag', 'paper', s < 0 ? C.yellow : C.blue, 3, blockX(s, 5) + 0.02, BLOCK * 4 + 0.95, 0, 0.36, 0.22, 0.02),
    );
  }
  out.push(p('box', 'wood', C.cream, 3, 0, BLOCK * 3, 0, GATE_HALF * 2 + BLOCK * 1.6, 0.18, BLOCK * 0.9));
  out.push(p('gable', 'wood', C.red, 3, 0, BLOCK * 3 + 0.18, 0, BLOCK * 0.8, 0.5, 1.2, { ry: Math.PI / 2 }));
  out.push(p('star', 'brass', '#d2a33f', 3, 0, BLOCK * 3 + 0.02, -BLOCK * 0.46, 0.34, 0.34, 0.05));
  return out;
}

// ---------- workshop: a toy workbench with tools ----------
function workshop(): Piece[] {
  const out: Piece[] = tapedPlot(3.6, 3.0);
  out.push(
    p('box', 'wood', C.bench, 0, -0.6, 0, 0.2, 0.7, 0.42, 0.6, { ry: 0.3, until: 1 }),
    p('box', 'wood', C.orange, 0, -0.55, 0.42, 0.2, 0.42, 0.42, 0.42, { ry: -0.2, until: 1 }),
    p('cyl', 'wood', C.bench, 0, 0.6, 0.03, -0.3, 0.07, 0.6, 0.07, { rz: Math.PI / 2, ry: 0.5, until: 1 }),
    p('box', 'tin', C.tin, 0, 0.62, 0, -0.26, 0.24, 0.12, 0.12, { ry: 0.5, until: 1 }),
  );
  // Tier 1: the workbench with a vise and a hammer, planks piled beside it.
  const bz = 0.25;
  const topY = 0.78;
  out.push(p('box', 'wood', C.bench, 1, 0, topY, bz, 2.4, 0.14, 0.95));
  for (const [x, z] of [
    [-1.05, bz - 0.35],
    [1.05, bz - 0.35],
    [-1.05, bz + 0.35],
    [1.05, bz + 0.35],
  ] as const) {
    out.push(p('box', 'wood', C.slab, 1, x, 0, z, 0.14, topY, 0.14));
  }
  out.push(p('box', 'wood', C.slab, 1, 0, 0.24, bz, 2.1, 0.08, 0.72));
  out.push(p('box', 'tin', C.tinDark, 1, 0.85, topY + 0.14, bz - 0.28, 0.3, 0.22, 0.26));
  out.push(p('box', 'tin', C.tin, 1, 0.85, topY + 0.2, bz - 0.47, 0.34, 0.14, 0.1));
  out.push(p('cyl', 'tin', C.tin, 1, 0.85, topY + 0.27, bz - 0.56, 0.05, 0.3, 0.05, { rx: Math.PI / 2 }));
  out.push(p('cyl', 'wood', C.logEnd, 1, -0.4, topY + 0.14, bz - 0.15, 0.08, 0.62, 0.08, { rz: Math.PI / 2, ry: 0.3 }));
  out.push(p('box', 'tin', C.tinDark, 1, -0.72, topY + 0.14, bz - 0.24, 0.12, 0.13, 0.28, { ry: 0.3 }));
  for (let i = 0; i < 3; i++) {
    out.push(
      p('box', 'wood', i % 2 ? C.board : C.bench, 1, -1.35 + i * 0.04, i * 0.09, -0.95, 1.2, 0.08, 0.26, {
        ry: 1.2 + i * 0.12,
      }),
    );
  }
  // Tier 2: a pegboard with hanging tools, a red toolbox and a stool.
  const backZ = bz + 0.6;
  out.push(p('box', 'wood', C.board, 2, 0, topY + 0.14, backZ, 2.5, 1.3, 0.08));
  for (const [x, y] of [
    [-0.95, 1.6],
    [-0.4, 1.75],
    [0.25, 1.62],
    [0.85, 1.7],
  ] as const) {
    out.push(p('cyl', 'brass', '#d2a33f', 2, x, y + 0.02, backZ - 0.08, 0.05, 0.1, 0.05, { rx: Math.PI / 2 }));
  }
  out.push(p('box', 'tin', C.tin, 2, -0.95, 1.08, backZ - 0.1, 0.09, 0.56, 0.04)); // wrench
  out.push(p('cyl', 'tin', C.tin, 2, -0.95, 1.52, backZ - 0.1, 0.2, 0.05, 0.2, { rx: Math.PI / 2 }));
  out.push(p('cyl', 'plastic', C.red, 2, -0.4, 1.45, backZ - 0.1, 0.1, 0.3, 0.1)); // screwdriver
  out.push(p('cyl', 'tin', C.tin, 2, -0.4, 1.12, backZ - 0.1, 0.035, 0.34, 0.035));
  out.push(p('plate', 'tin', C.tin, 2, 0.33, 1.08, backZ - 0.08, 0.5, 0.38, 0.02, { rz: -0.15 })); // saw
  out.push(p('box', 'wood', C.bench, 2, 0.08, 1.38, backZ - 0.1, 0.2, 0.18, 0.06, { rz: -0.15 }));
  out.push(p('box', 'tin', C.tinDark, 2, 0.85, 1.25, backZ - 0.1, 0.24, 0.12, 0.05)); // pliers
  out.push(p('box', 'plastic', C.yellow, 2, 0.85, 1.0, backZ - 0.1, 0.08, 0.26, 0.05, { rz: 0.2 }));
  out.push(p('box', 'plastic', C.yellow, 2, 0.93, 1.0, backZ - 0.1, 0.08, 0.26, 0.05, { rz: -0.2 }));
  out.push(p('box', 'plastic', C.red, 2, -0.75, 0, -0.85, 0.8, 0.4, 0.42));
  out.push(p('box', 'plastic', C.roofDark, 2, -0.75, 0.4, -0.85, 0.82, 0.06, 0.44));
  out.push(p('box', 'tin', C.tinDark, 2, -0.75, 0.46, -0.85, 0.36, 0.08, 0.06));
  out.push(p('cyl', 'wood', C.bench, 2, 0.6, 0.44, -0.75, 0.5, 0.08, 0.5));
  for (const a of [0, 2.1, 4.2]) {
    out.push(p('cyl', 'wood', C.slab, 2, 0.6 + Math.cos(a) * 0.16, 0, -0.75 + Math.sin(a) * 0.16, 0.06, 0.45, 0.06));
  }
  // Tier 3: a striped awning on posts, a brass gear sign, a crate of springs and a lamp.
  const ax = 1.45;
  const az0 = bz - 0.15; // the awning shades the back of the bench and leaves its top in view
  const az1 = backZ + 0.1;
  for (const [x, z] of [
    [-ax, az0],
    [ax, az0],
    [-ax, az1],
    [ax, az1],
  ] as const) {
    out.push(p('cyl', 'wood', C.cream, 3, x, 0, z, 0.12, z === az0 ? 2.05 : 2.35, 0.12));
  }
  const dz = az1 - az0;
  const tilt = Math.atan2(0.3, dz);
  for (let i = 0; i < 6; i++) {
    const w = (ax * 2 + 0.4) / 6;
    out.push(
      p(
        'box',
        'plastic',
        i % 2 ? C.cream : C.red,
        3,
        -ax - 0.2 + w * (i + 0.5),
        2.05 + 0.15,
        (az0 + az1) / 2,
        w,
        0.07,
        dz + 0.5,
        {
          rx: -tilt,
        },
      ),
    );
  }
  out.push(p('cyl', 'brass', '#d2a33f', 3, 0, 2.45, az0 + 0.05, 0.62, 0.1, 0.62, { rx: Math.PI / 2 }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    out.push(
      p(
        'box',
        'brass',
        '#d2a33f',
        3,
        Math.cos(a) * 0.34,
        2.45 + 0.31 + Math.sin(a) * 0.34 - 0.06,
        az0 + 0.0,
        0.12,
        0.12,
        0.1,
        {
          rz: a,
        },
      ),
    );
  }
  out.push(p('cyl', 'tin', C.tinDark, 3, 0, 2.6, az0 + 0.0, 0.18, 0.12, 0.18, { rx: Math.PI / 2 }));
  out.push(p('box', 'wood', C.bench, 3, 1.2, 0, -1.1, 0.6, 0.42, 0.5, { ry: -0.25 }));
  for (const [x, z] of [
    [1.08, -1.18],
    [1.3, -1.02],
    [1.22, -1.25],
  ] as const) {
    out.push(p('cyl', 'brass', '#d2a33f', 3, x, 0.42, z, 0.14, 0.2, 0.14));
  }
  out.push(p('cyl', 'tin', C.tinDark, 3, -1.0, topY + 0.14, bz + 0.3, 0.06, 0.55, 0.06));
  out.push(p('cone', 'plastic', C.yellow, 3, -1.0, topY + 0.6, bz + 0.18, 0.34, 0.22, 0.34, { rx: 0.5 }));
  return out;
}

// ---------- garden: felt trees and bushes, paper flowers, a sandbox ----------
const FLOWER_COLORS = [C.red, C.yellow, C.purple, C.orange, C.blue];

function flower(tier: number, x: number, z: number, n: number, h = 0.42, until?: number): Piece[] {
  const u = until === undefined ? {} : { until };
  return [
    p('cyl', 'felt', C.feltDark, tier, x, 0.04, z, 0.04, h, 0.04, u),
    p('ball', 'felt', C.feltLight, tier, x + 0.06, 0.12, z, 0.14, 0.05, 0.08, { rz: -0.4, ...u }),
    p('ball', 'paper', FLOWER_COLORS[n % FLOWER_COLORS.length], tier, x, h, z, 0.2, 0.12, 0.2, u),
    p(
      'ball',
      'paper',
      C.yellow === FLOWER_COLORS[n % FLOWER_COLORS.length] ? C.orange : C.cream,
      tier,
      x,
      h + 0.08,
      z - 0.03,
      0.07,
      0.06,
      0.07,
      u,
    ),
  ];
}

function pine(tier: number, x: number, z: number, s: number): Piece[] {
  return [
    p('cyl', 'wood', C.log2, tier, x, 0.04, z, 0.16 * s, 0.5 * s, 0.16 * s),
    p('cone', 'felt', C.feltDark, tier, x, 0.4 * s, z, 0.95 * s, 0.75 * s, 0.95 * s),
    p('cone', 'felt', C.felt, tier, x, 0.85 * s, z, 0.75 * s, 0.65 * s, 0.75 * s),
    p('cone', 'felt', C.feltLight, tier, x, 1.25 * s, z, 0.52 * s, 0.55 * s, 0.52 * s),
  ];
}

function garden(): Piece[] {
  const out: Piece[] = tapedPlot(3.6, 2.8);
  out.push(
    p('plate', 'felt', C.feltLight, 0, -0.6, 0.004, 0.2, 0.5, 0.02, 0.4, { ry: 0.5, until: 1 }),
    p('plate', 'felt', C.felt, 0, 0.7, 0.004, -0.3, 0.42, 0.02, 0.36, { ry: -0.3, until: 1 }),
    p('cyl', 'plastic', C.red, 0, 0.2, 0, 0.5, 0.3, 0.3, 0.3, { until: 1 }),
    p('box', 'tin', C.tin, 0, 0.55, 0, 0.45, 0.14, 0.04, 0.3, { ry: 0.6, until: 1 }),
  );
  // Tier 1: a felt soil bed with wooden edging, three bushes and seedlings.
  const bw = 3.0;
  const bd = 2.1;
  out.push(p('plate', 'felt', C.soil, 1, 0, 0.002, 0, bw, 0.05, bd));
  for (const s of [-1, 1]) {
    out.push(p('box', 'wood', C.bench, 1, 0, 0, (s * (bd + 0.12)) / 2, bw + 0.24, 0.14, 0.12));
    out.push(p('box', 'wood', C.bench, 1, (s * (bw + 0.12)) / 2, 0, 0, 0.12, 0.14, bd));
  }
  out.push(
    p('ball', 'felt', C.felt, 1, -0.95, 0.03, 0.55, 0.78, 0.6, 0.7),
    p('ball', 'felt', C.feltLight, 1, -0.35, 0.03, 0.7, 0.6, 0.48, 0.56),
    p('ball', 'felt', C.feltDark, 1, 1.05, 0.03, 0.6, 0.7, 0.56, 0.66),
  );
  for (const [x, z] of [
    [-0.6, -0.5],
    [-0.2, -0.55],
    [0.2, -0.5],
    [0.6, -0.55],
  ] as const) {
    out.push(p('cyl', 'felt', C.feltDark, 1, x, 0.04, z, 0.04, 0.16, 0.04, { until: 3 }));
    out.push(p('ball', 'felt', C.feltLight, 1, x, 0.18, z, 0.14, 0.08, 0.14, { until: 3 }));
  }
  // Tier 2: two felt pines, paper flowers and a cream picket fence along the front.
  out.push(...pine(2, -1.25, 0.75, 1), ...pine(2, 1.3, 0.85, 0.85));
  for (let i = 0; i < 6; i++) out.push(...flower(2, -0.9 + i * 0.36, 0.05 + (i % 2) * 0.16, i));
  const fz = -bd / 2 - 0.28;
  for (let i = 0; i < 12; i++) {
    const x = -1.55 + i * 0.282;
    if (Math.abs(x) < 0.3) continue; // a gap for the path
    out.push(p('box', 'wood', C.cream, 2, x, 0, fz, 0.1, 0.46, 0.05));
    out.push(p('gable', 'wood', C.cream, 2, x, 0.46, fz, 0.05, 0.07, 0.1, { ry: Math.PI / 2 }));
  }
  for (const s of [-1, 1]) {
    for (const y of [0.12, 0.3]) out.push(p('box', 'wood', C.cream, 2, s * 0.95, y, fz + 0.04, 1.3, 0.06, 0.03));
  }
  // Tier 3: a round felt tree, a sandbox with a bucket, a birdhouse and more flowers.
  out.push(p('cyl', 'wood', C.log2, 3, 0.15, 0.04, 0.85, 0.18, 0.75, 0.18));
  out.push(p('ball', 'felt', C.felt, 3, 0.15, 0.7, 0.85, 1.0, 0.9, 0.9));
  out.push(p('ball', 'felt', C.feltLight, 3, 0.0, 1.25, 0.78, 0.55, 0.45, 0.5));
  out.push(p('box', 'wood', C.yellow, 3, -0.45, 0.04, -0.45, 1.0, 0.16, 0.08));
  out.push(p('box', 'wood', C.yellow, 3, -0.45, 0.04, 0.0, 1.0, 0.16, 0.08));
  out.push(p('box', 'wood', C.yellow, 3, -0.92, 0.04, -0.22, 0.08, 0.16, 0.38));
  out.push(p('box', 'wood', C.yellow, 3, 0.02, 0.04, -0.22, 0.08, 0.16, 0.38));
  out.push(p('plate', 'felt', C.sand, 3, -0.45, 0.04, -0.22, 0.88, 0.1, 0.38));
  out.push(p('cyl', 'plastic', C.blue, 3, -0.25, 0.14, -0.2, 0.18, 0.18, 0.18));
  out.push(p('box', 'plastic', C.red, 3, -0.65, 0.14, -0.25, 0.08, 0.04, 0.3, { ry: 0.6, rz: 0.2 }));
  out.push(p('cyl', 'wood', C.cream, 3, 1.35, 0.04, -0.35, 0.07, 0.95, 0.07));
  out.push(p('box', 'wood', C.blue, 3, 1.35, 0.98, -0.35, 0.3, 0.28, 0.28));
  out.push(p('gable', 'wood', C.red, 3, 1.35, 1.26, -0.35, 0.38, 0.2, 0.4));
  out.push(p('cyl', 'plastic', C.ink, 3, 1.35, 1.08, -0.5, 0.1, 0.02, 0.1, { rx: Math.PI / 2 }));
  for (let i = 0; i < 4; i++) out.push(...flower(3, 0.45 + i * 0.25, -0.55 + (i % 2) * 0.12, i + 2, 0.32));
  return out;
}

// ---------- flagpole: a green army flag on a plinth ----------
function flagpole(): Piece[] {
  const out: Piece[] = tapedPlot(2.4, 2.4);
  out.push(
    p('cyl', 'wood', C.logEnd, 0, -0.1, 0.04, 0.2, 0.08, 1.4, 0.08, { rz: Math.PI / 2, ry: 0.4, until: 1 }),
    p('box', 'wood', C.cream, 0, 0.45, 0, -0.35, 0.5, 0.5, 0.5, { ry: 0.3, until: 1 }),
  );
  // Tier 1: a dowel pole stuck in a block, a small flag.
  out.push(p('box', 'wood', C.cream, 1, 0, 0, 0, 0.6, 0.5, 0.6, { until: 2 }));
  out.push(p('cyl', 'wood', C.logEnd, 1, 0, 0.5, 0, 0.09, 1.6, 0.09, { until: 2 }));
  out.push(p('ball', 'wood', C.red, 1, 0, 2.08, 0, 0.16, 0.16, 0.16, { until: 2 }));
  out.push(p('flag', 'felt', C.armyGreen, 1, 0.04, 1.55, 0, 0.62, 0.42, 0.03, { until: 2 }));
  // Tier 2: a two-step plinth, a tin pole, a bigger flag and a brass ball.
  out.push(p('box', 'plastic', C.stone, 2, 0, 0, 0, 1.7, 0.26, 1.7));
  out.push(p('box', 'plastic', C.stone2, 2, 0, 0.26, 0, 1.15, 0.26, 1.15));
  out.push(p('cyl', 'tin', C.tin, 2, 0, 0.52, 0, 0.11, 2.5, 0.11, { until: 3 }));
  out.push(p('ball', 'brass', '#d2a33f', 2, 0, 3.0, 0, 0.2, 0.2, 0.2, { until: 3 }));
  out.push(p('flag', 'felt', C.armyGreen, 2, 0.05, 2.25, 0, 0.92, 0.6, 0.03, { until: 3 }));
  // Tier 3: a third step with a brass star plaque, a tall pole, a big flag with a star,
  // brass bollards with red ropes.
  out.push(p('box', 'plastic', C.stone2, 3, 0, 0, 0, 2.2, 0.14, 2.2));
  out.push(p('star', 'brass', '#d2a33f', 3, 0, 0.3, -0.59, 0.3, 0.3, 0.04));
  out.push(p('cyl', 'tin', C.tin, 3, 0, 0.52, 0, 0.12, 3.4, 0.12));
  out.push(p('ball', 'brass', '#d2a33f', 3, 0, 3.9, 0, 0.24, 0.24, 0.24));
  out.push(p('flag', 'felt', C.armyGreen, 3, 0.06, 2.95, 0, 1.3, 0.85, 0.03));
  out.push(p('star', 'paper', C.cream, 3, 0.62, 3.2, -0.03, 0.36, 0.36, 0.02));
  const r = 1.05;
  for (const [x, z] of [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
  ] as const) {
    out.push(p('cyl', 'brass', '#d2a33f', 3, x, 0, z, 0.1, 0.42, 0.1));
    out.push(p('ball', 'brass', '#d2a33f', 3, x, 0.4, z, 0.13, 0.13, 0.13));
  }
  for (const [x, z, ry] of [
    [0, -r, 0],
    [r, 0, Math.PI / 2],
    [-r, 0, Math.PI / 2],
  ] as const) {
    out.push(p('log', 'felt', C.red, 3, x, 0.3, z, r * 2 - 0.1, 0.04, 0.04, { ry }));
  }
  return out;
}

const BUILDERS: Record<BuildingId, () => Piece[]> = { barracks, walls, workshop, garden, flagpole };
const cache = new Map<BuildingId, Piece[]>();

// Every piece of a building over all its tiers (built once, shared, do not mutate).
export function allPieces(id: BuildingId): readonly Piece[] {
  let list = cache.get(id);
  if (!list) {
    list = BUILDERS[id]();
    cache.set(id, list);
  }
  return list;
}

export function clampTier(tier: number): number {
  return Math.max(0, Math.min(MAX_BUILD_TIER, Math.floor(Number.isFinite(tier) ? tier : 0)));
}

export function shownAt(piece: Piece, tier: number): boolean {
  return piece.tier <= tier && (piece.until === undefined || piece.until > tier);
}

// The pieces standing at `tier`.
export function piecesAt(id: BuildingId, tier: number): Piece[] {
  const t = clampTier(tier);
  return allPieces(id).filter((q) => shownAt(q, t));
}

// What changes going from tier `from` to tier `to`: pieces to drop in, pieces to clear.
export function tierDiff(id: BuildingId, from: number, to: number): { added: Piece[]; removed: Piece[] } {
  const a = clampTier(from);
  const b = clampTier(to);
  const all = allPieces(id);
  return {
    added: all.filter((q) => shownAt(q, b) && !shownAt(q, a)),
    removed: all.filter((q) => shownAt(q, a) && !shownAt(q, b)),
  };
}

export function isBuildingId(id: string): id is BuildingId {
  return (BUILDING_IDS as readonly string[]).includes(id);
}
