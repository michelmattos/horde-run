// World 3 UI: the Jack-in-the-Box shuffle chip on the HUD, the Wind-up Robot on the CHAMP
// button, and sticker art for every World 3 item, upgrade and map figure (and, while at
// it, every item in the catalog and every Expedition upgrade).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { UpgradeIconW3 } from '../src/contracts.ts';
import type { ChampionIconId } from '../src/ui/icons.ts';

// The sticker modules read the shared palette, which imports a Babylon colour class by its
// deep ES path ('@babylonjs/core/Maths/math.color', as the bundle wants). Node's resolver
// needs the '.js' on such a path, so this test adds it with a tiny resolve hook before it
// loads them; nothing else about module loading changes.
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s.startsWith('@babylonjs/') && !s.endsWith('.js')) return next(s + '.js', c);
        return next(s, c);
      }`,
    ),
);
const { SHUFFLE_CRANK_TURNS, shuffleChipLook } = await import('../src/ui/uiLogic.ts');
const { championIconFor, crankIcon } = await import('../src/ui/icons.ts');
const { upgradeCategoryOf, upgradeIconOf, upgradeIconSvg } = await import('../src/ui/expedition/icons.ts');
const { UPGRADES } = await import('../src/expedition/upgrades.ts');
const { ITEM_ICON_IDS, itemIcon, itemSlotOf } = await import('../src/meta/itemIcons.ts');
const { ITEMS } = await import('../src/progression/index.ts');
const { gearIcon, gearPath, jackIcon, jesterIcon, robotIcon } = await import('../src/meta/worldArt.ts');

const W3_ICONS: readonly UpgradeIconW3[] = [
  'gate-clock',
  'mob-boots',
  'relic-sawguard',
  'champ-crowbar',
  'cannon-bank',
];

// A well-formed decorative sticker: one svg, hidden from screen readers, no NaN in the paths.
function assertSticker(svg: string, what: string): void {
  assert.match(svg, /^<svg [^>]*aria-hidden="true"/, what);
  assert.equal((svg.match(/<svg /g) ?? []).length, (svg.match(/<\/svg>/g) ?? []).length, `${what}: balanced`);
  assert.doesNotMatch(svg, /NaN|undefined/, what);
}

test('shuffle chip: hidden with nothing coming, fills and winds while the boss cranks', () => {
  assert.equal(shuffleChipLook(undefined).show, false);
  assert.equal(shuffleChipLook({ warn: 0, active: false }).show, false, 'nothing coming yet');
  const half = shuffleChipLook({ warn: 0.5, active: false });
  assert.deepEqual(half, { show: true, fill: 0.5, turn: 360, active: false });
  assert.deepEqual(shuffleChipLook({ warn: 0, active: true }), {
    show: true,
    fill: 1,
    turn: SHUFFLE_CRANK_TURNS * 360,
    active: true,
  });
  assert.equal(shuffleChipLook({ warn: 9, active: false }).fill, 1, 'clamped');
  assert.equal(shuffleChipLook({ warn: Number.NaN, active: true }).fill, 1);
  // Snapped to 1/50, so a frame-by-frame warn only changes the DOM ~50 times per crank.
  const looks = Array.from({ length: 300 }, (_, k) => shuffleChipLook({ warn: k / 299, active: false }));
  assert.ok(new Set(looks.map((l) => l.fill)).size <= 51);
  for (let i = 1; i < looks.length; i++) {
    assert.ok(looks[i].fill >= looks[i - 1].fill, 'never unwinds while cranking');
    assert.ok(looks[i].turn >= looks[i - 1].turn);
  }
});

test('the CHAMP button has a figure for every champion, the Wind-up Robot its own', () => {
  const ids: ChampionIconId[] = ['sarge', 'tank', 'drummer', 'windup'];
  const svgs = ids.map((id) => championIconFor(id, 60));
  svgs.forEach((s, i) => assertSticker(s.replace(/^<svg class="[^"]*" /, '<svg '), ids[i]));
  assert.equal(new Set(svgs).size, ids.length, 'all different');
  const crank = crankIcon(48);
  assertSticker(crank.replace(/^<svg class="[^"]*" /, '<svg '), 'crank');
  assert.match(crank, /class="tb-crank-arm"/, 'the arm can be turned on its own');
});

test('every World 3 upgrade icon has art in its own category', () => {
  const cats = {
    'gate-clock': 'gate',
    'mob-boots': 'mob',
    'relic-sawguard': 'relic',
    'champ-crowbar': 'champion',
    'cannon-bank': 'cannon',
  };
  for (const icon of W3_ICONS) {
    assertSticker(upgradeIconSvg(icon, 28).replace(/^<svg class="[^"]*" /, '<svg '), icon);
    assert.equal(upgradeCategoryOf(icon), cats[icon], icon);
  }
  assert.equal(new Set(W3_ICONS.map((i) => upgradeIconSvg(i, 28))).size, W3_ICONS.length);
});

test('an upgrade card draws its World 3 art first, then World 2, then the base icon', () => {
  assert.equal(upgradeIconOf({ icon: 'gate-x3', iconW3: 'gate-clock' }), 'gate-clock');
  assert.equal(upgradeIconOf({ icon: 'gate-x3', iconW2: 'gate-frost', iconW3: 'gate-clock' }), 'gate-clock');
  assert.equal(upgradeIconOf({ icon: 'gate-x3', iconW2: 'gate-frost' }), 'gate-frost');
  assert.equal(upgradeIconOf({ icon: 'gate-x3' }), 'gate-x3');
  // Every upgrade in the pool draws (and in its own category).
  for (const u of UPGRADES) {
    const art = upgradeIconOf(u);
    assert.doesNotThrow(() => upgradeIconSvg(art, 28), u.id);
    assert.equal(upgradeCategoryOf(art), u.category, u.id);
  }
  for (const icon of W3_ICONS)
    assert.ok(
      UPGRADES.some((u) => u.iconW3 === icon),
      `${icon} is used`,
    );
});

test('every catalog item has a sticker in its slot, the World 3 gear included', () => {
  for (const it of ITEMS) {
    assert.equal(itemSlotOf(it.id), it.slot, it.id);
    assert.doesNotMatch(itemIcon(it.id, 40), />\?<\/text>/, `${it.id} is not the '?' placeholder`);
  }
  for (const id of ['gear-gun', 'archer', 'windup']) {
    assert.ok(ITEM_ICON_IDS.includes(id), id);
    assertSticker(itemIcon(id, 40).replace(/^<svg class="[^"]*" /, '<svg '), id);
  }
  assert.equal(itemSlotOf('gear-gun'), 'cannon');
  assert.equal(itemSlotOf('archer'), 'mob');
  assert.equal(itemSlotOf('windup'), 'champion');
});

test('world map art for the workshop: robot, Jack-in-the-Box, jester and gear', () => {
  for (const [name, svg] of [
    ['robot', robotIcon(76)],
    ['jack', jackIcon(50)],
    ['jester', jesterIcon(80)],
    ['gear', gearIcon(30)],
  ] as const)
    assertSticker(svg.replace(/^<svg class="[^"]*" /, '<svg '), name);
  // The gear outline closes and has four points per tooth.
  const d = gearPath(32, 32, 27, 20, 10);
  assert.match(d, /^M.* Z$/);
  assert.equal(d.split(' L').length, 40);
});
