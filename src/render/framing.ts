// Camera framing math for the fixed portrait lane camera. Pure (no Babylon) so it can
// be reasoned about and tested in isolation.
//
// The camera sits on the lane centre line (x = 0) behind the cannon, pitched down by
// `pitch` and looking up +Z. We pin two ground points to screen heights (NDC y):
//   - the cannon row near the bottom (above the thumb zone),
//   - the far edge of the enemy base near the top,
// and then pick pitch + vertical fov so the lane width (plus margin) at the cannon row
// just fills the screen width. Wide screens are framed as if they were DESIGN_ASPECT,
// so they show the same lane plus extra scenery at the sides. The caller can move the
// two rows inward (screenRows) so the bases stay clear of the HUD and safe-area insets.

export const DESIGN_ASPECT = 0.5; // widest aspect that is framed by lane width
export const NEAR_NDC_Y = -0.52; // default cannon row: ~76% down the screen
export const FAR_NDC_Y = 0.8; // default far edge of the enemy base: ~10% from the top
const MIN_ROW_GAP = 0.6; // NDC; the rows never squeeze closer than this
const PITCH_MAX = (60 * Math.PI) / 180;
const PITCH_MIN = (45 * Math.PI) / 180;
const FOV_MIN = (38 * Math.PI) / 180;
const FOV_MAX = (72 * Math.PI) / 180;

export interface FramingInput {
  aspect: number; // width / height of the render target
  laneWidth: number;
  nearZ: number; // ground z pinned near the bottom (the cannon row)
  farZ: number; // ground z pinned near the top (back of the enemy base)
  margin: number; // extra world units on each side of the lane
  nearNdcY?: number; // screen row (NDC y) for nearZ; default NEAR_NDC_Y
  farNdcY?: number; // screen row (NDC y) for farZ; default FAR_NDC_Y
}

export interface Framing {
  pitch: number; // radians below horizontal
  fov: number; // vertical fov, radians
  y: number; // camera height
  z: number; // camera z (x is always 0)
}

interface Solved {
  y: number;
  z: number;
  halfWidth: number; // visible half-width in world units at the near row
}

// For a fixed pitch and tan(fov/2), place the camera so nearZ and farZ land on their NDC rows.
interface Rows {
  near: number;
  far: number;
}

// Screen rows (NDC y) that keep the bases clear of `reserveTop` / `reserveBottom` CSS px
// on a screen `cssHeight` tall, never more outward than the defaults.
export function screenRows(cssHeight: number, reserveTop: number, reserveBottom: number): Rows {
  if (!(cssHeight > 0)) return { near: NEAR_NDC_Y, far: FAR_NDC_Y };
  const far = Math.min(FAR_NDC_Y, 1 - (2 * reserveTop) / cssHeight);
  const near = Math.max(NEAR_NDC_Y, -1 + (2 * reserveBottom) / cssHeight);
  if (far - near >= MIN_ROW_GAP) return { near, far };
  const mid = (far + near) / 2; // tiny screens: keep the gap, centred between the reserves
  return { near: mid - MIN_ROW_GAP / 2, far: mid + MIN_ROW_GAP / 2 };
}

function place(pitch: number, t: number, nearZ: number, farZ: number, aspect: number, rows: Rows): Solved | null {
  const s = Math.sin(pitch);
  const c = Math.cos(pitch);
  // A ground point at depth dz ahead and h below the camera projects to NDC y = k/t when
  // dz * (s - k c) = h * (c + k s); r(k) is that dz/h ratio.
  const r = (k: number): number => (c + k * s) / (s - k * c);
  const kN = rows.near * t;
  const kF = rows.far * t;
  if (s - kF * c <= 1e-4) return null; // far row would be above the horizon
  const span = r(kF) - r(kN);
  if (span <= 1e-6) return null;
  const h = (farZ - nearZ) / span;
  const z = nearZ - h * r(kN);
  const forward = h * s + (nearZ - z) * c; // view-axis distance to the near row
  return { y: h, z, halfWidth: forward * t * aspect };
}

export function computeFraming(input: FramingInput): Framing {
  const aspect = Math.min(input.aspect, DESIGN_ASPECT);
  const want = input.laneWidth / 2 + input.margin;
  const tMin = Math.tan(FOV_MIN / 2);
  const tMax = Math.tan(FOV_MAX / 2);
  const { nearZ, farZ } = input;
  const rows: Rows = { near: input.nearNdcY ?? NEAR_NDC_Y, far: input.farNdcY ?? FAR_NDC_Y };

  // Prefer the steepest pitch at which some fov in range fits the width; visible width at
  // the near row shrinks as fov grows (stronger perspective), so bisect on fov.
  const step = (1 * Math.PI) / 180;
  for (let pitch = PITCH_MAX; pitch >= PITCH_MIN - 1e-9; pitch -= step) {
    const atMax = place(pitch, tMax, nearZ, farZ, aspect, rows);
    if (!atMax || atMax.halfWidth > want) continue;
    const atMin = place(pitch, tMin, nearZ, farZ, aspect, rows);
    if (!atMin) continue;
    if (atMin.halfWidth < want) {
      // Lane is very wide for its length: use the flattest fov and back the camera off
      // along its view axis until the width fits (the far end stays in view).
      return pullBack(pitch, tMin, atMin, want, aspect);
    }
    let lo = tMin;
    let hi = tMax;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const p = place(pitch, mid, nearZ, farZ, aspect, rows);
      if (p && p.halfWidth >= want) lo = mid;
      else hi = mid;
    }
    const best = place(pitch, lo, nearZ, farZ, aspect, rows) ?? atMin;
    return { pitch, fov: 2 * Math.atan(lo), y: best.y, z: best.z };
  }
  // Very long lane: even the strongest perspective leaves spare width. Show it as scenery.
  const fallback = place(PITCH_MIN, tMax, nearZ, farZ, aspect, rows) ?? { y: 30, z: nearZ - 20, halfWidth: want };
  return { pitch: PITCH_MIN, fov: FOV_MAX, y: fallback.y, z: fallback.z };
}

function pullBack(pitch: number, t: number, at: Solved, want: number, aspect: number): Framing {
  const forward = at.halfWidth / (t * aspect);
  const extra = want / (t * aspect) - forward;
  return {
    pitch,
    fov: 2 * Math.atan(t),
    y: at.y + extra * Math.sin(pitch),
    z: at.z - extra * Math.cos(pitch),
  };
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
