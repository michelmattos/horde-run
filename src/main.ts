// Boot and per-frame wiring. One renderer, input, HUD, overlay set and world map live
// for the whole session; each battle (card Play, retry, next level) gets a fresh RNG,
// sim and battle. Flow: world map → level card → battle → result (stars saved via
// recordResult) → Next opens the next level's card / Map / Retry. `?level=1-1` skips
// the menus straight into a battle (used by the smoke test).
// Expedition (concept §4.2): a second flow next to the campaign. The world map's
// Expedition button opens the start screen (New, Daily, Resume); `?expedition=<seed>`
// or `?expedition=daily` starts or resumes a run straight onto the run map. The run
// rules are pure (src/expedition); this file only walks the run's phases: run map →
// battle (generated level with the upgrades applied) → upgrade pick / lost card → map,
// plus shop and rest stops, until the run result. Every step is saved, so a reload
// resumes where the player was (a battle restarts from its beginning).
// Per rendered frame: loop.advance → input.sample → battle.step (which steps the sim)
// → renderer.frame → hud.update. The sim runs at a fixed SIM_HZ. While a menu covers
// the battlefield nothing moves, so the loop draws one frame under it and then stops
// (concept §8 "Heat and battery"); wake() restarts it. Drawing is capped at 60 fps even
// on a 120 Hz screen (iPhone 17 Pro Max): rAF callbacks that come too soon are skipped.
// The camera only zooms out gently as the crowd grows; it never shakes.
// Milestone 4 (progression): the save holds a profile next to the stars (coins, owned
// items, upgrade tiers, the loadout, the village). Campaign flow is map → level card →
// loadout → battle → result with coins and unlocks. The map's dock opens the Collection
// (upgrades, coin items) and the Home base, a separate 3D village scene on the same
// engine that the render loop draws instead of the battlefield while it is up. Campaign
// battles get the profile's BattleLoadout (resolveLoadout also reshapes the level for the
// cannon and the village perks); Expedition battles stay loadout-free but pay coins.
// Battle cues (shots, blasts, ultimates) go to the renderer, the audio and the haptics.
// `?screen=loadout|collection|home` opens a meta screen straight away (smoke test).
import { Engine } from '@babylonjs/core/Engines/engine';
import { LAYOUT, Team, UnitKind, starGoalLabels } from './contracts.ts';
import type { BattleState, LevelDef, RunBattleSpec, RunState, SaveData, SimEvent, WorldDef } from './contracts.ts';
import type { BattleLoadout } from './game/loadout.ts';
import { createSim } from './sim/index.ts';
import type { Sim } from './sim/index.ts';
import { createBattle } from './game/battle.ts';
import type { Battle, BattleCue } from './game/battle.ts';
import { WORLDS, getLevel, getLevelById } from './game/levels.ts';
import { evaluateStars } from './game/stars.ts';
import { createRenderer } from './render/index.ts';
import type { RenderStats } from './render/index.ts';
import { parseCannon, parseChampion } from './render/crowdLogic.ts';
import { createAudio } from './audio/index.ts';
import type { MusicId } from './audio/index.ts';
import { createRng } from './core/rng.ts';
import { createFixedStep, createFrameCap } from './core/loop.ts';
import { loadSettings } from './core/settings.ts';
import { createInput } from './core/input.ts';
import { isLandscapeTouch, watchInterruptions } from './core/lifecycle.ts';
import type { InterruptReason } from './core/lifecycle.ts';
import { createHaptics } from './core/haptics.ts';
import { registerServiceWorker } from './core/pwa.ts';
import { isWorldUnlocked, loadGame, recordResult, writeGame } from './core/save.ts';
import type { GameData } from './core/save.ts';
import { planRecovery, readRecovery, takeRecoveryTarget, writeRecovery } from './core/recovery.ts';
import type { RecoveryTarget } from './core/recovery.ts';
import { writeSavedRender } from './render/look/quality.ts';
import { createWorldMap } from './meta/worldMap.ts';
import { createLoadoutScreen } from './meta/loadout.ts';
import { createCollectionScreen } from './meta/collection.ts';
import { itemIcon } from './meta/itemIcons.ts';
import { collectionView, homeView, loadoutView } from './meta/views.ts';
import type { HomeBase } from './home/homeBase.ts';
import {
  addCoins,
  applyCampaignResult,
  build,
  buyItem as buyCollectionItem,
  getItem,
  markSeen,
  newlyUnlocked,
  recordExpeditionBattle,
  recordExpeditionRun,
  resolveLoadout,
  setLoadout,
  unannouncedUnlocks,
  upgradeItem,
} from './progression/index.ts';
import type { Profile, ProgressFacts } from './progression/index.ts';
import { createHud, hudReserve } from './ui/hud.ts';
import { createOverlays } from './ui/overlays.ts';
import { createLoadingScreen, LOADING_TIMEOUT_MS, settle } from './ui/loading.ts';
import {
  abandonRun,
  applyUpgrades,
  availableNodes,
  battleSpec,
  buyHeal,
  buyItem,
  chooseNode,
  dailySeed,
  finishBattle,
  getUpgrade,
  leaveShop,
  loadExpedition,
  newRun,
  pickUpgrade,
  randomRunSeed,
  recordRunEnd,
  restHeal,
  RUN_RULES,
  runScore,
  saveExpedition,
} from './expedition/index.ts';
import type { ExpeditionSave } from './expedition/index.ts';
import { generateRunBattle } from './game/expedition.ts';
import { createExpeditionScreens, upgradeIconSvg } from './ui/expedition/index.ts';
import type { OwnedUpgrade } from './ui/expedition/index.ts';

// Seconds the battlefield keeps playing after the outcome before the result screen.
const RESULT_DELAY = 1.2;

declare global {
  interface Window {
    __hordeBooted?: boolean; // set once the first screen is up (index.html boot guard)
    __hordeBootError?: (message: string) => void; // shows a start-up failure on screen (index.html)
    __hordeFatal?: (message: string) => void; // shows a later, unrecoverable failure on screen (index.html)
    __horde?: {
      state(): BattleState;
      fps(): number; // frames actually drawn per second (capped at 60)
      zoom(): number; // current crowd zoom-out of the camera (0 = none)
      level(): string;
      spawn(n: number, champion?: boolean): void; // debug: player units at the cannon
      units(): number; // live sim units (stacked units count once)
      goto(levelId: string): boolean; // start a battle on that level, skipping menus
      render(): RenderStats; // last frame's draw calls, active meshes/indices, quality tier
      expedition(): RunState | null; // the current Expedition run, null when none is active
      expeditionChoose(nodeId: string): boolean; // enter that run map node, as a tap would
      win(): void; // debug: drains the enemy base so the battle ends in victory
      profile(): Profile; // the player's coins, items, tiers, loadout and village
      coins(n: number): number; // debug: adds n coins (saved); returns the new balance
      // Opens a meta screen ('map' | 'loadout' | 'collection' | 'home'); without an id it
      // only reports the screen showing ('battle', 'expedition' and 'settings' as well).
      screen(id?: string): string;
    };
  }
}

let canvas = document.getElementById('game') as HTMLCanvasElement;
const app = document.getElementById('app') as HTMLElement;

// MSAA is expensive at phone DPRs and barely visible there; keep it for low-DPR screens.
const antialias = window.devicePixelRatio < 2;
// Pauses between start-up attempts when the context comes back dead (about 6 s in all,
// well inside the boot guard's 20 s).
const BOOT_RETRY_MS: readonly number[] = [300, 700, 1500, 3500];

const engine = await obtainEngine();

// iOS can hand out a WebGL context that is already lost. Babylon then reads every GPU
// limit as 0, and building the bloom blur on those limits throws (the "e.toFixed" start-up
// error). This happens while the GPU process is still recovering from an earlier loss (or
// from another page's), so reloading straight away gets another dead context: three of
// those in a row used to end on the "could not start" card within a second or two. So the
// boot first waits and tries again on a fresh canvas (a canvas keeps its lost context for
// good), and only then falls back to the reload plan, before anything is built on it.
async function obtainEngine(): Promise<Engine> {
  for (let attempt = 0; ; attempt++) {
    const e = createEngine();
    if (contextUsable(e)) {
      if (attempt > 0) console.warn(`WebGL context usable after ${attempt} retries`);
      return e;
    }
    if (attempt >= BOOT_RETRY_MS.length) recoverDeadContextAtBoot();
    console.warn(`WebGL context lost at start-up: retrying in ${BOOT_RETRY_MS[attempt]} ms`);
    try {
      e.dispose();
    } catch {
      // A dead context can fail to release; the canvas is dropped either way.
    }
    const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    canvas = fresh;
    await new Promise((r) => setTimeout(r, BOOT_RETRY_MS[attempt]));
  }
}

// True when the context is alive and reported real limits.
function contextUsable(e: Engine): boolean {
  const gl = (e as unknown as { _gl?: WebGLRenderingContext | null })._gl;
  if (!gl || gl.isContextLost()) return false;
  const caps = e.getCaps();
  return caps.maxVaryingVectors > 0 && caps.maxTextureSize > 0;
}

function recoverDeadContextAtBoot(): never {
  const prev = readRecovery();
  const { plan, count } = planRecovery(prev, Date.now());
  // Keep the place an earlier recovery asked to return to (this boot has not used it yet).
  const target: RecoveryTarget = prev?.target ?? { kind: 'map' };
  if (plan !== 'give-up' && writeRecovery({ at: Date.now(), count, target })) {
    console.warn(`WebGL context lost at start-up: reloading (${plan})`);
    if (plan === 'reload-low') writeSavedRender({ quality: 'low', post: 'off' });
    window.__hordeBooted = true; // a reload is coming: the boot guard must not report this stop
    reloadWhenVisible();
  } else {
    window.__hordeBootError?.(
      'The phone did not give the game its graphics (the WebGL context was lost at start-up).\n\n' +
        'Close the game and Safari completely, then open it again. If that does not help, restart the phone.',
    );
  }
  throw new Error('WebGL context lost at start-up');
}

function createEngine(): Engine {
  try {
    return new Engine(
      canvas,
      antialias,
      { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', audioEngine: false },
      false, // the renderer owns hardware scaling (automatic resolution scaling)
    );
  } catch (e) {
    // No WebGL context (the browser refused one): the index.html boot guard shows why.
    window.__hordeBootError?.(
      `The graphics (WebGL) would not start: ${e instanceof Error ? e.message : String(e)}\n\n` +
        'Close the game and Safari completely, then open it again. If that does not help, restart the phone.',
    );
    throw e;
  }
}

const levelDef = (id: string): LevelDef => getLevelById(id) ?? getLevel(0);

const loading = createLoadingScreen();
const settings = loadSettings();
const renderer = createRenderer(engine, canvas, { hudReserve });
const input = createInput(canvas, settings);
const haptics = createHaptics(settings);
// No AudioContext until the first gesture; music and effect volumes follow settings live.
const audio = createAudio(settings, { baseUrl: import.meta.env.BASE_URL });
const overlays = createOverlays(app, settings, {
  onSound: (id) => audio.play(id),
  onSettingsChanged: () => audio.applySettings(),
});
const loop = createFixedStep();
const frameCap = createFrameCap();
const hud = createHud(renderer.scene, input, { onPause: () => pause('user') });

// ---------- Progress: stars + profile, saved together (save v2) ----------

const loaded = loadGame();
let save: SaveData = loaded.save;
let profile: Profile = loaded.profile;
if (loaded.migrated) writeGame(save, profile); // a v1 save gets its retroactive coins once

const facts = (): ProgressFacts => ({ levels: save.levels, profile });
function commitProfile(p: Profile): void {
  profile = p;
  writeGame(save, profile);
}

const map = createWorldMap(app, {
  worlds: WORLDS.map((w: WorldDef) => ({
    world: w,
    levels: w.levels.map((id) => ({ id, name: levelDef(id).name, boss: !!levelDef(id).boss })),
  })),
  onPlay: (id) => openLevelCard(id),
  onSaveReplaced: (s) => {
    save = s;
  },
  onExpedition: () => openExpeditionStart(),
  onHome: () => openHome(),
  onCollection: () => openCollection(() => showMap()),
  onSettings: () => openSettings(),
  getGame: (): GameData => ({ save, profile }),
  onGameReplaced: (g) => {
    save = g.save;
    profile = g.profile;
  },
  whenUncovered: () => loading.whenHidden(),
});
const screens = createExpeditionScreens(app);
// The UI font, so no screen is first shown in the fallback face and then re-laid out.
const fontsReady: Promise<unknown> = document.fonts
  ? Promise.all(['600', '700'].map((w) => document.fonts.load(`${w} 16px 'Horde Fredoka'`)))
  : Promise.resolve();

// Meta screens. Where Back goes from the loadout and the collection depends on how they
// were opened, so the openers keep the way back.
let loadoutLevel = '';
let collectionBack: () => void = () => showMap();
const loadoutScreen = createLoadoutScreen(app, {
  onStart: (sel) => {
    commitProfile(setLoadout(profile, sel, facts()));
    startLevel(loadoutLevel);
  },
  onBack: () => {
    loadoutScreen.hide();
    openLevelCard(loadoutLevel);
  },
  onCollection: () => openCollection(() => openLoadout(loadoutLevel)),
});
const collection = createCollectionScreen(app, {
  onUpgrade: (id) => {
    const p = upgradeItem(profile, id, facts());
    if (!p) return;
    commitProfile(p);
    audio.play('upgrade');
    collection.show(collectionView(facts()));
  },
  onBuy: (id) => {
    const p = buyCollectionItem(profile, id, facts());
    if (!p) return;
    commitProfile(markSeen(p, [id]));
    audio.play('unlock');
    collection.show(collectionView(facts()));
  },
  onBack: () => {
    collection.hide();
    collectionBack();
  },
});

// The home base village is its own Babylon scene, built (and its code loaded) the first
// time it opens, so it never costs the battle anything.
let home: HomeBase | undefined;
let homeLoading = false;

// Optional ?seed=N makes a session reproducible; otherwise every battle differs.
const params = new URLSearchParams(location.search);
const seedParam = Number(params.get('seed'));
let seedCounter = Number.isFinite(seedParam) && seedParam !== 0 ? seedParam : Date.now();

let level: LevelDef = getLevel(0);
let sim: Sim | undefined;
let battle: Battle | undefined;
let inBattle = false; // a battle is on screen (playing, paused or showing its result)
let outcomeAt = -1; // sim time the outcome was reached, -1 while playing
let resultShown = false;
// Which flow the battle on screen belongs to; an Expedition battle ends in the run's
// pick / lost card instead of the campaign result.
let mode: 'campaign' | 'expedition' = 'campaign';
let stageLoading = false; // the battle's scene is still loading behind the loading screen: the sim waits
let battleLoad = 0; // bumped per battle, so a slow load never releases a newer battle
let runMapShown = false; // the run map is the Expedition screen up (for __horde.level())
const events: SimEvent[] = []; // sim and battle events since the last rendered frame
const cues: BattleCue[] = []; // battle cues (shots, blasts, ultimates) since the last rendered frame
// The campaign battle's loadout (undefined in the Expedition: no ultimate button there).
let battleLoadout: BattleLoadout | undefined;

// The level after `id`: the next one in its world, or the first of the next world once
// that world is open (World 1's boss leads into World 2 when the stars are there).
function nextLevelId(id: string): string | undefined {
  const wi = WORLDS.findIndex((w) => w.levels.includes(id));
  if (wi < 0) return undefined;
  const levels = WORLDS[wi].levels;
  const i = levels.indexOf(id);
  if (i + 1 < levels.length) return levels[i + 1];
  const nextWorld = WORLDS[wi + 1];
  return nextWorld && isWorldUnlocked(save, nextWorld, WORLDS) ? nextWorld.levels[0] : undefined;
}

// Level card over whatever is showing (the map, or the stopped battlefield after a win).
function openLevelCard(id: string): void {
  const l = levelDef(id);
  overlays.showLevelIntro({
    code: l.id,
    levelName: l.name,
    intro: l.intro,
    goals: starGoalLabels(l),
    earned: save.levels[l.id]?.stars ?? [false, false, false],
    boss: l.boss?.name,
    onPlay: () => openLoadout(l.id),
    onMap: () => showMap(),
  });
}

// ---------- Meta screens: loadout, collection, home base, settings ----------

function hideMeta(): void {
  loadoutScreen.hide();
  collection.hide();
  homeWanted = false;
  if (home?.visible) home.hide();
}

// The loadout before a campaign level; Fight saves the pick and starts the battle.
function openLoadout(id: string): void {
  hideMeta();
  overlays.hide();
  loadoutLevel = id;
  loadoutScreen.show(loadoutView(levelDef(id), facts()));
}

// The collection marks every unlock as seen once it has shown their New stickers.
function openCollection(back: () => void): void {
  hideMeta();
  overlays.hide();
  collectionBack = back;
  const f = facts();
  collection.show(collectionView(f));
  const fresh = unannouncedUnlocks(f);
  if (fresh.length > 0) commitProfile(markSeen(profile, fresh));
}

let homeWanted = false; // the home base should be up (it may still be loading)
function openHome(): void {
  map.hide();
  screens.hide();
  leaveBattlefield();
  hideMeta();
  homeWanted = true;
  if (home) return showHome(home);
  if (homeLoading) return;
  homeLoading = true;
  void import('./home/homeBase.ts').then(({ createHomeBase }) => {
    homeLoading = false;
    home = createHomeBase(engine, app, { onBuild: (id) => buildHome(id), onBack: () => showMap() });
    if (homeWanted) showHome(home);
  });
}

function showHome(h: HomeBase): void {
  h.show(homeView(facts()));
  wake();
}

function buildHome(id: string): void {
  const p = build(profile, id, facts());
  if (!p || !home) return;
  commitProfile(p);
  audio.play('build');
  showHome(home);
}

function openSettings(): void {
  overlays.showSettings({ onClose: () => overlays.hide() });
}

// Leaves the battlefield (if any) for a full-screen menu: nothing steps or draws under it.
function leaveBattlefield(): void {
  audio.setMusic('menu');
  overlays.hide();
  inBattle = false;
  input.setPaused(true);
  hud.setVisible(false);
}

function showMap(): void {
  screens.hide();
  hideMeta();
  leaveBattlefield();
  map.show(save, {
    expedition: {
      active: !!run && run.outcome === 'active',
      dailyDone: exp.best.daily[dailySeed(new Date()).daily] !== undefined,
    },
    coins: profile.coins,
    newItems: unannouncedUnlocks(facts()).length,
  });
}

// A campaign battle with the profile's loadout: the cannon and the village reshape the
// level, the rest goes to the battle as a BattleLoadout.
function startLevel(id: string): void {
  mode = 'campaign';
  hud.setRun(null);
  const r = resolveLoadout(levelDef(id), profile);
  battleLoadout = r.battle;
  renderer.setLoadout({ cannon: parseCannon(profile.loadout.cannon), champion: parseChampion(r.battle.champion.id) });
  audio.setChampion(parseChampion(r.battle.champion.id));
  beginBattle(r.level, seedCounter++, r.battle);
}

// Each world theme has its own battle and boss loop.
function battleMusic(def: LevelDef): MusicId {
  if (def.theme === 'freezer') return def.boss ? 'boss2' : 'battle2';
  if (def.theme === 'workshop') return def.boss ? 'boss3' : 'battle3';
  return def.boss ? 'boss' : 'battle';
}

// Fresh RNG, sim and battle on `def`. hud.setRun must already be set for this battle:
// the renderer frames the lane from hudReserve() when the level loads.
function beginBattle(def: LevelDef, seed: number, loadout?: BattleLoadout): void {
  map.hide();
  overlays.hide();
  screens.hide();
  hideMeta();
  level = def;
  audio.setMusic(battleMusic(def));
  const rng = createRng(seed);
  const rand = (): number => rng.next();
  const s = createSim(level, rand);
  sim = s;
  battle = createBattle(level, s, rand, loadout);
  inBattle = true;
  outcomeAt = -1;
  resultShown = false;
  events.length = 0;
  cues.length = 0;
  // Cover the screen until the scene can draw its finished picture; frames keep
  // rendering under the cover (that is when shaders compile) but the battle waits.
  loading.show();
  stageLoading = true;
  const load = ++battleLoad;
  renderer.loadLevel(level);
  const ready = settle(Promise.all([fontsReady, renderer.whenReady()]), LOADING_TIMEOUT_MS);
  void ready.then(() => {
    if (load === battleLoad) stageLoading = false;
  });
  void loading.hideWhen(ready);
  input.configure({ laneWidth: level.lane.width, aimLimit: level.cannon.aimLimit });
  input.setPaused(false);
  hud.setVisible(true);
  loop.reset();
  wake();
  // Every battle entry path (map, retry, next) honours the portrait-only rule.
  if (isLandscapeTouch()) pause('orientation');
}

// ---------- Expedition session ----------

let exp: ExpeditionSave = loadExpedition();
let run: RunState | undefined = exp.run?.outcome === 'active' ? exp.run : undefined;

function ownedUpgrades(r: RunState): OwnedUpgrade[] {
  const out: OwnedUpgrade[] = [];
  for (const [id, stacks] of Object.entries(r.upgrades)) {
    const def = getUpgrade(id);
    if (def && stacks > 0) out.push({ def, stacks });
  }
  return out;
}

// Saves the run as the current one and returns it.
function commitRun(r: RunState): RunState {
  run = r;
  exp = { ...exp, run: r };
  saveExpedition(exp);
  return r;
}

function openExpeditionStart(): void {
  map.hide();
  hideMeta();
  leaveBattlefield();
  runMapShown = false;
  const today = dailySeed(new Date());
  const r = run;
  screens.showStart({
    dailyDate: today.daily,
    dailyBest: exp.best.daily[today.daily],
    bestScore: exp.best.bestScore,
    runsPlayed: exp.best.runsPlayed,
    runsWon: exp.best.runsWon,
    resume: r ? { hp: r.hp, maxHp: r.maxHp, gold: r.gold, battlesWon: r.stats.battlesWon, daily: r.daily } : undefined,
    onNew: () => startRun(randomRunSeed()),
    onDaily: () => startRun(today.seed, today.daily),
    onResume: r ? () => showRunStep() : undefined,
    onBack: () => showMap(),
  });
}

// A new run replaces the current one, which counts as abandoned.
function startRun(seed: number, daily?: string): void {
  if (run) {
    exp = recordRunEnd(exp, abandonRun(run));
    run = undefined;
  }
  commitRun(newRun(seed, daily !== undefined ? { daily } : {}));
  showRunStep();
}

// Shows whatever the run's phase calls for (also how a saved run resumes).
function showRunStep(): void {
  const r = run;
  if (!r) return openExpeditionStart();
  runMapShown = false;
  switch (r.phase) {
    case 'map':
      return showRunMap(r);
    case 'battle':
      return startRunBattle(r);
    case 'pick':
      return showRunPick(r);
    case 'shop':
      return showRunShop(r);
    case 'rest':
      return showRunRest(r);
    case 'over':
      return endRun(r);
  }
}

function enterNode(r: RunState, nodeId: string): void {
  commitRun(chooseNode(r, nodeId));
  showRunStep();
}

function showRunMap(r: RunState): void {
  map.hide();
  leaveBattlefield();
  screens.showMap({
    run: r,
    available: availableNodes(r),
    upgrades: ownedUpgrades(r),
    onChoose: (id) => enterNode(r, id),
    onBack: () => showMap(),
    onAbandon: () => endRun(abandonRun(r), true),
  });
  runMapShown = true;
}

function startRunBattle(r: RunState): void {
  const spec: RunBattleSpec = battleSpec(r);
  const def = applyUpgrades(generateRunBattle(spec), r.upgrades);
  mode = 'expedition';
  // Expedition battles are a level playing field: the basic cannon and Sarge, no loadout.
  battleLoadout = undefined;
  renderer.setLoadout({ cannon: 'popgun', champion: 'sarge' });
  audio.setChampion('sarge');
  hud.setRun({
    hp: r.hp,
    maxHp: r.maxHp,
    gold: r.gold,
    kind: spec.kind,
    upgrades: ownedUpgrades(r).map(({ def: u, stacks }) => ({
      icon: upgradeIconSvg(u.icon, '100%'),
      label: u.name,
      stacks,
    })),
  });
  // Seeded per node, and per retry for the boss, so a resumed run replays the same battle.
  beginBattle(def, spec.seed + r.stats.battlesLost);
}

// The battle's outcome goes into the run; then the pick, lost-battle card or run result.
function finishRunBattle(b: Battle): void {
  const r = run;
  if (!r) return showMap();
  resultShown = true;
  audio.setMusic('menu', { delay: 1 }); // after the fanfare
  input.setPaused(true);
  hud.setVisible(false);
  const victory = b.state.outcome === 'victory';
  const kind = battleSpec(r).kind;
  // Every Expedition battle pays campaign coins too (wins also count toward unlocks).
  const paid = recordExpeditionBattle(profile, kind, victory);
  commitProfile(paid.profile);
  const next = commitRun(
    finishBattle(r, {
      victory,
      baseHpFraction: b.state.playerBaseMaxHp > 0 ? b.state.playerBaseHp / b.state.playerBaseMaxHp : 0,
      seconds: b.stats.endTime ?? outcomeAt,
    }),
  );
  if (next.phase === 'over') return endRun(next);
  if (next.phase === 'pick') return showRunPick(next);
  if (!victory) {
    const hpLost = next.lastBattle?.hpLost ?? 0;
    screens.showBattleLost({
      hpLost,
      hp: next.hp,
      maxHp: next.maxHp,
      boss: kind === 'boss',
      coins: { earned: paid.coins, total: profile.coins },
      onContinue: () => showRunStep(),
    });
    return;
  }
  showRunStep(); // a win with nothing left to offer goes straight back to the map
}

function showRunPick(r: RunState): void {
  const node = r.map.nodes.find((n) => n.id === r.at);
  const offer = (r.offer ?? []).map((id) => getUpgrade(id)).filter((u) => u !== undefined);
  const after = (id: string | null): void => {
    commitRun(pickUpgrade(r, id));
    showRunStep();
  };
  screens.showPick({
    title: 'Victory!',
    elite: node?.kind === 'elite',
    offer,
    owned: r.upgrades,
    hp: r.hp,
    maxHp: r.maxHp,
    hpLost: r.lastBattle?.hpLost ?? 0,
    gold: r.gold,
    goldGained: r.lastBattle?.gold ?? 0,
    onPick: (id) => after(id),
    onSkip: () => after(null),
  });
}

function showRunShop(r: RunState): void {
  leaveBattlefield();
  const shop = r.shop;
  if (!shop) return showRunMap(commitRun(leaveShop(r)));
  screens.showShop({
    gold: r.gold,
    hp: r.hp,
    maxHp: r.maxHp,
    items: shop.items.flatMap((it) => {
      const def = getUpgrade(it.upgradeId);
      return def ? [{ def, price: it.price, sold: it.sold, owned: r.upgrades[def.id] ?? 0 }] : [];
    }),
    heal: { price: shop.healPrice, amount: shop.healAmount, done: shop.healed },
    onBuy: (i) => showRunShop(commitRun(buyItem(r, i))),
    onHeal: () => showRunShop(commitRun(buyHeal(r))),
    onLeave: () => {
      commitRun(leaveShop(r));
      showRunStep();
    },
  });
}

function showRunRest(r: RunState): void {
  leaveBattlefield();
  screens.showRest({
    hp: r.hp,
    maxHp: r.maxHp,
    heal: Math.min(r.maxHp - r.hp, Math.round(r.maxHp * RUN_RULES.restHealFraction)),
    onRest: () => {
      commitRun(restHeal(r));
      showRunStep();
    },
  });
}

// Records a finished run (won, lost or abandoned) and shows its result. A run that was
// played out pays its coins; an abandoned one pays nothing (no free coins for quitting).
function endRun(r: RunState, abandoned = false): void {
  const score = runScore(r);
  const paid = abandoned ? { profile, coins: 0 } : recordExpeditionRun(profile, r);
  commitProfile(paid.profile);
  const prev = r.daily !== undefined ? exp.best.daily[r.daily] : exp.best.bestScore;
  exp = recordRunEnd(exp, r);
  saveExpedition(exp);
  run = undefined;
  runMapShown = false;
  if (!resultShown) leaveBattlefield();
  screens.showRunResult({
    outcome: r.outcome === 'won' ? 'won' : 'lost',
    score,
    best: r.daily !== undefined ? exp.best.daily[r.daily] : exp.best.bestScore,
    newBest: prev === undefined || score > prev,
    daily: r.daily,
    stats: r.stats,
    hp: r.hp,
    maxHp: r.maxHp,
    upgrades: ownedUpgrades(r),
    coins: { earned: paid.coins, total: profile.coins },
    onNewRun: () => openExpeditionStart(),
    onMap: () => showMap(),
  });
}

// ?expedition=<seed>|daily: resumes the saved run when it has that seed, else starts one.
function bootExpedition(param: string): boolean {
  const daily = param === 'daily' ? dailySeed(new Date()) : undefined;
  const seed = daily ? daily.seed : Number(param);
  if (!Number.isInteger(seed) || seed <= 0) return false;
  if (run && run.seed === seed && run.daily === daily?.daily) showRunStep();
  else startRun(seed, daily?.daily);
  return true;
}

function pause(reason: 'user' | InterruptReason): void {
  if (!inBattle || input.paused || resultShown) return;
  input.setPaused(true);
  hud.setVisible(false);
  showPauseOverlay(reason);
}

function showPauseOverlay(reason: 'user' | InterruptReason): void {
  overlays.showPause({
    reason,
    onResume: () => {
      // Resuming while still in landscape on a phone swaps to the rotate prompt instead.
      if (isLandscapeTouch()) return showPauseOverlay('orientation');
      input.setPaused(false);
      hud.setVisible(true);
      wake();
    },
    // An Expedition battle restarts as it was entered; leaving keeps the run in its
    // battle phase, so Resume re-enters it.
    onRestart: () => (mode === 'expedition' ? showRunStep() : startLevel(level.id)),
    onMap: () => showMap(),
  });
}

function showResult(b: Battle): void {
  resultShown = true;
  audio.setMusic('menu', { delay: 1 }); // after the fanfare
  input.setPaused(true);
  hud.setVisible(false);
  const victory = b.state.outcome === 'victory';
  const stars = evaluateStars(level, b.state, b.stats);
  const time = b.stats.endTime ?? outcomeAt;
  const prev = save.levels[level.id];
  const before = facts();
  const r = recordResult(save, level.id, { victory, stars, time });
  const paid = applyCampaignResult(profile, level.id, prev, { victory, stars });
  save = r.save;
  profile = paid.profile;
  writeGame(save, profile);
  const unlocked = newlyUnlocked(before, facts()).flatMap((id) => {
    const it = getItem(id);
    return it ? [{ name: it.name, icon: itemIcon(id, 64) }] : [];
  });
  const next = nextLevelId(level.id);
  const id = level.id;
  overlays.showResult(victory ? 'victory' : 'defeat', {
    levelName: level.name,
    timeSeconds: time,
    hasNext: !!next,
    stars: victory ? stars : [false, false, false],
    goals: starGoalLabels(level),
    newBest: r.newBest,
    coins: { earned: paid.coins, total: profile.coins, lines: paid.lines },
    unlocked,
    onRetry: () => startLevel(id),
    onNext: () => (next ? openLevelCard(next) : showMap()),
    onMap: () => showMap(),
  });
}

// One fixed sim step. Paused input makes battle.step a no-op, so pause needs no special case.
function simStep(): void {
  if (!battle) return;
  const before = events.length;
  const cuesBefore = cues.length;
  battle.step(input.sample(), events, cues);
  if (events.length > before) haptics.onEvents(events.slice(before));
  if (cues.length > cuesBefore) haptics.onCues(cues.slice(cuesBefore));
  if (outcomeAt < 0 && battle.state.outcome !== 'playing') {
    outcomeAt = battle.state.time;
    haptics.result(battle.state.outcome === 'victory');
  }
}

let looping = false;
let contextLost = false; // the WebGL context is gone: draw nothing until it is restored
let woke = false; // the next frame is the first after a restart; its delta spans the menu time
let drawnFps = 0; // smoothed rate of frames actually drawn (rAF may tick faster than the cap)

// (Re)starts the render loop; a no-op while running or while neither a battlefield nor
// the home base is on screen.
function wake(): void {
  if (looping || !(inBattle || home?.visible) || contextLost) return;
  looping = true;
  woke = true;
  loop.reset();
  frameCap.reset();
  engine.runRenderLoop(renderFrame);
}

function stopLoop(): void {
  looping = false;
  engine.stopRenderLoop(renderFrame);
}

// The home base draws only while something in it moves or loads. The loop keeps ticking
// while it is up (an empty rAF callback costs nothing) so a tap on a building redraws.
function homeFrame(h: HomeBase): void {
  const gap = frameCap.tick(performance.now());
  if (gap < 0) return;
  const dt = woke ? 0 : gap;
  woke = false;
  if (!h.needsFrame()) return;
  if (gap > 0) drawnFps = drawnFps > 0 ? drawnFps + (1 / gap - drawnFps) * 0.1 : 1 / gap;
  h.frame(dt);
  h.scene.render();
}

function renderFrame(): void {
  if (home?.visible) return homeFrame(home);
  if (!battle || !sim || !inBattle) {
    stopLoop();
    return;
  }
  // 60 fps cap: skip rAF callbacks that arrive sooner than one 60 Hz frame. Nothing is
  // drawn on a skipped callback, so the canvas keeps showing the last frame.
  const gap = frameCap.tick(performance.now());
  if (gap < 0) return;
  if (gap > 0) drawnFps = drawnFps > 0 ? drawnFps + (1 / gap - drawnFps) * 0.1 : 1 / gap;
  const dt = woke ? 0 : gap;
  woke = false;
  if (!input.paused && !stageLoading) loop.advance(dt, simStep);
  // After the outcome the crowd keeps settling (the sim keeps stepping) until the result screen.
  if (outcomeAt >= 0 && !resultShown && battle.state.time - outcomeAt >= RESULT_DELAY) {
    if (mode === 'expedition') finishRunBattle(battle);
    else showResult(battle);
  }
  for (const c of cues) renderer.cue(c);
  audio.battleFrame(events, cues);
  renderer.frame({
    view: sim.view,
    battle: battle.state,
    cannonX: battle.cannonX,
    time: sim.time,
    dt,
    events,
    defenders: sim.defenders,
  });
  hud.update(battle.state, level.name, {
    bossName: level.boss?.name,
    bossPhases: level.boss?.phases.length,
    ultimate:
      battleLoadout && battle.hasUltimate
        ? {
            charge: battle.ultimateCharge,
            id: battleLoadout.ultimate.id,
            label: getItem(battleLoadout.ultimate.id)?.name ?? battleLoadout.ultimate.id,
          }
        : undefined,
    champion: { id: battleLoadout ? parseChampion(battleLoadout.champion.id) : 'sarge' },
  });
  events.length = 0;
  cues.length = 0;
  // Static menu up and this frame drawn under it: stop until resume, retry or next
  // (a loading battle keeps drawing so its shaders compile under the loading screen).
  if ((input.paused && !stageLoading) || resultShown) stopLoop();
}

input.onPauseKey(() => {
  if (resultShown) return;
  if (input.paused) return; // the overlay's Resume button handles unpausing
  pause('user');
});
watchInterruptions((r) => pause(r));
// Nothing plays while the tab is hidden (menus included, e.g. a coin tally).
document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));

// A resize clears the canvas; redraw once even when the loop is stopped behind a menu.
engine.onResizeObservable.add(() => wake());

// GPU context loss (iOS drops WebGL contexts under memory pressure or after a long time
// in the background). Babylon's in-place restore proved unreliable there (a blank or
// half-rebuilt battlefield), so the page reloads back to where the player was as soon
// as it is visible (core/recovery.ts). Only when losses repeat right after a recovery
// does the game stay put: it pauses, stops drawing into the dead context, and if the
// context comes back the renderer recompiles and refits under the pause card.
engine.onContextLostObservable.add(() => {
  contextLost = true;
  stopLoop();
  const { plan, count } = planRecovery(readRecovery(), Date.now());
  const target: RecoveryTarget =
    inBattle && !resultShown
      ? mode === 'campaign'
        ? { kind: 'level', id: level.id }
        : { kind: 'expedition' }
      : runMapShown || screens.visible
        ? { kind: 'expedition' }
        : { kind: 'map' };
  if (plan !== 'give-up' && writeRecovery({ at: Date.now(), count, target })) {
    console.warn(`WebGL context lost: reloading (${plan})`);
    if (plan === 'reload-low') writeSavedRender({ quality: 'low', post: 'off' });
    reloadWhenVisible();
    return;
  }
  // Lost again right after two reloads: stop reloading and say so instead of a blank screen.
  window.__hordeFatal?.(
    "This phone keeps dropping the game's graphics (WebGL context lost). " +
      'Close the game and Safari completely, then open it again. If that does not help, restart the phone.',
  );
  pause('hidden');
});

function reloadWhenVisible(): void {
  if (document.visibilityState === 'visible') {
    location.reload();
    return;
  }
  const onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onVisible);
    location.reload();
  };
  document.addEventListener('visibilitychange', onVisible);
}
engine.onContextRestoredObservable.add(() => {
  contextLost = false;
  renderer.contextRestored();
  wake();
});

// The level the player is up to: the first one not yet won (the boss once all are).
function currentLevelId(): string {
  const open = WORLDS.filter((w) => isWorldUnlocked(save, w, WORLDS)).flatMap((w) => w.levels);
  return open.find((id) => !save.levels[id]?.stars[0]) ?? open[open.length - 1] ?? getLevel(0).id;
}

// Opens a meta screen by name; false for an unknown name.
function openScreen(id: string): boolean {
  if (id === 'map') showMap();
  else if (id === 'loadout') openLoadout(currentLevelId());
  else if (id === 'collection') openCollection(() => showMap());
  else if (id === 'home') openHome();
  else return false;
  return true;
}

function currentScreen(): string {
  if (homeWanted) return 'home';
  if (collection.visible) return 'collection';
  if (loadoutScreen.visible) return 'loadout';
  if (inBattle) return 'battle';
  if (screens.visible) return 'expedition';
  if (map.visible) return 'map';
  return overlays.visible ? 'overlay' : 'none';
}

// Redraws whichever meta screen is up with fresh numbers (after a debug coin grant).
function refreshScreen(): void {
  if (home && homeWanted) showHome(home);
  else if (collection.visible) collection.show(collectionView(facts()));
  else if (loadoutScreen.visible) openLoadout(loadoutLevel);
  else if (map.visible && !inBattle) showMap();
}

// Boot: ?level=<id> goes straight into that battle, ?expedition=<seed>|daily onto the
// run, ?screen=loadout|collection|home onto that screen; after a context-loss reload,
// back to where the player was; otherwise the world map.
function boot(): void {
  const startId = params.get('level');
  const expParam = params.get('expedition');
  const screenParam = params.get('screen');
  const recovered = takeRecoveryTarget();
  if (startId && getLevelById(startId)) return startLevel(startId);
  if (expParam && bootExpedition(expParam)) return;
  if (screenParam && openScreen(screenParam)) return;
  if (recovered?.kind === 'level' && getLevelById(recovered.id)) return startLevel(recovered.id);
  if (recovered?.kind === 'expedition' && run) return showRunStep();
  showMap();
}
boot();
// A battle lifts the loading screen itself once its scene is ready; a menu once the font is in.
if (!inBattle) void loading.hideWhen(fontsReady);
window.__hordeBooted = true; // the first screen is up: the index.html boot guard stands down

window.__horde = {
  state: () => (battle ? battle.state : ({} as BattleState)),
  fps: () => drawnFps,
  zoom: () => renderer.cameraZoom,
  level: () =>
    screens.visible && runMapShown ? 'expedition-map' : inBattle ? level.id : screens.visible ? 'expedition' : 'map',
  spawn: (n: number, champion = false) => {
    const count = Math.max(0, Math.floor(n));
    if (count > 0 && sim && battle) {
      const kind = champion ? UnitKind.Champion : UnitKind.Mob;
      // Spread over rows up the lane like a cannon stream (all on one z, separation
      // squeezes a big spawn into a single solid band across the rug).
      const spread = level.lane.width / 2 - 0.6;
      const perRow = Math.max(1, Math.floor(spread * 2.2));
      const rows = Math.ceil(count / perRow);
      const depth = Math.min(22, rows * 0.9);
      for (let r = 0, left = count; r < rows && left > 0; r++) {
        const k = r === rows - 1 ? left : Math.min(left, perRow);
        sim.spawn(
          Team.Player,
          kind,
          battle.cannonX,
          LAYOUT.cannonZ + 2 + (rows > 1 ? (r / (rows - 1)) * depth : 0),
          k,
          { spread },
        );
        left -= k;
      }
    }
  },
  units: () => (sim ? sim.view.count : 0),
  goto: (id: string) => {
    if (!getLevelById(id)) return false;
    startLevel(id);
    return true;
  },
  render: () => renderer.stats(),
  expedition: () => run ?? null,
  expeditionChoose: (id: string) => {
    if (!run || !availableNodes(run).includes(id)) return false;
    screens.hide();
    enterNode(run, id);
    return true;
  },
  win: () => {
    if (battle && battle.state.outcome === 'playing') battle.state.enemyBaseHp = 0;
  },
  profile: () => structuredClone(profile),
  coins: (n: number) => {
    const add = Math.floor(n);
    if (Number.isFinite(add) && add > 0) {
      commitProfile(addCoins(profile, add));
      refreshScreen();
    }
    return profile.coins;
  },
  screen: (id?: string) => {
    if (id !== undefined) openScreen(id);
    return currentScreen();
  },
};

// ?debug exposes the Babylon scene for console inspection (draw-call and mesh audits).
if (params.has('debug')) (window as unknown as { __scene?: unknown }).__scene = renderer.scene;

if (import.meta.env.PROD) registerServiceWorker();
