// Expedition World 3 pieces: the workshop gate layouts (timed gates, belts, saws, a wind-up
// robot trickle), the Jack-in-the-Box as a third run boss, and the five World 3 upgrades on
// every template combination. Like the World 2 sweep, battles are composed straight from
// template picks so every workshop layout is covered with every lane and defender set,
// mirrored too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_FREE_BANDS,
  RUN_TEMPLATE_COUNTS,
  composeRunBattle,
  composeRunBoss,
  generateRunBattle,
  runBossModel,
  workshopLayout,
} from '../src/game/expedition.ts';
import type { RunBattlePicks } from '../src/game/expedition.ts';
import { UPGRADES, applyUpgrades } from '../src/expedition/index.ts';
import { EXPEDITION_KEY, loadExpedition, saveExpedition, emptyExpedition } from '../src/expedition/persist.ts';
import { battleSpec, chooseNode, finishBattle, newRun } from '../src/expedition/run.ts';
import { availableNodes } from '../src/expedition/map.ts';
import { validateLevel } from '../src/game/levels.ts';
import type { KeyValueStore } from '../src/core/save.ts';
import type { GateDef, LevelDef, RunBattleSpec } from '../src/contracts.ts';

type Build = Readonly<Record<string, number>>;

function everyBattle(): LevelDef[] {
  const out: LevelDef[] = [];
  const specs: RunBattleSpec[] = [
    { seed: 21, kind: 'battle', index: 0 },
    { seed: 22, kind: 'elite', index: 3 },
  ];
  for (const spec of specs)
    for (let lane = 0; lane < RUN_TEMPLATE_COUNTS.lanes; lane++)
      for (let gates = 0; gates < RUN_TEMPLATE_COUNTS.gates; gates++)
        for (let defenders = 0; defenders < RUN_TEMPLATE_COUNTS.defenders; defenders++)
          for (const mirror of [false, true]) {
            const picks: RunBattlePicks = { lane, gates, defenders, waves: (lane + gates) % 3, mirror, name: 0 };
            out.push(composeRunBattle(spec, picks));
          }
  return out;
}
const BATTLES = everyBattle();
const WORKSHOP = BATTLES.filter((l) => l.theme === 'workshop');
const JACKS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) =>
  composeRunBoss({ seed: 700 + k, kind: 'boss', index: 4 }, 'jackInTheBox'),
);
const BOSSES = [0, 1].flatMap((k) =>
  (['tinGeneral', 'snowGlobeGiant', 'jackInTheBox'] as const).map((m) =>
    composeRunBoss({ seed: 910 + k, kind: 'boss', index: 4 }, m),
  ),
);

const added = (l: LevelDef): GateDef[] => l.gates.filter((g) => g.id.startsWith('up-'));
const reach = (g: GateDef): number => g.width / 2 + Math.abs(g.move?.amplitude ?? 0);

test('the workshop layouts bring timed gates, belts, saws and a wind-up robot trickle', () => {
  assert.ok(WORKSHOP.length > 0 && WORKSHOP.length < BATTLES.length, 'some layouts play in the workshop, not all');
  assert.ok(WORKSHOP.some((l) => l.gates.some((g) => g.toggle)));
  assert.ok(
    WORKSHOP.some((l) => l.gates.some((g) => g.toggle?.alt)),
    'a timed gate that turns into a trap',
  );
  assert.ok(WORKSHOP.some((l) => (l.conveyors?.length ?? 0) > 0));
  assert.ok(WORKSHOP.some((l) => (l.saws?.length ?? 0) > 0));
  for (const l of WORKSHOP) {
    assert.equal(l.trickleMix?.unit, 'robot', `${l.id}: robots in the trickle`);
    assert.equal(l.ice ?? l.iceWalls, undefined, `${l.id}: no ice in the workshop`);
    assert.ok(
      l.gates.every((g) => !g.fork && !g.freeze),
      `${l.id}: no forks or freezing gates`,
    );
  }
  for (const l of BATTLES)
    if (l.theme !== 'workshop')
      assert.equal(l.conveyors ?? l.turntables ?? l.saws, undefined, `${l.id}: hazards only in the workshop`);
});

test('mirrored workshop layouts flip belts and saws with the gates', () => {
  const spec: RunBattleSpec = { seed: 33, kind: 'battle', index: 1 };
  for (let gates = 0; gates < RUN_TEMPLATE_COUNTS.gates; gates++) {
    const picks: RunBattlePicks = { lane: 0, gates, defenders: 0, waves: 0, mirror: false, name: 0 };
    const a = composeRunBattle(spec, picks);
    if (a.theme !== 'workshop') continue;
    const b = composeRunBattle(spec, { ...picks, mirror: true });
    assert.deepEqual(
      b.gates.map((g) => g.x || 0),
      a.gates.map((g) => -g.x || 0),
    );
    for (const [i, c] of (a.conveyors ?? []).entries()) {
      const m = b.conveyors![i];
      assert.equal(m.x || 0, -c.x || 0);
      assert.equal(m.vx || 0, -c.vx || 0);
      assert.equal(m.vz, c.vz);
    }
    for (const [i, s] of (a.saws ?? []).entries()) {
      const m = b.saws![i];
      assert.equal(m.x || 0, -s.x || 0);
      assert.equal(m.path?.dx || 0, -(s.path?.dx ?? 0) || 0);
    }
    for (const [i, t] of (a.turntables ?? []).entries()) assert.equal(b.turntables![i].spin || 0, -t.spin || 0);
  }
});

test('belts, turntables and saws stay inside the lane and out of the free bands', () => {
  for (const l of [...BATTLES, ...BOSSES]) {
    const hw = l.lane.width / 2 + 1e-9;
    const free = (z0: number, z1: number, what: string): void => {
      if (l.boss !== undefined) return;
      for (const [a, b] of RUN_FREE_BANDS) assert.ok(z1 < a || z0 > b, `${l.id}: ${what} in a free band`);
    };
    for (const c of l.conveyors ?? []) {
      assert.ok(Math.abs(c.x) + c.width / 2 <= hw, `${l.id}: ${c.id} outside the lane`);
      free(c.z, c.z + c.length, c.id);
    }
    for (const t of l.turntables ?? []) {
      assert.ok(Math.abs(t.x) + t.radius <= hw, `${l.id}: ${t.id} outside the lane`);
      free(t.z - t.radius, t.z + t.radius, t.id);
    }
    for (const s of l.saws ?? []) {
      const dx = s.path?.dx ?? 0;
      const dz = s.path?.dz ?? 0;
      assert.ok(Math.max(Math.abs(s.x), Math.abs(s.x + dx)) + s.radius <= hw, `${l.id}: ${s.id} outside the lane`);
      free(Math.min(s.z, s.z + dz) - s.radius, Math.max(s.z, s.z + dz) + s.radius, s.id);
    }
  }
});

test('a quarter of battle seeds play a workshop layout; the rest draw as before', () => {
  let workshop = 0;
  const n = 4000;
  for (let k = 0; k < n; k++) {
    const seed = (k * 2654435761 + 17) >>> 0;
    const w = workshopLayout(seed);
    assert.equal(workshopLayout(seed), w, 'deterministic');
    const l = generateRunBattle({ seed, kind: k % 2 ? 'battle' : 'elite', index: k % 4 });
    if (w >= 0) {
      workshop++;
      assert.equal(l.theme, 'workshop', `seed ${seed}`);
    } else assert.notEqual(l.theme, 'workshop', `seed ${seed}`);
  }
  assert.ok(workshop > 0.2 * n && workshop < 0.3 * n, `${workshop} of ${n}`);
});

test('the Jack-in-the-Box: workshop boss that shuffles the gates, faster each phase', () => {
  for (const boss of JACKS) {
    assert.equal(boss.name, 'Jack-in-the-Box');
    assert.equal(boss.theme, 'workshop');
    assert.equal(boss.boss?.model, 'jackInTheBox');
    const phases = boss.boss!.phases;
    assert.equal(phases.length, 3);
    for (const [i, p] of phases.entries()) {
      assert.ok(p.shuffle, `phase ${i + 1} shuffles`);
      assert.ok(p.shuffle.every > p.shuffle.warn + p.shuffle.glide);
      if (i > 0) {
        assert.ok(p.belowHp < phases[i - 1].belowHp);
        assert.ok(p.shuffle.every < phases[i - 1].shuffle!.every, 'shuffles come faster');
      }
    }
    assert.ok(
      phases.some((p) => (p.summon ?? 0) > 0),
      'it summons robots',
    );
    assert.equal(new Set(boss.gates.map((g) => g.width)).size, 1, 'one gate width, so any spot fits any gate');
    assert.ok(boss.gates.length >= 3);
    assert.ok(boss.gates.every((g) => !g.fork && !g.move));
    assert.ok(boss.enemyWaves.some((w) => w.unit === 'robot'));
    assert.ok(boss.intro && boss.targetTime);
  }
  assert.equal(new Set(JACKS.map((l) => JSON.stringify(l.gates.map((g) => g.x)))).size, 2, 'seeds mirror the lane');
});

test('the run boss stays deterministic and the Jack-in-the-Box is one of three', () => {
  let jack = 0;
  for (let k = 0; k < 300; k++) {
    const seed = (k * 40503 + 9) >>> 0;
    const m = runBossModel(seed);
    if (m === 'jackInTheBox') jack++;
    assert.equal(generateRunBattle({ seed, kind: 'boss', index: 4 }).boss?.model ?? 'tinGeneral', m);
  }
  assert.ok(jack > 70 && jack < 130, `${jack} of 300`);
});

test('World 3 upgrades: what each one changes', () => {
  const w3 = ['clockwork', 'boots', 'sawguard', 'crowbar', 'bankshot'];
  for (const id of w3) {
    const def = UPGRADES.find((u) => u.id === id);
    assert.ok(def?.iconW3, `${id} has a World 3 icon`);
  }
  const base = WORKSHOP.find((l) => l.gates.some((g) => g.toggle) && (l.defenders?.length ?? 0) > 0)!;
  assert.ok(base);

  const clock = applyUpgrades(base, { clockwork: 1 });
  const extra = added(clock);
  assert.equal(extra.length, 1);
  assert.ok(extra[0].op === 'mul' && extra[0].value === 3 && extra[0].toggle, 'a timed x3');
  for (const g of base.gates)
    if (g.toggle) {
      const after = clock.gates.find((o) => o.id === g.id)!;
      assert.ok(after.toggle!.on > g.toggle.on, `${g.id} stays open longer`);
      assert.equal(after.toggle!.off, g.toggle.off);
    }

  assert.equal(applyUpgrades(base, { boots: 1 }).mods?.beltGrip, 0.5);
  assert.equal(applyUpgrades(base, { boots: 2 }).mods?.beltGrip, 0.9);

  const guard = applyUpgrades(base, { sawguard: 1 });
  assert.ok(guard.mods!.sawGuard! > 0 && guard.mods!.sawGuard! < 1);
  for (const [i, d] of base.defenders!.entries())
    assert.ok(guard.defenders![i].hp > d.hp, 'the drawback: tougher defenders');

  const bar = applyUpgrades(base, { crowbar: 1 });
  assert.ok(bar.mods!.shieldBreak! > 0);
  assert.ok(bar.champion.damage > base.champion.damage);

  const one = applyUpgrades(base, { bankshot: 1 });
  const two = applyUpgrades(base, { bankshot: 2 });
  assert.ok(one.mods!.ricochetEvery! > two.mods!.ricochetEvery!, 'a second stack ricochets more often');
  assert.ok(two.mods!.ricochetEvery! >= 2);
  assert.ok(one.cannon.fireRate > base.cannon.fireRate && two.cannon.fireRate > one.cannon.fireRate);

  // Nothing World 3 leaks into a level by default.
  const plain = applyUpgrades(base, {});
  for (const k of ['beltGrip', 'sawGuard', 'shieldBreak', 'ricochetEvery'] as const)
    assert.equal(plain.mods?.[k], undefined, k);
});

test('an owned Clockwork Gate finds a spot clear of gates, defenders and hazards', () => {
  for (const base of [...WORKSHOP, ...JACKS]) {
    for (const build of [{ clockwork: 1 }, { clockwork: 1, tripler: 1, 'frost-gate': 1, supply: 2 }] as Build[]) {
      const out = applyUpgrades(base, build);
      if (Object.keys(build).length === 1)
        assert.equal(added(out).length, 1, `${base.id}: no room for the Clockwork Gate`);
      for (const g of added(out)) {
        for (const o of out.gates) {
          if (o === g) continue;
          const sideBySide = o.z === g.z && Math.abs(o.x - g.x) >= reach(o) + reach(g) + 0.3;
          assert.ok(sideBySide || Math.abs(o.z - g.z) >= 3, `${base.id}: ${g.id} too close to ${o.id}`);
        }
        for (const c of out.conveyors ?? [])
          assert.ok(g.z <= c.z - 1.5 || g.z >= c.z + c.length + 1.5, `${base.id}: ${g.id} on belt ${c.id}`);
        for (const t of out.turntables ?? [])
          assert.ok(Math.abs(g.z - t.z) >= t.radius + 1.5, `${base.id}: ${g.id} on ${t.id}`);
        for (const s of out.saws ?? []) {
          const dz = s.path?.dz ?? 0;
          const lo = Math.min(s.z, s.z + dz) - s.radius - 1.5;
          const hi = Math.max(s.z, s.z + dz) + s.radius + 1.5;
          assert.ok(g.z <= lo || g.z >= hi, `${base.id}: ${g.id} on saw track ${s.id}`);
        }
      }
    }
  }
});

test('with the World 3 upgrades owned, every generated battle and boss stays valid', () => {
  const builds: Build[] = [
    { clockwork: 1 },
    { boots: 2 },
    { sawguard: 1 },
    { crowbar: 1 },
    { bankshot: 2 },
    { clockwork: 1, boots: 2, sawguard: 1, crowbar: 1, bankshot: 2, overcharge: 1, sapper: 1, rapid: 2 },
  ];
  for (const base of [...BATTLES.filter((_, i) => i % 3 === 0), ...WORKSHOP, ...BOSSES]) {
    const back = validateLevel(JSON.parse(JSON.stringify(base)), base.id);
    assert.deepEqual(back, base, `${base.id} round trip`);
    for (const build of builds) {
      const out = applyUpgrades(base, build);
      assert.deepEqual(validateLevel(JSON.parse(JSON.stringify(out)), out.id), out, `${base.id}`);
    }
  }
});

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

test('a run saved before World 3 still loads and keeps fighting', () => {
  // Build a mid-run save with only World 1 and World 2 upgrades, as an older build wrote it.
  let run = newRun(77);
  run = finishBattle(chooseNode(run, availableNodes(run)[0]), { victory: true, baseHpFraction: 0.7, seconds: 60 });
  const old = { ...run, upgrades: { doubler: 2, 'frost-gate': 1, skates: 1 }, phase: 'map' as const, offer: undefined };
  const store = memStore({ [EXPEDITION_KEY]: JSON.stringify({ ...emptyExpedition(), run: old }) });
  const back = loadExpedition(store);
  assert.ok(back.run, 'the run survives');
  assert.deepEqual(back.run.upgrades, old.upgrades);
  const next = chooseNode(back.run, availableNodes(back.run)[0]);
  if (next.phase === 'battle') {
    const level = applyUpgrades(generateRunBattle(battleSpec(next)), next.upgrades);
    assert.deepEqual(validateLevel(JSON.parse(JSON.stringify(level)), level.id), level);
  }
  saveExpedition(back, store);
  assert.deepEqual(loadExpedition(store), back);
});
