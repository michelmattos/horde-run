// Pure World 3 render bookkeeping (no Babylon): the workshop room theme, toggling-gate
// faces (clock, shutter, split-flap) against the contracts' own clocks, gliding gates
// against gateGlide, belt scroll and facing, turntable and saw motion, the shuffle
// tremble and workshop scenery placement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conveyorDir,
  cycleFlipIn,
  cycleOn,
  gateEffectAt,
  gateGlide,
  gateLabelAt,
  turntableSpin,
} from '../src/contracts.ts';
import type { ConveyorDef, GateDef, GateToggleDef, TurntableDef } from '../src/contracts.ts';
import {
  BELT_REPEAT,
  CLOCK_WARN,
  FLAP_TIME,
  GLIDE_LIFT,
  SAW_RAISE_TIME,
  SCENERY_CLEARANCE,
  SHUFFLE_JITTER,
  SHUTTER_TIME,
  WORKSHOP_RADIUS,
  beltScroll,
  beltYaw,
  clockWarn,
  dentStage,
  flapAt,
  glidePoseAt,
  roomThemeOf,
  sawRaiseAt,
  scatterWorkshopScenery,
  shuffleJitter,
  shutterAt,
  toggleLabels,
  toggleViewAt,
  turntableAngle,
} from '../src/render/fxLogic.ts';
import type { GlidePose, ToggleView } from '../src/render/fxLogic.ts';

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const view = (): ToggleView => ({ on: true, closed: false, flipIn: 0, progress: 0, since: 0 });

function gate(over: Partial<GateDef> = {}): GateDef {
  return { id: 'g', x: 0, z: 20, width: 3, op: 'mul', value: 3, ...over } as GateDef;
}

test('the workshop theme comes from LevelDef.theme', () => {
  assert.equal(roomThemeOf({ theme: 'workshop' }), 'workshop');
  assert.equal(roomThemeOf({ theme: 'freezer' }), 'freezer');
  assert.equal(roomThemeOf({}), 'bedroom');
});

test('a toggle view follows cycleOn and cycleFlipIn exactly', () => {
  const cycles = [
    { on: 3, off: 1.5 },
    { on: 2.5, off: 2.5, offset: 1 },
    { on: 3.5, off: 2 },
    { on: 2, off: 0 },
  ];
  const v = view();
  for (const c of cycles)
    for (let t = 0; t < 20; t += 0.137) {
      toggleViewAt(c, t, v);
      assert.equal(v.on, cycleOn(c, t), `on at ${t}`);
      if (Number.isFinite(cycleFlipIn(c, t)) && c.off > 0) assert.ok(near(v.flipIn, cycleFlipIn(c, t), 1e-6));
      assert.ok(v.progress >= 0 && v.progress < 1);
      assert.equal(v.closed, !v.on, 'no alt: off means shutter down');
    }
  // With an alt the gate is never closed.
  const alt = { on: 3, off: 2, alt: { op: 'div' as const, value: 2 } };
  for (let t = 0; t < 10; t += 0.25) assert.equal(toggleViewAt(alt, t, v).closed, false);
});

test('the first phase is not a flip; later flips report the time since', () => {
  const c = { on: 3, off: 1.5 };
  const v = view();
  assert.equal(toggleViewAt(c, 0, v).since, Infinity);
  assert.equal(toggleViewAt(c, 2.9, v).since, Infinity);
  assert.ok(near(toggleViewAt(c, 3.1, v).since, 0.1, 1e-9));
  assert.ok(near(toggleViewAt(c, 4.6, v).since, 0.1, 1e-9));
  // An offset that starts the clock off: still no flip at t = 0.
  assert.equal(toggleViewAt({ on: 2, off: 2, offset: 3 }, 0.5, v).since, Infinity);
});

test('toggle faces match gateLabelAt for both phases', () => {
  const plain = gate({ toggle: { on: 3, off: 1.5 } });
  const flip = gate({ toggle: { on: 3, off: 2, alt: { op: 'div', value: 2 } } });
  const sub = gate({ op: 'add', value: 10, toggle: { on: 2, off: 2, alt: { op: 'sub', value: 4 } } });
  const v = view();
  for (const g of [plain, flip, sub]) {
    const l = toggleLabels(g);
    for (let t = 0; t < 12; t += 0.3) {
      const on = toggleViewAt(g.toggle!, t, v).on;
      assert.equal(on ? l.on : l.off, gateLabelAt(g, t), `${g.op} at ${t}`);
    }
  }
  assert.equal(toggleLabels(plain).off, '');
});

// The view of a gate's toggle at t, for the flip-timing tests below.
function viewAt(c: GateToggleDef, t: number): ToggleView {
  return toggleViewAt(c, t, view());
}

test('the shutter is fully down exactly when the sim closes the gate, and rolls up after it opens', () => {
  const c = { on: 4, off: 3 };
  const g = gate({ toggle: c });
  // Down for the whole closed phase, starting at the very flip.
  for (let t = 4.0001; t < 7; t += 0.05) {
    assert.equal(gateEffectAt(g, t), null);
    assert.equal(shutterAt(viewAt(c, t)), 1, `down at ${t}`);
  }
  // Open and settled mid-phase; the drop eases in (a falling weight) before the close.
  assert.equal(shutterAt(viewAt(c, 2)), 0);
  assert.equal(shutterAt(viewAt(c, 4 - SHUTTER_TIME)), 0);
  assert.ok(shutterAt(viewAt(c, 4 - SHUTTER_TIME / 2)) < 0.5);
  let last = -1;
  for (let t = 4 - SHUTTER_TIME; t < 4; t += SHUTTER_TIME / 20) {
    const k = shutterAt(viewAt(c, t));
    assert.ok(k >= last, 'closing never rises back');
    last = k;
  }
  // Rolls up once the gate counts again (t = 7), settled after SHUTTER_TIME.
  assert.ok(shutterAt(viewAt(c, 7.0001)) > 0.99);
  assert.ok(shutterAt(viewAt(c, 7 + SHUTTER_TIME / 2)) < 0.5);
  assert.equal(shutterAt(viewAt(c, 7 + SHUTTER_TIME)), 0);
  // The battle starting closed is not a drop.
  assert.equal(shutterAt(viewAt({ on: 2, off: 2, offset: 3 }, 0.5)), 1);
});

test('the split-flap is edge-on at the flip and flat away from it', () => {
  const c = { on: 4, off: 3, alt: { op: 'sub' as const, value: 10 } };
  assert.equal(flapAt(viewAt(c, 2)), 0);
  assert.equal(flapAt(viewAt(c, 4 - FLAP_TIME / 2)), 0);
  assert.equal(flapAt(viewAt(c, 4 + FLAP_TIME / 2)), 0);
  // Continuous through edge-on (|angle| near PI/2 on both sides of the flip).
  assert.ok(near(Math.abs(flapAt(viewAt(c, 3.9999))), Math.PI / 2, 0.01));
  assert.ok(near(Math.abs(flapAt(viewAt(c, 4.0001))), Math.PI / 2, 0.01));
  const before = flapAt(viewAt(c, 4 - FLAP_TIME / 4));
  const after = flapAt(viewAt(c, 4 + FLAP_TIME / 4));
  assert.ok(before > 0 && before < Math.PI / 2);
  assert.ok(after < 0 && after > -Math.PI / 2);
  // A clock that never flips never flaps.
  for (let t = 0; t < 10; t += 0.1) assert.equal(flapAt(viewAt({ on: 2, off: 0, alt: c.alt }, t)), 0);
});

test('a flipping card shows exactly the face gateLabelAt gives whenever it is not edge-on', () => {
  const gates = [
    gate({ toggle: { on: 4, off: 3, alt: { op: 'sub', value: 10 } } }),
    gate({ op: 'add', value: 10, toggle: { on: 2, off: 2.5, offset: 1, alt: { op: 'div', value: 2 } } }),
  ];
  for (const g of gates) {
    const l = toggleLabels(g);
    for (let t = 0; t < 20; t += 0.0137) {
      const v = viewAt(g.toggle!, t);
      if (Math.abs(flapAt(v)) > Math.PI / 2 - 0.05) continue; // edge-on: no face to read
      assert.equal(v.on ? l.on : l.off, gateLabelAt(g, t), `face at ${t}`);
    }
  }
});

test('the clock warns only in the last CLOCK_WARN seconds', () => {
  assert.equal(clockWarn(CLOCK_WARN + 0.5), 0);
  assert.equal(clockWarn(Infinity), 0);
  assert.ok(near(clockWarn(CLOCK_WARN / 2), 0.5));
  assert.equal(clockWarn(0), 1);
});

test('a gliding gate follows gateGlide plus its sway and lifts only in the air', () => {
  const p: GlidePose = { x: 0, z: 0, lift: 0, landed: false };
  const seconds = 1.2;
  for (let e = 0; e <= seconds; e += 0.05) {
    const sway = 0.3 * Math.sin(e);
    glidePoseAt(e, seconds, -3, 20, 3, 34, sway, p);
    const k = gateGlide(e, seconds);
    assert.ok(near(p.x, -3 + 6 * k + sway, 1e-9));
    assert.ok(near(p.z, 20 + 14 * k, 1e-9));
    assert.ok(p.lift >= 0 && p.lift <= GLIDE_LIFT + 1e-9);
  }
  glidePoseAt(0, seconds, -3, 20, 3, 34, 0, p);
  assert.equal(p.lift, 0);
  glidePoseAt(seconds / 2, seconds, -3, 20, 3, 34, 0, p);
  assert.ok(near(p.lift, GLIDE_LIFT));
  glidePoseAt(seconds, seconds, -3, 20, 3, 34, 0.1, p);
  assert.equal(p.landed, true);
  assert.equal(p.lift, 0);
  assert.ok(near(p.x, 3.1));
});

test('the belt scroll integrates speed per repeat and stays in [0, 1)', () => {
  const c: ConveyorDef = { id: 'b', x: 0, z: 9, width: 10, length: 6, vx: 2.4, vz: 0, flip: 8 };
  let off = 0;
  let travelled = 0;
  for (let i = 0; i < 600; i++) {
    off = beltScroll(off, c, 1 / 60);
    travelled += 2.4 / 60;
    assert.ok(off >= 0 && off < 1);
  }
  const expect = -travelled / BELT_REPEAT;
  const d = Math.abs(off - (expect - Math.floor(expect)));
  assert.ok(Math.min(d, 1 - d) < 1e-6, 'same phase (mod one repeat)');
  assert.equal(beltScroll(0.25, c, -1), 0.25, 'no backwards time');
});

test('the belt faces the way it runs, flipping with conveyorDir, square to its rectangle', () => {
  const lateral: ConveyorDef = { id: 'a', x: 0, z: 9, width: 10, length: 6, vx: 1.8, vz: 0, flip: 8 };
  const along: ConveyorDef = { id: 'b', x: -2.5, z: 26, width: 4, length: 7, vx: 0, vz: 3 };
  assert.ok(near(beltYaw(lateral, conveyorDir(lateral, 1)), Math.PI / 2));
  assert.ok(near(beltYaw(lateral, conveyorDir(lateral, 9)), -Math.PI / 2));
  assert.equal(beltYaw(along, 1), 0);
  assert.ok(near(beltYaw(along, -1), Math.PI));
  // Babylon yaw turns local +z to (sin y, cos y): the chevrons point along the velocity.
  for (const [c, t] of [
    [lateral, 1],
    [lateral, 9],
    [along, 0],
  ] as const) {
    const d = conveyorDir(c, t);
    const y = beltYaw(c, d);
    assert.ok(Math.sin(y) * c.vx * d + Math.cos(y) * c.vz * d > 0);
  }
});

test('the turntable angle integrates turntableSpin through flips', () => {
  const p: TurntableDef = { id: 't', x: 0, z: 24, radius: 3.4, spin: 0.9, flip: 2 };
  let a = 0;
  let sum = 0;
  const dt = 1 / 120;
  for (let i = 0; i < 1000; i++) {
    const t = i * dt;
    a = turntableAngle(a, p, t, dt);
    sum += turntableSpin(p, t) * dt;
    assert.ok(a >= 0 && a < Math.PI * 2);
  }
  const want = sum - Math.floor(sum / (Math.PI * 2)) * Math.PI * 2;
  assert.ok(near(a, want, 1e-6));
});

test('a cycled saw is up while on and eases down and up around its off time', () => {
  assert.equal(sawRaiseAt(undefined, 3), 1);
  const c = { on: 2.5, off: 2.5 };
  for (let t = 0; t < 2.5; t += 0.1) assert.equal(sawRaiseAt(c, t), 1, 'up while on');
  assert.ok(sawRaiseAt(c, 2.5 + SAW_RAISE_TIME / 2) < 1 && sawRaiseAt(c, 2.5 + SAW_RAISE_TIME / 2) > 0);
  assert.equal(sawRaiseAt(c, 3.75), 0, 'sunk mid-off');
  assert.ok(sawRaiseAt(c, 5 - SAW_RAISE_TIME / 2) > 0, 'rises before it bites');
  assert.ok(near(sawRaiseAt(c, 5 - 1e-9), 1, 1e-6));
  let last = 2;
  for (let t = 2.5; t < 3.75; t += 0.01) {
    const k = sawRaiseAt(c, t);
    assert.ok(k <= last + 1e-12, 'sinks monotonically');
    last = k;
  }
});

test('the shuffle tremble is a few cm and zero without warn', () => {
  const out = { x: 1, z: 1 };
  shuffleJitter(0, 3, 0.5, out);
  assert.ok(near(out.x, 0) && near(out.z, 0));
  for (let t = 0; t < 4; t += 0.031) {
    shuffleJitter(1, t, 1.7, out);
    assert.ok(Math.abs(out.x) <= SHUFFLE_JITTER + 1e-12 && Math.abs(out.z) <= SHUFFLE_JITTER + 1e-12);
  }
});

test('shield dents deepen with damage and never undent', () => {
  let last = 0;
  for (let hp = 150; hp >= 0; hp -= 5) {
    const s = dentStage(hp, 150);
    assert.ok(s >= last);
    last = s;
  }
  assert.equal(dentStage(150, 150), 0);
  assert.equal(last, 3);
});

test('workshop props stay off the lane and off the conveyors', () => {
  const laneWidth = 10;
  const belts = [{ x: 0, z: 12, width: 11, depth: 6 }];
  for (let seed = 1; seed <= 5; seed++) {
    const props = scatterWorkshopScenery(seed * 131, laneWidth, -8, 70, 60, 9, belts);
    assert.ok(props.length > 20, `seed ${seed}: ${props.length} props`);
    for (const p of props) {
      const r = WORKSHOP_RADIUS[p.kind] * p.scale;
      assert.ok(Math.abs(p.x) - r >= laneWidth / 2 + SCENERY_CLEARANCE - 1e-9, `${p.kind} in the lane at x=${p.x}`);
      for (const w of belts) {
        const dx = Math.max(0, Math.abs(p.x - w.x) - w.width / 2);
        const dz = Math.max(0, Math.abs(p.z - w.z) - w.depth / 2);
        assert.ok(Math.hypot(dx, dz) >= r + SCENERY_CLEARANCE - 1e-9);
      }
    }
  }
});
