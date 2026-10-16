// Camera framing math for the fixed portrait lane camera. Pure (no Babylon) so it can
// be reasoned about and tested in isolation.
//
// The camera looks up the lane (+Z) from behind the player's fort, turned a little
// (CAMERA_YAW) so the lane runs from bottom right to top left, low (CAMERA_PITCH) and
// with a wide fov for strong perspective, like Mob Control (Michel picked this "F3" look
// on 2026-10-16). The angles are fixed; only the position is solved: the camera moves as
// close to the lane as it can while the whole rug (both edges, from the back of the
// player's fort to the back of the enemy base) and the top of the enemy fort or boss
// stay on screen. Wide screens are framed as if they were DESIGN_ASPECT, so they show
// the same lane plus extra scenery at the sides.

export const DESIGN_ASPECT = 0.5; // widest aspect that is framed by lane width
export const NEAR_NDC_Y = -0.6; // bottom HUD row: the HUD buttons sit below it
export const FAR_NDC_Y = 0.8; // default top of the playfield: ~10% from the top
export const CAMERA_YAW = 0.08; // radians, turned toward +x: the lane leans to the top left
export const CAMERA_PITCH = 0.64; // radians below horizontal
export const CAMERA_FOV = 1.2; // vertical fov, radians
const SIDE_NDC = 0.97; // rug edges stay this far inside the screen sides
const BOTTOM_NDC = -0.97; // the back of the player's fort stays above the bottom edge
const MIN_ROW_GAP = 0.6; // NDC; the rows never squeeze closer than this

export interface FramingInput {
  aspect: number; // width / height of the render target
  laneWidth: number;
  margin: number; // rug beyond each lane edge, world units
  nearZ: number; // back of the player's fort
  farZ: number; // back of the enemy base
  farNdcY?: number; // highest screen row (NDC y) for the far rug corners; default FAR_NDC_Y
  top?: { y: number; z: number }; // the enemy fort's flag tip or the boss's plume (x = 0)
  topNdcY?: number; // highest screen row for `top`; default farNdcY
}

export interface Framing {
  pitch: number; // radians below horizontal
  yaw: number; // radians about +y
  fov: number; // vertical fov, radians
  x: number;
  y: number;
  z: number;
}

interface Rows {
  near: number;
  far: number;
}

// Screen rows (NDC y) that keep the playfield clear of `reserveTop` / `reserveBottom`
// CSS px on a screen `cssHeight` tall, never more outward than the defaults.
export function screenRows(cssHeight: number, reserveTop: number, reserveBottom: number): Rows {
  if (!(cssHeight > 0)) return { near: NEAR_NDC_Y, far: FAR_NDC_Y };
  const far = Math.min(FAR_NDC_Y, 1 - (2 * reserveTop) / cssHeight);
  const near = Math.max(NEAR_NDC_Y, -1 + (2 * reserveBottom) / cssHeight);
  if (far - near >= MIN_ROW_GAP) return { near, far };
  const mid = (far + near) / 2; // tiny screens: keep the gap, centred between the reserves
  return { near: mid - MIN_ROW_GAP / 2, far: mid + MIN_ROW_GAP / 2 };
}

type Vec = [number, number, number];

// Camera axes for a yaw/pitch (Babylon, left-handed: +x right, +y up, +z forward).
function axes(yaw: number, pitch: number): { r: Vec; u: Vec; f: Vec } {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  return { r: [cy, 0, -sy], u: [sy * sp, cp, cy * sp], f: [sy * cp, -sp, cy * cp] };
}

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Maximum of a concave function on [lo, hi] (ternary search).
function argmaxConcave(fn: (v: number) => number, lo: number, hi: number): number {
  for (let i = 0; i < 100; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (fn(m1) < fn(m2)) lo = m1;
    else hi = m2;
  }
  return (lo + hi) / 2;
}

// Centre of {v : fn(v) >= level} around `best`, where fn is concave with its peak at best.
function centreOfLevelSet(fn: (v: number) => number, best: number, level: number, span: number): number {
  const edge = (dir: number): number => {
    let inside = best;
    let outside = best + dir * span;
    if (fn(outside) >= level) return outside;
    for (let i = 0; i < 60; i++) {
      const mid = (inside + outside) / 2;
      if (fn(mid) >= level) inside = mid;
      else outside = mid;
    }
    return inside;
  };
  return (edge(-1) + edge(1)) / 2;
}

// In camera coordinates (a, b, g) = (c·r, c·u, c·f) a point P is seen at
// X = P·r - a, Y = P·u - b, depth Z = P·f - g, and lies on screen when
// |X| <= kx Z and -kBottom Z <= Y <= kTop Z. Each bound caps g, horizontal and vertical
// bounds separately, so the closest camera (largest g) maximises two concave functions.
export function computeFraming(input: FramingInput): Framing {
  const aspect = Math.min(input.aspect, DESIGN_ASPECT);
  const t = Math.tan(CAMERA_FOV / 2);
  const { r, u, f } = axes(CAMERA_YAW, CAMERA_PITCH);
  const hw = input.laneWidth / 2 + input.margin;
  const farRow = input.farNdcY ?? FAR_NDC_Y;
  const pts: { p: Vec; top: number }[] = [];
  for (const sx of [-1, 1]) {
    pts.push({ p: [sx * hw, 0, input.nearZ], top: farRow });
    pts.push({ p: [sx * hw, 0, input.farZ], top: farRow });
  }
  if (input.top) pts.push({ p: [0, input.top.y, input.top.z], top: input.topNdcY ?? farRow });
  const X = pts.map((q) => dot(q.p, r));
  const Y = pts.map((q) => dot(q.p, u));
  const Z = pts.map((q) => dot(q.p, f));
  const kx = SIDE_NDC * t * aspect;
  const kBottom = -BOTTOM_NDC * t;

  const gx = (a: number): number => {
    let g = Infinity;
    for (let i = 0; i < pts.length; i++) g = Math.min(g, Z[i] - Math.abs(X[i] - a) / kx);
    return g;
  };
  const gy = (b: number): number => {
    let g = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const kTop = pts[i].top * t;
      const dy = Y[i] - b;
      g = Math.min(g, Z[i] - (dy > 0 ? dy / kTop : -dy / kBottom));
    }
    return g;
  };
  const span = 4 * (input.farZ - input.nearZ + hw + 10);
  let a = argmaxConcave(gx, Math.min(...X), Math.max(...X));
  let b = argmaxConcave(gy, Math.min(...Y) - span, Math.max(...Y) + span);
  const g = Math.min(gx(a), gy(b));
  // The other direction has room to spare: centre the view within it.
  if (gx(a) > g) a = centreOfLevelSet(gx, a, g, span);
  else b = centreOfLevelSet(gy, b, g, span);
  return {
    pitch: CAMERA_PITCH,
    yaw: CAMERA_YAW,
    fov: CAMERA_FOV,
    x: a * r[0] + b * u[0] + g * f[0],
    y: a * r[1] + b * u[1] + g * f[1],
    z: a * r[2] + b * u[2] + g * f[2],
  };
}

// NDC [x, y] of the world point (x, y, z) seen by a framing's camera (fov widened by
// `zoom`, as zoomedFov), or null when it is behind the camera.
export function projectNdc(
  fr: Framing,
  x: number,
  y: number,
  z: number,
  aspect: number,
  zoom = 0,
): [number, number] | null {
  const { r, u, f } = axes(fr.yaw, fr.pitch);
  const d: Vec = [x - fr.x, y - fr.y, z - fr.z];
  const depth = dot(d, f);
  if (depth <= 1e-6) return null;
  const t = Math.tan(zoomedFov(fr.fov, zoom) / 2);
  return [dot(d, r) / depth / (t * aspect), dot(d, u) / depth / t];
}

// ---------- Crowd zoom-out ----------
// As the player's crowd grows the view widens a little (up to +15% fov tangent), so a
// big army fits without the lane leaving the screen. Eased exponentially toward the
// target: no steps, no shake, no oscillation. The camera position never changes.
export const ZOOM_MAX = 0.15; // up to +15% wider view
export const ZOOM_FULL_UNITS = 900; // crowd size at which the zoom-out is complete
export const ZOOM_RATE = 1.5; // 1/s, exponential smoothing

export function crowdZoomTarget(playerUnits: number): number {
  const x = Math.min(1, Math.max(0, playerUnits / ZOOM_FULL_UNITS));
  return ZOOM_MAX * x * x * (3 - 2 * x); // smoothstep
}

// Moves `zoom` toward the crowd's target over dt seconds; never overshoots.
export function easeZoom(zoom: number, playerUnits: number, dt: number): number {
  const target = crowdZoomTarget(playerUnits);
  return zoom + (target - zoom) * (1 - Math.exp(-ZOOM_RATE * Math.max(0, dt)));
}

// Vertical fov widened by `zoom` (0 = the framed fov).
export function zoomedFov(fov: number, zoom: number): number {
  return 2 * Math.atan(Math.tan(fov / 2) * (1 + zoom));
}
