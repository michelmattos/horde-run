// World 2 crowd logic (no Babylon): batches for the new figures, snowball rolling and the
// Blizzard frost tint on the enemy crowd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT_VARIANT, UnitKind } from '../src/contracts.ts';
import {
  ENEMY_SLOTS,
  FROST_FADE,
  RollTracker,
  SLOT,
  SLOT_COUNT,
  crowdSlot,
  frostAmount,
  frostColor,
  snowballRoll,
} from '../src/render/crowdLogic.ts';

const KINDS = [UnitKind.Mob, UnitKind.Champion];

test('every World 2 variant gets its own batch', () => {
  const giant = crowdSlot(UnitKind.Champion, UNIT_VARIANT.giant);
  const snowball = crowdSlot(UnitKind.Mob, UNIT_VARIANT.snowball);
  const snowman = crowdSlot(UnitKind.Mob, UNIT_VARIANT.snowman);
  const penguin = crowdSlot(UnitKind.Mob, UNIT_VARIANT.penguin);
  const old = new Set<number>([
    crowdSlot(UnitKind.Mob, UNIT_VARIANT.rifleman),
    crowdSlot(UnitKind.Mob, UNIT_VARIANT.sprinter),
    crowdSlot(UnitKind.Mob, UNIT_VARIANT.bomber),
    crowdSlot(UnitKind.Champion, UNIT_VARIANT.knight),
    crowdSlot(UnitKind.Champion, UNIT_VARIANT.sarge),
  ]);
  const fresh = [giant, snowball, snowman, penguin];
  assert.equal(new Set(fresh).size, 4, 'four distinct batches');
  for (const s of fresh) {
    assert.ok(!old.has(s), `slot ${s} is not a Milestone 4 batch`);
    assert.ok(s >= 0 && s < SLOT_COUNT);
  }
  // A Giant is the Giant whether the battle spawns it as a heavy (champion kind) or a mob.
  assert.equal(crowdSlot(UnitKind.Mob, UNIT_VARIANT.giant), giant);
});

test('an enemy snowman or penguin never lands in a player figure batch', () => {
  const playerSlots = [
    SLOT.rifleman,
    SLOT.knight,
    SLOT.sprinter,
    SLOT.bomber,
    SLOT.champion,
    SLOT.giant,
    SLOT.snowball,
  ];
  for (const kind of KINDS) {
    for (const v of [UNIT_VARIANT.snowman, UNIT_VARIANT.penguin]) {
      const slot = crowdSlot(kind, v);
      assert.ok(ENEMY_SLOTS.includes(slot), `variant ${v} kind ${kind} -> enemy figure`);
      assert.ok(!playerSlots.includes(slot as (typeof playerSlots)[number]));
    }
  }
  assert.equal(crowdSlot(UnitKind.Champion, UNIT_VARIANT.snowman), SLOT.snowman);
});

test('a snowball turns distance / radius radians, integrated as it grows', () => {
  assert.ok(Math.abs(snowballRoll(Math.PI, 0.5) - 2 * Math.PI) < 1e-12, 'pi units at r 0.5 is one turn');
  const t = new RollTracker();
  t.step(3, 0, 10, 0.5);
  const start = t.pitch;
  // Roll 1 unit at r 0.5 (2 rad), then grow to r 1 and roll 1 more unit (1 rad).
  for (let k = 1; k <= 10; k++) t.step(3, 0, 10 + k * 0.1, 0.5);
  t.step(3, 0, 11, 1); // grows in place: no turn
  assert.ok(Math.abs(t.pitch - (start + 2)) < 1e-5, `pitch ${t.pitch}`);
  for (let k = 1; k <= 10; k++) t.step(3, 0, 11 + k * 0.1, 1);
  assert.ok(Math.abs(t.pitch - ((start + 3) % (Math.PI * 2))) < 1e-5);
  // Sideways drift turns it about z, against the motion.
  const before = t.roll;
  t.step(3, 0.5, 12, 1);
  assert.ok(Math.abs(t.roll - (before - 0.5)) < 1e-5);
  // A far jump means the slot now holds another ball: it starts afresh, no huge spin.
  t.step(3, 4, 30, 1);
  assert.ok(Math.abs(t.roll) < 1e-9);
});

test('frost tints enemies toward ice and returns exactly to the team colour', () => {
  const team = [0.578, 0.371, 0.144];
  const out = [0, 0, 0];
  frostColor(team[0], team[1], team[2], frostAmount(4), out);
  assert.ok(out[2] > team[2] + 0.3, 'bluer while frozen');
  assert.ok(out[0] < team[0], 'less red while frozen');
  // Fades over the last FROST_FADE seconds and is gone at 0.
  assert.equal(frostAmount(FROST_FADE * 3), 1);
  assert.ok(frostAmount(FROST_FADE / 2) > 0 && frostAmount(FROST_FADE / 2) < 1);
  for (const left of [0, -1, undefined, Number.NaN]) {
    frostColor(team[0], team[1], team[2], frostAmount(left), out);
    assert.deepEqual(out, team, `enemyFrozen ${left}`);
  }
});
