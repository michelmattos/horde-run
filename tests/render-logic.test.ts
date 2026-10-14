// Pure render-side logic: adaptive resolution and camera framing rows (no Babylon).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResolutionScaler } from '../src/render/resolution.ts';
import { FAR_NDC_Y, NEAR_NDC_Y, ZOOM_MAX, computeFraming, crowdZoomTarget, easeZoom, screenRows, zoomedFov } from '../src/render/framing.ts';

function feed(s: ResolutionScaler, dt: number, seconds: number): void {
  for (let t = 0; t < seconds; t += dt) s.sample(dt);
}

test('resolution drops on slow frames and recovers at a 60 Hz vsync interval', () => {
  const s = new ResolutionScaler(3);
  assert.equal(s.ratio, 1.5);
  feed(s, 0.025, 2.5); // a slow patch
  assert.ok(s.ratio < 1.5, `ratio ${s.ratio} should drop`);
  feed(s, 1 / 60, 30); // steady 60 Hz afterwards
  assert.equal(s.ratio, 1.5);
});

test('resolution ignores frame times during warm-up after a level load', () => {
  const s = new ResolutionScaler(3);
  s.warmUp(2);
  feed(s, 0.03, 1.9); // shader compiles
  assert.equal(s.ratio, 1.5);
});

test('resolution backs off after a step up that failed', () => {
  const s = new ResolutionScaler(2);
  feed(s, 0.025, 1.6);
  assert.equal(s.ratio, 1.25);
  feed(s, 1 / 60, 5.1); // first probe up after 5 s
  assert.equal(s.ratio, 1.5);
  feed(s, 0.025, 1.6); // too slow at 1.5: drop again
  assert.equal(s.ratio, 1.25);
  feed(s, 1 / 60, 6); // the next probe now waits longer than 5 s
  assert.equal(s.ratio, 1.25);
  feed(s, 1 / 60, 5);
  assert.equal(s.ratio, 1.5);
});

test('screen rows keep defaults on a plain screen and move inward for the HUD and insets', () => {
  assert.deepEqual(screenRows(844, 70, 150), { near: NEAR_NDC_Y, far: FAR_NDC_Y });
  const notched = screenRows(844, 47 + 70, 34 + 190);
  assert.ok(notched.far < FAR_NDC_Y && notched.near > NEAR_NDC_Y);
  assert.ok(Math.abs((1 - notched.far) / 2 * 844 - 117) < 1e-6, 'far row sits at the HUD bottom');
  const tiny = screenRows(200, 120, 120);
  assert.ok(tiny.far - tiny.near >= 0.6 - 1e-9);
});

test('framing honours the requested rows', () => {
  const input = { aspect: 390 / 844, laneWidth: 10, nearZ: 1.5, farZ: 59, margin: 0.6 };
  const project = (f: ReturnType<typeof computeFraming>, z: number): number => {
    // NDC y of ground point (0, 0, z) for a camera at (0, y, cz) pitched down by `pitch`.
    const dy = -f.y;
    const dz = z - f.z;
    const fwd = dz * Math.cos(f.pitch) - dy * Math.sin(f.pitch);
    const up = dy * Math.cos(f.pitch) + dz * Math.sin(f.pitch);
    return up / fwd / Math.tan(f.fov / 2);
  };
  const def = computeFraming(input);
  assert.ok(Math.abs(project(def, 59) - FAR_NDC_Y) < 1e-3);
  const moved = computeFraming({ ...input, farNdcY: 0.66, nearNdcY: -0.45 });
  assert.ok(Math.abs(project(moved, 59) - 0.66) < 1e-3, `far row ${project(moved, 59)}`);
  assert.ok(Math.abs(project(moved, 1.5) + 0.45) < 1e-3, `near row ${project(moved, 1.5)}`);
});

test('crowd zoom-out: grows smoothly with the crowd, capped, never overshoots', () => {
  assert.equal(crowdZoomTarget(0), 0);
  assert.equal(crowdZoomTarget(5000), ZOOM_MAX);
  let prev = -1;
  for (let n = 0; n <= 1200; n += 50) {
    const z = crowdZoomTarget(n);
    assert.ok(z >= prev && z <= ZOOM_MAX, `monotonic at ${n}`);
    prev = z;
  }
  // Eases toward the target at 60 fps without stepping past it.
  let zoom = 0;
  let last = 0;
  for (let i = 0; i < 600; i++) {
    zoom = easeZoom(zoom, 1000, 1 / 60);
    assert.ok(zoom >= last && zoom <= ZOOM_MAX + 1e-12);
    assert.ok(zoom - last < 0.01, 'no visible step in one frame');
    last = zoom;
  }
  assert.ok(ZOOM_MAX - zoom < 0.001, 'settles at the full zoom-out');
  assert.ok(zoomedFov(1, 0.15) > 1 && zoomedFov(1, 0) === 1);
});
