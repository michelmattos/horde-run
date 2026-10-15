// Home base village data and math: the tier-to-piece tables (four visibly different
// tiers, tier 0 an empty taped plot), plots apart on the rug, the fixed camera keeping the
// whole village in the free band at phone and desktop shapes, tap picking, the build
// animation timing and the box AO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_IDS,
  MAX_BUILD_TIER,
  PLOTS,
  allPieces,
  clampTier,
  isBuildingId,
  piecesAt,
  tierDiff,
} from '../src/home/villagePieces.ts';
import {
  DROP_TIME,
  SOLDIER_SPOTS,
  SQUASH_TIME,
  VILLAGE_POINTS,
  boxAO,
  buildingBounds,
  dropGroups,
  dropPose,
  dropSchedule,
  frameVillage,
  idlePose,
  pickBuilding,
  pieceAabb,
  project,
  rayBox,
  rotate,
} from '../src/home/villageMath.ts';
import { buildingCardLook, grownBuildings, tiersOf } from '../src/home/homeLogic.ts';

const HEX = /^#[0-9a-f]{6}$/i;

test('five buildings with the fixed ids', () => {
  assert.deepEqual(BUILDING_IDS, ['barracks', 'walls', 'workshop', 'garden', 'flagpole']);
  assert.ok(isBuildingId('garden'));
  assert.ok(!isBuildingId('castle'));
  assert.equal(MAX_BUILD_TIER, 3);
});

test('every piece is well formed', () => {
  for (const id of BUILDING_IDS) {
    for (const q of allPieces(id)) {
      assert.match(q.color, HEX, `${id} colour`);
      for (const v of [q.x, q.y, q.z, q.w, q.h, q.d]) assert.ok(Number.isFinite(v), `${id} finite`);
      assert.ok(q.w > 0 && q.h > 0 && q.d > 0, `${id} ${q.shape} has size`);
      assert.ok(q.y >= -1e-9, `${id} nothing below the floor`);
      assert.ok(q.tier >= 0 && q.tier <= 3, `${id} tier`);
      if (q.until !== undefined) assert.ok(q.until > q.tier, `${id} cleared after it appears`);
    }
  }
});

test('tier 0 is a taped-off plot with a few loose pieces, cleared at tier 1', () => {
  for (const id of BUILDING_IDS) {
    const t0 = piecesAt(id, 0);
    assert.ok(t0.length > 0, id);
    assert.ok(
      t0.every((q) => q.until === 1),
      `${id}: everything at tier 0 is temporary`,
    );
    assert.ok(
      t0.some((q) => q.shape === 'plate' && q.mat === 'paper'),
      `${id} has tape`,
    );
    assert.ok(
      t0.every((q) => pieceAabb(q).max[1] < 1.6),
      `${id}: nothing tall on an empty plot`,
    );
  }
});

test('each tier visibly differs from the one before and builds up', () => {
  for (const id of BUILDING_IDS) {
    for (let t = 1; t <= 3; t++) {
      const d = tierDiff(id, t - 1, t);
      assert.ok(d.added.length >= 3, `${id} tier ${t} adds pieces (${d.added.length})`);
      const vol = (list: ReturnType<typeof piecesAt>): number => list.reduce((s, q) => s + q.w * q.h * q.d, 0);
      if (t >= 2) assert.ok(vol(piecesAt(id, t)) > vol(piecesAt(id, t - 1)) * 0.9, `${id} grows at ${t}`);
    }
    const h = [1, 2, 3].map((t) => buildingBounds(id, t).max[1]);
    assert.ok(h[2] >= h[0], `${id} the finished building is at least as tall as tier 1`);
  }
});

test('tierDiff and piecesAt agree; tiers clamp', () => {
  for (const id of BUILDING_IDS) {
    const d = tierDiff(id, 0, 3);
    const at0 = new Set(piecesAt(id, 0));
    const at3 = new Set(piecesAt(id, 3));
    for (const q of d.added) assert.ok(at3.has(q) && !at0.has(q));
    for (const q of d.removed) assert.ok(at0.has(q) && !at3.has(q));
    assert.deepEqual(piecesAt(id, 9), piecesAt(id, 3));
    assert.deepEqual(piecesAt(id, -2), piecesAt(id, 0));
  }
  assert.equal(clampTier(Number.NaN), 0);
  assert.equal(clampTier(2.7), 2);
});

test('plots do not overlap, sit on the rug, and buildings stay inside their plots', () => {
  const ids = BUILDING_IDS;
  for (let i = 0; i < ids.length; i++) {
    const a = PLOTS[ids[i]];
    assert.ok(Math.abs(a.x) + a.w / 2 <= 6.5 && a.z - a.d / 2 >= -7.5 && a.z + a.d / 2 <= 11.5, `${a.id} on the rug`);
    for (let j = i + 1; j < ids.length; j++) {
      const b = PLOTS[ids[j]];
      const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2;
      assert.ok(apart, `${a.id} / ${b.id}`);
    }
  }
  for (const id of ids) {
    const p = PLOTS[id];
    for (let t = 0; t <= 3; t++) {
      const b = buildingBounds(id, t);
      assert.ok(b.min[0] >= p.x - p.w / 2 - 0.35 && b.max[0] <= p.x + p.w / 2 + 0.35, `${id} t${t} x`);
      assert.ok(b.min[2] >= p.z - p.d / 2 - 0.35 && b.max[2] <= p.z + p.d / 2 + 0.35, `${id} t${t} z`);
    }
  }
});

test('soldiers stand clear of every finished building', () => {
  for (const s of SOLDIER_SPOTS) {
    for (const id of BUILDING_IDS) {
      const b = buildingBounds(id, 3);
      const inside = s.x > b.min[0] + 0.1 && s.x < b.max[0] - 0.1 && s.z > b.min[2] + 0.1 && s.z < b.max[2] - 0.1;
      assert.ok(!inside, `soldier at ${s.x},${s.z} inside ${id}`);
    }
  }
});

test('rotation follows Babylon yaw-pitch-roll', () => {
  const close = (a: number[], b: number[]): void =>
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a.join()} ~ ${b.join()}`));
  close(rotate([1, 0, 0], 0, Math.PI / 2, 0), [0, 0, -1]); // yaw turns +x toward -z
  close(rotate([0, 0, 1], 0, Math.PI / 2, 0), [1, 0, 0]);
  close(rotate([0, 1, 0], Math.PI / 2, 0, 0), [0, 0, 1]); // pitch turns +y toward +z
  close(rotate([1, 0, 0], 0, 0, Math.PI / 2), [0, 1, 0]); // roll turns +x toward +y
});

const SHAPES: [string, number, number][] = [
  ['iPhone portrait', 390, 844],
  ['small phone', 320, 568],
  ['tablet', 820, 1180],
  ['desktop', 1440, 900],
];

for (const [name, w, h] of SHAPES) {
  test(`camera frames the whole village in the free band (${name})`, () => {
    const band = { top: 80 / h, bottom: 270 / h };
    const f = frameVillage(w / h, band);
    for (const pt of VILLAGE_POINTS) {
      const [x, y, z] = project(pt, f.position, f.target, f.fov, w / h);
      assert.ok(z > 0, 'in front');
      assert.ok(Math.abs(x) <= 1, `x ${x.toFixed(3)}`);
      assert.ok(y <= 1 - 2 * band.top + 1e-6, `below the header (${y.toFixed(3)})`);
      assert.ok(y >= -1 + 2 * band.bottom - 1e-6, `above the sheet (${y.toFixed(3)})`);
    }
    // Fixed 3/4 view: looking down at the same pitch whatever the screen.
    const dy = f.target[1] - f.position[1];
    const dz = f.target[2] - f.position[2];
    assert.ok(Math.abs(Math.atan2(-dy, dz) - 0.8) < 1e-6);
    assert.equal(f.position[0], 0);
  });
}

test('the village fills the width on a phone', () => {
  const a = 390 / 844;
  const f = frameVillage(a, { top: 0.1, bottom: 0.32 });
  const xs = VILLAGE_POINTS.map((p) => Math.abs(project(p, f.position, f.target, f.fov, a)[0]));
  assert.ok(Math.max(...xs) > 0.85, 'not shrunk into the middle');
});

test('rayBox hits, misses and starts inside', () => {
  const b = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
  assert.equal(rayBox([-1, 0.5, 0.5], [1, 0, 0], b), 1);
  assert.equal(rayBox([-1, 2, 0.5], [1, 0, 0], b), null);
  assert.equal(rayBox([0.5, 0.5, 0.5], [0, 1, 0], b), 0);
  assert.equal(rayBox([2, 0.5, 0.5], [1, 0, 0], b), null);
});

test('tapping a building from the camera picks it', () => {
  const tiers = { barracks: 3, walls: 3, workshop: 3, garden: 3, flagpole: 3 };
  const f = frameVillage(390 / 844, { top: 0.1, bottom: 0.32 });
  for (const id of BUILDING_IDS) {
    const p = PLOTS[id];
    const b = buildingBounds(id, 3);
    const aim: [number, number, number] = [p.x, (b.max[1] + b.min[1]) / 2, p.z];
    const dir: [number, number, number] = [aim[0] - f.position[0], aim[1] - f.position[1], aim[2] - f.position[2]];
    assert.equal(pickBuilding(f.position, dir, tiers), id, id);
  }
  // Empty rug and the sky pick nothing.
  assert.equal(pickBuilding([5.2, 20, -20], [0, -20, 15.2], tiers), null);
  assert.equal(pickBuilding([0, 20, -20], [0, 0.2, 1], tiers), null);
  // An empty plot is still tappable (its footprint).
  const g = PLOTS.garden;
  assert.equal(pickBuilding([g.x, 10, g.z - 6], [0, -10, 6], {}), 'garden');
});

test('drop animation: lowest first, stagger bounded, squash settles to rest', () => {
  const pieces = [
    { y: 1, z: 0 },
    { y: 0, z: 1 },
    { y: 0, z: -1 },
  ];
  const d = dropSchedule(pieces);
  assert.ok(d[2] < d[1] && d[1] < d[0], 'bottom-front first');
  const many = dropSchedule(Array.from({ length: 200 }, (_, i) => ({ y: i * 0.01, z: 0 })));
  assert.ok(Math.max(...many) <= 1.11, 'whole build stays short');
  assert.equal(dropPose(-0.1).visible, false);
  const mid = dropPose(DROP_TIME / 2);
  assert.ok(mid.y > 0 && mid.visible);
  const land = dropPose(DROP_TIME + 0.01);
  assert.equal(land.y, 0);
  assert.ok(land.sy < 1 && land.sxz > 1, 'squash on landing');
  const end = dropPose(DROP_TIME + SQUASH_TIME + 0.01);
  assert.deepEqual([end.y, end.sy, end.sxz, end.done], [0, 1, 1, true]);
});

test('details drop together with the block they are stuck to', () => {
  const walls1 = tierDiff('walls', 0, 1).added;
  const g = dropGroups(walls1);
  const leaders = new Set(g);
  const blocks = walls1.filter((q) => q.shape === 'box');
  assert.equal(leaders.size, blocks.length, 'one group per block');
  g.forEach((l, i) => assert.equal(walls1[l].shape === 'box' || l === i, true));
});

test('idle sway fades to exact rest', () => {
  for (let i = 0; i < 4; i++) {
    const p = idlePose(i, 1.234 * i, 0);
    assert.deepEqual([p.sy, p.yaw, p.lean], [1, 0, 0]);
    const q = idlePose(i, 0.7 + i, 1);
    assert.ok(Math.abs(q.sy - 1) <= 0.03 && Math.abs(q.yaw) <= 0.08);
  }
});

test('box AO darkens a vertex next to another piece and leaves open ones lit', () => {
  // Vertex 0: on the floor beside a block, facing it; vertex 1: high up in the open.
  const pos = [0.05, 0.3, 0, 0, 5, 0];
  const nrm = [1, 0, 0, 0, 1, 0];
  const owner = [99, 99];
  const boxes = [{ min: [0.1, 0, -0.5] as [number, number, number], max: [1, 1, 0.5] as [number, number, number] }];
  const ao = boxAO(pos, nrm, owner, boxes);
  assert.ok(ao[0] < 0.75, `occluded ${ao[0]}`);
  assert.equal(ao[1], 1);
  // A piece never occludes itself.
  const self = boxAO(pos, nrm, [0, 0], boxes);
  assert.ok(self[0] > ao[0]);
});

test('building cards say what the button does', () => {
  const b = {
    id: 'barracks',
    name: 'Barracks',
    tier: 0,
    maxTier: 3,
    perkNow: '',
    nextCost: 60,
    canAfford: true,
  };
  assert.deepEqual(buildingCardLook(b), { tierText: 'Empty plot', label: 'Build', action: 'build', why: '' });
  assert.equal(buildingCardLook({ ...b, tier: 1, nextCost: 150 }).label, 'Upgrade');
  assert.equal(buildingCardLook({ ...b, canAfford: false }).action, 'poor');
  assert.equal(buildingCardLook({ ...b, lockedReason: 'Win 1-5 first' }).action, 'locked');
  assert.equal(buildingCardLook({ ...b, tier: 3, nextCost: null }).action, 'built');
  assert.equal(buildingCardLook({ ...b, tier: 3, nextCost: null }).tierText, 'Tier 3/3');
});

test('only buildings that went up animate, never on the first view', () => {
  const a = tiersOf([
    { id: 'barracks', tier: 1 },
    { id: 'walls', tier: 2 },
    { id: 'castle', tier: 3 },
  ]);
  assert.deepEqual(a, { barracks: 1, walls: 2, workshop: 0, garden: 0, flagpole: 0 });
  assert.deepEqual(grownBuildings(null, a), []);
  const b = { ...a, barracks: 2, walls: 1 };
  assert.deepEqual(grownBuildings(a, b), ['barracks']);
  assert.deepEqual(tiersOf([{ id: 'garden', tier: 7 }]).garden, 3);
});
