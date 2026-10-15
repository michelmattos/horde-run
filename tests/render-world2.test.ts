// Pure World 2 render bookkeeping (no Babylon): the room slot that keeps exactly one
// theme's assets alive, freezer scenery placement, the frozen gate's crack stages and
// thaw style, gust strength, the snowball arc and fork signposts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREEZER_RADIUS,
  RoomSlot,
  SCENERY_CLEARANCE,
  forkSigns,
  roomThemeOf,
  scatterFreezerScenery,
} from '../src/render/fxLogic.ts';
import type { Rect, RoomTheme } from '../src/render/fxLogic.ts';

interface FakeRoom {
  theme: RoomTheme;
  serial: number;
  disposed: boolean;
}

function slotLog() {
  const built: FakeRoom[] = [];
  const released: { theme: RoomTheme; room: FakeRoom }[] = [];
  let serial = 0;
  const slot = new RoomSlot<FakeRoom>(
    (theme) => {
      const room = { theme, serial: ++serial, disposed: false };
      built.push(room);
      return room;
    },
    (theme, room) => {
      room.disposed = true;
      released.push({ theme, room });
    },
  );
  return { slot, built, released };
}

test('theme of a level: absent and unknown themes play in the bedroom', () => {
  assert.equal(roomThemeOf({}), 'bedroom');
  assert.equal(roomThemeOf({ theme: 'bedroom' }), 'bedroom');
  assert.equal(roomThemeOf({ theme: 'freezer' }), 'freezer');
});

test('room slot: a theme change disposes the old room before the new one is used', () => {
  const { slot, built, released } = slotLog();
  const bedroom = slot.use('bedroom');
  assert.equal(slot.theme, 'bedroom');
  assert.equal(released.length, 0);
  const freezer = slot.use('freezer');
  assert.equal(slot.theme, 'freezer');
  assert.equal(bedroom.disposed, true, 'old bedroom released');
  assert.equal(freezer.disposed, false);
  assert.deepEqual(
    released.map((r) => [r.theme, r.room.serial]),
    [['bedroom', bedroom.serial]],
  );
  // Back to the bedroom: a fresh build, the freezer goes.
  const again = slot.use('bedroom');
  assert.notEqual(again, bedroom);
  assert.equal(freezer.disposed, true);
  assert.equal(built.filter((r) => !r.disposed).length, 1, 'only one room alive at a time');
});

test('room slot: the same theme keeps its assets (retry / next level)', () => {
  const { slot, built, released } = slotLog();
  const a = slot.use('freezer');
  const b = slot.use('freezer');
  assert.equal(a, b);
  assert.equal(built.length, 1);
  assert.equal(released.length, 0);
  slot.clear();
  assert.equal(a.disposed, true);
  assert.equal(slot.theme, null);
  slot.clear(); // idempotent
  assert.equal(released.length, 1);
});

test('freezer scenery never enters the lane (plus clearance) nor an ice wall', () => {
  const laneWidth = 10;
  const walls: Rect[] = [
    { x: -4.5, z: 20, width: 5, depth: 1.2 }, // pokes past the left edge
    { x: 5.5, z: 34, width: 6, depth: 1.5 }, // pokes past the right edge
  ];
  for (let seed = 1; seed <= 25; seed++) {
    const props = scatterFreezerScenery(seed * 977, laneWidth, -8, 70, 60, 9, walls);
    assert.ok(props.length > 20, `seed ${seed}: ${props.length} props`);
    for (const p of props) {
      const r = FREEZER_RADIUS[p.kind] * p.scale;
      assert.ok(Math.abs(p.x) - r >= laneWidth / 2 + SCENERY_CLEARANCE - 1e-9, `${p.kind} in the lane at x=${p.x}`);
      for (const w of walls) {
        const dx = Math.max(0, Math.abs(p.x - w.x) - w.width / 2);
        const dz = Math.max(0, Math.abs(p.z - w.z) - w.depth / 2);
        assert.ok(Math.hypot(dx, dz) >= r + SCENERY_CLEARANCE - 1e-9, `${p.kind} on ice wall at ${p.x},${p.z}`);
      }
    }
  }
});

test('freezer scenery: stable per seed, never overlapping', () => {
  const a = scatterFreezerScenery(42, 8, 0, 60, 50, 9);
  assert.deepEqual(a, scatterFreezerScenery(42, 8, 0, 60, 50, 9));
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) {
      const d = Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z);
      assert.ok(d >= FREEZER_RADIUS[a[i].kind] * a[i].scale + FREEZER_RADIUS[a[j].kind] * a[j].scale - 1e-9);
    }
});

test('fork signs: one between each neighbouring pair of a fork, none for lone gates', () => {
  const signs = forkSigns([
    { fork: 'a', x: 2.5, z: 20, width: 3 },
    { fork: 'a', x: -2.5, z: 20, width: 3 },
    { fork: 'b', x: 0, z: 40, width: 4 }, // lone fork id: no sign
    { x: 0, z: 10, width: 6 },
  ]);
  assert.equal(signs.length, 1);
  assert.equal(signs[0].fork, 'a');
  assert.equal(signs[0].x, 0);
  assert.equal(signs[0].z, 20);
  assert.equal(signs[0].span, 2);
});
