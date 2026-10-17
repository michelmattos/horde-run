// Pure render-side logic: adaptive resolution and camera framing (no Babylon).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResolutionScaler } from '../src/render/resolution.ts';
import {
  FAR_NDC_Y,
  NEAR_NDC_Y,
  ZOOM_MAX,
  computeFraming,
  projectNdc,
  crowdZoomTarget,
  easeZoom,
  screenRows,
  zoomedFov,
} from '../src/render/framing.ts';

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
  assert.deepEqual(screenRows(844, 70, 120), { near: NEAR_NDC_Y, far: FAR_NDC_Y });
  const notched = screenRows(844, 47 + 70, 34 + 190);
  assert.ok(notched.far < FAR_NDC_Y && notched.near > NEAR_NDC_Y);
  assert.ok(Math.abs(((1 - notched.far) / 2) * 844 - 117) < 1e-6, 'far row sits at the HUD bottom');
  const tiny = screenRows(200, 120, 120);
  assert.ok(tiny.far - tiny.near >= 0.6 - 1e-9);
});

test('framing keeps the whole rug and the enemy fort on screen, as close as that allows', () => {
  for (const aspect of [390 / 844, 0.42, 0.75]) {
    for (const length of [45, 55, 70]) {
      const farNdcY = 0.72;
      const top = { y: 6, z: length + 2 };
      const input = { aspect, laneWidth: 10, margin: 0.4, nearZ: -3.2, farZ: length + 4, farNdcY, top, topNdcY: 0.78 };
      const f = computeFraming(input);
      const shown = Math.min(aspect, 0.5);
      const slack: number[] = [];
      for (const x of [-5.4, 5.4]) {
        for (const z of [input.nearZ, input.farZ]) {
          const p = projectNdc(f, x, 0, z, shown);
          assert.ok(p, `corner (${x}, ${z}) in front of the camera`);
          const [nx, ny] = p;
          const where = `aspect ${aspect.toFixed(2)} lane ${length} corner (${x}, ${z}): ${nx.toFixed(3)}, ${ny.toFixed(3)}`;
          assert.ok(Math.abs(nx) <= 0.97 + 1e-6, where);
          assert.ok(ny >= -0.97 - 1e-6 && ny <= farNdcY + 1e-6, where);
          slack.push(0.97 - Math.abs(nx), ny + 0.97, farNdcY - ny);
        }
      }
      const p = projectNdc(f, 0, top.y, top.z, shown);
      assert.ok(p && p[1] <= 0.78 + 1e-6, `fort top at ${p?.[1]}`);
      if (p) slack.push(0.78 - p[1]);
      // As close as allowed: moving any nearer would push something off screen.
      assert.ok(Math.min(...slack) < 1e-3, `closest bound has ${Math.min(...slack)} spare`);
    }
  }
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
