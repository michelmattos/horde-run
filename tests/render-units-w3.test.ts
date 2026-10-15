// World 3 crowd and unit-effect logic (no Babylon): batches for the archer, the Wind-up
// Robot champion and the enemy tin robot, loadout ids, the wind-up gait and key, the
// arrow flight, the gate-walk glints and the Gear Gun's ratchet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT, UNIT_VARIANT, UnitKind } from '../src/contracts.ts';
import {
  ARROW_FROM_Y,
  ARROW_TIME,
  ARROW_TO_Y,
  ENEMY_SLOTS,
  GaitTracker,
  HOP_STYLE,
  ROBOT_RADIUS,
  SLOT,
  SLOT_COUNT,
  WALK_GLINTS,
  WALK_SPAN,
  arrowAt,
  arrowDuration,
  crowdScale,
  crowdSlot,
  gearRatchet,
  parseCannon,
  parseChampion,
  rotateLocal,
  slotStyle,
  tinRock,
  walkGlintOffset,
  walkGlintScale,
  walkTickAngle,
} from '../src/render/crowdLogic.ts';
import { writeTRS } from '../src/render/fxLogic.ts';

test('archer, Wind-up Robot and tin robot each get their own batch', () => {
  const archer = crowdSlot(UnitKind.Mob, UNIT_VARIANT.archer);
  const windup = crowdSlot(UnitKind.Champion, UNIT_VARIANT.windup);
  const robot = crowdSlot(UnitKind.Mob, UNIT_VARIANT.robot);
  assert.equal(archer, SLOT.archer);
  assert.equal(windup, SLOT.windup);
  assert.equal(robot, SLOT.robot);
  const all = new Set<number>(Object.values(SLOT));
  assert.equal(all.size, SLOT_COUNT, 'slots are 0..SLOT_COUNT-1 without gaps');
  for (const s of all) assert.ok(s >= 0 && s < SLOT_COUNT);
  // Earlier figures keep their batches.
  assert.equal(crowdSlot(UnitKind.Mob, UNIT_VARIANT.rifleman), SLOT.rifleman);
  assert.equal(crowdSlot(UnitKind.Champion, UNIT_VARIANT.sarge), SLOT.champion);
  assert.equal(crowdSlot(UnitKind.Champion, UNIT_VARIANT.knight), SLOT.knight);
  assert.equal(crowdSlot(UnitKind.Mob, UNIT_VARIANT.snowball), SLOT.snowball);
});

test('a robot is an enemy figure whatever its kind; the archer and windup are not', () => {
  for (const kind of [UnitKind.Mob, UnitKind.Champion]) assert.equal(crowdSlot(kind, UNIT_VARIANT.robot), SLOT.robot);
  assert.ok(ENEMY_SLOTS.includes(SLOT.robot));
  assert.ok(!ENEMY_SLOTS.includes(SLOT.archer));
  assert.ok(!ENEMY_SLOTS.includes(SLOT.windup));
});

test('scales: archer on the mob scale, windup on the champion scale, robot on its own', () => {
  assert.equal(crowdScale(SLOT.archer, LAYOUT.mobRadius), 1);
  assert.equal(crowdScale(SLOT.windup, LAYOUT.championRadius), 1);
  assert.equal(crowdScale(SLOT.robot, ROBOT_RADIUS), 1);
  assert.ok(Math.abs(crowdScale(SLOT.robot, 0.72) - 2) < 1e-9);
  for (const s of [SLOT.archer, SLOT.windup, SLOT.robot]) assert.ok(crowdScale(s, 0) > 0, 'radius 0 still draws');
});

test('hop styles of the World 3 figures', () => {
  assert.equal(slotStyle(SLOT.archer, 'sarge'), HOP_STYLE.archer);
  assert.equal(slotStyle(SLOT.robot, 'sarge'), HOP_STYLE.robot);
  assert.equal(slotStyle(SLOT.windup, 'sarge'), HOP_STYLE.windup);
  assert.equal(slotStyle(SLOT.champion, 'windup'), HOP_STYLE.windup);
  // The tin robot barely lifts off the floor: a stiff rock, not a hop.
  assert.ok(HOP_STYLE.robot.height < HOP_STYLE.rifleman.height / 2);
  assert.ok(HOP_STYLE.robot.waddle > HOP_STYLE.rifleman.waddle);
});

test('loadout ids: gear-gun and windup parse, unknown ids fall back', () => {
  assert.equal(parseCannon('gear-gun'), 'gear-gun');
  assert.equal(parseChampion('windup'), 'windup');
  assert.equal(parseCannon('snowball-launcher'), 'snowball-launcher');
  assert.equal(parseChampion('drummer'), 'drummer');
  assert.equal(parseCannon('nope'), 'popgun');
  assert.equal(parseChampion(undefined), 'sarge');
});

test('the gait tracker reads walking and standing off the motion', () => {
  const g = new GaitTracker();
  const dt = 1 / 60;
  g.step(3, 0, 10, dt);
  assert.equal(g.move, 1, 'first sighting starts walking');
  // Standing still for half a second settles to ~0, and the key slows to its idle rate.
  for (let k = 0; k < 30; k++) g.step(3, 0, 10, dt);
  assert.ok(g.move < 0.05, `standing: ${g.move}`);
  const keyA = g.key;
  g.step(3, 0, 10, dt);
  const idle = (g.key - keyA + Math.PI * 2) % (Math.PI * 2);
  // Walking at 6 u/s brings it back up and the key turns faster.
  let z = 10;
  for (let k = 0; k < 30; k++) g.step(3, 0, (z += 6 * dt), dt);
  assert.ok(g.move > 0.95, `walking: ${g.move}`);
  const keyB = g.key;
  g.step(3, 0, (z += 6 * dt), dt);
  const run = (g.key - keyB + Math.PI * 2) % (Math.PI * 2);
  assert.ok(run > idle * 3, `key runs faster walking (${run}) than standing (${idle})`);
  // Frozen (live 0): the key stops.
  const keyC = g.key;
  g.step(3, 0, z, dt, 0);
  assert.equal(g.key, keyC);
  // A big jump means another unit took the slot: it starts afresh.
  g.step(3, 4, 30, dt);
  assert.equal(g.move, 1);
});

test('tinRock is a clipped rock in -1..1 that holds at the ends', () => {
  let held = 0;
  for (let i = 0; i < 200; i++) {
    const v = tinRock((i / 200) * Math.PI * 2);
    assert.ok(v >= -1 && v <= 1);
    if (Math.abs(v) === 1) held++;
  }
  assert.ok(held > 40, 'spends a good share of the cycle held on one foot');
});

test('rotateLocal matches writeTRS (the key hangs on the hopping figure)', () => {
  const m = new Float32Array(16);
  const out = { x: 0, y: 0, z: 0 };
  for (const [yaw, pitch, roll] of [
    [0, 0, 0],
    [Math.PI, 0.16, -0.1],
    [-0.7, 0.05, 0.3],
    [2.1, -0.4, 1.2],
  ]) {
    writeTRS(m, 0, 0, 0, 0, 1, 1, 1, yaw, pitch, roll);
    const [x, y, z] = [0.1, 0.6, -0.17];
    rotateLocal(x, y, z, yaw, pitch, roll, out);
    const ex = x * m[0] + y * m[4] + z * m[8];
    const ey = x * m[1] + y * m[5] + z * m[9];
    const ez = x * m[2] + y * m[6] + z * m[10];
    assert.ok(Math.abs(out.x - ex) < 1e-6 && Math.abs(out.y - ey) < 1e-6 && Math.abs(out.z - ez) < 1e-6);
  }
});

test('arrows fly a short arc from the bow to the target', () => {
  const p = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  arrowAt(0, 1, 10, 3, 18, p);
  assert.deepEqual([p.x, p.z], [1, 10]);
  assert.ok(Math.abs(p.y - ARROW_FROM_Y) < 1e-9);
  assert.ok(p.pitch < 0, 'leaves nose up');
  arrowAt(1, 1, 10, 3, 18, p);
  assert.deepEqual([p.x, p.z], [3, 18]);
  assert.ok(Math.abs(p.y - ARROW_TO_Y) < 1e-9);
  assert.ok(p.pitch > 0, 'lands nose down');
  arrowAt(0.5, 1, 10, 3, 18, p);
  assert.ok(p.y > ARROW_FROM_Y, 'arcs above the bow mid-flight');
  assert.ok(Math.abs(p.yaw - Math.atan2(2, 8)) < 1e-9, 'heads at the target');
  // Clamped outside 0..1; quick for close shots, never longer than ARROW_TIME.
  arrowAt(2, 1, 10, 3, 18, p);
  assert.deepEqual([p.x, p.z], [3, 18]);
  assert.ok(arrowDuration(1) < arrowDuration(6));
  assert.equal(arrowDuration(100), ARROW_TIME);
  assert.ok(arrowDuration(0) > 0);
});

test('gate-walk glints spread over the line, pop in from the middle and drop away', () => {
  const offs = Array.from({ length: WALK_GLINTS }, (_, j) => walkGlintOffset(j));
  assert.equal(offs[0], 0);
  assert.equal(new Set(offs).size, WALK_GLINTS, 'distinct spots');
  assert.ok(Math.max(...offs.map(Math.abs)) <= WALK_SPAN + 1e-9);
  assert.ok(Math.abs(Math.max(...offs) - WALK_SPAN) < 1e-9 && Math.abs(Math.min(...offs) + WALK_SPAN) < 1e-9);
  const sec = 2;
  assert.equal(walkGlintScale(0, -0.1, sec), 0);
  assert.equal(walkGlintScale(0, sec, sec), 0);
  assert.equal(walkGlintScale(0, 1, sec), 1);
  assert.ok(walkGlintScale(0, 0.1, sec) > walkGlintScale(WALK_GLINTS - 1, 0.1, sec), 'middle first');
  assert.ok(walkGlintScale(3, sec - 0.02, sec) < 0.3, 'dropping away at the end');
  // Ticks: whole teeth between ticks, monotonic.
  let last = -1;
  for (let t = 0; t < 2; t += 0.01) {
    const a = walkTickAngle(t, 8);
    assert.ok(a >= last - 1e-9);
    last = a;
  }
  assert.ok(Math.abs(walkTickAngle(0.25 * 0.5, 8) - (Math.PI * 2) / 8) < 1e-9, 'a tick snaps a whole tooth');
});

test('the Gear Gun ratchets one tooth per shot', () => {
  const tooth = (Math.PI * 2) / 16;
  assert.equal(gearRatchet(0, 16), 0);
  assert.ok(Math.abs(gearRatchet(1, 16) - tooth) < 1e-9);
  assert.ok(Math.abs(gearRatchet(3.5, 16) - 4 * tooth) < 1e-9, 'holds after the snap');
  assert.ok(gearRatchet(3.1, 16) > 3 * tooth && gearRatchet(3.1, 16) < 4 * tooth, 'mid-snap');
});
