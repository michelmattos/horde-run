// World map layout math: nodes stay on screen, climb upward and never overlap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLayout } from '../src/meta/mapLayout.ts';

for (const width of [320, 375, 430, 480]) {
  test(`mapLayout keeps 10 nodes inside ${width}px, rising and apart`, () => {
    const size = 64;
    const margin = 16;
    const pts = mapLayout(10, width, { nodeSize: size, margin });
    assert.equal(pts.length, 10);
    for (const p of pts) {
      assert.ok(p.x - size / 2 >= margin - 1e-9, `left edge ${p.x}`);
      assert.ok(p.x + size / 2 <= width - margin + 1e-9, `right edge ${p.x}`);
    }
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i].y > pts[i - 1].y, 'increasing upward');
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= size, `nodes ${i},${j} overlap`);
    const xs = pts.map((p) => p.x);
    assert.ok(Math.max(...xs) - Math.min(...xs) > size, 'the path actually winds');
  });
}

test('mapLayout degrades gracefully', () => {
  assert.deepEqual(mapLayout(0, 400), []);
  const narrow = mapLayout(5, 80, { nodeSize: 64, margin: 16 });
  for (const p of narrow) assert.equal(p.x, 40, 'too narrow to swing: straight up the middle');
  const tight = mapLayout(4, 400, { nodeSize: 90, step: 10 });
  for (let i = 1; i < tight.length; i++) assert.ok(tight[i].y - tight[i - 1].y >= 90, 'step never below node size');
});
